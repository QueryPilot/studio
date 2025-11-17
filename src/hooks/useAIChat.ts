import { useChat } from "@ai-sdk/react";
import { AI_SIDECAR_URL } from "@/config/constants";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useEffect } from "react";
import { DefaultChatTransport } from "ai";

export interface UseAIChatOptions {
  onError?: (error: Error) => void;
}

/**
 * Custom hook that wraps AI SDK's useChat with connection context and provider/model injection.
 * Automatically injects connection context headers from the workspace store.
 */
export function useAIChat(options?: UseAIChatOptions) {
  const { connectionId, database, schema } = useWorkspaceSelectionStore();
  const { selectedProvider, selectedModel, loadProviders } = useAIChatStore();

  // Load providers on mount to ensure fresh data
  useEffect(() => {
    void loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only load once on mount

  // Create a unique ID for the chat session based on provider and model
  // This forces useChat to reinitialize when provider/model changes
  const chatId =
    selectedProvider && selectedModel
      ? `${selectedProvider}-${selectedModel}`
      : "uninitialized";

  console.log("[useAIChat] Initializing with:", {
    chatId,
    provider: selectedProvider,
    model: selectedModel,
  });

  const chatResult = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: `${AI_SIDECAR_URL}/chat`,
      body: {
        provider: selectedProvider,
        model: selectedModel,
      },
      headers: {
        "X-Connection-Id": connectionId || "",
        "X-Connection-Database": database || "",
        "X-Connection-Schema": schema || "",
      },
    }),
    onError: (error) => {
      console.error("[useAIChat] Chat error:", error);
      options?.onError?.(error);
    },
  });

  const result = {
    ...chatResult,
    // Additional context
    connectionContext: {
      connectionId,
      database,
      schema,
      hasConnection: Boolean(connectionId),
    },
    providerContext: {
      provider: selectedProvider,
      model: selectedModel,
      hasProvider: Boolean(selectedProvider && selectedModel),
    },
  };

  return result;
}
