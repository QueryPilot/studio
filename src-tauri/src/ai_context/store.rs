//! AI Context Store
//!
//! Thread-safe store for AI-relevant state synced from frontend.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tokio::sync::RwLock;

/// Maximum number of history entries to keep
const MAX_HISTORY_ENTRIES: usize = 100;

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
}

/// Thread-safe AI context store
pub struct AiContextStore {
    history: RwLock<VecDeque<QueryHistoryEntry>>,
    active_context: RwLock<ActiveContext>,
}

impl AiContextStore {
    pub fn new() -> Self {
        Self {
            history: RwLock::new(VecDeque::with_capacity(MAX_HISTORY_ENTRIES)),
            active_context: RwLock::new(ActiveContext::default()),
        }
    }

    /// Add a query execution to history
    pub async fn add_history_entry(&self, entry: QueryHistoryEntry) {
        let mut history = self.history.write().await;
        history.push_front(entry);
        if history.len() > MAX_HISTORY_ENTRIES {
            history.pop_back();
        }
    }

    /// Get recent query history
    pub async fn get_history(&self, limit: usize, connection_id: Option<&str>) -> Vec<QueryHistoryEntry> {
        let history = self.history.read().await;
        history
            .iter()
            .filter(|e| connection_id.map_or(true, |id| e.connection_id == id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// Update active editor context
    pub async fn set_active_context(&self, context: ActiveContext) {
        let mut active = self.active_context.write().await;
        *active = context;
    }

    /// Get current active context
    pub async fn get_active_context(&self) -> ActiveContext {
        self.active_context.read().await.clone()
    }

    /// Clear all history
    pub async fn clear_history(&self) {
        let mut history = self.history.write().await;
        history.clear();
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

        store.add_history_entry(QueryHistoryEntry {
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
        }).await;

        let history = store.get_history(10, None).await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].query, "SELECT 1");
    }

    #[tokio::test]
    async fn test_history_limit() {
        let store = AiContextStore::new();

        for i in 0..150 {
            store.add_history_entry(QueryHistoryEntry {
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
            }).await;
        }

        let history = store.get_history(200, None).await;
        assert_eq!(history.len(), MAX_HISTORY_ENTRIES);
        // Most recent should be first
        assert_eq!(history[0].id, "149");
    }

    #[tokio::test]
    async fn test_filter_by_connection() {
        let store = AiContextStore::new();

        store.add_history_entry(QueryHistoryEntry {
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
        }).await;

        store.add_history_entry(QueryHistoryEntry {
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
        }).await;

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
        store.set_active_context(ActiveContext {
            connection_id: Some("conn-1".to_string()),
            database: Some("mydb".to_string()),
            schema: Some("public".to_string()),
            query: Some("SELECT * FROM users".to_string()),
            last_executed_query: None,
            has_results: true,
            row_count: Some(10),
            column_count: Some(3),
            updated_at: 12345,
        }).await;

        let context = store.get_active_context().await;
        assert_eq!(context.connection_id, Some("conn-1".to_string()));
        assert_eq!(context.database, Some("mydb".to_string()));
        assert!(context.has_results);
        assert_eq!(context.row_count, Some(10));
    }

    #[tokio::test]
    async fn test_clear_history() {
        let store = AiContextStore::new();

        store.add_history_entry(QueryHistoryEntry {
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
        }).await;

        assert_eq!(store.get_history(10, None).await.len(), 1);

        store.clear_history().await;

        assert_eq!(store.get_history(10, None).await.len(), 0);
    }
}
