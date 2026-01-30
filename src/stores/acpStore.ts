/**
 * ACP Store
 *
 * Zustand store for Agent Client Protocol (ACP) state management.
 * Handles agent selection, session lifecycle, and message streaming.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AgentInfo, AcpSession, AcpMessage, ToolCall, ModelInfo } from "@/types/acp";
import * as db from "@/lib/db/aiConversations";
import { AcpService } from "@/services/acpService";

// Module-level variable to track warmup promise (avoids Zustand serialization issues)
let currentWarmupPromise: Promise<string> | null = null;

// Default model ID for quick filter (uses haiku-equivalent on Claude agents)
export const DEFAULT_QUICK_FILTER_MODEL = "haiku";

// Storage key for persisted model preferences
const STORAGE_KEY = "acp-model-preferences";

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

  // Dynamic models fetched from agents (keyed by agentId)
  dynamicModels: Record<string, ModelInfo[]>;
  isLoadingModels: boolean;

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

  // Active tool calls during streaming
  activeToolCalls: ToolCall[];

  // Warmup state - pre-starts agent for faster first message
  isWarmingUp: boolean;

  // UI state
  isPanelOpen: boolean;

  // Actions
  loadAgents: () => Promise<void>;
  selectAgent: (agentId: string) => void;
  fetchModelsForAgent: (agentId: string) => Promise<void>;
  selectModel: (modelId: string) => Promise<void>;
  warmupAgent: (connectionId?: string) => Promise<string>;
  startSession: (connectionId?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, contextJson?: string) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  appendChunk: (text: string) => void;
  appendThinking: (text: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolCallId: string, status: ToolCall["status"]) => void;
  finalizeMessage: () => void;
  togglePanel: () => void;
}

export const useAcpStore = create<AcpState>()(
  persist(
    (set, get) => ({
    // Initial state
    availableAgents: [],
    selectedAgentId: null,
    selectedModel: null,
    isLoadingAgents: false,
    dynamicModels: {},
    isLoadingModels: false,
    activeSession: null,
    activeInstanceId: null,
    messages: [],
    isStreaming: false,
    streamingContent: "",
    streamingThinking: "",
    streamingError: null,
    activeToolCalls: [],
    isWarmingUp: false,
    isPanelOpen: false,

    loadAgents: async () => {
      set({ isLoadingAgents: true });
      try {
        const agents = await AcpService.listAgents();
        set({ availableAgents: agents });

        // Auto-select first installed agent if none selected
        const firstInstalledAgent = agents.find((agent) => agent.installed);
        if (firstInstalledAgent && !get().selectedAgentId) {
          const defaultModel = firstInstalledAgent.models[0]?.id ?? null;
          set({
            selectedAgentId: firstInstalledAgent.id,
            selectedModel: get().selectedModel ?? defaultModel,
          });
          // Fetch dynamic models for auto-selected agent
          void get().fetchModelsForAgent(firstInstalledAgent.id);
        }
      } finally {
        set({ isLoadingAgents: false });
      }
    },

    selectAgent: (agentId) => {
      const { selectedAgentId: currentAgentId, activeSession, availableAgents, dynamicModels } = get();

      // Find the new agent and get its default model
      const newAgent = availableAgents.find((a) => a.id === agentId);

      // Use dynamic models if available, otherwise static
      const models = dynamicModels[agentId]?.length ? dynamicModels[agentId] : newAgent?.models ?? [];
      const defaultModel = models[0]?.id ?? null;

      // If changing to a different agent, clear current session and warmup
      if (currentAgentId !== agentId && activeSession) {
        currentWarmupPromise = null;
        set({
          selectedAgentId: agentId,
          selectedModel: defaultModel,
          activeSession: null,
          activeInstanceId: null,
          messages: [],
          isWarmingUp: false,
        });
      } else {
        set({
          selectedAgentId: agentId,
          selectedModel: defaultModel,
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
      const { selectedModel: currentModel, activeSession, activeInstanceId } = get();

      if (currentModel === modelId) return;

      set({ selectedModel: modelId });

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
      const { selectedAgentId, selectedModel, activeSession, isWarmingUp } = get();

      // Already have a session for this agent
      if (activeSession) {
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

      // Start warmup
      set({ isWarmingUp: true });

      currentWarmupPromise = (async () => {
        try {
          // Start agent subprocess
          const instanceId = await AcpService.startAgent(selectedAgentId);

          // Create ACP session with LLM home directory as working directory
          const llmHome = await AcpService.getLlmHome();
          const sessionId = await AcpService.createSession(instanceId, llmHome);

          // Set the model for the session (if one is selected)
          // Note: Some agents (e.g., Gemini) don't support session/set_model
          if (selectedModel) {
            try {
              await AcpService.setSessionModel(instanceId, selectedModel);
            } catch (err) {
              console.warn("Agent doesn't support model selection:", err);
            }
          }

          const session: AcpSession = {
            id: sessionId,
            agentId: selectedAgentId,
            instanceId,
            connectionId,
            title: "New Conversation",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          await db.saveSession(session);
          set({
            activeSession: session,
            activeInstanceId: instanceId,
            messages: [],
            isWarmingUp: false,
          });

          currentWarmupPromise = null;
          return sessionId;
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

      set({
        activeSession: session,
        activeInstanceId: session.instanceId,
        messages,
      });
    },

    sendMessage: async (content, contextJson) => {
      let { activeSession, activeInstanceId } = get();

      // If no active session but warmup is in progress, wait for it
      if (!activeSession && currentWarmupPromise) {
        await currentWarmupPromise;
        // Re-read state after warmup completes
        activeSession = get().activeSession;
        activeInstanceId = get().activeInstanceId;
      }

      if (!activeSession || !activeInstanceId) {
        throw new Error("No active session");
      }

      // Add user message
      const userMessage: AcpMessage = {
        id: nanoid(),
        sessionId: activeSession.id,
        role: "user",
        content,
        timestamp: Date.now(),
      };

      set((state) => ({ messages: [...state.messages, userMessage] }));
      await db.saveMessage(userMessage);

      // Start streaming - clear tool calls too
      set({
        isStreaming: true,
        streamingContent: "",
        streamingThinking: "",
        streamingError: null,
        activeToolCalls: [],
      });

      try {
        // sendPrompt returns sessionId and sets up event listeners
        // Callbacks are invoked as streaming events arrive
        await AcpService.sendPrompt(activeInstanceId, content, contextJson, {
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
          onComplete: () => {
            get().finalizeMessage();
          },
          onError: (error) => {
            set({ isStreaming: false, streamingError: error });
            console.error("ACP error:", error);
          },
        });
      } catch (error) {
        set({ isStreaming: false });
        console.error("ACP error:", error);
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
      set((state) => ({
        streamingContent: state.streamingContent + text,
      }));
    },

    appendThinking: (text) => {
      set((state) => ({
        streamingThinking: state.streamingThinking + text,
      }));
    },

    addToolCall: (toolCall) => {
      set((state) => ({
        activeToolCalls: [...state.activeToolCalls, toolCall],
      }));
    },

    updateToolCall: (toolCallId, status) => {
      set((state) => ({
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, status } : tc
        ),
      }));
    },

    finalizeMessage: async () => {
      const { activeSession, streamingContent, streamingThinking, activeToolCalls } = get();
      if (!activeSession) return;

      const assistantMessage: AcpMessage = {
        id: nanoid(),
        sessionId: activeSession.id,
        role: "assistant",
        content: streamingContent,
        thinking: streamingThinking || undefined,
        toolCalls: activeToolCalls.length > 0 ? activeToolCalls : undefined,
        timestamp: Date.now(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isStreaming: false,
        streamingContent: "",
        streamingThinking: "",
        activeToolCalls: [],
      }));

      await db.saveMessage(assistantMessage);
      await db.saveSession({
        ...activeSession,
        updatedAt: Date.now(),
      });
    },

    togglePanel: () => {
      set((state) => ({ isPanelOpen: !state.isPanelOpen }));
    },
  }),
    {
      name: STORAGE_KEY,
      // Only persist model selection, not session state
      partialize: (state) => ({
        selectedModel: state.selectedModel,
      }),
    },
  ),
);
