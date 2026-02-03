# MCP Enhanced Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add new MCP tools (`get_query_history`, `get_current_context`, `get_execution_plan`, `get_table_relationships`) to enable AI agents to understand user context and provide better assistance.

**Architecture:** Backend-centric approach where the Tauri backend maintains AI-relevant state. The frontend syncs active context (current query, connection) to the backend via Tauri commands. The MCP sidecar queries this state through the existing IPC bridge.

**Tech Stack:** Rust (Tauri backend + MCP sidecar), TypeScript (React frontend), JSON-RPC over Unix socket

---

## Overview

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Frontend   │────▶│  Tauri Backend  │◀────│ MCP Sidecar │
│  (React)    │sync │  (Rust)         │ IPC │  (Rust)     │
└─────────────┘     └─────────────────┘     └─────────────┘
       │                    │
       │ Tauri commands:    │ New stores:
       │ - sync_ai_context  │ - AiContextStore
       │                    │ - QueryHistoryStore
       └────────────────────┘
```

**New MCP Tools (MVP):**
1. `get_query_history` - Recent queries executed by user
2. `get_current_context` - Current editor state (query, connection, results summary)
3. `get_execution_plan` - EXPLAIN output for query optimization
4. `get_table_relationships` - Foreign keys and join paths

---

## Task 1: Create AI Context Store (Backend)

**Files:**
- Create: `src-tauri/src/ai_context/mod.rs`
- Create: `src-tauri/src/ai_context/store.rs`
- Modify: `src-tauri/src/lib.rs` (add module)

**Step 1: Create the module structure**

Create `src-tauri/src/ai_context/mod.rs`:
```rust
//! AI Context Module
//!
//! Stores context for AI agents: query history, active editor state, etc.
//! This data is synced from the frontend and exposed via the MCP bridge.

pub mod store;

pub use store::{AiContextStore, ActiveContext, QueryHistoryEntry};
```

**Step 2: Create the context store**

Create `src-tauri/src/ai_context/store.rs`:
```rust
//! AI Context Store
//!
//! Thread-safe store for AI-relevant state synced from frontend.

use std::collections::VecDeque;
use std::sync::RwLock;
use serde::{Deserialize, Serialize};

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
    pub fn add_history_entry(&self, entry: QueryHistoryEntry) {
        let mut history = self.history.write().unwrap();
        history.push_front(entry);
        if history.len() > MAX_HISTORY_ENTRIES {
            history.pop_back();
        }
    }

    /// Get recent query history
    pub fn get_history(&self, limit: usize, connection_id: Option<&str>) -> Vec<QueryHistoryEntry> {
        let history = self.history.read().unwrap();
        history
            .iter()
            .filter(|e| connection_id.map_or(true, |id| e.connection_id == id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// Update active editor context
    pub fn set_active_context(&self, context: ActiveContext) {
        let mut active = self.active_context.write().unwrap();
        *active = context;
    }

    /// Get current active context
    pub fn get_active_context(&self) -> ActiveContext {
        self.active_context.read().unwrap().clone()
    }

    /// Clear all history
    pub fn clear_history(&self) {
        let mut history = self.history.write().unwrap();
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

    #[test]
    fn test_add_and_get_history() {
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
        });

        let history = store.get_history(10, None);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].query, "SELECT 1");
    }

    #[test]
    fn test_history_limit() {
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
            });
        }

        let history = store.get_history(200, None);
        assert_eq!(history.len(), MAX_HISTORY_ENTRIES);
        // Most recent should be first
        assert_eq!(history[0].id, "149");
    }

    #[test]
    fn test_filter_by_connection() {
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
        });

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
        });

        let filtered = store.get_history(10, Some("conn-1"));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].connection_id, "conn-1");
    }
}
```

**Step 3: Register the module in lib.rs**

Modify `src-tauri/src/lib.rs` - add near other module declarations:
```rust
pub mod ai_context;
```

**Step 4: Run tests**

```bash
cd src-tauri && cargo test ai_context
```
Expected: All tests pass

**Step 5: Commit**

```bash
git add src-tauri/src/ai_context/
git add src-tauri/src/lib.rs
git commit -m "feat(ai-context): add AI context store for query history and active context"
```

---

## Task 2: Add Tauri Commands for AI Context

**Files:**
- Create: `src-tauri/src/ai_context/commands.rs`
- Modify: `src-tauri/src/ai_context/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

