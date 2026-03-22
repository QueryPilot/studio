/**
 * ACP Service
 *
 * Service for interacting with the Agent Client Protocol (ACP) backend.
 * Handles agent lifecycle, session management, and streaming updates.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentInfo,
  ModelInfo,
  SessionUpdateEvent,
  ToolCall,
  ContentBlock,
  NpmPackageManager,
  PlanStep,
} from "@/types/acp";

const activeListeners = new Map<string, UnlistenFn>();
const DEFAULT_ACP_CWD = ".";

// Cached silent agent instance for fast AI filter requests
// This avoids starting a new agent process for every quick filter
interface CachedSilentAgent {
  agentId: string;
  instanceId: string;
  modelId?: string;
  lastUsed: number;
}

let cachedSilentAgent: CachedSilentAgent | null = null;
const SILENT_AGENT_TTL = 5 * 60 * 1000; // 5 minutes TTL

// Mutex to prevent race conditions in silent agent operations
let silentAgentMutex: Promise<void> = Promise.resolve();

/**
 * Acquire the silent agent mutex to prevent concurrent operations
 */
function withSilentAgentMutex<T>(fn: () => Promise<T>): Promise<T> {
  const currentMutex = silentAgentMutex;
  let release: () => void;
  silentAgentMutex = new Promise((resolve) => {
    release = resolve;
  });
  return currentMutex.then(fn).finally(() => {
    release();
  });
}

/**
 * Extract text content from ContentBlock (can be array or single object)
 */
function extractText(content: ContentBlock | ContentBlock[] | undefined): string | undefined {
  if (!content) return undefined;

  // Handle single content block
  if (!Array.isArray(content)) {
    return content.type === "text" ? content.text : undefined;
  }

  // Handle array of content blocks
  const textBlock = content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : undefined;
}

