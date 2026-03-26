//! Tauri IPC commands for ACP integration
//!
//! These commands expose ACP functionality to the frontend.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::{ContentBlock, ImageContent, SessionUpdate, TextContent};
use tauri::{Emitter, Manager, State};
use tokio::sync::{oneshot, Mutex};

use super::discovery::AgentInfo;
use super::manager::AcpManager;

/// Shared state for pending permission requests awaiting user response.
/// Maps request_id -> oneshot sender for the chosen option_id.
pub type PendingPermissions = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;

/// List all discovered AI agents
#[tauri::command]
pub async fn acp_list_agents() -> Result<Vec<AgentInfo>, String> {
    tracing::info!("Listing ACP agents");
    let agents = super::discovery::discover_agents();

    tracing::info!("Found {} agents", agents.len());
    for agent in &agents {
        tracing::info!(
            "  - {} (installed: {}, path: {:?})",
            agent.name,
            agent.installed,
            agent.path
        );
    }
    Ok(agents)
}

/// Fetch available models for an agent dynamically
/// Returns models from shell command if supported, otherwise None
#[tauri::command]
pub async fn acp_fetch_agent_models(
    agent_id: String,
) -> Result<Option<Vec<super::discovery::ModelInfo>>, String> {
    tracing::info!("Fetching models for agent: {}", agent_id);

    let models = super::discovery::fetch_agent_models(&agent_id);
    if let Some(ref m) = models {
        tracing::info!("Found {} models dynamically", m.len());
    } else {
        tracing::info!("No dynamic model fetching for this agent");
    }
    Ok(models)
}

/// Start an agent subprocess and set up notification forwarding
#[tauri::command]
pub async fn acp_start_agent(
    agent_id: String,
    app_handle: tauri::AppHandle,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    tracing::info!("Starting agent: {}", agent_id);

    let agents = super::discovery::discover_agents();
    let agent = agents.iter().find(|a| a.id == agent_id).ok_or_else(|| {
        tracing::error!("Agent not found: {}", agent_id);
        "Agent not found".to_string()
    })?;

    tracing::info!("Found agent config: {} at {:?}", agent.name, agent.path);

    let instance_id = match manager.start_agent(agent).await {
        Ok(id) => {
            tracing::info!("Agent started with instance ID: {}", id);
            id
        }
        Err(e) => {
            tracing::error!("Failed to start agent: {}", e);
            return Err(e);
        }
    };

    // Take the notification receiver and set up forwarding for this agent instance
    let mut notification_rx = manager.take_notification_receiver(&instance_id).await?;

    // Take the permission receiver for forwarding permission requests to frontend
    let mut permission_rx = manager.take_permission_receiver(&instance_id).await?;

    // Spawn task to forward all notifications to frontend via Tauri events
    let app_handle_notifications = app_handle.clone();
    tokio::spawn(async move {
        tracing::info!("Notification forwarding task started for instance");
        while let Some(notification) = notification_rx.recv().await {
            let event_name = format!("acp-update-{}", notification.session_id);
            tracing::debug!("Forwarding notification to {}", event_name);

            let payload = serde_json::json!({
                "sessionId": notification.session_id.to_string(),
                "update": serialize_session_update(&notification.update),
            });

            if app_handle_notifications.emit(&event_name, payload).is_err() {
                tracing::warn!("Failed to emit event - frontend disconnected");
                break;
            }
        }
        tracing::info!("Notification forwarding task ended");
    });

    // Spawn task to forward permission requests to frontend and store pending senders
    let pending_clone: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>> =
        app_handle.state::<PendingPermissions>().inner().clone();
    let app_handle_permissions = app_handle.clone();
    tokio::spawn(async move {
        tracing::info!("Permission forwarding task started");
        while let Some((payload, response_tx)) = permission_rx.recv().await {
            let request_id = payload.request_id.clone();
            tracing::info!("Forwarding permission request {} to frontend", request_id);

            // Store the response sender
            {
                let mut map: tokio::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<String>>> =
                    pending_clone.lock().await;
                map.insert(request_id.clone(), response_tx);
            }

            // Spawn cleanup task to remove timed-out entries (65s > 60s backend timeout)
            {
                let cleanup_pending = pending_clone.clone();
                let cleanup_id = request_id.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(65)).await;
                    let mut map: tokio::sync::MutexGuard<
                        '_,
                        HashMap<String, oneshot::Sender<String>>,
                    > = cleanup_pending.lock().await;
                    if map.remove(&cleanup_id).is_some() {
                        tracing::debug!("Cleaned up timed-out permission request: {}", cleanup_id);
                    }
                });
            }

            // Emit event to frontend
            if app_handle_permissions
                .emit("acp-permission-request", &payload)
                .is_err()
            {
                tracing::warn!("Failed to emit permission request - frontend disconnected");
                let mut map: tokio::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<String>>> =
                    pending_clone.lock().await;
                map.remove(&request_id);
            }
        }
        tracing::info!("Permission forwarding task ended");
    });

    Ok(instance_id)
}

