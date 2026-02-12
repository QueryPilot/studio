/**
 * ACP Store
 *
 * Zustand store for Agent Client Protocol (ACP) state management.
 * Handles agent selection, session lifecycle, and message streaming.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  AgentInfo,
  AcpSession,
  AcpMessage,
  ToolCall,
  ModelInfo,
  NpmPackageManager,
  AssistantFlowSegment,
} from "@/types/acp";
import * as db from "@/lib/db/aiConversations";
import { AcpService } from "@/services/acpService";
import { toast } from "sonner";

// Module-level variable to track warmup promise (avoids Zustand serialization issues)
let currentWarmupPromise: Promise<string> | null = null;

// Default model ID for quick filter (uses haiku-equivalent on Claude agents)
export const DEFAULT_QUICK_FILTER_MODEL = "haiku";

// Storage key for persisted model preferences
const STORAGE_KEY = "acp-model-preferences";

// Maximum title length
const MAX_TITLE_LENGTH = 50;

/**
 * Generate a session title from the first user message.
 * Truncates and cleans up the message for display.
 */
function generateSessionTitle(message: string): string {
  // Remove @ mentions (e.g., @public.users)
  let title = message.replace(/@[\w.]+/g, "").trim();

  // Remove excess whitespace
  title = title.replace(/\s+/g, " ");

  // Truncate if too long
  if (title.length > MAX_TITLE_LENGTH) {
    // Try to cut at a word boundary
    const truncated = title.slice(0, MAX_TITLE_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    title = lastSpace > 20 ? truncated.slice(0, lastSpace) + "…" : truncated + "…";
  }

  // Fallback if title is empty after cleanup
  if (!title || title === "…") {
    title = "New Conversation";
  }

  return title;
}

/**
 * Hook to get available models for the currently selected agent
 * Returns dynamically fetched models if available, otherwise static models
 */
export function useAvailableModels(): ModelInfo[] {
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const agents = useAcpStore((s) => s.availableAgents);
  const dynamicModels = useAcpStore((s) => s.dynamicModels);

  // Prefer dynamic models if available for this agent
  if (selectedAgentId && dynamicModels[selectedAgentId]?.length) {
    return dynamicModels[selectedAgentId];
  }

  // Fall back to static models from agent definition
  const agent = agents.find((a) => a.id === selectedAgentId);
  return agent?.models ?? [];
}

/**
 * Hook to check if models are being fetched
 */
export function useIsLoadingModels(): boolean {
  return useAcpStore((s) => s.isLoadingModels);
}

interface AcpState {
  // Discovered agents
  availableAgents: AgentInfo[];
  selectedAgentId: string | null;
  selectedModel: string | null;
  isLoadingAgents: boolean;

  // Per-agent model preferences (agentId -> modelId)
  modelPreferences: Record<string, string>;

  // Preferred package manager for installs/upgrades
  preferredPackageManager: NpmPackageManager;

  // Auto-upgrade: true = upgrade silently, false = show toast for confirmation
  autoUpgradePackages: boolean;

  // Skipped versions: packageName -> version (don't nag about these)
  skippedPackageVersions: Record<string, string>;

  // Dynamic models fetched from agents (keyed by agentId)
  dynamicModels: Record<string, ModelInfo[]>;
  isLoadingModels: boolean;

  // Package updates (agents with outdated packages)
  agentsWithUpdates: AgentInfo[];

  // Active session
  activeSession: AcpSession | null;
  activeInstanceId: string | null;

  // Messages for active session
  messages: AcpMessage[];

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  streamingError: string | null;
  streamingFlow: AssistantFlowSegment[];

  // Active tool calls during streaming
  activeToolCalls: ToolCall[];

  // Additional ACP streaming metadata
  streamingPlan: Array<{ id: string; description: string; status: string }>;
  currentMode: string | null;
  availableSessionCommands: string[];

  // Warmup state - pre-starts agent for faster first message
  isWarmingUp: boolean;

  // MCP tools availability - false if sidecar is missing
  mcpAvailable: boolean;

  // Session history
  recentSessions: AcpSession[];
  isLoadingSessions: boolean;

  // UI state
  isPanelOpen: boolean;

  // Actions
  loadAgents: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  loadRecentSessions: (connectionId?: string) => Promise<void>;
  selectAgent: (agentId: string) => void;
  fetchModelsForAgent: (agentId: string) => Promise<void>;
  selectModel: (modelId: string) => Promise<void>;
  warmupAgent: (connectionId?: string) => Promise<string>;
  startSession: (connectionId?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  newConversation: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, contextJson?: string, images?: Array<{ data: string; mimeType: string }>) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  appendChunk: (text: string) => void;
  appendThinking: (text: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolCallId: string, status: ToolCall["status"]) => void;
  setPlan: (
    steps: Array<{ id: string; description: string; status: string }>
  ) => void;
  setMode: (mode: string | null) => void;
  setAvailableCommands: (commands: string[]) => void;
  finalizeMessage: () => void;
  togglePanel: () => void;
  setPreferredPackageManager: (pm: NpmPackageManager) => void;
  setAutoUpgradePackages: (auto: boolean) => void;
  skipPackageVersion: (packageName: string, version: string) => void;
  upgradePackages: (agents: AgentInfo[]) => Promise<void>;
}

export const useAcpStore = create<AcpState>()(
  persist(
    (set, get) => ({
    // Initial state
    availableAgents: [],
    selectedAgentId: null,
    selectedModel: null,
    isLoadingAgents: false,
    modelPreferences: {},
    preferredPackageManager: "npm" as NpmPackageManager,
    autoUpgradePackages: true,
    skippedPackageVersions: {},
    dynamicModels: {},
    isLoadingModels: false,
    agentsWithUpdates: [],
    activeSession: null,
    activeInstanceId: null,
    messages: [],
    isStreaming: false,
    streamingContent: "",
    streamingThinking: "",
    streamingError: null,
    streamingFlow: [],
    activeToolCalls: [],
    streamingPlan: [],
    currentMode: null,
    availableSessionCommands: [],
    isWarmingUp: false,
    mcpAvailable: true, // Assume available until warmup confirms
    recentSessions: [],
    isLoadingSessions: false,
    isPanelOpen: false,

    loadAgents: async () => {
      set({ isLoadingAgents: true });
      try {
        const agents = await AcpService.listAgents();
        set({ availableAgents: agents });

        const currentAgentId = get().selectedAgentId;

        // If we have a persisted agent, verify it's still installed and fetch its models
        if (currentAgentId) {
          const persistedAgent = agents.find((a) => a.id === currentAgentId && a.installed);
          if (persistedAgent) {
            // Fetch dynamic models for persisted agent
            void get().fetchModelsForAgent(currentAgentId);
          } else {
            // Persisted agent no longer available, clear selection
            set({ selectedAgentId: null, selectedModel: null });
          }
        }

        // Auto-select first installed agent if none selected
        if (!get().selectedAgentId) {
          const firstInstalledAgent = agents.find((agent) => agent.installed);
          if (firstInstalledAgent) {
            const defaultModel = firstInstalledAgent.models[0]?.id ?? null;
            set({
              selectedAgentId: firstInstalledAgent.id,
              selectedModel: get().selectedModel ?? defaultModel,
            });
            // Fetch dynamic models for auto-selected agent
            void get().fetchModelsForAgent(firstInstalledAgent.id);
          }
        }
      } finally {
        set({ isLoadingAgents: false });
      }

      // Check for package updates in the background (non-blocking)
      void get().checkForUpdates();
    },

    checkForUpdates: async () => {
      try {
        const agentsWithUpdates = await AcpService.checkPackageUpdates();
        const { skippedPackageVersions, autoUpgradePackages } = get();

        // Filter out packages whose latest version was skipped by the user
        const filteredAgents = agentsWithUpdates
          .map((agent) => ({
            ...agent,
            packages: agent.packages.filter((pkg) => {
              if (!pkg.updateAvailable || !pkg.latestVersion) return false;
              return skippedPackageVersions[pkg.name] !== pkg.latestVersion;
            }),
          }))
          .filter((agent) => agent.packages.some((p) => p.updateAvailable));

        set({ agentsWithUpdates: filteredAgents });

        if (filteredAgents.length === 0) return;

        if (autoUpgradePackages) {
          // Auto mode: upgrade silently, show toast when done
          await get().upgradePackages(filteredAgents);
        } else {
          // Manual mode: show toast for each agent with updates
          for (const agent of filteredAgents) {
            const outdated = agent.packages.filter((p) => p.updateAvailable);
            const summary = outdated
              .map((p) => `${p.name} ${p.installedVersion} → ${p.latestVersion}`)
              .join(", ");

            toast(`${agent.name} update available`, {
              description: summary,
              duration: 30000,
              action: {
                label: "Update",
                onClick: () => {
                  void get().upgradePackages([agent]);
                },
              },
              cancel: {
                label: "Skip",
                onClick: () => {
                  // Skip these versions so we don't nag again
                  for (const pkg of outdated) {
                    if (pkg.latestVersion) {
                      get().skipPackageVersion(pkg.name, pkg.latestVersion);
                    }
                  }
                },
              },
            });
          }
        }
      } catch (error) {
        console.warn("Failed to check for package updates:", error);
      }
    },

    loadRecentSessions: async (connectionId?: string) => {
      set({ isLoadingSessions: true });
      try {
        // Load sessions filtered by connectionId for workspace-specific history
        const sessions = await db.listRecentSessions(20, connectionId);
        set({ recentSessions: sessions });
      } finally {
        set({ isLoadingSessions: false });
      }
    },

    selectAgent: (agentId) => {
      const {
        selectedAgentId: currentAgentId,
        selectedModel: currentModel,
        availableAgents,
        dynamicModels,
        modelPreferences,
      } = get();

      // Save current model preference before switching
      const updatedPreferences = { ...modelPreferences };
      if (currentAgentId && currentModel) {
        updatedPreferences[currentAgentId] = currentModel;
      }

      // Find the new agent
      const newAgent = availableAgents.find((a) => a.id === agentId);

      // Use dynamic models if available, otherwise static
      const models = dynamicModels[agentId]?.length ? dynamicModels[agentId] : newAgent?.models ?? [];

      // Restore saved preference for this agent, or use first available model
      const savedModel = modelPreferences[agentId];
      const defaultModel = savedModel ?? models[0]?.id ?? null;

      // If changing to a different agent, clear current session and warmup
      if (currentAgentId !== agentId) {
        currentWarmupPromise = null;
        set({
          selectedAgentId: agentId,
          selectedModel: defaultModel,
          modelPreferences: updatedPreferences,
          activeSession: null,
          activeInstanceId: null,
          messages: [],
          streamingFlow: [],
          streamingPlan: [],
          currentMode: null,
          availableSessionCommands: [],
          isWarmingUp: false,
        });

        // Warmup the new agent in the background (if installed)
        if (newAgent?.installed) {
          // Small delay to let the UI update first
          setTimeout(() => {
            void get().warmupAgent();
          }, 100);
        }
      } else {
        set({
          selectedAgentId: agentId,
          selectedModel: defaultModel,
          modelPreferences: updatedPreferences,
        });
      }

      // Fetch dynamic models for the newly selected agent
      void get().fetchModelsForAgent(agentId);
    },

    fetchModelsForAgent: async (agentId) => {
      // Skip if we already have dynamic models for this agent
      if (get().dynamicModels[agentId]?.length) {
        return;
      }

      // Check if agent is installed before fetching
      const agent = get().availableAgents.find((a) => a.id === agentId);
      if (!agent?.installed) {
        return;
      }

      set({ isLoadingModels: true });
      try {
        const models = await AcpService.fetchAgentModels(agentId);
        if (models && models.length > 0) {
          set((state) => ({
            dynamicModels: {
              ...state.dynamicModels,
              [agentId]: models,
            },
          }));

          // Update selected model if this is the current agent and no model selected
          const { selectedAgentId, selectedModel } = get();
          if (selectedAgentId === agentId && !selectedModel) {
            set({ selectedModel: models[0]?.id ?? null });
          }
        }
      } catch (error) {
        console.warn("Failed to fetch dynamic models for agent:", agentId, error);
        // Fall back to static models - no action needed
      } finally {
        set({ isLoadingModels: false });
      }
    },

    selectModel: async (modelId: string) => {
      const {
        selectedAgentId,
        selectedModel: currentModel,
        activeSession,
        activeInstanceId,
        modelPreferences,
      } = get();

      if (currentModel === modelId) return;

      // Save model preference for the current agent
      const updatedPreferences = selectedAgentId
        ? { ...modelPreferences, [selectedAgentId]: modelId }
        : modelPreferences;

      set({
        selectedModel: modelId,
        modelPreferences: updatedPreferences,
      });

      // If we have an active session, try to update the model on it
      // Note: Some agents (e.g., Gemini) don't support session/set_model
      if (activeSession && activeInstanceId && modelId) {
        try {
          await AcpService.setSessionModel(activeInstanceId, modelId);
        } catch (error) {
          // Silently ignore - agent may not support model selection
          console.warn("Agent doesn't support model selection:", error);
        }
      }
    },

    warmupAgent: async (connectionId) => {
      const { selectedAgentId, selectedModel, activeSession, activeInstanceId, isWarmingUp, messages } = get();

      // Already have an active running session
      if (activeSession && activeInstanceId) {
        return activeSession.id;
      }

      // Already warming up - return existing promise
      if (isWarmingUp && currentWarmupPromise) {
        return currentWarmupPromise;
      }

      if (!selectedAgentId) {
        throw new Error("No agent selected");
      }

      // Check if agent is installed
      const agent = get().availableAgents.find(a => a.id === selectedAgentId);
      if (!agent?.installed) {
        throw new Error("Selected agent is not installed");
      }

      // If we have a loaded session but no instanceId, we're resuming an old conversation
      // Keep the existing messages but create a fresh agent session
      const resumeSession = (activeSession && !activeInstanceId) ? activeSession : null;
      const existingMessages = resumeSession ? messages : [];

      // Start warmup
      set({ isWarmingUp: true });

      currentWarmupPromise = (async () => {
        try {
          // Start agent subprocess
          const instanceId = await AcpService.startAgent(selectedAgentId);

          // Get MCP sidecar path for database access
          // CRITICAL: Without MCP sidecar, agents cannot access database tools
          let mcpServers: { name: string; command: string; args: string[] }[] | undefined;
          let mcpAvailable = false;
          try {
            const sidecarPath = await AcpService.getMcpSidecarPath();
            mcpServers = [
              {
                name: "querypilot",
                command: sidecarPath,
                args: [],
              },
            ];
            mcpAvailable = true;
          } catch (err) {
            // MCP sidecar not available - agent will have limited functionality
            console.error("[ACP] ⚠️ MCP sidecar NOT available - database tools disabled:", err);
            console.error("[ACP] Run 'cargo build -p querypilot-mcp' to build the sidecar");
          }

          // Store MCP availability for UI to show warnings
          set({ mcpAvailable });

          // Create ACP session with LLM home directory as working directory
          const llmHome = await AcpService.getLlmHome();
          const sessionId = await AcpService.createSession(instanceId, llmHome, mcpServers);

          // Set the model for the session (if one is selected)
          // Note: Some agents (e.g., Gemini) don't support session/set_model
          if (selectedModel) {
            try {
              await AcpService.setSessionModel(instanceId, selectedModel);
            } catch (err) {
              console.warn("Agent doesn't support model selection:", err);
            }
          }

          // If resuming old session, update it with new instanceId
          // Otherwise create a fresh session
          let session: AcpSession;
          if (resumeSession) {
            session = {
              ...resumeSession,
              instanceId,
              updatedAt: Date.now(),
            };
          } else {
            session = {
              id: sessionId,
              agentId: selectedAgentId,
              instanceId,
              connectionId,
              title: "New Conversation",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
          }

          await db.saveSession(session);

          // Only set messages if resuming an old session (to restore history)
          // For new sessions, preserve current messages (may have optimistically added user message)
          if (resumeSession) {
            set({
              activeSession: session,
              activeInstanceId: instanceId,
              messages: existingMessages,
              isWarmingUp: false,
            });
          } else {
            set({
              activeSession: session,
              activeInstanceId: instanceId,
              isWarmingUp: false,
            });
          }

          currentWarmupPromise = null;
          return session.id;
        } catch (error) {
          set({ isWarmingUp: false });
          currentWarmupPromise = null;
          throw error;
        }
      })();

      return currentWarmupPromise;
    },

    startSession: async (connectionId) => {
      // Use warmupAgent which handles deduplication
      return get().warmupAgent(connectionId);
    },

    loadSession: async (sessionId) => {
      const session = await db.getSession(sessionId);
      if (!session) throw new Error("Session not found");

      const messages = await db.getSessionMessages(sessionId);

      // Select the agent that was used for this session (if different)
      const { selectedAgentId, availableAgents } = get();
      if (session.agentId !== selectedAgentId) {
        // Check if agent is still installed
        const agent = availableAgents.find((a) => a.id === session.agentId);
        if (agent?.installed) {
          get().selectAgent(session.agentId);
        }
      }

      // Note: ACP doesn't support session resume. The old instanceId is invalid
      // (the process is gone). We load the messages for display, but set
      // activeInstanceId to null. When user sends a new message, a fresh
      // agent session will be started automatically.
      set({
        activeSession: session,
        activeInstanceId: null, // Old instance is dead - will warmup on next message
        messages,
        isStreaming: false,
        streamingContent: "",
        streamingThinking: "",
        streamingError: null,
        streamingFlow: [],
        activeToolCalls: [],
        streamingPlan: [],
        currentMode: null,
        availableSessionCommands: [],
        isWarmingUp: false,
      });

      // Warmup the agent in background so it's ready for the next message
      const agent = get().availableAgents.find((a) => a.id === session.agentId);
      if (agent?.installed) {
        setTimeout(() => {
          void get().warmupAgent();
        }, 100);
      }
    },

    newConversation: () => {
      // Clear current session state to start fresh
      currentWarmupPromise = null;
      set({
        activeSession: null,
        activeInstanceId: null,
        messages: [],
        isStreaming: false,
        streamingContent: "",
        streamingThinking: "",
        streamingError: null,
        streamingFlow: [],
        activeToolCalls: [],
        streamingPlan: [],
        currentMode: null,
        availableSessionCommands: [],
        isWarmingUp: false,
      });

      // Trigger warmup for the selected agent
      const { selectedAgentId, availableAgents } = get();
      const agent = availableAgents.find((a) => a.id === selectedAgentId);
      if (agent?.installed) {
        setTimeout(() => {
          void get().warmupAgent();
        }, 100);
      }
    },

    deleteSession: async (sessionId) => {
      await db.deleteSession(sessionId);

      // If deleting the active session, clear it
      const { activeSession } = get();
      // Get connectionId before deleting for refresh
      const deletedSession = get().recentSessions.find((s) => s.id === sessionId);
      const connectionId = deletedSession?.connectionId;

      if (activeSession?.id === sessionId) {
        get().newConversation();
      }

      // Refresh the session list for this connection
      void get().loadRecentSessions(connectionId);
    },

    sendMessage: async (content, contextJson, images) => {
      const { messages } = get();

      // Generate a temporary message ID for optimistic UI
      const tempMessageId = nanoid();
      const isFirstMessage = messages.filter((m) => m.role === "user").length === 0;

      // Add user message IMMEDIATELY (optimistic UI)
      const userMessage: AcpMessage = {
        id: tempMessageId,
        sessionId: "pending", // Will be updated once session is ready
        role: "user",
        content,
        timestamp: Date.now(),
        images: images && images.length > 0 ? images : undefined,
      };

      set((state) => ({
        messages: [...state.messages, userMessage],
        isStreaming: true,
        streamingContent: "",
        streamingThinking: "",
        streamingError: null,
        streamingFlow: [],
        activeToolCalls: [],
        streamingPlan: [],
      }));

      // Now wait for session to be ready (user sees their message while waiting)
      let activeSession = get().activeSession;
      let activeInstanceId = get().activeInstanceId;

      if (!activeSession && currentWarmupPromise) {
        await currentWarmupPromise;
        // Re-read state after warmup completes
        activeSession = get().activeSession;
        activeInstanceId = get().activeInstanceId;
      }

      if (!activeSession || !activeInstanceId) {
        set({
          isStreaming: false,
          streamingError: "No active session",
          streamingFlow: [],
        });
        return;
      }

      // Update the message with the real session ID
      const finalMessage: AcpMessage = { ...userMessage, sessionId: activeSession.id };
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === tempMessageId ? finalMessage : m
        ),
      }));

      // Generate title from first user message
      if (isFirstMessage && activeSession.title === "New Conversation") {
        const title = generateSessionTitle(content);
        activeSession = { ...activeSession, title };
        set({ activeSession });
        void db.saveSession(activeSession);
        // Refresh session list so title shows immediately in dropdown
        void get().loadRecentSessions(activeSession.connectionId);
      }

      // Save message to DB (don't await - fire and forget)
      void db.saveMessage(finalMessage);

      try {
        // sendPrompt returns sessionId and sets up event listeners
        // Callbacks are invoked as streaming events arrive
        await AcpService.sendPrompt(activeInstanceId, content, contextJson, images, {
          onChunk: (text) => {
            get().appendChunk(text);
          },
          onThinking: (text) => {
            get().appendThinking(text);
          },
          onToolCall: (toolCall) => {
            get().addToolCall(toolCall);
          },
          onToolCallUpdate: (id, status) => {
            get().updateToolCall(id, status as ToolCall["status"]);
          },
          onPlanUpdate: (steps) => {
            get().setPlan(steps);
          },
          onModeUpdate: (mode) => {
            get().setMode(mode);
          },
          onAvailableCommandsUpdate: (commands) => {
            get().setAvailableCommands(commands);
          },
          onComplete: () => {
            get().finalizeMessage();
          },
          onError: (error) => {
            set({
              isStreaming: false,
              streamingError: error,
              streamingFlow: [],
              streamingPlan: [],
            });
            console.error("ACP error:", error);
          },
        });
      } catch (error) {
        set({ isStreaming: false, streamingFlow: [], streamingPlan: [] });
        console.error("ACP error:", error);
      }
    },

    cancelGeneration: async () => {
      const { activeInstanceId } = get();
      if (activeInstanceId) {
        await AcpService.cancelSession(activeInstanceId);
        set({ isStreaming: false, streamingFlow: [], streamingPlan: [] });
      }
    },

    appendChunk: (text) => {
      if (!text) return;

      set((state) => {
        const nextFlow = [...state.streamingFlow];
        const last = nextFlow[nextFlow.length - 1];
        if (last && last.type === "text") {
          last.text += text;
        } else {
          nextFlow.push({ type: "text", text });
        }

        return {
          streamingContent: state.streamingContent + text,
          streamingFlow: nextFlow,
        };
      });
    },

    appendThinking: (text) => {
      set((state) => ({
        streamingThinking: state.streamingThinking + text,
      }));
    },

    addToolCall: (toolCall) => {
      set((state) => {
        // Prevent duplicate tool calls (same ID can be sent multiple times during streaming)
        if (state.activeToolCalls.some((tc) => tc.id === toolCall.id)) {
          return state; // Already have this tool call
        }

        const hasFlowEntry = state.streamingFlow.some(
          (segment) =>
            segment.type === "tool-call" && segment.call.id === toolCall.id
        );
        const nextFlow = hasFlowEntry
          ? state.streamingFlow
          : [
              ...state.streamingFlow,
              { type: "tool-call" as const, call: toolCall },
            ];

        return {
          activeToolCalls: [...state.activeToolCalls, toolCall],
          streamingFlow: nextFlow,
        };
      });
    },

    updateToolCall: (toolCallId, status) => {
      set((state) => ({
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, status } : tc
        ),
        streamingFlow: state.streamingFlow.map((segment) => {
          if (segment.type !== "tool-call") return segment;
          if (segment.call.id !== toolCallId) return segment;
          return {
            ...segment,
            call: {
              ...segment.call,
              status,
            },
          };
        }),
      }));
    },

    setPlan: (steps) => {
      set({ streamingPlan: steps });
    },

    setMode: (mode) => {
      set({ currentMode: mode });
    },

    setAvailableCommands: (commands) => {
      set({ availableSessionCommands: commands });
    },

    finalizeMessage: async () => {
      const {
        activeSession,
        streamingContent,
        streamingThinking,
        activeToolCalls,
        streamingFlow,
      } = get();
      if (!activeSession) return;

      const assistantMessage: AcpMessage = {
        id: nanoid(),
        sessionId: activeSession.id,
        role: "assistant",
        content: streamingContent,
        thinking: streamingThinking || undefined,
        toolCalls: activeToolCalls.length > 0 ? activeToolCalls : undefined,
        assistantFlow: streamingFlow.length > 0 ? streamingFlow : undefined,
        timestamp: Date.now(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isStreaming: false,
        streamingContent: "",
        streamingThinking: "",
        streamingFlow: [],
        activeToolCalls: [],
        streamingPlan: [],
      }));

      await db.saveMessage(assistantMessage);
      await db.saveSession({
        ...activeSession,
        updatedAt: Date.now(),
      });

      // Refresh session list so this conversation appears in history
      void get().loadRecentSessions(activeSession.connectionId);
    },

    togglePanel: () => {
      set((state) => ({ isPanelOpen: !state.isPanelOpen }));
    },

    setPreferredPackageManager: (pm: NpmPackageManager) => {
      set({ preferredPackageManager: pm });
    },

    setAutoUpgradePackages: (auto: boolean) => {
      set({ autoUpgradePackages: auto });
    },

    skipPackageVersion: (packageName: string, version: string) => {
      set((state) => ({
        skippedPackageVersions: {
          ...state.skippedPackageVersions,
          [packageName]: version,
        },
        // Also remove from agentsWithUpdates so the badge disappears
        agentsWithUpdates: state.agentsWithUpdates
          .map((a) => ({
            ...a,
            packages: a.packages.map((p) =>
              p.name === packageName && p.latestVersion === version
                ? { ...p, updateAvailable: false }
                : p
            ),
          }))
          .filter((a) => a.packages.some((p) => p.updateAvailable)),
      }));
    },

    upgradePackages: async (agents: AgentInfo[]) => {
      const outdatedPackages = agents.flatMap((agent) =>
        agent.packages
          .filter((p) => p.updateAvailable)
          .map((p) => ({ pkg: p, agentId: agent.id }))
      );

      if (outdatedPackages.length === 0) return;

      let successCount = 0;
      const results: string[] = [];

      for (const { pkg, agentId } of outdatedPackages) {
        try {
          const binaryName = agentId === "codex-acp" ? "codex" : "claude";
          await AcpService.upgradePackage(pkg.name, pkg.managerType, binaryName);
          successCount++;
          results.push(`${pkg.name} → v${pkg.latestVersion}`);
        } catch (err) {
          console.error(`Failed to upgrade ${pkg.name}:`, err);
          results.push(`${pkg.name} failed`);
        }
      }

      if (successCount > 0) {
        toast.success(`Updated ${successCount} package${successCount > 1 ? "s" : ""}`, {
          description: results.join(", "),
        });
        // Refresh agents to pick up new versions
        void get().loadAgents();
      } else {
        toast.error("Package upgrade failed", {
          description: results.join(", "),
        });
      }
    },
  }),
    {
      name: STORAGE_KEY,
      // Persist agent selection and per-agent model preferences
      partialize: (state) => ({
        selectedAgentId: state.selectedAgentId,
        selectedModel: state.selectedModel,
        modelPreferences: state.modelPreferences,
        preferredPackageManager: state.preferredPackageManager,
        autoUpgradePackages: state.autoUpgradePackages,
        skippedPackageVersions: state.skippedPackageVersions,
      }),
    },
  ),
);