**Step 1: Create the commands module**

Create `src-tauri/src/ai_context/commands.rs`:
```rust
//! Tauri commands for AI context sync.

use std::sync::Arc;
use tauri::State;

use super::store::{ActiveContext, AiContextStore, QueryHistoryEntry};

/// State wrapper for AI context store
pub struct AiContextState(pub Arc<AiContextStore>);

/// Sync active editor context from frontend
#[tauri::command]
pub fn sync_ai_context(
    state: State<'_, AiContextState>,
    context: ActiveContext,
) -> Result<(), String> {
    state.0.set_active_context(context);
    Ok(())
}

/// Track a query execution (called after query runs)
#[tauri::command]
pub fn track_query_execution(
    state: State<'_, AiContextState>,
    entry: QueryHistoryEntry,
) -> Result<(), String> {
    state.0.add_history_entry(entry);
    Ok(())
}

/// Get query history (for debugging/testing)
#[tauri::command]
pub fn get_ai_query_history(
    state: State<'_, AiContextState>,
    limit: Option<usize>,
    connection_id: Option<String>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let limit = limit.unwrap_or(20);
    Ok(state.0.get_history(limit, connection_id.as_deref()))
}

/// Get current active context (for debugging/testing)
#[tauri::command]
pub fn get_ai_active_context(
    state: State<'_, AiContextState>,
) -> Result<ActiveContext, String> {
    Ok(state.0.get_active_context())
}
```

**Step 2: Update mod.rs to export commands**

Modify `src-tauri/src/ai_context/mod.rs`:
```rust
//! AI Context Module
//!
//! Stores context for AI agents: query history, active editor state, etc.
//! This data is synced from the frontend and exposed via the MCP bridge.

pub mod commands;
pub mod store;

pub use commands::AiContextState;
pub use store::{AiContextStore, ActiveContext, QueryHistoryEntry};
```

**Step 3: Register state and commands in lib.rs**

Modify `src-tauri/src/lib.rs` - in the `run()` function, add state management and register commands.

Find the `.manage()` calls and add:
```rust
.manage(ai_context::AiContextState(std::sync::Arc::new(
    ai_context::AiContextStore::new(),
)))
```

Find the `.invoke_handler()` call and add the new commands to the list:
```rust
ai_context::commands::sync_ai_context,
ai_context::commands::track_query_execution,
ai_context::commands::get_ai_query_history,
ai_context::commands::get_ai_active_context,
```

**Step 4: Verify compilation**

```bash
cd src-tauri && cargo check
```
Expected: No errors

**Step 5: Commit**

```bash
git add src-tauri/src/ai_context/commands.rs
git add src-tauri/src/ai_context/mod.rs
git add src-tauri/src/lib.rs
git commit -m "feat(ai-context): add Tauri commands for syncing AI context"
```

---

## Task 3: Add Frontend Service for AI Context Sync

**Files:**
- Create: `src/services/aiContextService.ts`
- Modify: `src/stores/tabStateStore.ts` (add sync hook)

**Step 1: Create the AI context service**

