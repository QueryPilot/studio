//! ACP Manager module
//!
//! Manages agent subprocess lifecycle with stdio transport.
//!
//! Note: The ACP library uses `#[async_trait(?Send)]` which means futures are not
//! Send. We use `tokio::task::LocalSet` to run ACP operations on a dedicated
//! single-threaded executor.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

use agent_client_protocol::{
    Agent, CancelNotification, Client, ClientCapabilities, ClientSideConnection, ContentBlock,
    FileSystemCapability, Implementation, InitializeRequest, ModelId, NewSessionRequest,
    PermissionOptionKind, PromptRequest, PromptResponse, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome, SessionId,
    SessionNotification, SetSessionModelRequest, ToolKind,
};
use serde_json::Value;

use super::discovery::AgentInfo;

/// A channel sender for forwarding session notifications to Tauri
pub type NotificationSender = mpsc::UnboundedSender<SessionNotification>;
pub type NotificationReceiver = mpsc::UnboundedReceiver<SessionNotification>;

const ALLOWED_SHELL_CAPABILITIES: [&str; 4] = [
    "workspace.listTabs",
    "workspace.getFocusedTab",
    "workspace.getTabContext",
    "query.run",
];

/// Commands that can be sent to the ACP worker thread
enum AcpCommand {
    StartAgent {
        agent_info: AgentInfo,
        response_tx: oneshot::Sender<Result<String, String>>,
    },
    CreateSession {
        agent_id: String,
        cwd: String,
        response_tx: oneshot::Sender<Result<String, String>>,
    },
    SetSessionModel {
        agent_id: String,
        model_id: String,
        response_tx: oneshot::Sender<Result<(), String>>,
    },
    SendPrompt {
        agent_id: String,
        prompt: Vec<ContentBlock>,
        response_tx: oneshot::Sender<Result<PromptResponse, String>>,
    },
    GetSessionId {
        agent_id: String,
        response_tx: oneshot::Sender<Result<SessionId, String>>,
    },
    Cancel {
        agent_id: String,
        response_tx: oneshot::Sender<Result<(), String>>,
    },
    StopAgent {
        agent_id: String,
        response_tx: oneshot::Sender<Result<(), String>>,
    },
    Shutdown {
        response_tx: oneshot::Sender<Result<(), String>>,
    },
    TakeNotificationReceiver {
        agent_id: String,
        response_tx: oneshot::Sender<Result<NotificationReceiver, String>>,
    },
}

/// Client implementation that forwards notifications via a channel
struct QueryPilotClient {
    notification_tx: NotificationSender,
}

impl QueryPilotClient {
    fn new(notification_tx: NotificationSender) -> Self {
        Self { notification_tx }
    }
}

