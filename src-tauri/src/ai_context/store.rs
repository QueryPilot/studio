//! AI Context Store
//!
//! Thread-safe store for AI-relevant state synced from frontend.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use tokio::sync::RwLock;

/// Maximum number of history entries to keep
const MAX_HISTORY_ENTRIES: usize = 100;

/// Maximum number of active contexts to track (one per connection/window)
const MAX_ACTIVE_CONTEXTS: usize = 10;

/// Snapshot file name consumed by the `querypilot agent` CLI.
const SNAPSHOT_FILE_NAME: &str = "ai-context-store.json";

/// A query execution record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub query: String,
    pub connection_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub executed_at: u64,
    pub execution_time_ms: Option<u64>,
    pub row_count: Option<usize>,
    pub success: bool,
    pub error: Option<String>,
}

/// Current active editor context
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActiveContext {
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub query: Option<String>,
    pub last_executed_query: Option<String>,
    pub has_results: bool,
    pub row_count: Option<usize>,
    pub column_count: Option<usize>,
    pub updated_at: u64,
    pub panel_id: Option<String>,
    pub tab_id: Option<String>,
    pub tab_type: Option<String>,
    pub title: Option<String>,
    pub filter: Option<String>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub view_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAiContextSnapshot {
    history: Vec<QueryHistoryEntry>,
    active_contexts: Vec<ActiveContext>,
}

/// Thread-safe AI context store
pub struct AiContextStore {
    history: RwLock<VecDeque<QueryHistoryEntry>>,
    active_contexts: RwLock<Vec<ActiveContext>>,
}

impl AiContextStore {
    pub fn new() -> Self {
        Self {
            history: RwLock::new(VecDeque::with_capacity(MAX_HISTORY_ENTRIES)),
            active_contexts: RwLock::new(Vec::new()),
        }
    }

    fn snapshot_path() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".querypilot").join(SNAPSHOT_FILE_NAME)
    }

    async fn persist_snapshot(&self) {
        let history = {
            let h = self.history.read().await;
            h.iter().cloned().collect::<Vec<_>>()
        };
        let active_contexts = {
            let c = self.active_contexts.read().await;
            c.clone()
        };

        let payload = PersistedAiContextSnapshot {
            history,
            active_contexts,
        };

        let Ok(serialized) = serde_json::to_string(&payload) else {
            tracing::warn!("[AIContext] Failed to serialize snapshot");
            return;
        };

        let path = Self::snapshot_path();
        if let Some(parent) = path.parent() {
            if let Err(err) = tokio::fs::create_dir_all(parent).await {
                tracing::warn!(
                    "[AIContext] Failed to create snapshot directory {}: {}",
                    parent.display(),
                    err
                );
                return;
            }
        }

        if let Err(err) = tokio::fs::write(&path, serialized).await {
            tracing::warn!(
                "[AIContext] Failed to persist snapshot {}: {}",
                path.display(),
                err
            );
        }
    }

    /// Add a query execution to history
    pub async fn add_history_entry(&self, entry: QueryHistoryEntry) {
        {
            let mut history = self.history.write().await;
            history.push_front(entry);
            if history.len() > MAX_HISTORY_ENTRIES {
                history.pop_back();
            }
        }
        self.persist_snapshot().await;
    }

    /// Get recent query history
    pub async fn get_history(
        &self,
        limit: usize,
        connection_id: Option<&str>,
    ) -> Vec<QueryHistoryEntry> {
        let history = self.history.read().await;
        history
            .iter()
            .filter(|e| connection_id.is_none_or(|id| e.connection_id == id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// Update active editor context (upserts by connection_id)
    pub async fn set_active_context(&self, context: ActiveContext) {
        {
            let mut contexts = self.active_contexts.write().await;

            // Upsert: if a context with the same connection_id exists, update it
            if let Some(conn_id) = &context.connection_id {
                if let Some(existing) = contexts
                    .iter_mut()
                    .find(|c| c.connection_id.as_ref() == Some(conn_id))
                {
                    *existing = context;
                    drop(contexts);
                    self.persist_snapshot().await;
                    return;
                }
            }

            // Push new context, evict oldest if at capacity
            if contexts.len() >= MAX_ACTIVE_CONTEXTS {
                // Remove the one with the oldest updated_at
                if let Some(oldest_idx) = contexts
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, c)| c.updated_at)
                    .map(|(i, _)| i)
                {
                    contexts.remove(oldest_idx);
                }
            }
            contexts.push(context);
        }
        self.persist_snapshot().await;
    }

    /// Get most recent active context (backwards compatible)
    pub async fn get_active_context(&self) -> ActiveContext {
        let contexts = self.active_contexts.read().await;
        contexts
            .iter()
            .max_by_key(|c| c.updated_at)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all active contexts, sorted by updated_at descending (most recent first)
    pub async fn get_all_active_contexts(&self) -> Vec<ActiveContext> {
        let contexts = self.active_contexts.read().await;
        let mut sorted = contexts.clone();
        sorted.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sorted
    }

    /// Clear all history
    pub async fn clear_history(&self) {
        {
            let mut history = self.history.write().await;
            history.clear();
        }
        self.persist_snapshot().await;
    }
}

impl Default for AiContextStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_add_and_get_history() {
        let store = AiContextStore::new();

        store
            .add_history_entry(QueryHistoryEntry {
                id: "1".to_string(),
                query: "SELECT 1".to_string(),
                connection_id: "conn-1".to_string(),
                database: "test".to_string(),
                schema: Some("public".to_string()),
                executed_at: 1000,
                execution_time_ms: Some(50),
                row_count: Some(1),
                success: true,
                error: None,
            })
            .await;

        let history = store.get_history(10, None).await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].query, "SELECT 1");
    }

    #[tokio::test]
    async fn test_history_limit() {
        let store = AiContextStore::new();

        for i in 0..150 {
            store
                .add_history_entry(QueryHistoryEntry {
                    id: i.to_string(),
                    query: format!("SELECT {}", i),
                    connection_id: "conn-1".to_string(),
                    database: "test".to_string(),
                    schema: None,
                    executed_at: i as u64,
                    execution_time_ms: None,
                    row_count: None,
                    success: true,
                    error: None,
                })
                .await;
        }

        let history = store.get_history(200, None).await;
        assert_eq!(history.len(), MAX_HISTORY_ENTRIES);
        // Most recent should be first
        assert_eq!(history[0].id, "149");
    }

    #[tokio::test]
    async fn test_filter_by_connection() {
        let store = AiContextStore::new();

        store
            .add_history_entry(QueryHistoryEntry {
                id: "1".to_string(),
                query: "SELECT 1".to_string(),
                connection_id: "conn-1".to_string(),
                database: "test".to_string(),
                schema: None,
                executed_at: 1000,
                execution_time_ms: None,
                row_count: None,
                success: true,
                error: None,
            })
            .await;

        store
            .add_history_entry(QueryHistoryEntry {
                id: "2".to_string(),
                query: "SELECT 2".to_string(),
                connection_id: "conn-2".to_string(),
                database: "test".to_string(),
                schema: None,
                executed_at: 2000,
                execution_time_ms: None,
                row_count: None,
                success: true,
                error: None,
            })
            .await;

        let filtered = store.get_history(10, Some("conn-1")).await;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].connection_id, "conn-1");
    }

    #[tokio::test]
    async fn test_active_context() {
        let store = AiContextStore::new();

        // Default context should be empty
        let context = store.get_active_context().await;
        assert!(context.connection_id.is_none());
        assert!(!context.has_results);

        // Set active context
        store
            .set_active_context(ActiveContext {
                connection_id: Some("conn-1".to_string()),
                database: Some("mydb".to_string()),
                schema: Some("public".to_string()),
                query: Some("SELECT * FROM users".to_string()),
                last_executed_query: None,
                has_results: true,
                row_count: Some(10),
                column_count: Some(3),
                updated_at: 12345,
                ..Default::default()
            })
            .await;

        let context = store.get_active_context().await;
        assert_eq!(context.connection_id, Some("conn-1".to_string()));
        assert_eq!(context.database, Some("mydb".to_string()));
        assert!(context.has_results);
        assert_eq!(context.row_count, Some(10));
    }

    #[tokio::test]
    async fn test_active_context_upsert_by_connection_id() {
        let store = AiContextStore::new();

        // Insert first context
        store
            .set_active_context(ActiveContext {
                connection_id: Some("conn-1".to_string()),
                database: Some("db1".to_string()),
                schema: None,
                query: Some("SELECT 1".to_string()),
                last_executed_query: None,
                has_results: false,
                row_count: None,
                column_count: None,
                updated_at: 100,
                ..Default::default()
            })
            .await;

        // Insert second context with same connection_id (should update, not add)
        store
            .set_active_context(ActiveContext {
                connection_id: Some("conn-1".to_string()),
                database: Some("db1_updated".to_string()),
                schema: None,
                query: Some("SELECT 2".to_string()),
                last_executed_query: None,
                has_results: true,
                row_count: Some(5),
                column_count: Some(2),
                updated_at: 200,
                ..Default::default()
            })
            .await;

        let all = store.get_all_active_contexts().await;
        assert_eq!(
            all.len(),
            1,
            "Should have 1 context (upserted), got {}",
            all.len()
        );
        assert_eq!(all[0].query, Some("SELECT 2".to_string()));
        assert_eq!(all[0].database, Some("db1_updated".to_string()));
    }

    #[tokio::test]
    async fn test_active_context_multiple_connections() {
        let store = AiContextStore::new();

        store
            .set_active_context(ActiveContext {
                connection_id: Some("conn-1".to_string()),
                database: Some("db1".to_string()),
                schema: None,
                query: None,
                last_executed_query: None,
                has_results: false,
                row_count: None,
                column_count: None,
                updated_at: 100,
                ..Default::default()
            })
            .await;

        store
            .set_active_context(ActiveContext {
                connection_id: Some("conn-2".to_string()),
                database: Some("db2".to_string()),
                schema: None,
                query: None,
                last_executed_query: None,
                has_results: false,
                row_count: None,
                column_count: None,
                updated_at: 200,
                ..Default::default()
            })
            .await;

        let all = store.get_all_active_contexts().await;
        assert_eq!(all.len(), 2);
        // Most recent first
        assert_eq!(all[0].connection_id, Some("conn-2".to_string()));
        assert_eq!(all[1].connection_id, Some("conn-1".to_string()));

        // get_active_context returns most recent
        let primary = store.get_active_context().await;
        assert_eq!(primary.connection_id, Some("conn-2".to_string()));
    }

    #[tokio::test]
    async fn test_active_context_eviction() {
        let store = AiContextStore::new();

        // Insert MAX_ACTIVE_CONTEXTS + 1 contexts
        for i in 0..=MAX_ACTIVE_CONTEXTS {
            store
                .set_active_context(ActiveContext {
                    connection_id: Some(format!("conn-{}", i)),
                    database: Some(format!("db-{}", i)),
                    schema: None,
                    query: None,
                    last_executed_query: None,
                    has_results: false,
                    row_count: None,
                    column_count: None,
                    updated_at: i as u64,
                    ..Default::default()
                })
                .await;
        }

        let all = store.get_all_active_contexts().await;
        assert_eq!(all.len(), MAX_ACTIVE_CONTEXTS);

        // The oldest (conn-0 with updated_at=0) should have been evicted
        assert!(
            !all.iter()
                .any(|c| c.connection_id == Some("conn-0".to_string())),
            "conn-0 should have been evicted"
        );

        // The most recent should still be there
        assert!(
            all.iter()
                .any(|c| c.connection_id == Some(format!("conn-{}", MAX_ACTIVE_CONTEXTS))),
            "Most recent context should still be present"
        );
    }

    #[tokio::test]
    async fn test_clear_history() {
        let store = AiContextStore::new();

        store
            .add_history_entry(QueryHistoryEntry {
                id: "1".to_string(),
                query: "SELECT 1".to_string(),
                connection_id: "conn-1".to_string(),
                database: "test".to_string(),
                schema: None,
                executed_at: 1000,
                execution_time_ms: None,
                row_count: None,
                success: true,
                error: None,
            })
            .await;

        assert_eq!(store.get_history(10, None).await.len(), 1);

        store.clear_history().await;

        assert_eq!(store.get_history(10, None).await.len(), 0);
    }
}
