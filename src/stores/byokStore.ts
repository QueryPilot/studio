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
import type { ProviderId, BYOKSession, StreamCallbacks, ByokToolCall } from "@/ai/types";
import { PROVIDER_CONFIGS, createModel } from "@/ai/providers";
import { buildSystemPrompt } from "@/ai/constants";
import { streamChat } from "@/ai/service";
import { createTools, type ToolContext } from "@/ai/tools";

interface BYOKState {
  // Persisted
  providerId: ProviderId | null;
  modelId: string | null;

  // Runtime
  messages: ModelMessage[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  session: BYOKSession | null;
  abortController: AbortController | null;
  activeToolCalls: ByokToolCall[];

  // Actions
  setProvider: (id: ProviderId) => void;
  setModel: (id: string) => void;
  initSession: (apiKey?: string) => void;
  sendMessage: (
    content: string,
    toolContext: ToolContext,
    schemaContext?: { databaseType?: string; schemaJson?: string },
    callbacks?: Partial<StreamCallbacks>,
  ) => Promise<void>;
  cancelGeneration: () => void;
  clearHistory: () => void;
}

export const useByokStore = create<BYOKState>()(
  persist(
    (set, get) => ({
      // Persisted state
      providerId: null,
      modelId: null,

      // Runtime state
      messages: [],
      isStreaming: false,
      streamingContent: "",
      error: null,
      session: null,
      abortController: null,
      activeToolCalls: [],

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
        set({ modelId: id, session: null });
      },

      initSession: (apiKey) => {
        const { providerId, modelId } = get();
        if (!providerId || !modelId) return;

        const config = PROVIDER_CONFIGS[providerId];
        if (config.requiresApiKey && !apiKey) return;

        const model = createModel(providerId, modelId, apiKey);
        set({
          session: { providerId, modelId, provider: model },
          error: null,
        });
      },

      sendMessage: async (content, toolContext, schemaContext, callbacks) => {
        const { session, messages } = get();
        if (!session) return;

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

        const tools = createTools(toolContext);
        const systemPrompt = buildSystemPrompt(schemaContext);

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
        set({ isStreaming: false, abortController: null, activeToolCalls: [] });
      },

      clearHistory: () => {
        set({ messages: [], streamingContent: "", error: null, activeToolCalls: [] });
      },
    }),
    {
      name: "byok-preferences",
      partialize: (state) => ({
        providerId: state.providerId,
        modelId: state.modelId,
      }),
    },
  ),
);