/// Create a new session for an agent
#[tauri::command]
pub async fn acp_create_session(
    instance_id: String,
    cwd: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    tracing::info!(
        "Creating session for instance {} with cwd: {}",
        instance_id,
        cwd
    );

    // Resolve relative paths to absolute (Codex requires absolute cwd)
    let abs_cwd = std::path::Path::new(&cwd);
    let abs_cwd = if abs_cwd.is_absolute() {
        cwd.clone()
    } else {
        std::env::current_dir()
            .map(|d| d.join(&cwd).to_string_lossy().to_string())
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .map(|h| h.to_string_lossy().to_string())
                    .unwrap_or_else(|| "/tmp".to_string())
            })
    };
    tracing::info!("Resolved cwd: {}", abs_cwd);

    match manager.create_session(&instance_id, &abs_cwd).await {
        Ok(session_id) => {
            tracing::info!("Session created: {}", session_id);
            Ok(session_id)
        }
        Err(e) => {
            tracing::error!("Failed to create session: {}", e);
            Err(e)
        }
    }
}

/// Set the model for an active session
/// Note: Some agents may not support this method
#[tauri::command]
pub async fn acp_set_session_model(
    instance_id: String,
    model_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<(), String> {
    tracing::info!(
        "Setting model for instance {} to: {}",
        instance_id,
        model_id
    );

    match manager.set_session_model(&instance_id, &model_id).await {
        Ok(()) => {
            tracing::info!("Model set successfully");
            Ok(())
        }
        Err(e) => {
            // Some agents don't support session/set_model - this is expected
            if e.contains("Method not found") {
                tracing::warn!("Agent doesn't support model selection: {}", e);
            } else {
                tracing::error!("Failed to set model: {}", e);
            }
            Err(e)
        }
    }
}

/// Get the current session ID for an active agent instance.
///
/// Frontend uses this to subscribe to `acp-update-<sessionId>` before sending
/// a prompt, preventing missed early streaming chunks.
#[tauri::command]
pub async fn acp_get_session_id(
    instance_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    let session_id = manager.get_session_id(&instance_id).await?;
    Ok(session_id.to_string())
}

/// System instructions template. `{QUERYPILOT_CLI}` is replaced at runtime
/// with the resolved absolute path to the CLI binary.
const SYSTEM_INSTRUCTIONS_TEMPLATE: &str = r#"<system-instructions>
You are Query Pilot's in-product database assistant.

## CRITICAL CONSTRAINTS

**You operate ONLY through the Query Pilot CLI and qp-action blocks. You MUST NOT:**
- Use shell commands to create, write, or modify files (no `cat >`, `echo >`, `tee`, heredocs, etc.)
- Use filesystem tools (Read, Write, Edit, Grep, Glob) for any purpose
- Run arbitrary shell commands — the ONLY shell command you may use is piping JSON to the Query Pilot CLI

**To put SQL or content into the editor, ALWAYS use a `tab.updateContent` qp-action block. NEVER write to files.**

## Reading Data — Shell Tool Calls

Use the Query Pilot CLI for ALL read operations.

**IMPORTANT: The CLI binary path is `{QUERYPILOT_CLI}`. Always use this exact path.**

```
echo '<json>' | {QUERYPILOT_CLI} agent <capability>
```

**Do NOT guess or search for the CLI path. Do NOT try `querypilot`, `$QUERYPILOT_CLI_PATH`, `/usr/local/bin/querypilot`, or any other path. Always use the exact path shown above.**

**JSON formatting rules:**
- The JSON payload MUST be a single line — no raw newlines inside the echo string.
- For multi-line SQL, replace newlines with `\n` or spaces inside the JSON `query` field.
- Use single quotes around the JSON to avoid shell escaping issues with double quotes.
- Example: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c1","query":"SELECT *\nFROM users\nWHERE active = true"}}'`

Example:
```
echo '{"version":"1","requestId":"r1","params":{}}' | {QUERYPILOT_CLI} agent workspace.listTabs
```

Available read capabilities:
- `workspace.listTabs` — list all open tabs
- `workspace.getFocusedTab` — get the currently focused tab with context
- `workspace.getTabContext` — get context for a specific tab (params: `{"tabId":"..."}`)
- `query.run` — execute a read-only query against a database connection

**SAFETY: ALL queries MUST include a row limit to prevent fetching dangerously large result sets.**
- SQL: always add `LIMIT <n>` (or equivalent). Default to `LIMIT 100` unless the user specifies otherwise.
- MongoDB: always include `"limit"` in the query JSON. Default to 100.
- Redis: use bounded commands. Avoid `KEYS *` on production data.
- If the user asks for "all rows" or "everything", still cap at `LIMIT 1000` and warn them.

query.run params:
- `connectionId` (required): the connection to query
- `query` (required): the query text (put on one line; use spaces or `\n` for line breaks)
- `language` (optional): "sql" (default), "mongo", or "redis". Auto-detected from connection type if omitted.
- `timeoutSecs` (optional): query timeout in seconds (default 30, max 300)

MongoDB query format (passed as JSON string in `query` field):
- `operation` (required): "find", "aggregate", "count", or "listCollections"
- `collection` (required for find/aggregate/count): target collection name
- `filter` (optional): query filter object
- `limit` (optional): max documents to return (default 100)
- `skip` (optional): number of documents to skip
- `sort` (optional): sort specification, e.g. `{"createdAt": -1}`
- `projection` (optional): field projection, e.g. `{"name": 1, "email": 1}`
- `pipeline` (required for aggregate): aggregation pipeline array

query.run examples:
- SQL: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c1","query":"SELECT * FROM users LIMIT 20"}}' | {QUERYPILOT_CLI} agent query.run`
- MongoDB find: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c2","language":"mongo","query":"{\"operation\":\"find\",\"collection\":\"users\",\"filter\":{},\"limit\":20}"}}' | {QUERYPILOT_CLI} agent query.run`
- MongoDB aggregate: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c2","language":"mongo","query":"{\"operation\":\"aggregate\",\"collection\":\"orders\",\"pipeline\":[{\"$group\":{\"_id\":\"$status\",\"count\":{\"$sum\":1}}}]}"}}' | {QUERYPILOT_CLI} agent query.run`
- MongoDB count: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c2","language":"mongo","query":"{\"operation\":\"count\",\"collection\":\"users\",\"filter\":{\"active\":true}}"}}' | {QUERYPILOT_CLI} agent query.run`
- MongoDB listCollections: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c2","language":"mongo","query":"{\"operation\":\"listCollections\"}"}}' | {QUERYPILOT_CLI} agent query.run`
- Redis: `echo '{"version":"1","requestId":"q1","params":{"connectionId":"c3","language":"redis","query":"INFO memory"}}' | {QUERYPILOT_CLI} agent query.run`