fn extract_shell_command_candidate(tool_title: &str, raw_input: Option<&Value>) -> Option<String> {
    if let Some(raw) = raw_input {
        if let Some(command) = raw.as_str() {
            let trimmed = command.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(obj) = raw.as_object() {
            for key in ["command", "cmd", "input", "raw"] {
                if let Some(command) = obj.get(key).and_then(Value::as_str) {
                    let trimmed = command.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    if tool_title.contains("querypilot") {
        Some(tool_title.to_string())
    } else {
        None
    }
}

fn tokenize_shell_command(command: &str) -> Vec<String> {
    command
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '(' | ')' | ',' | ':'))
                .to_string()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn is_querypilot_binary_token(token: &str) -> bool {
    let lowered = token.to_ascii_lowercase();
    lowered == "querypilot"
        || lowered == "querypilot.exe"
        || lowered == "$querypilot_cli_path"
        || lowered == "${querypilot_cli_path}"
        || lowered.ends_with("/querypilot")
        || lowered.ends_with("\\querypilot")
        || lowered.ends_with("/querypilot.exe")
        || lowered.ends_with("\\querypilot.exe")
}

fn is_allowed_querypilot_agent_shell(tool_title: &str, raw_input: Option<&Value>) -> bool {
    let Some(candidate) = extract_shell_command_candidate(tool_title, raw_input) else {
        return false;
    };

    // Disallow obvious command chaining / injection forms.
    if candidate.contains("&&")
        || candidate.contains("||")
        || candidate.contains(';')
        || candidate.contains('|')
        || candidate.contains("`")
        || candidate.contains("$(")
        || candidate.contains('\n')
        || candidate.contains('\r')
    {
        return false;
    }

    let mut tokens = tokenize_shell_command(&candidate);
    let Some(start_idx) = tokens
        .iter()
        .position(|token| is_querypilot_binary_token(token))
    else {
        return false;
    };
    tokens = tokens.split_off(start_idx);

    if tokens.len() < 3 {
        return false;
    }
    if !is_querypilot_binary_token(&tokens[0]) {
        return false;
    }
    if !tokens[1].eq_ignore_ascii_case("agent") {
        return false;
    }

    let capability = tokens[2].as_str();
    if !ALLOWED_SHELL_CAPABILITIES.contains(&capability) {
        return false;
    }

    let mut index = 3;
    while index < tokens.len() {
        match tokens[index].as_str() {
            "--json" => {
                index += 1;
            }
            "--timeout-ms" => {
                if index + 1 >= tokens.len()
                    || !tokens[index + 1].chars().all(|ch| ch.is_ascii_digit())
                {
                    return false;
                }
                index += 2;
            }
            _ => return false,
        }
    }

    true
}

#[async_trait::async_trait(?Send)]
impl Client for QueryPilotClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        // Check the tool kind to decide whether to allow or deny
        let tool_kind = args.tool_call.fields.kind.unwrap_or(ToolKind::Other);
        let tool_title = args.tool_call.fields.title.as_deref().unwrap_or("unknown");

        tracing::info!(
            "Permission request for tool: {:?} ({})",
            tool_kind,
            tool_title,
        );

        let is_allowed_shell = matches!(tool_kind, ToolKind::Execute)
            && is_allowed_querypilot_agent_shell(
                tool_title,
                args.tool_call.fields.raw_input.as_ref(),
            );

        let should_allow = is_allowed_shell
            || matches!(tool_kind, ToolKind::Think | ToolKind::SwitchMode);

        if should_allow {
            tracing::info!("Auto-approving {:?} operation: {}", tool_kind, tool_title);

            // Find an AllowOnce or AllowAlways option to select
            let allow_option = args.options.iter().find(|opt| {
                matches!(
                    opt.kind,
                    PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways
                )
            });

            if let Some(option) = allow_option {
                return Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                        option.option_id.clone(),
                    )),
                ));
            }

            // If no allow option available, just cancel (shouldn't happen)
            tracing::warn!("No allow option found for {:?}, cancelling", tool_kind);
            Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ))
        } else {
            // Dangerous operations - deny by default
            // TODO: Wire to UI for user approval
            tracing::warn!(
                "Denying {:?} operation: {} (dangerous tool)",
                tool_kind,
                tool_title
            );
            Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ))
        }
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        // Forward notifications to the channel for Tauri event emission
        tracing::info!(
            "QueryPilotClient received notification for session {}",
            args.session_id
        );
        let _ = self.notification_tx.send(args);
        Ok(())
    }
}

/// Internal state for an agent process
struct AgentProcess {
    #[allow(dead_code)]
    child: Child,
    connection: ClientSideConnection,
    session_id: Option<SessionId>,
    notification_rx: Option<NotificationReceiver>,
    /// The binary name of this agent (e.g., "gemini", "claude-code-acp")
    binary_name: String,
}

/// Worker that runs ACP operations on a LocalSet
struct AcpWorker {
    agents: HashMap<String, AgentProcess>,
}