Create `src/services/aiContextService.ts`:
```typescript
/**
 * AI Context Service
 *
 * Syncs frontend state to backend for AI agent access.
 */

import { invoke } from "@tauri-apps/api/core";

export interface ActiveContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  query: string | null;
  lastExecutedQuery: string | null;
  hasResults: boolean;
  rowCount: number | null;
  columnCount: number | null;
  updatedAt: number;
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  connectionId: string;
  database: string;
  schema?: string;
  executedAt: number;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
}

/**
 * Sync active editor context to backend
 */
export async function syncAiContext(context: ActiveContext): Promise<void> {
  try {
    await invoke("sync_ai_context", { context });
  } catch (error) {
    console.error("[AIContext] Failed to sync context:", error);
  }
}

/**
 * Track a query execution in AI history
 */
export async function trackQueryExecution(
  entry: QueryHistoryEntry
): Promise<void> {
  try {
    await invoke("track_query_execution", { entry });
  } catch (error) {
    console.error("[AIContext] Failed to track execution:", error);
  }
}

// Debounce timer for context sync
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 500;

/**
 * Debounced context sync (call frequently, syncs at most every 500ms)
 */
export function debouncedSyncAiContext(context: ActiveContext): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    void syncAiContext(context);
    syncTimer = null;
  }, SYNC_DEBOUNCE_MS);
}
```

**Step 2: Add sync hook to tabStateStore**

Modify `src/stores/tabStateStore.ts` - add import at top:
```typescript
import { debouncedSyncAiContext } from "@/services/aiContextService";
```

In the `setQueryState` function, after updating state, add AI context sync.

Find the line `return { queryStates: newStates };` in `setQueryState` and before it add:
```typescript
      // Sync to AI context (for MCP tools)
      // Only sync if we have meaningful state
      if (newState.query || newState.result) {
        debouncedSyncAiContext({
          connectionId: null, // Will be set by the component that has connection context
          database: null,
          schema: null,
          query: newState.query || null,
          lastExecutedQuery: newState.lastExecutedQuery || null,
          hasResults: newState.result !== null,
          rowCount: newState.result?.rowCount ?? null,
          columnCount: newState.result?.columns?.length ?? null,
          updatedAt: Date.now(),
        });
      }
```

**Step 3: Verify TypeScript compiles**

```bash
pnpm typecheck
```
Expected: No errors

**Step 4: Commit**

```bash
git add src/services/aiContextService.ts
git add src/stores/tabStateStore.ts
git commit -m "feat(frontend): add AI context sync service and hook to tabStateStore"
```

---

## Task 4: Add MCP Bridge Handlers for AI Context

**Files:**
- Modify: `src-tauri/src/mcp/handlers.rs`

**Step 1: Add imports for AI context**

At the top of `src-tauri/src/mcp/handlers.rs`, add:
```rust
use crate::ai_context::{AiContextStore, ActiveContext, QueryHistoryEntry};
```

**Step 2: Update McpHandler to include AI context store**

Find the `McpHandler` struct and update:
```rust
/// MCP Bridge request handler
pub struct McpHandler {
    manager: Arc<ConnectionManager>,
    ai_context: Arc<AiContextStore>,
}

impl McpHandler {
    pub fn new(manager: Arc<ConnectionManager>, ai_context: Arc<AiContextStore>) -> Self {
        Self { manager, ai_context }
    }
```

**Step 3: Add new method handlers in handle_request**

Find the `handle_request` match statement and add new methods:
```rust
            "get_query_history" => self.handle_get_query_history(id.clone(), params).await,
            "get_current_context" => self.handle_get_current_context(id.clone()).await,
            "get_execution_plan" => self.handle_get_execution_plan(id.clone(), params).await,
```

**Step 4: Implement the handler methods**

Add these methods to the `impl McpHandler` block:

