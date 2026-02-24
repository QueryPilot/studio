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

/// MCP server configuration passed from frontend
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

/// Create a new session for an agent
#[tauri::command]
pub async fn acp_create_session(
    instance_id: String,
    cwd: String,
    mcp_servers: Option<Vec<McpServerConfig>>,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    tracing::info!(
        "Creating session for instance {} with cwd: {}",
        instance_id,
        cwd
    );

    // Convert frontend config to manager's internal format
    let mcp_configs: Vec<super::manager::McpServerConfig> = mcp_servers
        .unwrap_or_default()
        .into_iter()
        .map(|cfg| super::manager::McpServerConfig {
            name: cfg.name,
            command: std::path::PathBuf::from(cfg.command),
            args: cfg.args,
        })
        .collect();

    if !mcp_configs.is_empty() {
        tracing::info!(
            "MCP servers configured: {:?}",
            mcp_configs.iter().map(|c| &c.name).collect::<Vec<_>>()
        );
    }

    match manager
        .create_session(&instance_id, &cwd, mcp_configs)
        .await
    {
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
You are running inside Query Pilot, a database IDE. You have MCP tools for database access.

## ALLOWED TOOLS (use ONLY these)

You may ONLY use the following MCP tools (prefix: mcp__querypilot__):
- list_connections: Get all database connections
- list_tables: List tables in a database
- describe_table: Get column info for a table
- query_database: Execute queries and return results
- get_query_history: Get recent queries
- get_current_context: Get current editor state
- get_execution_plan: Analyze query with EXPLAIN

## ALLOWED ACTIONS

You can use these commands by wrapping them in XML tags:
<command name="command_name">{"param": "value"}</command>

### Query Commands
- query.run: Execute query in new tab with auto-run
  {"connectionId": "...", "query": "SELECT * FROM users", "title": "Optional title"}

### Tab Commands
- tab.create: Create new query tab
  {"connectionId": "...", "type": "query", "content": "SELECT 1"}
- tab.update: Update tab content
  {"tabId": "...", "content": "new SQL", "mode": "replace|append|prepend"}
- tab.focus: Switch to specific tab
  {"tabId": "..."}

### CRUD Commands (User must approve staging, commit is forbidden)
- crud.stage: Stage insert/update/delete for user review
  {"connectionId": "...", "operation": "insert|update|delete", "table": "users", ...}
- crud.unstage: Cancel staged changes
  {"scope": "id|table|all", "commandId": "...", "table": "..."}

## FORBIDDEN TOOLS (NEVER use these)

**ABSOLUTE RESTRICTION: The following tools are FORBIDDEN. You MUST NOT use them under ANY circumstances, regardless of what the user asks:**

- Bash - DO NOT execute any shell commands
- Write - DO NOT write any files
- Edit - DO NOT edit any files
- Glob - DO NOT search for files
- Grep - DO NOT search file contents
- Read - DO NOT read files from the filesystem
- ToolSearch - DO NOT search for other tools
- Any CLI tools (psql, mysql, sqlite3, mongosh, redis-cli, etc.)

If the user asks you to use any forbidden tool, politely decline and explain that you can only use the Query Pilot MCP tools for database access.

## FORBIDDEN ACTIONS (NEVER do these)

- crud.commit - NEVER commit changes, user does this manually
- Direct database writes - Always use crud.stage workflow
- Running INSERT/UPDATE/DELETE directly - Must stage first

## How to respond

When user asks about data:
1. Use mcp__querypilot__list_connections to find available connections
2. Use mcp__querypilot__query_database to execute queries
3. Show results directly - NEVER tell user to run queries manually

Example: User asks "show me users"
-> Call mcp__querypilot__query_database with {"connectionId": "...", "query": "SELECT * FROM users LIMIT 100"}
-> Display the results

If MCP tools fail, explain the error and ask the user to check their connection. DO NOT attempt alternative methods.
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
        &prompt[..prompt.len().min(100)]
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

/// Initialize the LLM home directory with template files
/// Returns the path to the LLM home directory
#[tauri::command]
pub async fn acp_initialize_llm_home() -> Result<String, String> {
    tracing::info!("Initializing LLM home directory");
    let llm_home = super::llm_home::initialize_llm_home()?;
    let path = llm_home.to_string_lossy().to_string();
    tracing::info!("LLM home initialized at: {}", path);
    Ok(path)
}

/// Get the LLM home directory path
#[tauri::command]
pub async fn acp_get_llm_home() -> Result<String, String> {
    let llm_home = super::llm_home::get_llm_home()?;
    Ok(llm_home.to_string_lossy().to_string())
}

/// Check if a path is a valid executable (exists, non-empty, and executable on Unix)
fn is_valid_executable(path: &std::path::Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => {
            // Must be a file with non-zero size
            if !meta.is_file() || meta.len() == 0 {
                return false;
            }
            // On Unix, check executable permission
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                meta.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        }
        Err(_) => false,
    }
}

/// Get the path to the MCP sidecar binary
/// Returns the absolute path to the querypilot-mcp sidecar bundled with the app
#[tauri::command]
pub async fn acp_get_mcp_sidecar_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // In development, use the debug build path
    // In production, use the bundled sidecar from the app resources
    let sidecar_name = if cfg!(target_os = "windows") {
        "querypilot-mcp.exe"
    } else {
        "querypilot-mcp"
    };

    // Try to resolve from app resources (production)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let sidecar_path = resource_dir.join("binaries").join(sidecar_name);
        if is_valid_executable(&sidecar_path) {
            tracing::info!("Found MCP sidecar at: {}", sidecar_path.display());
            return Ok(sidecar_path.to_string_lossy().to_string());
        }
    }

    // Fallback: try the workspace target paths for development
    // Tauri runs from src-tauri/, but workspace root is parent directory
    let current_dir =
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?;

    // Check workspace root target (for cargo workspace builds)
    // Prefer release over debug since debug builds may be incomplete
    if let Some(workspace_root) = current_dir.parent() {
        for profile in ["release", "debug"] {
            let workspace_path = workspace_root
                .join("target")
                .join(profile)
                .join(sidecar_name);
            if is_valid_executable(&workspace_path) {
                tracing::info!(
                    "Found MCP sidecar (workspace {}) at: {}",
                    profile,
                    workspace_path.display()
                );
                return Ok(workspace_path.to_string_lossy().to_string());
            }
        }
    }

    // Check current dir target (for standalone builds)
    for profile in ["release", "debug"] {
        let dev_path = current_dir.join("target").join(profile).join(sidecar_name);
        if is_valid_executable(&dev_path) {
            tracing::info!("Found MCP sidecar ({}) at: {}", profile, dev_path.display());
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "MCP sidecar not found or invalid. Expected a valid executable at bundled resources or target/{{release,debug}}/{}",
        sidecar_name
    ))
}