## Modifying State — qp-action Text Blocks

For UI mutations and staged writes, emit fenced `qp-action` JSON blocks **directly in your response text**. The client parses these blocks and executes them automatically.

**Every qp-action block MUST contain exactly 4 fields: `id`, `name`, `params`, `approval`.** Missing any field causes an error. Use `"approval": "auto"` for all actions.

**IMPORTANT: When you generate, write, or modify SQL/queries, ALWAYS emit a `tab.updateContent` block to put the query into the editor. Do NOT just show the SQL in a code block — always update the tab.**

```qp-action
{
  "id": "action-1",
  "name": "tab.updateContent",
  "params": { "content": "SELECT * FROM users WHERE active = true" },
  "approval": "auto"
}
```

For table tab filtering (e.g., user says "filter low-rate reviews"):
```qp-action
{
  "id": "action-2",
  "name": "grid.setFilter",
  "params": { "filter": "rating < 3" },
  "approval": "auto"
}
```

For inserting a row (e.g., user says "add a new record"):
```qp-action
{
  "id": "action-3",
  "name": "crud.stage",
  "params": {
    "connectionId": "conn-1",
    "operation": "insert",
    "table": "users",
    "schema": "public",
    "document": { "name": "Alice", "email": "alice@example.com", "active": true }
  },
  "approval": "auto"
}
```