```rust
    /// Get query history
    async fn handle_get_query_history(&self, id: String, params: Value) -> JsonRpcResponse {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Params {
            #[serde(default)]
            limit: Option<usize>,
            #[serde(default)]
            connection_id: Option<String>,
        }

        let params: Params = match serde_json::from_value(params) {
            Ok(p) => p,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Invalid parameters: {}", e),
                );
            }
        };

        let limit = params.limit.unwrap_or(20).min(100);
        let history = self.ai_context.get_history(limit, params.connection_id.as_deref());

        match serde_json::to_value(&history) {
            Ok(value) => JsonRpcResponse::success(id, value),
            Err(e) => JsonRpcResponse::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Serialization error: {}", e),
            ),
        }
    }

    /// Get current active context
    async fn handle_get_current_context(&self, id: String) -> JsonRpcResponse {
        let context = self.ai_context.get_active_context();

        match serde_json::to_value(&context) {
            Ok(value) => JsonRpcResponse::success(id, value),
            Err(e) => JsonRpcResponse::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Serialization error: {}", e),
            ),
        }
    }

    /// Get execution plan (EXPLAIN) for a query
    async fn handle_get_execution_plan(&self, id: String, params: Value) -> JsonRpcResponse {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Params {
            connection_id: String,
            query: String,
            #[serde(default)]
            analyze: bool, // If true, use EXPLAIN ANALYZE (actually runs query)
        }

        let params: Params = match serde_json::from_value(params) {
            Ok(p) => p,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Invalid parameters: {}", e),
                );
            }
        };

        let conn = match self.manager.get_connection(&params.connection_id) {
            Some(c) => c,
            None => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::CONNECTION_NOT_FOUND,
                    format!("Connection not found: {}", params.connection_id),
                );
            }
        };

        let sql_adapter = match conn.adapter.as_sql() {
            Some(a) => a,
            None => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::QUERY_FAILED,
                    "Connection does not support SQL queries".to_string(),
                );
            }
        };

        // Build EXPLAIN query based on database type
        let db_type = conn.adapter.db_type();
        let explain_query = match db_type {
            crate::types::DbType::PostgreSQL => {
                if params.analyze {
                    format!("EXPLAIN (ANALYZE, FORMAT TEXT) {}", params.query)
                } else {
                    format!("EXPLAIN (FORMAT TEXT) {}", params.query)
                }
            }
            crate::types::DbType::MySQL | crate::types::DbType::MariaDB => {
                if params.analyze {
                    format!("EXPLAIN ANALYZE {}", params.query)
                } else {
                    format!("EXPLAIN {}", params.query)
                }
            }
            crate::types::DbType::SQLite => {
                format!("EXPLAIN QUERY PLAN {}", params.query)
            }
            crate::types::DbType::SQLServer => {
                // SQL Server uses SET SHOWPLAN_TEXT ON before query
                // For simplicity, we'll use a different approach
                format!("SET SHOWPLAN_TEXT ON; {}", params.query)
            }
            _ => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::QUERY_FAILED,
                    format!("EXPLAIN not supported for {:?}", db_type),
                );
            }
        };

        match sql_adapter.execute_query(&explain_query).await {
            Ok(result) => {
                // Format as text output
                let plan_text: Vec<String> = result.rows
                    .iter()
                    .map(|row| {
                        row.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                            .join(" | ")
                    })
                    .collect();

                let output = serde_json::json!({
                    "plan": plan_text.join("\n"),
                    "databaseType": format!("{:?}", db_type),
                    "analyzed": params.analyze,
                });

                JsonRpcResponse::success(id, output)
            }
            Err(e) => JsonRpcResponse::error(
                id,
                error_codes::QUERY_FAILED,
                format!("Failed to get execution plan: {}", e),
            ),
        }
    }
```

**Step 5: Verify compilation**

```bash
cd src-tauri && cargo check
```
Expected: No errors (may need to update bridge.rs to pass ai_context)

**Step 6: Commit**

```bash
git add src-tauri/src/mcp/handlers.rs
git commit -m "feat(mcp): add handlers for get_query_history, get_current_context, get_execution_plan"
```

---

## Task 5: Update MCP Bridge to Pass AI Context Store

**Files:**
- Modify: `src-tauri/src/mcp/bridge.rs`

**Step 1: Update bridge to accept AI context store**

Find the `McpBridge` struct and its `new()` method. Update to accept `Arc<AiContextStore>`:

```rust
use crate::ai_context::AiContextStore;

impl McpBridge {
    pub fn new(manager: Arc<ConnectionManager>, ai_context: Arc<AiContextStore>) -> Self {
        Self {
            manager,
            ai_context,
            // ... other fields
        }
    }
```

Update where `McpHandler::new()` is called to pass `ai_context`:
```rust
let handler = McpHandler::new(Arc::clone(&self.manager), Arc::clone(&self.ai_context));
```