export const AcpService = {
  /**
   * List all discovered agents available on the system
   */
  async listAgents(): Promise<AgentInfo[]> {
    return invoke<AgentInfo[]>("acp_list_agents");
  },

  /**
   * Fetch available models for an agent dynamically
   * Some agents (like OpenCode) support fetching models via CLI command
   * @param agentId The agent identifier
   * @returns Array of models if supported, null otherwise
   */
  async fetchAgentModels(agentId: string): Promise<ModelInfo[] | null> {
    return invoke<ModelInfo[] | null>("acp_fetch_agent_models", { agentId });
  },

  /**
   * Default working directory for ACP sessions.
   * We intentionally avoid generated LLM home/template directories.
   */
  getDefaultSessionCwd(): string {
    return DEFAULT_ACP_CWD;
  },

  /**
   * Start an agent subprocess
   * @param agentId The agent identifier (e.g., "claude-code-acp")
   * @returns Instance ID for the running agent process
   */
  async startAgent(agentId: string): Promise<string> {
    return invoke<string>("acp_start_agent", { agentId });
  },

  /**
   * Create a new ACP session for an agent instance
   * @param instanceId The running agent instance ID
   * @param cwd Working directory for the session
   * @returns Session ID
   */
  async createSession(
    instanceId: string,
    cwd: string,
  ): Promise<string> {
    return invoke<string>("acp_create_session", { instanceId, cwd });
  },

  /**
   * Stop an ACP agent subprocess.
   */
  async stopAgent(instanceId: string): Promise<void> {
    await invoke("acp_stop_agent", { instanceId });
  },

  /**
   * Get the path to the bundled `querypilot` CLI binary.
   */
  async getQuerypilotCliPath(): Promise<string> {
    return invoke<string>("acp_get_querypilot_cli_path");
  },

  /**
   * Set the model for an active session
   * @param instanceId The running agent instance ID
   * @param modelId The model ID (e.g., "claude-sonnet-4-20250514")
   */
  async setSessionModel(instanceId: string, modelId: string): Promise<void> {
    return invoke("acp_set_session_model", { instanceId, modelId });
  },

  /**
   * Get the current session ID for an active agent instance.
   * Used to subscribe to session events before sending a prompt.
   */
  async getSessionId(instanceId: string): Promise<string> {
    return invoke<string>("acp_get_session_id", { instanceId });
  },

  /**
   * Send a prompt to an agent and stream the response
   * @param instanceId The running agent instance ID
   * @param prompt The user prompt text
   * @param contextJson Optional database schema context as JSON
   * @param callbacks Callbacks for streaming events
   * @returns Session ID for this interaction
   */
  async sendPrompt(
    instanceId: string,
    prompt: string,
    contextJson?: string,
    images?: Array<{ data: string; mimeType: string }>,
    callbacks?: {
      onChunk?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolCall?: (toolCall: ToolCall) => void;
      onToolCallUpdate?: (
        toolCallId: string,
        status: string,
        payload?: { output?: unknown; error?: string }
      ) => void;
      onContentBlock?: (block: Exclude<ContentBlock, { type: "text" }>) => void;
      onPlanUpdate?: (steps: PlanStep[]) => void;
      onModeUpdate?: (mode: string) => void;
      onAvailableCommandsUpdate?: (commands: string[]) => void;
      onComplete?: () => void;
      onError?: (error: string) => void;
    }
  ): Promise<string> {
    // Subscribe before sending the prompt to avoid losing early chunks.
    let sessionId: string;
    try {
      sessionId = await this.getSessionId(instanceId);
    } catch (error) {
      callbacks?.onError?.(String(error));
      throw error;
    }

    // Set up event listener for streaming updates
    const eventName = `acp-update-${sessionId}`;

    // Clean up any existing listener for this session
    activeListeners.get(sessionId)?.();

    const unlisten = await listen<SessionUpdateEvent>(eventName, (event) => {
      const { update } = event.payload;

      switch (update.type) {
        case "AgentMessageChunk": {
          const contentData = update.content.content;
          const blocks = Array.isArray(contentData) ? contentData : [contentData];
          for (const block of blocks) {
            if (block.type === "text") {
              callbacks?.onChunk?.(block.text);
            } else {
              callbacks?.onContentBlock?.(block);
            }
          }
          break;
        }
        case "AgentThoughtChunk": {
          const contentData = update.content.content;
          const thought = extractText(contentData);
          if (thought) callbacks?.onThinking?.(thought);
          break;
        }
        case "ToolCall": {
          // Extract tool name from various possible fields:
          // - title: Claude Code uses this
          // - _meta.claudeCode.toolName: Claude Code metadata
          // - tool_name: ACP protocol standard
          // - name: fallback
          const toolName =
            update.toolCall.title ??
            update.toolCall._meta?.claudeCode?.toolName ??
            update.toolCall.tool_name ??
            update.toolCall.name ??
            "Unknown";

          // Extract human-readable description from ACP content blocks
          // Content structure: [{"type":"content","content":{"type":"text","text":"..."}}]
          const rawInput = update.toolCall.rawInput;
          const contentBlocks = update.toolCall.content as Array<Record<string, unknown>> | undefined;
          let description: string | undefined;
          if (contentBlocks?.length) {
            for (const block of contentBlocks) {
              if (block.type === "content") {
                const inner = block.content as Record<string, unknown> | undefined;
                if (inner?.type === "text" && typeof inner.text === "string") {
                  description = inner.text;
                  break;
                }
              }
            }
          }
          // Fallback: use rawInput.description if available
          if (!description && rawInput && typeof rawInput.description === "string") {
            description = rawInput.description;
          }

          callbacks?.onToolCall?.({
            id: update.toolCall.toolCallId ?? update.toolCall.id ?? update.toolCall.tool_call_id ?? crypto.randomUUID(),
            name: toolName,
            status: "pending",
            input: update.toolCall.input ?? update.toolCall.arguments ?? rawInput ?? {},
            description,
            kind: update.toolCall.kind as string | undefined,
          });
          break;
        }
        case "ToolCallUpdate": {
          // Try multiple field names for the tool call ID
          const toolCallId =
            update.update.toolCallId ??
            update.update.tool_call_id ??
            update.update.id;
          // Status can be in different fields
          const status = update.update.status ?? update.update.state ?? "completed";
          if (toolCallId) {
            callbacks?.onToolCallUpdate?.(toolCallId, status, {
              output: update.update.output,
              error: update.update.error,
            });
          }
          break;
        }
        case "Plan": {
          callbacks?.onPlanUpdate?.(update.plan.steps);
          break;
        }
        case "CurrentModeUpdate": {
          const modeValue = update.mode.mode;
          if (modeValue) {
            callbacks?.onModeUpdate?.(modeValue);
          }
          break;
        }
        case "AvailableCommandsUpdate": {
          const commands = update.commands.commands;
          callbacks?.onAvailableCommandsUpdate?.(commands);
          break;
        }
        case "Complete": {
          // Stream ended - finalize message and clean up
          callbacks?.onComplete?.();
          AcpService.stopListening(sessionId);
          break;
        }
        case "Error": {
          // Error occurred - notify and clean up
          callbacks?.onError?.(update.message);
          AcpService.stopListening(sessionId);
          break;
        }
      }
    });

    activeListeners.set(sessionId, unlisten);

    // Now send the prompt after listener is active.
    try {
      const responseSessionId = await invoke<string>("acp_send_prompt", {
        instanceId,
        prompt,
        contextJson,
        images: images && images.length > 0 ? images : null,
      });
      // Defensive guard: session ID must remain stable for this request.
      if (responseSessionId !== sessionId) {
        AcpService.stopListening(sessionId);
        throw new Error(
          `Session mismatch: subscribed to ${sessionId}, prompt returned ${responseSessionId}`
        );
      }
    } catch (error) {
      AcpService.stopListening(sessionId);
      callbacks?.onError?.(String(error));
      throw error;
    }

    return sessionId;
  },

  /**
   * Stop listening and clean up for a session
   */
  stopListening(sessionId: string): void {
    activeListeners.get(sessionId)?.();
    activeListeners.delete(sessionId);
  },

  /**
   * Respond to a pending permission request
   * @param requestId The permission request ID
   * @param optionId The chosen option ID (e.g., "allow-once", "reject-once")
   */
  async respondPermission(requestId: string, optionId: string): Promise<void> {
    return invoke("acp_respond_permission", { requestId, optionId });
  },

  /**
   * Cancel an active session/prompt
   */
  async cancelSession(instanceId: string): Promise<void> {
    await invoke("acp_cancel_session", { instanceId });
  },

  /**
   * Install a package using the specified package manager
   * @param packageName The package name to install
   * @param managerType The type of package manager ("npm" or "brew")
   * @param packageManager For npm type: npm, pnpm, yarn, or bun
   * @returns Installation output
   */
  async installPackage(
    packageName: string,
    managerType: "npm" | "brew",
    packageManager: NpmPackageManager | "brew" = "npm"
  ): Promise<string> {
    return invoke<string>("acp_install_package", {
      packageName,
      managerType,
      packageManager,
    });
  },

  /**
   * Check for package updates across all agents
   * Returns agents that have at least one package with an available update
   */
  async checkPackageUpdates(): Promise<AgentInfo[]> {
    return invoke<AgentInfo[]>("acp_check_package_updates");
  },

  /**
   * Upgrade a package to its latest version
   * Auto-detects the package manager from the binary path
   * @param packageName The package name to upgrade
   * @param managerType The type of package manager ("npm" or "brew")
   * @param binaryName The binary name for detecting the package manager
   * @param packageManager Optional explicit package manager override
   * @returns Upgrade output
   */
  async upgradePackage(
    packageName: string,
    managerType: "npm" | "brew",
    binaryName: string,
    packageManager?: NpmPackageManager
  ): Promise<string> {
    return invoke<string>("acp_upgrade_package", {
      packageName,
      managerType,
      binaryName,
      packageManager: packageManager ?? null,
    });
  },

  /**
   * Send a silent prompt that doesn't go through the conversation store.
   * Used for background AI tasks like filter generation.
   * Reuses a cached agent instance when possible for faster responses.
   *
   * @param agentId The agent identifier (e.g., "opencode")
   * @param prompt The prompt to send
   * @param contextJson Optional context JSON
   * @param cwd Working directory for the session
   * @param modelId Optional model ID
   * @returns The complete response text
   */
  async sendSilentPrompt(
    agentId: string,
    prompt: string,
    contextJson?: string,
    cwd?: string,
    modelId?: string
  ): Promise<string> {
    // Use mutex to prevent race conditions in agent cache operations
    return withSilentAgentMutex(async () => {
      const now = Date.now();

      // Check if we can reuse cached agent
      const canReuse =
        cachedSilentAgent &&
        cachedSilentAgent.agentId === agentId &&
        cachedSilentAgent.modelId === modelId &&
        now - cachedSilentAgent.lastUsed < SILENT_AGENT_TTL;

      let instanceId: string;

      if (canReuse && cachedSilentAgent) {
        // Reuse existing agent instance
        instanceId = cachedSilentAgent.instanceId;
        cachedSilentAgent.lastUsed = now;
      } else {
        // Kill old cached agent if exists
        if (cachedSilentAgent) {
          try {
            await this.cancelSession(cachedSilentAgent.instanceId);
          } catch {
            // Ignore cleanup errors
          }
          cachedSilentAgent = null;
        }

        // Start a new agent instance
        instanceId = await this.startAgent(agentId);

        // Create a session
        const workingDir = cwd || DEFAULT_ACP_CWD;
        await this.createSession(instanceId, workingDir);

        // Set model if specified
        if (modelId) {
          try {
            await this.setSessionModel(instanceId, modelId);
          } catch {
            // Some agents don't support model selection
          }
        }

        // Cache the agent for reuse
        cachedSilentAgent = {
          agentId,
          instanceId,
          modelId,
          lastUsed: now,
        };
      }

      try {
        // Collect the response
        let responseText = "";
        let resolveCompletion:
          | ((result: { error?: string }) => void)
          | null = null;
        const completionPromise = new Promise<{ error?: string }>((resolve) => {
          resolveCompletion = resolve;
        });

        // Send prompt and collect streaming response
        await this.sendPrompt(instanceId, prompt, contextJson, undefined, {
          onChunk: (text) => {
            responseText += text;
          },
          onComplete: () => {
            if (resolveCompletion) {
              resolveCompletion({});
            }
          },
          onError: (err) => {
            if (resolveCompletion) {
              resolveCompletion({ error: err });
            }
          },
        });

        // Wait for completion with timeout.
        const maxWaitTime = 60000; // 60 seconds
        const completionResult = await Promise.race([
          completionPromise,
          new Promise<{ timedOut: true }>((resolve) => {
            setTimeout(() => {
              resolve({ timedOut: true });
            }, maxWaitTime);
          }),
        ]);

        if ("timedOut" in completionResult) {
          // On timeout, clear cached agent
          cachedSilentAgent = null;
          throw new Error("AI request timed out");
        }

        if (completionResult.error) {
          // On error, clear cached agent (might be in bad state)
          cachedSilentAgent = null;
          throw new Error(completionResult.error);
        }

        return responseText;
      } catch (err) {
        // On any error, clear the cached agent
        cachedSilentAgent = null;
        throw err;
      }
    });
  },

  /**
   * Warmup the silent agent for faster first response.
   * Call this proactively when user opens a table grid.
   */
  async warmupSilentAgent(agentId: string, modelId?: string): Promise<void> {
    // Use mutex to prevent race conditions with sendSilentPrompt
    return withSilentAgentMutex(async () => {
      // Only warmup if no cached agent or different agent
      if (
        cachedSilentAgent &&
        cachedSilentAgent.agentId === agentId &&
        cachedSilentAgent.modelId === modelId
      ) {
        cachedSilentAgent.lastUsed = Date.now();
        return;
      }

      // Kill old cached agent if exists
      if (cachedSilentAgent) {
        try {
          await this.cancelSession(cachedSilentAgent.instanceId);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Start a new agent instance
      const instanceId = await this.startAgent(agentId);

      // Create a session
      await this.createSession(instanceId, DEFAULT_ACP_CWD);

      // Set model if specified
      if (modelId) {
        try {
          await this.setSessionModel(instanceId, modelId);
        } catch {
          // Some agents don't support model selection
        }
      }

      // Cache the agent for reuse
      cachedSilentAgent = {
        agentId,
        instanceId,
        modelId,
        lastUsed: Date.now(),
      };
    });
  },
};