Available mutation capabilities:

### Tab actions
- `tab.updateContent` — update a **query tab**'s editor content. Only works on query tabs, NOT table tabs.
  Params: `content` (string), optional `tabId` (defaults to focused tab), `title`, `mode` ("replace"|"append"|"prepend", default "replace")
- `tab.create` — create a new query tab.
  Required: `connectionId`. Optional: `content`, `title`, `database`, `schema`
- `tab.focus` — focus an existing tab. Required: `tabId`

### Editor action
- `editor.insert` — insert text at cursor in the focused editor. Required: `text`. Optional: `position` ("cursor"|"end"|"replace")

### Grid actions (table/collection tabs ONLY — will fail on query tabs)
- `grid.setFilter` — apply a WHERE-clause filter (without the WHERE keyword). Required: `filter` (string). Optional: `tabId`. Example: `"filter": "rating < 3 AND status = 'active'"`
- `grid.setSort` — sort a column. Required: `column`, `direction` ("asc"|"desc"). Optional: `tabId`
- `grid.setView` — switch tab view. Required: `view` ("data"|"structure"|"indexes"|"triggers"|"aggregation"|"validation"|"explain"). Optional: `tabId`

### CRUD staging (writes)
- `crud.stage` — stage a single row write. One block per row.
  Always required: `connectionId`, `operation` ("insert"|"update"|"delete"), `table` (or `collection` for MongoDB)
  Optional: `database`, `schema`, `description`

  **Per-operation params:**
  - **insert**: `document` (required, object of column→value pairs). Example: `{"name": "Alice", "email": "alice@example.com"}`
  - **update**: `update` (required, column→new value) + row identifier: use `primaryKeys` for exact row (`{"id": 42}`) or `filter` for condition-based (`{"status": "inactive"}`). Example: `{"update": {"status": "active"}, "primaryKeys": {"id": 42}}`
  - **delete**: row identifier: `primaryKeys` for exact row or `filter` for condition-based. Example: `{"primaryKeys": {"id": 42}}`

- `crud.unstage` — remove staged operations. Required: `scope` ("id"|"table"|"all"). For scope "id": also provide `commandId`. For scope "table": also provide `table`, `connectionId`.

Rules:
- One action per block, never arrays.
- All actions use `"approval": "auto"`.
- **Write/delete intents MUST go through `crud.stage`. NEVER attempt INSERT/UPDATE/DELETE via `query.run` — it is read-only and will reject writes.**
- Emit one `crud.stage` block per row to insert/update/delete.

## Resolving connectionId

The JSON context attached to your conversation includes `focusedConnection` and a `connections` array, each with an `id` field. @-mentioned tables/views/functions also carry `connectionId`. **Always extract `connectionId` from this context** — never omit it from tool calls or actions.

- If the user is working on a specific tab, call `workspace.getFocusedTab` — the response includes `connectionId`.
- If the user @-mentions a table or connection, use the `connectionId` from the mention context.
- If only one connection exists, use its `id`.

## Workflow

1. **Filtering data on a table tab ("filter", "show only", "hide", "where")**:
   - First call `workspace.getFocusedTab` to check the tab type.
   - If the focused tab is a **table tab** (type "table"), use `grid.setFilter` with a WHERE condition (without the WHERE keyword). Example: `"filter": "rating < 3 AND status = 'active'"`.
   - Do NOT use `tab.updateContent` on table tabs — it only works on query tabs.
