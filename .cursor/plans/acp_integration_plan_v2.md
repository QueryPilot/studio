# ACP Integration Plan v2 - Query Pilot AI Features

> **Status:** Validated & Ready for Implementation
> **Created:** 2026-01-29
> **Previous Plan:** `acp_integration_plan_331309cb.plan.md` (superseded - contained errors)

## Executive Summary

This plan integrates the **Agent Client Protocol (ACP)** as the backend for Query Pilot's AI features. ACP is a standardized JSON-RPC 2.0 protocol for communication between clients and AI coding agents, enabling connection to Claude Code, Gemini CLI, and 15+ other agents.

**Key Features:**
- SQL query explanation via AI agents
- Natural language to SQL generation
- AI-powered data filtering in DataGrid
- Multi-agent support with user choice

---

## Quick Reference

| Question | Answer |
|----------|--------|
| Do users need Claude Code installed? | **Yes.** Agents run as local subprocesses. Query Pilot auto-detects installed agents. |
| How do agents get database context? | **Embedded JSON** in prompt context (MVP). MCP server later if needed. |
| How are streaming responses handled? | **Tauri events** from Rust backend reading agent stdout line-by-line. |
| Where is chat history stored? | **Dexie (IndexedDB)** following existing `queryHistory.ts` pattern. |
| What UI components to use? | **Vercel AI Elements** (`npx ai-elements@latest add conversation`) |

---

## Phase 1: Foundation (Rust Backend)

### 1.1 Add Dependencies

**File:** `src-tauri/Cargo.toml`

```toml
[dependencies]
# Add after existing deps:
agent-client-protocol = "0.9"  # ACP protocol implementation (v0.9.3 validated)
which = "7.0"                   # Agent binary detection in PATH
futures = "0.3"                 # For StreamExt on notification receiver
                                # Note: tokio, serde, uuid already in Cargo.toml
```

### 1.2 Create ACP Module Structure

```
src-tauri/src/acp/
├── mod.rs              # Module exports
├── discovery.rs        # Agent detection in PATH
├── manager.rs          # Subprocess lifecycle management
├── session.rs          # Session state tracking
└── commands.rs         # Tauri IPC commands
```

### 1.3 Agent Discovery (`discovery.rs`)

Detect installed agents by checking common locations:

```rust
use std::process::Command;
use which::which;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub version: Option<String>,
    pub acp_args: Vec<String>,
}

/// Known agents and their ACP invocation args (MVP list; prefer registry later)
const KNOWN_AGENTS: &[(&str, &str, &[&str])] = &[
    ("claude-code-acp", "Claude Code (ACP adapter)", &[]),
    ("gemini", "Gemini CLI", &["--experimental-acp"]),
    ("opencode", "OpenCode", &["acp"]),
    ("codex-acp", "Codex (ACP adapter)", &[]),
    ("goose", "Goose", &["--acp"]),
];

pub fn discover_agents() -> Vec<AgentInfo> {
    KNOWN_AGENTS
        .iter()
        .filter_map(|(binary, name, args)| {
            which(binary).ok().map(|path| {
                let version = get_agent_version(&path);
                AgentInfo {
                    id: binary.to_string(),
                    name: name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    version,
                    acp_args: args.iter().map(|s| s.to_string()).collect(),
                }
            })
        })
        .collect()
}

fn get_agent_version(path: &std::path::Path) -> Option<String> {
    Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}
```

### 1.4 ACP Manager (`manager.rs`)

Manages agent subprocess lifecycle with stdio transport:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use tokio::io::BufReader;
use agent_client_protocol::{
    Client, ClientSideConnection, ClientCapabilities, FileSystemCapability,
    InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion,
    ContentBlock, Implementation, RequestPermissionRequest,
    RequestPermissionResponse, RequestPermissionOutcome, SessionId,
    SessionNotification, SessionUpdate
};

/// Minimal client implementation for ACP handshake.
/// Permission requests are denied by default (MVP safety).
#[derive(Clone, Default)]
struct QueryPilotClient;

impl Client for QueryPilotClient {
    fn request_permission<'life0, 'async_trait>(
        &'life0 self,
        _args: RequestPermissionRequest,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = agent_client_protocol::Result<RequestPermissionResponse>> + 'async_trait>>
    where
        Self: 'async_trait,
        'life0: 'async_trait,
    {
        Box::pin(async {
            // MVP: deny all tool permissions by default.
            // TODO: Wire to UI for user approval before enabling agent tools.
            Ok(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled))
        })
    }

