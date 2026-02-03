//! Tauri commands for AI context sync.

use std::sync::Arc;
use tauri::State;

use super::store::{ActiveContext, AiContextStore, QueryHistoryEntry};

/// State wrapper for AI context store
pub struct AiContextState(pub Arc<AiContextStore>);

/// Sync active editor context from frontend
#[tauri::command]
pub async fn sync_ai_context(
    state: State<'_, AiContextState>,
    context: ActiveContext,
) -> Result<(), String> {
    state.0.set_active_context(context).await;
    Ok(())
}

/// Track a query execution (called after query runs)
#[tauri::command]
pub async fn track_query_execution(
    state: State<'_, AiContextState>,
    entry: QueryHistoryEntry,
) -> Result<(), String> {
    state.0.add_history_entry(entry).await;
    Ok(())
}

/// Get query history (for debugging/testing)
#[tauri::command]
pub async fn get_ai_query_history(
    state: State<'_, AiContextState>,
    limit: Option<usize>,
    connection_id: Option<String>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let limit = limit.unwrap_or(20);
    Ok(state.0.get_history(limit, connection_id.as_deref()).await)
}

/// Get current active context (for debugging/testing)
#[tauri::command]
pub async fn get_ai_active_context(
    state: State<'_, AiContextState>,
) -> Result<ActiveContext, String> {
    Ok(state.0.get_active_context().await)
}