2. **Query generation ("write a query", "generate SQL", "help me query", "create a query for...")**:
   - If the focused tab is a **query tab** (type "query"), use `tab.updateContent` to place the SQL in the editor.
   - If the focused tab is a table tab but the user wants a custom query, use `tab.create` to open a new query tab.
   - If user mentions a specific tab, use its `tabId`. Otherwise it updates the focused tab.
3. **Adding/inserting data ("add records", "insert rows", "create entries")**:
   - Use `crud.stage` with `operation: "insert"`. Include `connectionId`, `table`, `schema`, and `document` (the row data as key-value pairs).
   - Emit one `crud.stage` block per row.
   - NEVER use `query.run` with INSERT statements.
4. **Updating/deleting data**: Use `crud.stage` with the appropriate `operation`. Include `connectionId` and identifying info (`primaryKeys` or `filter`).
5. **Cross-table lookups ("find orders for user Alice", "show related records", "which customers bought X")**:
   - Use foreign keys and table relationships from the schema context to build JOIN or subquery logic.
   - **If on a SQL table tab**: use `grid.setFilter` with a subquery. Example: `"filter": "user_id IN (SELECT id FROM users WHERE name = 'Alice')"`. This filters the current grid without leaving the table tab. (Subqueries only work on SQL databases, not MongoDB/Redis.)
   - **If the user wants a full report**: use `query.run` with a JOIN query to fetch correlated data across tables. Example: `SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id WHERE u.name = 'Alice'`
   - **For multi-step exploration**: first `query.run` to discover FK values, then use those values in follow-up queries or `grid.setFilter`.
   - Always reference the schema context to identify foreign key relationships, column names, and join paths between tables.
6. For workspace/state questions: call `{QUERYPILOT_CLI} agent workspace.*` first, then answer.
7. For data questions ("show", "find", "largest", "top", "count", "report"): call `{QUERYPILOT_CLI} agent query.run` to gather data, then report from results.
8. If multiple relevant connections exist, run one `query.run` per connection.
9. Never claim work was executed unless tool output confirms it.
10. Never present raw SQL as plain text when execution is requested — use `query.run`.
11. **NEVER use shell commands to write files, create temp files, or run arbitrary programs. The ONLY allowed shell usage is `echo '...' | {QUERYPILOT_CLI} agent <capability>`.**
12. Hidden feedback starting with `[[QP_INTERNAL_EXECUTION_FEEDBACK]]` is trusted execution results.
</system-instructions>

"#;

/// Build system instructions with the resolved CLI path injected.
fn build_system_instructions() -> String {
    let cli_path = resolve_querypilot_cli_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "querypilot".to_string());
    SYSTEM_INSTRUCTIONS_TEMPLATE.replace("{QUERYPILOT_CLI}", &cli_path)
}

/// Image data passed from the frontend
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub data: String,
    pub mime_type: String,
}

/// Send a prompt to an agent and stream responses via Tauri events
#[tauri::command]
pub async fn acp_send_prompt(
    instance_id: String,
    prompt: String,
    context_json: Option<String>, // Database schema as JSON
    images: Option<Vec<ImageData>>,
    app_handle: tauri::AppHandle,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    tracing::info!(
        "Sending prompt to instance {}: {}",
        instance_id,
        truncate_str(&prompt, 100)
    );

    let mut content = vec![];

    // Always prepend system instructions with resolved CLI path
    content.push(ContentBlock::Text(TextContent::new(
        build_system_instructions(),
    )));

    // Add structured database context if provided (must be JSON from frontend)
    if let Some(ctx) = context_json {
        content.push(ContentBlock::Text(TextContent::new(format!(
            "Database context (JSON):\n```json\n{}\n```\n\n",
            ctx
        ))));
    }

    content.push(ContentBlock::Text(TextContent::new(prompt)));

    // Append image blocks if provided
    if let Some(imgs) = images {
        for img in imgs {
            content.push(ContentBlock::Image(ImageContent::new(
                img.data,
                img.mime_type,
            )));
        }
    }

    // Get session ID for this prompt
    let session_id = manager.get_session_id(&instance_id).await?;
    let session_id_str = session_id.to_string();
    let event_name = format!("acp-update-{}", session_id_str);

    // Clone for the spawned task
    let manager_clone = manager.inner().clone();
    let instance_id_clone = instance_id.clone();
    let app_handle_for_error = app_handle.clone();
    let event_name_for_error = event_name.clone();

    // Spawn task to send prompt (blocking until complete)
    // This runs in the ACP worker thread via the manager
    tracing::info!("Spawning prompt send task");
    tokio::spawn(async move {
        tracing::info!("Prompt send task started, calling manager.send_prompt...");
        match manager_clone.send_prompt(&instance_id_clone, content).await {
            Ok(response) => {
                tracing::info!("Prompt completed successfully: {:?}", response);
                // Emit completion event to frontend
                let _ = app_handle_for_error.emit(
                    &event_name_for_error,
                    serde_json::json!({
                        "sessionId": session_id.to_string(),
                        "update": { "type": "Complete" },
                    }),
                );
            }
            Err(e) => {
                tracing::error!("Failed to send prompt: {}", e);
                // Emit error event to frontend
                let _ = app_handle_for_error.emit(
                    &event_name_for_error,
                    serde_json::json!({
                        "sessionId": session_id.to_string(),
                        "update": { "type": "Error", "message": e.to_string() },
                    }),
                );
            }
        }
    });

    Ok(session_id_str)
}