    fn session_notification<'life0, 'async_trait>(
        &'life0 self,
        _args: SessionNotification,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = agent_client_protocol::Result<()>> + 'async_trait>>
    where
        Self: 'async_trait,
        'life0: 'async_trait,
    {
        // Notifications are consumed via connection.subscribe() instead.
        Box::pin(async { Ok(()) })
    }
}

pub struct AcpManager {
    agents: RwLock<HashMap<String, AgentProcess>>,
}

struct AgentProcess {
    #[allow(dead_code)]
    child: Child,
    connection: ClientSideConnection,
    session_id: Option<SessionId>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
        }
    }

    pub async fn start_agent(
        &self,
        agent_info: &AgentInfo,
    ) -> Result<String, String> {
        let mut cmd = Command::new(&agent_info.path);
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

        // Create ACP connection over stdio.
        // IMPORTANT: new() returns (connection, io_future); io_future MUST be spawned
        // or the connection will not process any messages.
        let (connection, io_task) = ClientSideConnection::new(
            QueryPilotClient::default(),
            stdin,                  // outgoing bytes (to agent)
            BufReader::new(stdout), // incoming bytes (from agent)
            |fut| { tokio::spawn(fut); }, // spawn function for internal tasks
        );
        tokio::spawn(io_task);

        // Initialize ACP handshake
        let client_caps = ClientCapabilities::new()
            .fs(FileSystemCapability::default()) // No file access for MVP
            .terminal(false);                    // No terminal access for MVP

        let client_info = Implementation::new("query-pilot", env!("CARGO_PKG_VERSION"))
            .title("Query Pilot");

        connection.initialize(
            InitializeRequest::new(ProtocolVersion::LATEST)
                .client_capabilities(client_caps)
                .client_info(client_info)
        ).await.map_err(|e| e.to_string())?;

        let agent_id = uuid::Uuid::new_v4().to_string();

        let mut agents = self.agents.write().await;
        agents.insert(agent_id.clone(), AgentProcess {
            child,
            connection,
            session_id: None,
        });

        Ok(agent_id)
    }

    pub async fn create_session(
        &self,
        agent_id: &str,
        cwd: &str,
    ) -> Result<String, String> {
        let mut agents = self.agents.write().await;
        let process = agents.get_mut(agent_id)
            .ok_or("Agent not found")?;

        // NewSessionRequest::new() requires PathBuf, not String
        let request = NewSessionRequest::new(PathBuf::from(cwd))
            .mcp_servers(vec![]); // MVP: no MCP servers

        let response = process.connection
            .new_session(request)
            .await
            .map_err(|e| e.to_string())?;

        process.session_id = Some(response.session_id.clone());
        Ok(response.session_id.to_string())
    }

    /// Send a prompt and return a receiver for streaming notifications.
    /// Use connection.subscribe() for real-time SessionNotification streaming.
    pub async fn send_prompt(
        &self,
        agent_id: &str,
        prompt: Vec<ContentBlock>,
    ) -> Result<(SessionId, impl futures::Stream<Item = SessionNotification>), String> {
        let agents = self.agents.read().await;
        let process = agents.get(agent_id)
            .ok_or("Agent not found")?;

        let session_id = process.session_id.clone()
            .ok_or("Session not created")?;

        // Subscribe to notifications BEFORE sending prompt to avoid race conditions
        let receiver = process.connection.subscribe();

        // Send the prompt (non-blocking, streaming happens via receiver)
        process.connection
            .prompt(PromptRequest::new(session_id.clone(), prompt))
            .await
            .map_err(|e| e.to_string())?;

        Ok((session_id, receiver))
    }

    /// Cancel an active session/prompt
    pub async fn cancel(&self, agent_id: &str) -> Result<(), String> {
        let agents = self.agents.read().await;
        let process = agents.get(agent_id)
            .ok_or("Agent not found")?;

        process.connection.cancel().await.map_err(|e| e.to_string())
    }
}
```

### 1.5 Tauri Commands (`commands.rs`)

```rust
use tauri::{State, Emitter};
use std::sync::Arc;
use futures::StreamExt;
use agent_client_protocol::{ContentBlock, TextContent, SessionUpdate};
use super::discovery::AgentInfo;
use super::manager::AcpManager;

#[tauri::command]
pub async fn acp_list_agents() -> Result<Vec<AgentInfo>, String> {
    Ok(super::discovery::discover_agents())
}

#[tauri::command]
pub async fn acp_start_agent(
    agent_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    let agents = super::discovery::discover_agents();
    let agent = agents.iter()
        .find(|a| a.id == agent_id)
        .ok_or("Agent not found")?;

    manager.start_agent(agent).await
}

#[tauri::command]
pub async fn acp_create_session(
    instance_id: String,
    cwd: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    manager.create_session(&instance_id, &cwd).await
}

