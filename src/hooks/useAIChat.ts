import { logger } from "@/lib/logger";
import { useChat } from "@ai-sdk/react";
import { AI_SIDECAR_URL } from "@/config/constants";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useEffect } from "react";
import { DefaultChatTransport } from "ai";
import { useWorkspaceContext } from "./useWorkspaceContext";

export interface UseAIChatOptions {
  onError?: (error: Error) => void;
}

/**
 * Custom hook that wraps AI SDK's useChat with workspace context and provider/model injection.
 * Automatically injects workspace context (connection, active table, etc.) into the request body.
 */
export function useAIChat(options?: UseAIChatOptions) {
  const { connectionId, database, schema } = useWorkspaceSelectionStore();
  const { selectedProvider, selectedModel, loadProviders } = useAIChatStore();
  const workspaceContext = useWorkspaceContext(connectionId);

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

  logger.info("[useAIChat] Initializing with:", {
    chatId,
    provider: selectedProvider,
    model: selectedModel,
    context: workspaceContext,
  });

  const chatResult = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: `${AI_SIDECAR_URL}/chat`,
      body: {
        provider: selectedProvider,
        model: selectedModel,
        context: {
          ...workspaceContext,
          // Ensure database and schema from selection store
          database: database || workspaceContext.database,
          schema: schema || workspaceContext.schema,
        },
      },
      headers: {
        // Keep connection ID in header for backward compatibility and rate limiting
        "X-Connection-Id": connectionId || "",
      },
    }),
    onError: (error) => {
      logger.error("[useAIChat] Chat error:", error);
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
