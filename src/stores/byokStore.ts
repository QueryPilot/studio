/**
 * BYOK Store
 *
 * Zustand store for Bring-Your-Own-Key AI state management.
 * Handles provider/model selection, session lifecycle, and message streaming
 * using the AI SDK with user-provided API keys.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelMessage } from "ai";
import type { ProviderId, ProviderModelInfo, BYOKSession, StreamCallbacks, ByokToolCall } from "@/ai/types";
import { PROVIDER_CONFIGS, createModel } from "@/ai/providers";
import { buildSystemPrompt } from "@/ai/constants";
import { streamChat } from "@/ai/service";
import { createTools, type ToolContext } from "@/ai/tools";

interface BYOKState {
  // Persisted
  providerId: ProviderId | null;
  modelId: string | null;
  runtimeMode: "acp" | "byok";
  autoExecuteQueries: boolean;
  includeSchemaContext: boolean;

  // Runtime
  apiKeys: Partial<Record<ProviderId, string>>;
  messages: ModelMessage[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  session: BYOKSession | null;
  abortController: AbortController | null;
  activeToolCalls: ByokToolCall[];
  fetchedModels: Partial<Record<ProviderId, ProviderModelInfo[]>>;
  isFetchingModels: boolean;

  // Actions
  setProvider: (id: ProviderId) => void;
  setModel: (id: string) => void;
  setApiKey: (key: string) => void;
  initSession: (apiKey?: string) => void;
  fetchModels: () => Promise<void>;
  sendMessage: (
    content: string,
    toolContext: ToolContext,
    schemaContext?: { databaseType?: string; schemaJson?: string },
    callbacks?: Partial<StreamCallbacks>,
  ) => Promise<void>;
  cancelGeneration: () => void;
  clearHistory: () => void;
  setRuntimeMode: (mode: "acp" | "byok") => void;
  setAutoExecuteQueries: (enabled: boolean) => void;
  setIncludeSchemaContext: (enabled: boolean) => void;
}

export const useByokStore = create<BYOKState>()(
  persist(
    (set, get) => ({
      // Persisted state
      providerId: null,
      modelId: null,
      runtimeMode: "acp",
      autoExecuteQueries: true,
      includeSchemaContext: true,

      // Runtime state
      apiKeys: {},
      messages: [],
      isStreaming: false,
      streamingContent: "",
      error: null,
      session: null,
      abortController: null,
      activeToolCalls: [],
      fetchedModels: {},
      isFetchingModels: false,

      setProvider: (id) => {
        const config = PROVIDER_CONFIGS[id];
        const defaultModel = config.models[0]?.id ?? null;
        set({
          providerId: id,
          modelId: defaultModel,
          session: null,
          messages: [],
        });
      },

      setModel: (id) => {
        const { providerId, apiKeys } = get();
        if (!providerId) {
          set({ modelId: id, session: null });
          return;
        }
        const config = PROVIDER_CONFIGS[providerId];
        const key = apiKeys[providerId] ?? "";
        if (config.requiresApiKey && !key) {
          set({ modelId: id, session: null });
          return;
        }
        const model = createModel(providerId, id, key || undefined);
        set({ modelId: id, session: { providerId, modelId: id, provider: model } });
      },

      setApiKey: (key) => {
        const { providerId } = get();
        if (!providerId) return;
        set((state) => ({
          apiKeys: { ...state.apiKeys, [providerId]: key },
        }));
      },

      initSession: (apiKeyArg) => {
        const { providerId, modelId, apiKeys } = get();
        if (!providerId || !modelId) return;
        const key = apiKeyArg ?? apiKeys[providerId] ?? "";
        const config = PROVIDER_CONFIGS[providerId];
        if (config.requiresApiKey && !key) return;
        if (apiKeyArg !== undefined) {
          set((state) => ({
            apiKeys: { ...state.apiKeys, [providerId]: apiKeyArg },
          }));
        }
        const model = createModel(providerId, modelId, key || undefined);
        set({
          session: { providerId, modelId, provider: model },
          error: null,
        });
      },

      fetchModels: async () => {
        const { providerId, apiKeys } = get();
        if (!providerId) return;
        const config = PROVIDER_CONFIGS[providerId];
        if (!config.listModels) return;
        const key = apiKeys[providerId];
        if (config.requiresApiKey && !key) return;

        set({ isFetchingModels: true });
        try {
          const models = await config.listModels(key);
          set((state) => ({
            fetchedModels: { ...state.fetchedModels, [providerId]: models },
            isFetchingModels: false,
          }));
        } catch {
          set({ isFetchingModels: false });
        }
      },

      sendMessage: async (content, toolContext, schemaContext, callbacks) => {
        const { session, messages, isStreaming, autoExecuteQueries, includeSchemaContext } = get();
        if (!session || isStreaming) return;

        const userMessage: ModelMessage = { role: "user", content };
        const updatedMessages = [...messages, userMessage];

        const abortController = new AbortController();
        set({
          messages: updatedMessages,
          isStreaming: true,
          streamingContent: "",
          error: null,
          abortController,
        });

        const tools = createTools(toolContext, { autoExecuteQueries });
        const systemPrompt = buildSystemPrompt(includeSchemaContext ? schemaContext : { databaseType: schemaContext?.databaseType });

        let fullText = "";

        await streamChat({
          model: session.provider,
          systemPrompt,
          messages: updatedMessages,
          tools,
          abortSignal: abortController.signal,
          callbacks: {
            onChunk: (text) => {
              fullText += text;
              set({ streamingContent: fullText });
              callbacks?.onChunk?.(text);
            },
            onToolCall: (tc) => {
              set((state) => ({
                activeToolCalls: [
                  ...state.activeToolCalls,
                  { id: tc.id, name: tc.name, status: "calling" as const },
                ],
              }));
              callbacks?.onToolCall?.(tc);
            },
            onToolResult: (id, result) => {
              set((state) => ({
                activeToolCalls: state.activeToolCalls.map((tc) =>
                  tc.id === id ? { ...tc, status: "complete" as const } : tc,
                ),
              }));
              callbacks?.onToolResult?.(id, result);
            },
            onFinish: (responseMessages) => {
              set((state) => ({
                messages: [...state.messages, ...responseMessages],
                isStreaming: false,
                streamingContent: "",
                abortController: null,
                activeToolCalls: [],
              }));
              callbacks?.onFinish?.(responseMessages);
            },
            onError: (error) => {
              set({
                isStreaming: false,
                error,
                abortController: null,
                activeToolCalls: [],
              });
              callbacks?.onError?.(error);
            },
          },
        });
      },

      cancelGeneration: () => {
        const { abortController } = get();
        abortController?.abort();
        set({ isStreaming: false, streamingContent: "", error: null, abortController: null, activeToolCalls: [] });
      },

      clearHistory: () => {
        set({ messages: [], streamingContent: "", error: null, activeToolCalls: [] });
      },

      setRuntimeMode: (mode) => set({ runtimeMode: mode }),
      setAutoExecuteQueries: (enabled) => set({ autoExecuteQueries: enabled }),
      setIncludeSchemaContext: (enabled) => set({ includeSchemaContext: enabled }),
    }),
    {
      name: "byok-preferences",
      partialize: (state) => ({
        providerId: state.providerId,
        modelId: state.modelId,
        runtimeMode: state.runtimeMode,
        autoExecuteQueries: state.autoExecuteQueries,
        includeSchemaContext: state.includeSchemaContext,
      }),
    },
  ),
);