#[tauri::command]
pub async fn acp_send_prompt(
    instance_id: String,
    prompt: String,
    context_json: Option<String>,  // Database schema as JSON
    app_handle: tauri::AppHandle,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<String, String> {
    let mut content = vec![];

    // Add database context if provided (prepend to prompt)
    if let Some(ctx) = context_json {
        content.push(ContentBlock::Text(TextContent::new(
            format!("Database schema context:\n```json\n{}\n```\n\n", ctx)
        )));
    }

    content.push(ContentBlock::Text(TextContent::new(prompt)));

    // Send prompt and get notification stream
    let (session_id, mut receiver) = manager
        .send_prompt(&instance_id, content)
        .await?;

    let session_id_str = session_id.to_string();
    let event_name = format!("acp-update-{}", session_id_str);

    // Spawn task to forward notifications to frontend via Tauri events
    tokio::spawn(async move {
        while let Some(notification) = receiver.next().await {
            // Filter to only this session's notifications
            if notification.session_id == session_id {
                // Serialize the update for frontend
                let payload = serde_json::json!({
                    "sessionId": notification.session_id.to_string(),
                    "update": serialize_session_update(&notification.update),
                });

                if app_handle.emit(&event_name, payload).is_err() {
                    break; // Frontend disconnected
                }
            }
        }

        // Stream ended - emit completion event
        let _ = app_handle.emit(&event_name, serde_json::json!({
            "sessionId": session_id.to_string(),
            "update": { "type": "Complete" },
        }));
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
        SessionUpdate::ToolCall(tool_call) => serde_json::json!({
            "type": "ToolCall",
            "toolCall": tool_call,
        }),
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

#[tauri::command]
pub async fn acp_cancel_session(
    instance_id: String,
    manager: State<'_, Arc<AcpManager>>,
) -> Result<(), String> {
    manager.cancel(&instance_id).await
}
```

### 1.6 Register Commands (`main.rs`)

```rust
mod acp;

fn main() {
    let acp_manager = Arc::new(acp::manager::AcpManager::new());

    tauri::Builder::default()
        .manage(acp_manager)
        .invoke_handler(tauri::generate_handler![
            // ... existing commands
            acp::commands::acp_list_agents,
            acp::commands::acp_start_agent,
            acp::commands::acp_create_session,
            acp::commands::acp_send_prompt,
            acp::commands::acp_cancel_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
```

---

## Phase 2: Frontend Infrastructure

### 2.1 Types (`src/types/acp.ts`)

```typescript
// ACP Protocol Types - Aligned with agent-client-protocol 0.9.x

export interface AgentInfo {
  id: string;
  name: string;
  path: string;
  version: string | null;
  acpArgs: string[];
}

export interface AcpSession {
  id: string;
  agentId: string;
  instanceId: string;
  connectionId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AcpMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: unknown;
}

// SessionUpdate variants - matches actual ACP protocol enum (PascalCase)
export type SessionUpdateEvent = {
  sessionId: string;
  update: SessionUpdate;
};

export type SessionUpdate =
  | { type: 'AgentMessageChunk'; content: ContentChunk }
  | { type: 'AgentThoughtChunk'; content: ContentChunk }
  | { type: 'ToolCall'; toolCall: AcpToolCall }
  | { type: 'ToolCallUpdate'; update: ToolCallUpdateData }
  | { type: 'Plan'; plan: PlanData }
  | { type: 'CurrentModeUpdate'; mode: ModeData }
  | { type: 'AvailableCommandsUpdate'; commands: AvailableCommandsData }
  | { type: 'UserMessageChunk'; content: ContentChunk }
  | { type: 'Complete' }  // Custom: emitted when stream ends
  | { type: 'Unknown' };

// Content chunk for streaming text
export interface ContentChunk {
  content: ContentBlock[];
}

// ACP ContentBlock variants
export type ContentBlock =
  | { type: 'text'; text: string; annotations?: unknown }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'audio'; mimeType: string; data: string }
  | { type: 'resourceLink'; uri: string; title?: string }
  | { type: 'resource'; uri: string; content: unknown };

// Tool call from agent
export interface AcpToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

// Tool call status update
export interface ToolCallUpdateData {
  toolCallId: string;
  status: 'running' | 'completed' | 'failed';
  output?: unknown;
  error?: string;
}

// Agent's execution plan
export interface PlanData {
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// Session mode (e.g., "plan", "act")
export interface ModeData {
  mode: string;
}

// Available commands update
export interface AvailableCommandsData {
  commands: string[];
}
```

### 2.2 Dexie Database (`src/lib/db/aiConversations.ts`)

Following existing `queryHistory.ts` pattern:

```typescript
import Dexie, { Table } from 'dexie';
import type { AcpSession, AcpMessage } from '@/types/acp';

class AIConversationsDB extends Dexie {
  sessions!: Table<AcpSession, string>;
  messages!: Table<AcpMessage, string>;

  constructor() {
    super('QueryPilotAI');

    this.version(1).stores({
      sessions: '&id, agentId, connectionId, updatedAt',
      messages: '&id, sessionId, timestamp',
    });
  }
}

let db: AIConversationsDB | null = null;

function getDb(): AIConversationsDB {
  if (!db) {
    db = new AIConversationsDB();
  }
  return db;
}

// In-memory fallback for environments without IndexedDB
const memoryStore = {
  sessions: new Map<string, AcpSession>(),
  messages: new Map<string, AcpMessage>(),
};

export async function saveSession(session: AcpSession): Promise<void> {
  try {
    await getDb().sessions.put(session);
  } catch {
    memoryStore.sessions.set(session.id, session);
  }
}

export async function getSession(id: string): Promise<AcpSession | undefined> {
  try {
    return await getDb().sessions.get(id);
  } catch {
    return memoryStore.sessions.get(id);
  }
}

export async function listRecentSessions(limit = 20): Promise<AcpSession[]> {
  try {
    return await getDb().sessions
      .orderBy('updatedAt')
      .reverse()
      .limit(limit)
      .toArray();
  } catch {
    return Array.from(memoryStore.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export async function saveMessage(message: AcpMessage): Promise<void> {
  try {
    await getDb().messages.put(message);
  } catch {
    memoryStore.messages.set(message.id, message);
  }
}

export async function getSessionMessages(sessionId: string): Promise<AcpMessage[]> {
  try {
    return await getDb().messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
  } catch {
    return Array.from(memoryStore.messages.values())
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await getDb().transaction('rw', [getDb().sessions, getDb().messages], async () => {
      await getDb().messages.where('sessionId').equals(id).delete();
      await getDb().sessions.delete(id);
    });
  } catch {
    memoryStore.sessions.delete(id);
    for (const [key, msg] of memoryStore.messages) {
      if (msg.sessionId === id) memoryStore.messages.delete(key);
    }
  }
}
```

### 2.3 ACP Service (`src/services/acpService.ts`)

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentInfo,
  SessionUpdateEvent,
  ToolCall,
  ContentBlock,
} from '@/types/acp';

export class AcpService {
  private static activeListeners = new Map<string, UnlistenFn>();

  static async listAgents(): Promise<AgentInfo[]> {
    return invoke<AgentInfo[]>('acp_list_agents');
  }

  static async startAgent(agentId: string): Promise<string> {
    return invoke<string>('acp_start_agent', { agentId });
  }

  static async createSession(instanceId: string, cwd: string): Promise<string> {
    return invoke<string>('acp_create_session', { instanceId, cwd });
  }

  static async sendPrompt(
    instanceId: string,
    prompt: string,
    contextJson?: string,
    callbacks?: {
      onChunk?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolCall?: (toolCall: ToolCall) => void;
      onToolCallUpdate?: (toolCallId: string, status: string) => void;
      onComplete?: () => void;
      onError?: (error: string) => void;
    }
  ): Promise<string> {
    // Send prompt - returns session ID for this interaction
    let sessionId: string;
    try {
      sessionId = await invoke<string>('acp_send_prompt', {
        instanceId,
        prompt,
        contextJson,
      });
    } catch (error) {
      callbacks?.onError?.(String(error));
      throw error;
    }

    // Set up event listener for streaming updates
    const eventName = `acp-update-${sessionId}`;

    // Clean up any existing listener for this session
    this.activeListeners.get(sessionId)?.();

    const unlisten = await listen<SessionUpdateEvent>(eventName, (event) => {
      const { update } = event.payload;

      switch (update.type) {
        case 'AgentMessageChunk': {
          const text = this.extractText(update.content.content);
          if (text) callbacks?.onChunk?.(text);
          break;
        }
        case 'AgentThoughtChunk': {
          const thought = this.extractText(update.content.content);
          if (thought) callbacks?.onThinking?.(thought);
          break;
        }
        case 'ToolCall': {
          callbacks?.onToolCall?.({
            id: update.toolCall.id,
            name: update.toolCall.name,
            status: 'pending',
            input: update.toolCall.input ?? {},
          });
          break;
        }
        case 'ToolCallUpdate': {
          callbacks?.onToolCallUpdate?.(
            update.update.toolCallId,
            update.update.status
          );
          break;
        }
        case 'Complete': {
          // Stream ended - finalize message and clean up
          callbacks?.onComplete?.();
          this.stopListening(sessionId);
          break;
        }
        // Plan, CurrentModeUpdate, AvailableCommandsUpdate can be handled
        // in future iterations for richer UI
      }
    });

    this.activeListeners.set(sessionId, unlisten);

    return sessionId;
  }

  /** Extract text from ContentBlock array */
  private static extractText(blocks: ContentBlock[]): string | undefined {
    const textBlock = blocks.find((b) => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : undefined;
  }

  /** Stop listening and clean up for a session */
  static stopListening(sessionId: string): void {
    this.activeListeners.get(sessionId)?.();
    this.activeListeners.delete(sessionId);
  }

  static async cancelSession(instanceId: string): Promise<void> {
    return invoke('acp_cancel_session', { instanceId });
  }
}
```

### 2.4 ACP Store (`src/stores/acpStore.ts`)

Following existing Zustand patterns:

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { AgentInfo, AcpSession, AcpMessage } from '@/types/acp';
import * as db from '@/lib/db/aiConversations';
import { AcpService } from '@/services/acpService';

interface AcpState {
  // Discovered agents
  availableAgents: AgentInfo[];
  selectedAgentId: string | null;

  // Active session
  activeSession: AcpSession | null;
  activeInstanceId: string | null;

  // Messages for active session
  messages: AcpMessage[];

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;

  // UI state
  isPanelOpen: boolean;

  // Actions
  loadAgents: () => Promise<void>;
  selectAgent: (agentId: string) => void;
  startSession: (connectionId?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, contextJson?: string) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  appendChunk: (text: string) => void;
  appendThinking: (text: string) => void;
  finalizeMessage: () => void;
  togglePanel: () => void;
}

export const useAcpStore = create<AcpState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    availableAgents: [],
    selectedAgentId: null,
    activeSession: null,
    activeInstanceId: null,
    messages: [],
    isStreaming: false,
    streamingContent: '',
    streamingThinking: '',
    isPanelOpen: false,

    loadAgents: async () => {
      const agents = await AcpService.listAgents();
      set({ availableAgents: agents });

      // Auto-select first agent if none selected
      if (agents.length > 0 && !get().selectedAgentId) {
        set({ selectedAgentId: agents[0].id });
      }
    },

    selectAgent: (agentId) => {
      set({ selectedAgentId: agentId });
    },

    startSession: async (connectionId) => {
      const { selectedAgentId } = get();
      if (!selectedAgentId) throw new Error('No agent selected');

      // Start agent subprocess
      const instanceId = await AcpService.startAgent(selectedAgentId);

      // Create ACP session
      const cwd = process.cwd(); // Or get from connection
      const sessionId = await AcpService.createSession(instanceId, cwd);

      const session: AcpSession = {
        id: sessionId,
        agentId: selectedAgentId,
        instanceId,
        connectionId,
        title: 'New Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveSession(session);
      set({
        activeSession: session,
        activeInstanceId: instanceId,
        messages: [],
      });

      return sessionId;
    },

    loadSession: async (sessionId) => {
      const session = await db.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const messages = await db.getSessionMessages(sessionId);

      set({
        activeSession: session,
        activeInstanceId: session.instanceId,
        messages,
      });
    },

    sendMessage: async (content, contextJson) => {
      const { activeSession, activeInstanceId } = get();
      if (!activeSession || !activeInstanceId) {
        throw new Error('No active session');
      }

      // Add user message
      const userMessage: AcpMessage = {
        id: nanoid(),
        sessionId: activeSession.id,
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      set(state => ({ messages: [...state.messages, userMessage] }));
      await db.saveMessage(userMessage);

      // Start streaming
      set({ isStreaming: true, streamingContent: '', streamingThinking: '' });

      try {
        // sendPrompt returns sessionId and sets up event listeners
        // Callbacks are invoked as streaming events arrive
        await AcpService.sendPrompt(
          activeInstanceId,
          content,
          contextJson,
          {
            onChunk: (text) => get().appendChunk(text),
            onThinking: (text) => get().appendThinking(text),
            onToolCall: (toolCall) => {
              // Store tool calls for display (optional enhancement)
              console.log('Tool call:', toolCall);
            },
            onToolCallUpdate: (id, status) => {
              console.log('Tool call update:', id, status);
            },
            onComplete: () => get().finalizeMessage(),
            onError: (error) => {
              set({ isStreaming: false });
              console.error('ACP error:', error);
            },
          }
        );
      } catch (error) {
        set({ isStreaming: false });
        console.error('ACP error:', error);
      }
    },

    cancelGeneration: async () => {
      const { activeInstanceId } = get();
      if (activeInstanceId) {
        await AcpService.cancelSession(activeInstanceId);
        set({ isStreaming: false });
      }
    },

    appendChunk: (text) => {
      set(state => ({
        streamingContent: state.streamingContent + text,
      }));
    },

    appendThinking: (text) => {
      set(state => ({
        streamingThinking: state.streamingThinking + text,
      }));
    },

    finalizeMessage: async () => {
      const { activeSession, streamingContent, streamingThinking } = get();
      if (!activeSession) return;

      const assistantMessage: AcpMessage = {
        id: nanoid(),
        sessionId: activeSession.id,
        role: 'assistant',
        content: streamingContent,
        thinking: streamingThinking || undefined,
        timestamp: Date.now(),
      };

      set(state => ({
        messages: [...state.messages, assistantMessage],
        isStreaming: false,
        streamingContent: '',
        streamingThinking: '',
      }));

      await db.saveMessage(assistantMessage);
      await db.saveSession({
        ...activeSession,
        updatedAt: Date.now(),
      });
    },

    togglePanel: () => {
      set(state => ({ isPanelOpen: !state.isPanelOpen }));
    },
  }))
);
```

---

## Phase 3: UI Components

### 3.1 Re-add Vercel AI Elements (Adapted for Vite/ACP)

AI Elements is designed for Next.js + Vercel AI SDK. We'll re-add the components and adapt them for Vite/Tauri + ACP.

**Step 1: Add components via CLI**

```bash
npx ai-elements@latest add conversation
npx ai-elements@latest add message
npx ai-elements@latest add prompt-input
npx ai-elements@latest add reasoning
npx ai-elements@latest add tool
npx ai-elements@latest add code-block
npx ai-elements@latest add loader
npx ai-elements@latest add shimmer
```

Components install to `src/components/ai-elements/`.

**Step 2: Adapt for Vite/ACP compatibility**

| Modification | Files Affected | Change |
|-------------|----------------|--------|
| Remove `"use client"` | All files | Delete directive (Vite doesn't need it) |
| Replace AI SDK types | `message.tsx`, `tool.tsx`, `prompt-input.tsx` | Use `@/types/acp` types instead |
| Remove `ChatStatus` | `prompt-input.tsx` | Use local `isStreaming` boolean |
| Remove `FileUIPart` | `message.tsx`, `prompt-input.tsx` | Remove file attachment features (MVP) |
| Replace `ToolUIPart` | `tool.tsx` | Use `ToolCall` from `@/types/acp` |

**Step 3: Type mapping**

Create adapter types in `src/components/ai-elements/types.ts`:

```typescript
import type { AcpMessage, ToolCall } from '@/types/acp';

// Map ACP types to what AI Elements expects
export type MessageRole = AcpMessage['role'];

export interface MessageProps {
  from: MessageRole;
  children: React.ReactNode;
  className?: string;
}

export interface ToolState {
  status: ToolCall['status'];
}

// Tool state mapping: ACP status → AI Elements state
export const mapToolStatus = (status: ToolCall['status']): string => {
  const mapping: Record<ToolCall['status'], string> = {
    pending: 'input-streaming',
    running: 'input-available',
    completed: 'output-available',
    failed: 'output-error',
  };
  return mapping[status];
};
```

**Step 4: Simplified component modifications**

After adding via CLI, make these edits:

**`message.tsx`** - Remove AI SDK imports:
```diff
- import type { FileUIPart, UIMessage } from "ai";
+ import type { AcpMessage } from "@/types/acp";

- export type MessageProps = HTMLAttributes<HTMLDivElement> & {
-   from: UIMessage["role"];
- };
+ export type MessageProps = HTMLAttributes<HTMLDivElement> & {
+   from: AcpMessage["role"];
+ };
```

**`tool.tsx`** - Use local ToolCall type:
```diff
- import type { ToolUIPart } from "ai";
+ import type { ToolCall } from "@/types/acp";
+ import { mapToolStatus } from "./types";

- export type ToolHeaderProps = {
-   type: ToolUIPart["type"];
-   state: ToolUIPart["state"];
- };
+ export type ToolHeaderProps = {
+   name: string;
+   status: ToolCall["status"];
+ };
```

**`prompt-input.tsx`** - Remove file attachments for MVP:
```diff
- import type { ChatStatus, FileUIPart } from "ai";

// Remove AttachmentsContext and file handling
// Simplify to just text input + submit
```

### 3.2 AI Panel Component (`src/components/AI/AIPanel.tsx`)

```tsx
import { useEffect } from 'react';
import { useAcpStore } from '@/stores/acpStore';
import { Conversation } from '@/components/ai-elements/conversation';
import { Message } from '@/components/ai-elements/message';
import { PromptInput } from '@/components/ai-elements/prompt-input';
import { Reasoning } from '@/components/ai-elements/reasoning';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { introspectionService } from '@/services/introspectionService';

export function AIPanel() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    activeSession,
    sendMessage,
    loadAgents,
    startSession,
  } = useAcpStore();

  const activeConnection = useConnectionStore(s => s.activeConnection);

  // Load agents on mount
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleSend = async (content: string) => {
    // Ensure we have a session
    if (!activeSession) {
      await startSession(activeConnection?.id);
    }

    // Build database context
    let contextJson: string | undefined;
    if (activeConnection) {
      try {
        const introspection = await introspectionService.getIntrospection(
          activeConnection.id
        );
        contextJson = JSON.stringify({
          database: activeConnection.database,
          dialect: activeConnection.type,
          tables: introspection.tables.map(t => ({
            schema: t.schema,
            name: t.name,
            columns: t.columns.map(c => ({
              name: c.name,
              type: c.dataType,
              nullable: c.nullable,
            })),
          })),
        }, null, 2);
      } catch (e) {
        console.warn('Failed to get schema context:', e);
      }
    }

    await sendMessage(content, contextJson);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">AI Assistant</h3>
        <AgentSelector />
      </div>

      {/* Messages */}
      <Conversation className="flex-1 overflow-y-auto p-4">
        {messages.map((msg) => (
          <Message
            key={msg.id}
            role={msg.role}
            className="mb-4"
          >
            {msg.thinking && (
              <Reasoning content={msg.thinking} collapsible />
            )}
            <div className="prose prose-sm dark:prose-invert">
              {msg.content}
            </div>
          </Message>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <Message role="assistant" className="mb-4">
            {streamingThinking && (
              <Reasoning content={streamingThinking} collapsible />
            )}
            <div className="prose prose-sm dark:prose-invert">
              {streamingContent}
              <span className="animate-pulse">▊</span>
            </div>
          </Message>
        )}
      </Conversation>

      {/* Input */}
      <div className="border-t p-4">
        <PromptInput
          onSubmit={handleSend}
          disabled={isStreaming}
          placeholder="Ask about your database..."
        />
      </div>
    </div>
  );
}
```

### 3.3 Agent Selector (`src/components/AI/AgentSelector.tsx`)

```tsx
import { useAcpStore } from '@/stores/acpStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function AgentSelector() {
  const { availableAgents, selectedAgentId, selectAgent } = useAcpStore();

  if (availableAgents.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No AI agents found.
        <a href="https://docs.querypilot.dev/ai-setup" className="underline ml-1">
          Install one
        </a>
      </div>
    );
  }

  return (
    <Select value={selectedAgentId ?? ''} onValueChange={selectAgent}>
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {availableAgents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            <div className="flex items-center gap-2">
              <span>{agent.name}</span>
              {agent.version && (
                <span className="text-muted-foreground text-[10px]">
                  v{agent.version}
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### 3.4 Integrate Right Panel

**File:** `src/screens/workspace/WorkspaceScreen.tsx`

Add right panel toggle and component:

```tsx
import { AIPanel } from '@/components/AI/AIPanel';
import { useWorkspaceScreenStore } from '@/stores/workspaceScreenStore';

// In the layout JSX:
{sidebars.right && (
  <div className="w-80 border-l flex flex-col">
    <AIPanel />
  </div>
)}
```

---

## Phase 4: Feature Implementation

### 4.1 Update FilterMode Type

**File:** `src/utils/filterParser.ts`

```typescript
// Change line 12 from:
export type FilterMode = "search" | "where";

// To:
export type FilterMode = "search" | "where" | "ai";
```

### 4.2 Wire AI Commands

**File:** `src/data/commands/aiCommands.ts`

```typescript
import { useAcpStore } from '@/stores/acpStore';

export const aiCommands: Command[] = [
  {
    id: "ai.togglePanel",
    label: "Toggle AI Assistant",
    category: "AI",
    handler: () => {
      useAcpStore.getState().togglePanel();
      useWorkspaceScreenStore.getState().toggleSidebar("right");
    },
  },
  {
    id: "ai.explainQuery",
    label: "AI: Explain Query",
    category: "AI",
    when: "editorTextFocus && queryEditor",
    handler: async () => {
      const store = useWorkspaceScreenStore.getState();
      if (!store.getSidebars().right) {
        store.toggleSidebar("right");
      }

      // Get selected SQL from editor
      const editor = getActiveEditor();
      const selectedSql = editor?.getSelection() || editor?.getValue();

      if (selectedSql) {
        const acpStore = useAcpStore.getState();
        await acpStore.sendMessage(
          `Explain this SQL query:\n\`\`\`sql\n${selectedSql}\n\`\`\``
        );
      }
    },
  },
  // ... similar for ai.generateSQL
];
```

### 4.3 Implement AI Filter Generation

**File:** `src/components/DataGrid/adapters/SqlDataGrid.tsx`

Pass `generateAIFilter` to useQuickFilter:

```typescript
const quickFilter = useQuickFilter({
  columns,
  gridId,
  generateAIFilter: async (prompt, options) => {
    const acpStore = useAcpStore.getState();

    // Ensure session exists
    if (!acpStore.activeSession) {
      await acpStore.startSession(connectionId);
    }

    // Build schema context
    const contextJson = JSON.stringify({
      table: tableName,
      columns: columns.map(c => ({ name: c.name, type: c.dataType })),
    });

    // Generate filter via AI
    const fullPrompt = options?.outputType === 'sql'
      ? `Generate a SQL WHERE clause for: ${prompt}\n\nOnly output the WHERE clause, no explanation.`
      : `Generate a search pattern for: ${prompt}\n\nOnly output the search pattern, no explanation.`;

    // This is a simplified version - in practice you'd want to
    // capture the AI response and return it (e.g., await a response channel)
    await acpStore.sendMessage(fullPrompt, contextJson);

    // Return the generated clause
    const lastMessage = acpStore.messages[acpStore.messages.length - 1];
    return {
      clause: lastMessage?.content || '',
      explanation: 'Generated by AI',
    };
  },
});
```

---

## Phase 5: Testing & Documentation

### 5.1 Test Cases

1. **Agent Discovery**
   - [ ] Detects Claude Code when installed
   - [ ] Detects Gemini CLI when installed
   - [ ] Shows empty state when no agents found
   - [ ] Handles partially installed agents gracefully

2. **Session Lifecycle**
   - [ ] Creates session successfully
   - [ ] Persists session to IndexedDB
   - [ ] Resumes session after app restart
   - [ ] Handles agent crash gracefully

3. **Streaming**
   - [ ] Displays text chunks in real-time
   - [ ] Shows thinking/reasoning blocks
   - [ ] Handles tool calls (if supported)
   - [ ] Cancel stops generation

4. **Context Injection**
   - [ ] Includes database schema in prompts
   - [ ] Works with different database types
   - [ ] Handles large schemas gracefully

### 5.2 User Documentation

Create `docs/guides/ai-features.md`:

1. Installing AI Agents
   - Claude Code requirements
   - Gemini CLI setup
   - Verifying installation

2. Using AI Features
   - Explain Query
   - Generate SQL
   - AI Filters

3. Troubleshooting
   - "No agents found"
   - Connection issues
   - Performance tips

---

## Implementation Order

| Phase | Task | Priority | Effort |
|-------|------|----------|--------|
| 1.1 | Add Rust dependencies | P0 | 0.5h |
| 1.2-1.4 | Agent discovery | P0 | 2h |
| 1.5-1.6 | ACP manager & commands | P0 | 4h |
| 2.1-2.2 | Types & Dexie DB | P0 | 2h |
| 2.3-2.4 | Service & Store | P0 | 3h |
| 3.1 | Re-add AI Elements + adapt | P0 | 2h |
| 3.2-3.4 | UI components | P1 | 3h |
| 4.1-4.2 | Feature wiring | P1 | 2h |
| 4.3 | AI filter integration | P2 | 3h |
| 5.1-5.2 | Testing & docs | P1 | 4h |

**Total estimated effort: ~25.5 hours**

---

## API Validation (2026-01-29)

Verified against `agent-client-protocol` v0.9.3 on crates.io:

| API Element | Verified | Notes |
|-------------|----------|-------|
| `ClientSideConnection::new()` | ✓ | Returns `(Self, impl Future)` - must spawn IO task |
| `Client` trait | ✓ | Two required methods: `request_permission`, `session_notification` |
| `InitializeRequest` builder | ✓ | `.client_capabilities()`, `.client_info()` |
| `NewSessionRequest::new()` | ✓ | Takes `PathBuf`, not `String` |
| `PromptRequest::new()` | ✓ | Takes `(SessionId, Vec<ContentBlock>)` |
| `SessionNotification` struct | ✓ | Has `session_id`, `update`, `meta` fields |
| `SessionUpdate` enum | ✓ | PascalCase variants: `AgentMessageChunk`, `ToolCall`, etc. |
| `ContentBlock::Text` | ✓ | Uses `TextContent::new(string)` |
| `connection.subscribe()` | ✓ | Returns `StreamReceiver` for notifications |
| `connection.cancel()` | ✓ | Halts active operations |

---

## Differences from Previous Plan

| Aspect | Previous Plan | This Plan |
|--------|--------------|-----------|
| UI Components | `npx shadcn@latest add ai/conversation` (wrong) | Re-add via `npx ai-elements@latest`, adapt for Vite/ACP |
| AI SDK dependency | Assumed AI SDK compatibility | Remove AI SDK types, use `@/types/acp` instead |
| IndexedDB | Zustand persist middleware | Dexie directly (matches codebase pattern) |
| FilterMode | Not addressed | Added `"ai"` to type union |
| MCP Server | Complex self-spawning approach | Deferred; embedded JSON context for MVP |
| Session persistence | Generic pattern | Matches `queryHistory.ts` pattern exactly |
| Agent discovery | Generic PATH search | Specific known agents with version detection |

---

## Security Considerations

1. **No file system access** - `clientCapabilities.fs` set to `None`
2. **No terminal access** - `clientCapabilities.terminal` set to `false`
3. **SQL validation** - Generated SQL should be validated before execution
4. **API keys** - Stored in OS keychain via existing `keychain.rs`
5. **Context limits** - Truncate large schemas to prevent context overflow

## Risk & Gaps

### ✅ Addressed in This Plan
1. **ACP I/O task** - Code now correctly spawns `io_task` from `ClientSideConnection::new()`.
2. **Streaming updates** - Uses `connection.subscribe()` and proper `SessionUpdate` enum variants (PascalCase).
3. **PathBuf vs String** - `NewSessionRequest::new()` now uses `PathBuf::from(cwd)`.
4. **Frontend types** - Updated to match actual ACP protocol types.

### ⚠️ Known Limitations (MVP Scope)
1. **Session resume** - Persisted `instanceId` is not valid across app restarts. MVP: re-create sessions after restart. Future: implement `session/load` for persistence.
2. **Agent discovery** - PATH-only detection may miss adapter-based agents. Future: add ACP registry support or user-configured agent paths.
3. **AI Elements adaptation** - After adding via CLI, must:
   - Remove `"use client"` directives (Vite doesn't need them)
   - Replace AI SDK type imports (`UIMessage`, `ToolUIPart`, `FileUIPart`, `ChatStatus`) with `@/types/acp` types
   - Remove file attachment features (not needed for MVP)
4. **Permission handling** - MVP denies all tool permissions. Future: wire to UI for user approval before enabling agent tools.

---

## Future Enhancements (Post-MVP)

1. **MCP Server** - Expose tools for dynamic schema queries
2. **Multi-session** - Support multiple concurrent conversations
3. **Session history** - UI to browse and resume past sessions
4. **Custom prompts** - User-configurable prompt templates
5. **Model selection** - Choose models within same agent (e.g., Claude Sonnet vs Opus)