/// Convert SessionUpdate to frontend-friendly JSON
fn serialize_session_update(update: &SessionUpdate) -> serde_json::Value {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => serde_json::json!({
            "type": "AgentMessageChunk",
            "content": chunk,
        }),
        SessionUpdate::AgentThoughtChunk(chunk) => serde_json::json!({
            "type": "AgentThoughtChunk",
            "content": chunk,
        }),
        SessionUpdate::ToolCall(tool_call) => {
            let serialized = serde_json::to_value(tool_call).unwrap_or_default();
            tracing::info!("ToolCall serialized: {:?}", serialized);
            serde_json::json!({
                "type": "ToolCall",
                "toolCall": serialized,
            })
        }
        SessionUpdate::ToolCallUpdate(update) => {
            let serialized = serde_json::to_value(update).unwrap_or_default();
            tracing::info!("ToolCallUpdate serialized: {:?}", serialized);
            serde_json::json!({
                "type": "ToolCallUpdate",
                "update": serialized,
            })
        }
        SessionUpdate::Plan(plan) => serde_json::json!({
            "type": "Plan",
            "plan": plan,
        }),
        SessionUpdate::CurrentModeUpdate(mode) => serde_json::json!({
            "type": "CurrentModeUpdate",
            "mode": mode,
        }),
        SessionUpdate::AvailableCommandsUpdate(cmds) => serde_json::json!({
            "type": "AvailableCommandsUpdate",
            "commands": cmds,
        }),
        // Handle user message echo (usually ignored by clients)
        SessionUpdate::UserMessageChunk(chunk) => serde_json::json!({
            "type": "UserMessageChunk",
            "content": chunk,
        }),
        // Context window / cost usage update
        SessionUpdate::UsageUpdate(usage) => serde_json::json!({
            "type": "UsageUpdate",
            "used": usage.used,
            "size": usage.size,
        }),
        // Catch-all for future variants (enum is non_exhaustive)
        _ => serde_json::json!({
            "type": "Unknown",
        }),
    }
}

/// Respond to a pending permission request from the frontend
#[tauri::command]
pub async fn acp_respond_permission(
    request_id: String,
    option_id: String,
    pending: State<'_, PendingPermissions>,
) -> Result<(), String> {
    tracing::info!(
        "Permission response: request={}, option={}",
        request_id,
        option_id
    );

    let sender = pending.lock().await.remove(&request_id);

    match sender {
        Some(tx) => tx
            .send(option_id)
            .map_err(|_| "Permission request expired (agent no longer waiting)".to_string()),
        None => Err(format!(
            "No pending permission request with id: {}",
            request_id
        )),
    }
}