**Step 2: Update lib.rs to pass AI context to bridge**

In `src-tauri/src/lib.rs`, find where `McpBridge` is created and update to pass the AI context store.

**Step 3: Verify compilation**

```bash
cd src-tauri && cargo check
```
Expected: No errors

**Step 4: Commit**

```bash
git add src-tauri/src/mcp/bridge.rs
git add src-tauri/src/lib.rs
git commit -m "feat(mcp): wire AI context store through MCP bridge"
```

---

## Task 6: Add MCP Sidecar Tools

**Files:**
- Create: `src-mcp-sidecar/src/tools/context.rs`
- Modify: `src-mcp-sidecar/src/tools/mod.rs`
- Modify: `src-mcp-sidecar/src/ipc_client.rs`

**Step 1: Add IPC client methods**

Add to `src-mcp-sidecar/src/ipc_client.rs`:
```rust
    /// Get query history
    pub async fn get_query_history(
        &self,
        limit: Option<usize>,
        connection_id: Option<&str>,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "limit": limit,
            "connectionId": connection_id
        });
        self.request("get_query_history", params).await
    }

    /// Get current active context
    pub async fn get_current_context(&self) -> Result<serde_json::Value> {
        self.request("get_current_context", serde_json::json!({})).await
    }

    /// Get execution plan for a query
    pub async fn get_execution_plan(
        &self,
        connection_id: &str,
        query: &str,
        analyze: bool,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "connectionId": connection_id,
            "query": query,
            "analyze": analyze
        });
        self.request("get_execution_plan", params).await
    }
```

**Step 2: Create context tools module**

Create `src-mcp-sidecar/src/tools/context.rs`:
```rust
//! AI context tools for MCP.

use std::collections::HashMap;

use crate::ipc_client::IpcClient;
use crate::types::{ToolCallResult, ToolDefinition};

/// Tool definition for get_query_history
pub fn query_history_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_query_history".to_string(),
        description: "Get recent SQL queries executed by the user. Use this to understand what the user has been working on and to reference past queries.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of queries to return (default 20, max 100)",
                    "default": 20,
                    "maximum": 100
                },
                "connectionId": {
                    "type": "string",
                    "description": "Optional: filter to queries from a specific connection"
                }
            }
        }),
    }
}

/// Tool definition for get_current_context
pub fn current_context_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_current_context".to_string(),
        description: "Get the current editor state including the query being edited, active connection, and results summary. Use this to understand what the user is currently working on.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {}
        }),
    }
}

/// Tool definition for get_execution_plan
pub fn execution_plan_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_execution_plan".to_string(),
        description: "Get the query execution plan (EXPLAIN) for a SQL query. Use this to analyze query performance and suggest optimizations.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "connectionId": {
                    "type": "string",
                    "description": "The database connection to use"
                },
                "query": {
                    "type": "string",
                    "description": "The SQL query to analyze"
                },
                "analyze": {
                    "type": "boolean",
                    "description": "If true, actually run the query to get real execution statistics (EXPLAIN ANALYZE). Default false.",
                    "default": false
                }
            },
            "required": ["connectionId", "query"]
        }),
    }
}

/// Execute get_query_history
pub async fn execute_query_history(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    let connection_id = arguments
        .get("connectionId")
        .and_then(|v| v.as_str());

    match client.get_query_history(limit, connection_id).await {
        Ok(result) => format_history_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get query history: {}", e)),
    }
}

/// Execute get_current_context
pub async fn execute_current_context(client: &IpcClient) -> ToolCallResult {
    match client.get_current_context().await {
        Ok(result) => format_context_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get current context: {}", e)),
    }
}

/// Execute get_execution_plan
pub async fn execute_execution_plan(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    let connection_id = match arguments.get("connectionId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return ToolCallResult::error("connectionId is required"),
    };

    let query = match arguments.get("query").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => return ToolCallResult::error("query is required"),
    };

    let analyze = arguments
        .get("analyze")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match client.get_execution_plan(connection_id, query, analyze).await {
        Ok(result) => format_plan_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get execution plan: {}", e)),
    }
}

fn format_history_result(result: serde_json::Value) -> ToolCallResult {
    let entries = match result.as_array() {
        Some(arr) => arr,
        None => return ToolCallResult::text("No query history available."),
    };

    if entries.is_empty() {
        return ToolCallResult::text("No query history available.");
    }

    let mut output = String::from("## Recent Query History\n\n");

    for (i, entry) in entries.iter().enumerate() {
        let query = entry.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let success = entry.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
        let exec_time = entry.get("executionTimeMs").and_then(|v| v.as_u64());
        let row_count = entry.get("rowCount").and_then(|v| v.as_u64());

        let status = if success { "✓" } else { "✗" };
        let timing = exec_time.map(|t| format!(" ({}ms)", t)).unwrap_or_default();
        let rows = row_count.map(|r| format!(", {} rows", r)).unwrap_or_default();

        output.push_str(&format!(
            "{}. {} `{}`{}{}\n",
            i + 1,
            status,
            truncate_query(query, 80),
            timing,
            rows
        ));
    }

    ToolCallResult::text(output)
}

fn format_context_result(result: serde_json::Value) -> ToolCallResult {
    let mut output = String::from("## Current Editor Context\n\n");

    if let Some(conn) = result.get("connectionId").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Connection:** {}\n", conn));
    } else {
        output.push_str("**Connection:** None\n");
    }

    if let Some(db) = result.get("database").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Database:** {}\n", db));
    }

    if let Some(schema) = result.get("schema").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Schema:** {}\n", schema));
    }

    output.push('\n');

    if let Some(query) = result.get("query").and_then(|v| v.as_str()) {
        if !query.is_empty() {
            output.push_str("**Current Query:**\n```sql\n");
            output.push_str(query);
            output.push_str("\n```\n\n");
        }
    }

    let has_results = result.get("hasResults").and_then(|v| v.as_bool()).unwrap_or(false);
    if has_results {
        let row_count = result.get("rowCount").and_then(|v| v.as_u64()).unwrap_or(0);
        let col_count = result.get("columnCount").and_then(|v| v.as_u64()).unwrap_or(0);
        output.push_str(&format!("**Results:** {} rows × {} columns\n", row_count, col_count));
    } else {
        output.push_str("**Results:** None\n");
    }

    ToolCallResult::text(output)
}