impl AcpWorker {
    fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    async fn start_agent(&mut self, agent_info: AgentInfo) -> Result<String, String> {
        let path = agent_info
            .path
            .as_ref()
            .ok_or_else(|| format!("Agent '{}' is not installed", agent_info.name))?;

        let mut cmd = Command::new(path);
        // Pass the resolved user PATH so the agent's child processes (node, git, etc.)
        // can find their dependencies in production macOS builds.
        let runtime_path = super::discovery::get_user_path();
        let mut path_entries: Vec<PathBuf> =
            std::env::split_paths(&std::ffi::OsString::from(&runtime_path)).collect();
        let cli_path = super::commands::resolve_querypilot_cli_path()
            .map_err(|err| format!("querypilot CLI unavailable: {}", err))?;
        if let Some(cli_dir) = cli_path.parent() {
            path_entries.insert(0, cli_dir.to_path_buf());
        }
        cmd.env("QUERYPILOT_CLI_PATH", cli_path);
        match std::env::join_paths(path_entries) {
            Ok(joined) => {
                cmd.env("PATH", joined);
            }
            Err(_) => {
                cmd.env("PATH", runtime_path);
            }
        }
        for arg in &agent_info.acp_args {
            cmd.arg(arg);
        }

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start agent: {}", e))?;

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        // Create bidirectional pipes using piper (implements futures traits)
        let (to_agent_rx, to_agent_tx) = piper::pipe(4096);
        let (from_agent_rx, from_agent_tx) = piper::pipe(4096);

        // Create notification channel
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();

        // Create ACP connection over the piper pipes
        let (connection, io_task) = ClientSideConnection::new(
            QueryPilotClient::new(notification_tx),
            to_agent_tx,   // outgoing bytes (to agent)
            from_agent_rx, // incoming bytes (from agent)
            |fut| {
                tokio::task::spawn_local(fut);
            },
        );

        // Spawn the ACP I/O task
        tokio::task::spawn_local(async move {
            if let Err(e) = io_task.await {
                tracing::error!("ACP I/O task error: {}", e);
            }
        });

        // Spawn bridge tasks to connect piper pipes to tokio stdin/stdout
        // Bridge: tokio stdin <- piper to_agent_rx
        let mut stdin = stdin;
        tokio::task::spawn_local(async move {
            let mut reader = to_agent_rx;
            let mut buf = [0u8; 4096];
            loop {
                match futures::AsyncReadExt::read(&mut reader, &mut buf).await {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        if stdin.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                        if stdin.flush().await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Bridge: tokio stdout -> piper from_agent_tx
        let stdout = BufReader::new(stdout);
        let mut from_agent_tx = from_agent_tx;
        tokio::task::spawn_local(async move {
            let mut stdout = stdout;
            let mut line = String::new();
            loop {
                line.clear();
                match stdout.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        if futures::AsyncWriteExt::write_all(&mut from_agent_tx, line.as_bytes())
                            .await
                            .is_err()
                        {
                            break;
                        }
                        if futures::AsyncWriteExt::flush(&mut from_agent_tx)
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Initialize ACP handshake
        let client_caps = ClientCapabilities::new()
            .fs(FileSystemCapability::default())
            .terminal(false);

        let client_info =
            Implementation::new("query-pilot", env!("CARGO_PKG_VERSION")).title("Query Pilot");

        connection
            .initialize(
                InitializeRequest::new(ProtocolVersion::LATEST)
                    .client_capabilities(client_caps)
                    .client_info(client_info),
            )
            .await
            .map_err(|e| e.to_string())?;

        let agent_id = uuid::Uuid::new_v4().to_string();

        self.agents.insert(
            agent_id.clone(),
            AgentProcess {
                child,
                connection,
                session_id: None,
                notification_rx: Some(notification_rx),
                binary_name: agent_info.id.clone(),
            },
        );

        Ok(agent_id)
    }

    async fn create_session(
        &mut self,
        agent_id: &str,
        cwd: &str,
    ) -> Result<String, String> {
        let process = self.agents.get_mut(agent_id).ok_or("Agent not found")?;
        let request = NewSessionRequest::new(PathBuf::from(cwd));

        let response = process
            .connection
            .new_session(request)
            .await
            .map_err(|e| e.to_string())?;

        process.session_id = Some(response.session_id.clone());
        Ok(response.session_id.to_string())
    }

    async fn set_session_model(&self, agent_id: &str, model_id: &str) -> Result<(), String> {
        let process = self.agents.get(agent_id).ok_or("Agent not found")?;
        let session_id = process.session_id.clone().ok_or("Session not created")?;

        tracing::info!("Setting session model to: {}", model_id);

        // Try ACP method first
        let result = process
            .connection
            .set_session_model(SetSessionModelRequest::new(
                session_id,
                ModelId::new(model_id),
            ))
            .await;

        match result {
            Ok(_) => Ok(()),
            Err(e) => {
                let err_str = e.to_string();
                // If method not found, try fallback for specific agents
                if err_str.contains("Method not found") {
                    self.set_model_fallback(&process.binary_name, model_id)
                        .await
                } else {
                    Err(err_str)
                }
            }
        }
    }

    /// Fallback method to set model for agents that don't support ACP session/set_model
    async fn set_model_fallback(&self, binary_name: &str, _model_id: &str) -> Result<(), String> {
        // No fallback available for supported agents (Claude Code, OpenCode, Codex)
        Err(format!(
            "Agent '{}' doesn't support model selection fallback",
            binary_name
        ))
    }

    async fn send_prompt(
        &self,
        agent_id: &str,
        prompt: Vec<ContentBlock>,
    ) -> Result<PromptResponse, String> {
        let process = self.agents.get(agent_id).ok_or("Agent not found")?;
        let session_id = process.session_id.clone().ok_or("Session not created")?;

        process
            .connection
            .prompt(PromptRequest::new(session_id, prompt))
            .await
            .map_err(|e| e.to_string())
    }

    fn get_session_id(&self, agent_id: &str) -> Result<SessionId, String> {
        let process = self.agents.get(agent_id).ok_or("Agent not found")?;
        process
            .session_id
            .clone()
            .ok_or_else(|| "Session not created".to_string())
    }

    async fn cancel(&self, agent_id: &str) -> Result<(), String> {
        let process = self.agents.get(agent_id).ok_or("Agent not found")?;
        let session_id = process.session_id.clone().ok_or("Session not created")?;

        process
            .connection
            .cancel(CancelNotification::new(session_id))
            .await
            .map_err(|e| e.to_string())
    }

    async fn stop_agent(&mut self, agent_id: &str) -> Result<(), String> {
        let mut process = self.agents.remove(agent_id).ok_or("Agent not found")?;

        if let Some(session_id) = process.session_id.clone() {
            let _ = process.connection.cancel(CancelNotification::new(session_id)).await;
        }

        if let Err(err) = process.child.start_kill() {
            tracing::debug!("ACP child start_kill failed for {}: {}", agent_id, err);
        }

        match tokio::time::timeout(Duration::from_secs(2), process.child.wait()).await {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => {
                tracing::warn!("ACP child wait failed for {}: {}", agent_id, err);
            }
            Err(_) => {
                tracing::warn!("ACP child wait timed out for {}", agent_id);
            }
        }

        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        let agent_ids: Vec<String> = self.agents.keys().cloned().collect();
        let mut errors: Vec<String> = Vec::new();

        for agent_id in agent_ids {
            if let Err(err) = self.stop_agent(&agent_id).await {
                errors.push(format!("{}: {}", agent_id, err));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("Failed to stop some ACP agents: {}", errors.join("; ")))
        }
    }

    fn take_notification_receiver(
        &mut self,
        agent_id: &str,
    ) -> Result<NotificationReceiver, String> {
        let process = self.agents.get_mut(agent_id).ok_or("Agent not found")?;
        process
            .notification_rx
            .take()
            .ok_or_else(|| "Notification receiver already taken".to_string())
    }
}

/// Manages active agent processes and their ACP connections
pub struct AcpManager {
    command_tx: mpsc::UnboundedSender<AcpCommand>,
}

impl AcpManager {
    /// Create a new ACP manager
    ///
    /// This spawns a dedicated thread with a LocalSet for running ACP operations.
    pub fn new() -> Self {
        let (command_tx, mut command_rx) = mpsc::unbounded_channel::<AcpCommand>();

        // Spawn a dedicated thread for ACP operations
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to create ACP runtime");

            let local_set = tokio::task::LocalSet::new();

            local_set.block_on(&rt, async move {
                let mut worker = AcpWorker::new();

                while let Some(cmd) = command_rx.recv().await {
                    match cmd {
                        AcpCommand::StartAgent {
                            agent_info,
                            response_tx,
                        } => {
                            let result = worker.start_agent(agent_info).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::CreateSession {
                            agent_id,
                            cwd,
                            response_tx,
                        } => {
                            let result = worker.create_session(&agent_id, &cwd).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::SetSessionModel {
                            agent_id,
                            model_id,
                            response_tx,
                        } => {
                            let result = worker.set_session_model(&agent_id, &model_id).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::SendPrompt {
                            agent_id,
                            prompt,
                            response_tx,
                        } => {
                            let result = worker.send_prompt(&agent_id, prompt).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::GetSessionId {
                            agent_id,
                            response_tx,
                        } => {
                            let result = worker.get_session_id(&agent_id);
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::Cancel {
                            agent_id,
                            response_tx,
                        } => {
                            let result = worker.cancel(&agent_id).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::StopAgent {
                            agent_id,
                            response_tx,
                        } => {
                            let result = worker.stop_agent(&agent_id).await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::Shutdown { response_tx } => {
                            let result = worker.shutdown().await;
                            let _ = response_tx.send(result);
                        }
                        AcpCommand::TakeNotificationReceiver {
                            agent_id,
                            response_tx,
                        } => {
                            let result = worker.take_notification_receiver(&agent_id);
                            let _ = response_tx.send(result);
                        }
                    }
                }
            });
        });

        Self { command_tx }
    }

    /// Start an agent subprocess and establish ACP connection
    pub async fn start_agent(&self, agent_info: &AgentInfo) -> Result<String, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::StartAgent {
                agent_info: agent_info.clone(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Create a new session for an agent
    pub async fn create_session(
        &self,
        agent_id: &str,
        cwd: &str,
    ) -> Result<String, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::CreateSession {
                agent_id: agent_id.to_string(),
                cwd: cwd.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Set the model for an active session
    pub async fn set_session_model(&self, agent_id: &str, model_id: &str) -> Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::SetSessionModel {
                agent_id: agent_id.to_string(),
                model_id: model_id.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Send a prompt to an agent
    pub async fn send_prompt(
        &self,
        agent_id: &str,
        prompt: Vec<ContentBlock>,
    ) -> Result<PromptResponse, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::SendPrompt {
                agent_id: agent_id.to_string(),
                prompt,
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Get the session ID for an agent
    pub async fn get_session_id(&self, agent_id: &str) -> Result<SessionId, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::GetSessionId {
                agent_id: agent_id.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Cancel an active session/prompt
    pub async fn cancel(&self, agent_id: &str) -> Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::Cancel {
                agent_id: agent_id.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Stop a single ACP agent subprocess and remove it from manager state.
    pub async fn stop_agent(&self, agent_id: &str) -> Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::StopAgent {
                agent_id: agent_id.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Stop all ACP agents and cleanly shutdown manager-owned processes.
    pub async fn shutdown(&self) -> Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::Shutdown { response_tx })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }

    /// Take the notification receiver for an agent (can only be done once)
    pub async fn take_notification_receiver(
        &self,
        agent_id: &str,
    ) -> Result<NotificationReceiver, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(AcpCommand::TakeNotificationReceiver {
                agent_id: agent_id.to_string(),
                response_tx,
            })
            .map_err(|_| "ACP worker shutdown")?;
        response_rx.await.map_err(|_| "ACP worker shutdown")?
    }
}

impl Default for AcpManager {
    fn default() -> Self {
        Self::new()
    }
}