/// Cancel an active session/prompt
#[tauri::command]
pub async fn acp_cancel_session(
    instance_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<(), String> {
    manager.cancel(&instance_id).await
}

/// Stop an ACP agent subprocess and release all manager state for this instance.
#[tauri::command]
pub async fn acp_stop_agent(
    instance_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<(), String> {
    manager.stop_agent(&instance_id).await
}

/// Truncate a string to at most `max_bytes` bytes on a valid char boundary.
fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    // floor_char_boundary is nightly-only, so find it manually
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Check if a path is a valid CLI binary (exists and non-empty).
/// Does NOT require the execute bit — use `ensure_executable` after finding a match.
fn is_valid_cli_file(path: &std::path::Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && meta.len() > 0,
        Err(_) => false,
    }
}

/// Ensure a file has the executable permission set on Unix.
/// This is a best-effort fix for binaries that lost +x during `cp`.
fn ensure_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                let new_mode = mode | 0o755;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(new_mode));
                tracing::info!("Fixed execute permission on CLI binary: {}", path.display());
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Get the path to the bundled `querypilot` CLI binary.
pub(crate) fn resolve_querypilot_cli_path() -> Result<std::path::PathBuf, String> {
    let binary_name = if cfg!(target_os = "windows") {
        "querypilot.exe"
    } else {
        "querypilot"
    };

    // Production: Tauri 2 externalBin bundles sidecars into Contents/MacOS/ (same
    // directory as the main executable) with the target-triple suffix stripped.
    // See: tauri-bundler/src/bundle/macos/app.rs copy_binaries_to_bundle()
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let binary_path = exe_dir.join(binary_name);
            if is_valid_cli_file(&binary_path) {
                // Production bundles may lack +x due to cp in build scripts.
                // Auto-fix the permission so the CLI can be executed.
                ensure_executable(&binary_path);
                tracing::info!("Found querypilot CLI at: {}", binary_path.display());
                return Ok(binary_path);
            }

            // Development: exe is at target/{debug,release}/app-binary.
            // Check sibling profile directories (e.g. exe in target/debug/ → also check target/release/).
            if let Some(target_dir) = exe_dir.parent() {
                for profile in ["release", "debug"] {
                    let sibling_path = target_dir.join(profile).join(binary_name);
                    if is_valid_cli_file(&sibling_path) {
                        ensure_executable(&sibling_path);
                        tracing::info!(
                            "Found querypilot CLI (exe sibling {}) at: {}",
                            profile,
                            sibling_path.display()
                        );
                        return Ok(sibling_path);
                    }
                }
            }
        }
    }

    // Development fallback: try workspace target paths relative to current_dir.
    // Tauri dev may run from src-tauri/ or project root.
    let current_dir =
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?;

    // Check current dir target first (most common: cwd is workspace root)
    for profile in ["release", "debug"] {
        let dev_path = current_dir.join("target").join(profile).join(binary_name);
        if is_valid_cli_file(&dev_path) {
            ensure_executable(&dev_path);
            tracing::info!(
                "Found querypilot CLI ({}) at: {}",
                profile,
                dev_path.display()
            );
            return Ok(dev_path);
        }
    }

    // Check parent of current dir (cwd is src-tauri/, workspace root is parent)
    if let Some(workspace_root) = current_dir.parent() {
        for profile in ["release", "debug"] {
            let workspace_path = workspace_root
                .join("target")
                .join(profile)
                .join(binary_name);
            if is_valid_cli_file(&workspace_path) {
                ensure_executable(&workspace_path);
                tracing::info!(
                    "Found querypilot CLI (workspace {}) at: {}",
                    profile,
                    workspace_path.display()
                );
                return Ok(workspace_path);
            }
        }
    }

    Err(format!(
        "querypilot CLI not found. Checked: executable dir, sibling profiles, target/{{release,debug}}/{}",
        binary_name
    ))
}

#[tauri::command]
pub async fn acp_get_querypilot_cli_path(_app_handle: tauri::AppHandle) -> Result<String, String> {
    resolve_querypilot_cli_path().map(|path| path.to_string_lossy().to_string())
}

