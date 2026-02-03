//! Tauri IPC commands for ACP integration
//!
//! These commands expose ACP functionality to the frontend.

use std::sync::Arc;

use agent_client_protocol::{ContentBlock, SessionUpdate, TextContent};
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
        tracing::info!("  - {} (installed: {}, path: {:?})", agent.name, agent.installed, agent.path);
    }
    Ok(agents)
}

/// Fetch available models for an agent dynamically
/// Returns models from shell command if supported, otherwise None
#[tauri::command]
pub async fn acp_fetch_agent_models(agent_id: String) -> Result<Option<Vec<super::discovery::ModelInfo>>, String> {
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
    let agent = agents
        .iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| {
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
    tracing::info!("Creating session for instance {} with cwd: {}", instance_id, cwd);

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
        tracing::info!("MCP servers configured: {:?}", mcp_configs.iter().map(|c| &c.name).collect::<Vec<_>>());
    }

    match manager.create_session(&instance_id, &cwd, mcp_configs).await {
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
/// Note: Some agents (e.g., Gemini CLI) don't support this method
#[tauri::command]
pub async fn acp_set_session_model(
    instance_id: String,
    model_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<(), String> {
    tracing::info!("Setting model for instance {} to: {}", instance_id, model_id);
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

/// Send a prompt to an agent and stream responses via Tauri events
#[tauri::command]
pub async fn acp_send_prompt(
    instance_id: String,
    prompt: String,
    context_json: Option<String>, // Database schema as JSON
    app_handle: tauri::AppHandle,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    tracing::info!("Sending prompt to instance {}: {}", instance_id, &prompt[..prompt.len().min(100)]);
    let mut content = vec![];

    // Add database context if provided (prepend to prompt)
    if let Some(ctx) = context_json {
        content.push(ContentBlock::Text(TextContent::new(format!(
            "Database schema context:\n```json\n{}\n```\n\n",
            ctx
        ))));
    }

    content.push(ContentBlock::Text(TextContent::new(prompt)));

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
        SessionUpdate::ToolCallUpdate(update) => serde_json::json!({
            "type": "ToolCallUpdate",
            "update": update,
        }),
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
        if sidecar_path.exists() {
            tracing::info!("Found MCP sidecar at: {}", sidecar_path.display());
            return Ok(sidecar_path.to_string_lossy().to_string());
        }
    }

    // Fallback: try the target/debug path for development
    let dev_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current dir: {}", e))?
        .join("target")
        .join("debug")
        .join(sidecar_name);

    if dev_path.exists() {
        tracing::info!("Found MCP sidecar (dev) at: {}", dev_path.display());
        return Ok(dev_path.to_string_lossy().to_string());
    }

    // Also check relative to src-tauri for monorepo structure
    let monorepo_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current dir: {}", e))?
        .parent()
        .map(|p| p.join("src-tauri").join("target").join("debug").join(sidecar_name));

    if let Some(path) = monorepo_path {
        if path.exists() {
            tracing::info!("Found MCP sidecar (monorepo dev) at: {}", path.display());
            return Ok(path.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "MCP sidecar not found. Expected at bundled resources or target/debug/{}",
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