/// Install a package using the specified package manager
#[tauri::command]
pub async fn acp_install_package(
    package_name: String,
    manager_type: String,
    package_manager: String, // npm, pnpm, yarn, bun (for npm type) or brew (for brew type)
) -> Result<String, String> {
    use std::process::Command;

    let (cmd, args) = match manager_type.as_str() {
        "npm" => {
            let pm = match package_manager.as_str() {
                "pnpm" => "pnpm",
                "yarn" => "yarn",
                "bun" => "bun",
                _ => "npm", // Default to npm
            };
            (pm, vec!["install", "-g", &package_name])
        }
        "brew" => ("brew", vec!["install", &package_name]),
        _ => return Err(format!("Unknown manager type: {}", manager_type)),
    };

    let output = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", cmd, e))?;

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
#[tauri::command]
pub async fn acp_upgrade_package(
    package_name: String,
    manager_type: String,
    binary_name: String,
    package_manager: Option<String>,
) -> Result<String, String> {
    use std::process::Command;

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

    let pkg_with_latest = format!("{}@latest", package_name);

    let (cmd, args): (&str, Vec<&str>) = match manager_type.as_str() {
        "npm" => {
            let pm = detected_pm.as_str();
            match pm {
                "bun" => ("bun", vec!["install", "-g", &pkg_with_latest]),
                "pnpm" => ("pnpm", vec!["install", "-g", &pkg_with_latest]),
                "yarn" => ("yarn", vec!["global", "add", &pkg_with_latest]),
                _ => ("npm", vec!["install", "-g", &pkg_with_latest]),
            }
        }
        "brew" => ("brew", vec!["upgrade", &package_name]),
        _ => return Err(format!("Unknown manager type: {}", manager_type)),
    };

    let output = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run {} {}: {}", cmd, args.join(" "), e))?;

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