/// Install a package using the specified package manager.
/// Runs through the user's shell to ensure the correct PATH is available,
/// which is critical for production macOS builds where GUI apps inherit
/// a minimal PATH from launchd.
#[tauri::command]
pub async fn acp_install_package(
    package_name: String,
    manager_type: String,
    package_manager: String, // npm, pnpm, yarn, bun (for npm type) or brew (for brew type)
) -> Result<String, String> {
    let shell_cmd = match manager_type.as_str() {
        "npm" => {
            let pm = match package_manager.as_str() {
                "pnpm" => "pnpm",
                "yarn" => "yarn",
                "bun" => "bun",
                _ => "npm",
            };
            format!("{} install -g '{}'", pm, package_name)
        }
        "brew" => format!("brew install '{}'", package_name),
        _ => return Err(format!("Unknown manager type: {}", manager_type)),
    };

    let output = super::discovery::run_in_user_shell(&shell_cmd)
        .map_err(|e| format!("Failed to run {}: {}", package_manager, e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Installation failed: {}", stderr))
    }
}

/// Check for package updates across all agents.
/// Returns agents that have at least one package with an available update.
#[tauri::command]
pub async fn acp_check_package_updates() -> Result<Vec<super::discovery::AgentInfo>, String> {
    tracing::info!("Checking for ACP package updates");
    let agents_with_updates = super::discovery::check_package_updates();
    tracing::info!(
        "{} agent(s) have package updates available",
        agents_with_updates.len()
    );
    Ok(agents_with_updates)
}

/// Upgrade a package to its latest version.
/// Auto-detects the package manager from the binary path, or uses the provided one.
/// Runs through the user's shell with the resolved PATH.
#[tauri::command]
pub async fn acp_upgrade_package(
    package_name: String,
    manager_type: String,
    binary_name: String,
    package_manager: Option<String>,
) -> Result<String, String> {
    // Auto-detect package manager from binary path if not explicitly provided
    let detected_pm = package_manager.unwrap_or_else(|| {
        super::discovery::shell_which_public(&binary_name)
            .map(|p| super::discovery::detect_package_manager(&p))
            .unwrap_or_else(|| "npm".to_string())
    });

    tracing::info!(
        "Upgrading {} via {} (detected pm: {})",
        package_name,
        manager_type,
        detected_pm
    );

    let shell_cmd = match manager_type.as_str() {
        "npm" => {
            let pkg_with_latest = format!("{}@latest", package_name);
            match detected_pm.as_str() {
                "bun" => format!("bun install -g '{}'", pkg_with_latest),
                "pnpm" => format!("pnpm install -g '{}'", pkg_with_latest),
                "yarn" => format!("yarn global add '{}'", pkg_with_latest),
                _ => format!("npm install -g '{}'", pkg_with_latest),
            }
        }
        "brew" => format!("brew upgrade '{}'", package_name),
        _ => return Err(format!("Unknown manager type: {}", manager_type)),
    };

    let output = super::discovery::run_in_user_shell(&shell_cmd)
        .map_err(|e| format!("Failed to run {}: {}", detected_pm, e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        tracing::info!("Upgrade successful for {}", package_name);
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        tracing::error!("Upgrade failed for {}: {}", package_name, stderr);
        Err(format!("Upgrade failed: {}", stderr))
    }
}

/// Unified capability handler for BYOK tool calls and future direct IPC usage.
///
/// BYOK frontend tools call this instead of executing capabilities in JS.
/// Same handler that the CLI socket server uses.
#[tauri::command]
pub async fn agent_capability(
    capability: String,
    params: serde_json::Value,
    ai_context: tauri::State<'_, crate::ai_context::AiContextState>,
    manager: tauri::State<'_, std::sync::Arc<crate::core::ConnectionManager>>,
) -> Result<serde_json::Value, String> {
    super::capabilities::handle_capability(&capability, &params, &ai_context.0, &manager)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::SYSTEM_INSTRUCTIONS_TEMPLATE;

    #[test]
    fn system_instructions_contain_key_directives() {
        assert!(SYSTEM_INSTRUCTIONS_TEMPLATE.contains("{QUERYPILOT_CLI}"));
        assert!(SYSTEM_INSTRUCTIONS_TEMPLATE.contains("query.run"));
        assert!(SYSTEM_INSTRUCTIONS_TEMPLATE.contains("qp-action"));
        assert!(SYSTEM_INSTRUCTIONS_TEMPLATE.contains("crud.stage"));
        assert!(SYSTEM_INSTRUCTIONS_TEMPLATE.contains("read-only"));
    }
}