fn format_plan_result(result: serde_json::Value) -> ToolCallResult {
    let plan = result.get("plan").and_then(|v| v.as_str()).unwrap_or("No plan available");
    let db_type = result.get("databaseType").and_then(|v| v.as_str()).unwrap_or("Unknown");
    let analyzed = result.get("analyzed").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut output = format!("## Query Execution Plan ({})\n\n", db_type);
    if analyzed {
        output.push_str("*Note: This is an ANALYZED plan with actual execution statistics.*\n\n");
    }
    output.push_str("```\n");
    output.push_str(plan);
    output.push_str("\n```\n");

    ToolCallResult::text(output)
}

fn truncate_query(query: &str, max_len: usize) -> String {
    let normalized: String = query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.len() <= max_len {
        normalized
    } else {
        format!("{}...", &normalized[..max_len.saturating_sub(3)])
    }
}
```

**Step 3: Register tools in mod.rs**

Update `src-mcp-sidecar/src/tools/mod.rs`:
```rust
//! MCP tool registry and implementations.

pub mod context;
pub mod describe;
pub mod list;
pub mod query;

use crate::ipc_client::IpcClient;
use crate::types::{ToolCallParams, ToolCallResult, ToolDefinition};

/// Get all available tool definitions
pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        query::definition(),
        list::list_tables_definition(),
        list::list_connections_definition(),
        describe::definition(),
        context::query_history_definition(),
        context::current_context_definition(),
        context::execution_plan_definition(),
    ]
}

