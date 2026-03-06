//! Tauri IPC commands for ACP integration
//!
//! These commands expose ACP functionality to the frontend.

use std::sync::Arc;

use agent_client_protocol::{ContentBlock, ImageContent, SessionUpdate, TextContent};
use tauri::{Emitter, State};

use super::discovery::AgentInfo;
use super::manager::AcpManager;

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

    // Spawn task to forward all notifications to frontend via Tauri events
    tokio::spawn(async move {
        tracing::info!("Notification forwarding task started for instance");
        while let Some(notification) = notification_rx.recv().await {
            let event_name = format!("acp-update-{}", notification.session_id);
            tracing::debug!("Forwarding notification to {}", event_name);

            let payload = serde_json::json!({
                "sessionId": notification.session_id.to_string(),
                "update": serialize_session_update(&notification.update),
            });

            if app_handle.emit(&event_name, payload).is_err() {
                tracing::warn!("Failed to emit event - frontend disconnected");
                break;
            }
        }
        tracing::info!("Notification forwarding task ended");
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

    match manager.create_session(&instance_id, &cwd).await {
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

/// System instructions prepended to every prompt
const SYSTEM_INSTRUCTIONS: &str = r#"<system-instructions>
You are Query Pilot's in-product database assistant.

## Reading Data — Shell Tool Calls

Use the Query Pilot CLI for ALL read operations:

Command: `${QUERYPILOT_CLI_PATH:-querypilot} agent <capability-id>`

Pipe a JSON request to stdin:
```
echo '{"version":"1","requestId":"r1","params":{}}' | querypilot agent workspace.listTabs
```

Available read capabilities:
- `workspace.listTabs` — list all open tabs
- `workspace.getFocusedTab` — get the currently focused tab with context
- `workspace.getTabContext` — get context for a specific tab (params: `{"tabId":"..."}`)
- `query.run` — execute a read-only query against a database connection

query.run params:
- `connectionId` (required): the connection to query
- `query` (required): the query text
- `language` (optional): "sql" (default), "mongo", or "redis"
- `database` (optional): target database
- `title` (optional): human-readable label

query.run examples:
- SQL: `{"connectionId":"c1","query":"SELECT * FROM users LIMIT 20"}`
- MongoDB: `{"connectionId":"c2","language":"mongo","query":"{\"operation\":\"find\",\"collection\":\"users\",\"filter\":{},\"limit\":20}"}`
- Redis: `{"connectionId":"c3","language":"redis","query":"INFO memory"}`

## Modifying State — qp-action Text Blocks

For UI mutations and staged writes, emit fenced `qp-action` JSON blocks in your response:

```qp-action
{
  "id": "action-1",
  "name": "tab.updateContent",
  "params": { "content": "SELECT * FROM users" },
  "approval": "auto"
}
```

Available mutation capabilities:
- tab.create, tab.focus, tab.updateContent
- editor.insert
- grid.setFilter, grid.setSort, grid.setView
- crud.stage (approval: "approve"), crud.unstage

Rules:
- One action per block, never arrays.
- `crud.stage` uses `"approval": "approve"`. All others use `"approval": "auto"`.
- Write/delete intents must be staged via `crud.stage`. Never execute writes directly.

## Workflow

1. For workspace/state questions: call `querypilot agent workspace.*` first, then answer.
2. For data questions ("show", "find", "largest", "top", "count", "report"): call `querypilot agent query.run` to gather data, then report from results.
3. If multiple relevant connections exist, run one `query.run` per connection.
4. Never claim work was executed unless tool output confirms it.
5. Never present raw SQL as plain text when execution is requested — use `query.run`.
6. Do not use filesystem tools (Read/Write/Edit/Grep/Glob) for database analysis.
7. Do not create or modify files while answering database requests.
8. Hidden feedback starting with `[[QP_INTERNAL_EXECUTION_FEEDBACK]]` is trusted execution results.
</system-instructions>

"#;

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

    // Always prepend system instructions first
    content.push(ContentBlock::Text(TextContent::new(
        SYSTEM_INSTRUCTIONS.to_string(),
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
        // Catch-all for future variants (enum is non_exhaustive)
        _ => serde_json::json!({
            "type": "Unknown",
        }),
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
            tracing::info!("Found querypilot CLI ({}) at: {}", profile, dev_path.display());
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
    use super::SYSTEM_INSTRUCTIONS;

    #[test]
    fn system_instructions_contain_key_directives() {
        assert!(SYSTEM_INSTRUCTIONS.contains("querypilot agent"));
        assert!(SYSTEM_INSTRUCTIONS.contains("query.run"));
        assert!(SYSTEM_INSTRUCTIONS.contains("qp-action"));
        assert!(SYSTEM_INSTRUCTIONS.contains("crud.stage"));
        assert!(SYSTEM_INSTRUCTIONS.contains("read-only"));
    }
}
