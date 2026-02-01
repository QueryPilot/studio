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
} from "@/types/acp";

const activeListeners = new Map<string, UnlistenFn>();

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
   * Initialize the LLM home directory with template files
   * Should be called once at app startup
   * @returns Path to the LLM home directory
   */
  async initializeLlmHome(): Promise<string> {
    return invoke<string>("acp_initialize_llm_home");
  },

  /**
   * Get the LLM home directory path
   * @returns Path to ~/.querypilot/llm/
   */
  async getLlmHome(): Promise<string> {
    return invoke<string>("acp_get_llm_home");
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
  async createSession(instanceId: string, cwd: string): Promise<string> {
    return invoke<string>("acp_create_session", { instanceId, cwd });
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
      sessionId = await invoke<string>("acp_send_prompt", {
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
    activeListeners.get(sessionId)?.();

    console.log("[ACP] Setting up listener for:", eventName);
    const unlisten = await listen<SessionUpdateEvent>(eventName, (event) => {
      console.log("[ACP] Received event:", event.event, event.payload);
      const { update } = event.payload;

      console.log("[ACP] Update type:", update.type);
      switch (update.type) {
        case "AgentMessageChunk": {
          console.log("[ACP] AgentMessageChunk content:", update.content);
          // Handle both { content: ContentBlock } and { content: ContentBlock[] }
          const contentData = update.content?.content;
          const text = extractText(contentData);
          console.log("[ACP] Extracted text:", text);
          if (text) callbacks?.onChunk?.(text);
          break;
        }
        case "AgentThoughtChunk": {
          const contentData = update.content?.content;
          const thought = extractText(contentData);
          if (thought) callbacks?.onThinking?.(thought);
          break;
        }
        case "ToolCall": {
          console.log("[ACP] ToolCall raw payload:", JSON.stringify(update.toolCall, null, 2));
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
          callbacks?.onToolCall?.({
            id: update.toolCall.toolCallId ?? update.toolCall.id ?? update.toolCall.tool_call_id ?? crypto.randomUUID(),
            name: toolName,
            status: "pending",
            input: update.toolCall.input ?? update.toolCall.arguments ?? {},
          });
          break;
        }
        case "ToolCallUpdate": {
          console.log("[ACP] ToolCallUpdate raw payload:", JSON.stringify(update.update, null, 2));
          // Try multiple field names for the tool call ID
          const toolCallId =
            update.update.toolCallId ??
            update.update.tool_call_id ??
            update.update.id;
          // Status can be in different fields
          const status = update.update.status ?? update.update.state ?? "completed";
          if (toolCallId) {
            callbacks?.onToolCallUpdate?.(toolCallId, status);
          }
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
        default: {
          // Log unhandled event types for debugging
          console.log("[ACP] Unhandled event type:", update.type, "payload:", JSON.stringify(update, null, 2));
        }
      }
    });

    activeListeners.set(sessionId, unlisten);

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
   * Send a silent prompt that doesn't go through the conversation store.
   * Used for background AI tasks like filter generation.
   * Creates a temporary agent session, gets the response, and cleans up.
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
    // Start a dedicated agent instance for this request
    const instanceId = await this.startAgent(agentId);

    try {
      // Create a session
      const workingDir = cwd || "/tmp";
      await this.createSession(instanceId, workingDir);

      // Set model if specified
      if (modelId) {
        await this.setSessionModel(instanceId, modelId);
      }

      // Collect the response
      let responseText = "";
      let completed = false;
      let error: string | undefined;

      // Send prompt and collect streaming response
      await this.sendPrompt(instanceId, prompt, contextJson, {
        onChunk: (text) => {
          responseText += text;
        },
        onComplete: () => {
          completed = true;
        },
        onError: (err) => {
          error = err;
          completed = true;
        },
      });

      // Wait for completion with timeout
      const maxWaitTime = 60000; // 60 seconds
      const startTime = Date.now();

      while (!completed && Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (error) {
        throw new Error(error);
      }

      if (!completed) {
        throw new Error("AI request timed out");
      }

      return responseText;
    } finally {
      // Clean up - cancel and let the agent terminate
      try {
        await this.cancelSession(instanceId);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
};