/// Execute a tool call
pub async fn execute_tool(
    client: &IpcClient,
    params: &ToolCallParams,
) -> ToolCallResult {
    match params.name.as_str() {
        "query_database" => query::execute(client, &params.arguments).await,
        "list_tables" => list::execute_list_tables(client, &params.arguments).await,
        "list_connections" => list::execute_list_connections(client, &params.arguments).await,
        "describe_table" => describe::execute(client, &params.arguments).await,
        "get_query_history" => context::execute_query_history(client, &params.arguments).await,
        "get_current_context" => context::execute_current_context(client).await,
        "get_execution_plan" => context::execute_execution_plan(client, &params.arguments).await,
        _ => ToolCallResult::error(format!("Unknown tool: {}", params.name)),
    }
}
```

**Step 4: Verify compilation**

```bash
cd src-mcp-sidecar && cargo check
```
Expected: No errors

**Step 5: Commit**

```bash
git add src-mcp-sidecar/src/tools/context.rs
git add src-mcp-sidecar/src/tools/mod.rs
git add src-mcp-sidecar/src/ipc_client.rs
git commit -m "feat(mcp-sidecar): add context tools (get_query_history, get_current_context, get_execution_plan)"
```

---

## Task 7: Update CLAUDE.md with New Tools

**Files:**
- Modify: `src-tauri/src/acp/llm_home.rs`

**Step 1: Update the CLAUDE.md template**

Find the `CLAUDE.md` template in `llm_home.rs` and add documentation for the new tools:

After the `### query_database` section, add:

```rust
### `get_query_history`
Get recent queries executed by the user.
```json
{
  "limit": 20,           // optional, default 20, max 100
  "connectionId": "conn-123"  // optional, filter by connection
}
```
Returns: List of recent queries with execution info

### `get_current_context`
Get the current editor state (what the user is looking at).
```json
{}
```
Returns: Current query, connection, results summary

### `get_execution_plan`
Analyze query performance with EXPLAIN.
```json
{
  "connectionId": "conn-123",
  "query": "SELECT * FROM users",
  "analyze": false  // optional, true = run query for real stats
}
```
Returns: Query execution plan for optimization
```

Also update the "When to Use Tools" section to include:
```rust
- "What was my last query?" → use `get_query_history`
- "What am I looking at?" → use `get_current_context`
- "Why is this query slow?" → use `get_execution_plan`
```

**Step 2: Bump template version**

Update `TEMPLATE_VERSION` constant:
```rust
const TEMPLATE_VERSION: &str = "1.2.0";
```

**Step 3: Verify compilation**

```bash
cd src-tauri && cargo check
```
Expected: No errors

**Step 4: Commit**

```bash
git add src-tauri/src/acp/llm_home.rs
git commit -m "docs(mcp): update CLAUDE.md template with new context tools"
```

---

## Task 8: Integration Test

**Step 1: Build everything**

```bash
make build
```

**Step 2: Manual testing**

1. Start Query Pilot
2. Connect to a database
3. Run a few queries
4. Start an AI chat session
5. Ask: "What was my last query?"
6. Ask: "What am I looking at right now?"
7. Ask: "Can you analyze the performance of this query?"

**Step 3: Verify tools appear in Claude Code**

The AI should be able to use:
- `get_query_history` - shows recent queries
- `get_current_context` - shows current editor state
- `get_execution_plan` - shows EXPLAIN output

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(mcp): complete implementation of enhanced AI context tools"
```

---

## Summary

| Tool | Purpose | Status |
|------|---------|--------|
| `get_query_history` | Recent user queries | New |
| `get_current_context` | Current editor state | New |
| `get_execution_plan` | Query performance analysis | New |
| `query_database` | Execute queries | Existing |
| `list_tables` | List tables | Existing |
| `list_connections` | List connections | Existing |
| `describe_table` | Table schema | Existing |

## Future Enhancements

Phase 2 tools (not in this plan):
- `get_table_relationships` - Foreign keys and join paths
- `preview_mutation_impact` - Show affected rows before UPDATE/DELETE
- `get_staged_changes` - Uncommitted CRUD operations
- `suggest_query_optimization` - AI-powered optimization suggestions
