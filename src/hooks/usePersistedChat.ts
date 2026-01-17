/**
 * Persisted Chat Hooks
 *
 * React hooks for conversation persistence using Dexie.
 */

import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Conversation, type Message } from "@/lib/db/conversations";

interface UseConversationOptions {
  conversationId: string;
  connectionId: string | null;
  title: string;
}

interface UseConversationResult {
  conversation: Conversation | undefined;
  isLoading: boolean;
  updateTitle: (title: string) => Promise<void>;
  deleteConversation: () => Promise<void>;
}

/**
 * Hook for managing a single conversation
 */
export function useConversation({
  conversationId,
  connectionId,
  title,
}: UseConversationOptions): UseConversationResult {
  const [isLoading, setIsLoading] = useState(true);

  // Live query for conversation
  const conversation = useLiveQuery(
    () => db.conversations.get(conversationId),
    [conversationId]
  );

  // Create conversation if it doesn't exist
  useEffect(() => {
    const init = async () => {
      const existing = await db.conversations.get(conversationId);
      if (!existing) {
        await db.conversations.add({
          id: conversationId,
          connectionId,
          title,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      setIsLoading(false);
    };

    init();
  }, [conversationId, connectionId, title]);

  const updateTitle = useCallback(
    async (newTitle: string) => {
      await db.conversations.update(conversationId, {
        title: newTitle,
        updatedAt: new Date(),
      });
    },
    [conversationId]
  );

  const deleteConv = useCallback(async () => {
    await db.deleteConversation(conversationId);
  }, [conversationId]);

  return {
    conversation,
    isLoading,
    updateTitle,
    deleteConversation: deleteConv,
  };
}

interface MessageInput {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts: unknown[];
}

interface UseConversationMessagesResult {
  messages: Message[];
  isLoading: boolean;
  addMessage: (message: MessageInput) => Promise<void>;
}

/**
 * Hook for managing messages in a conversation
 */
export function useConversationMessages(
  conversationId: string
): UseConversationMessagesResult {
  const [isLoading, setIsLoading] = useState(true);

  // Live query for messages
  const messages = useLiveQuery(
    async () => {
      const msgs = await db.getConversationMessages(conversationId);
      return msgs ?? [];
    },
    [conversationId],
    []
  );

  useEffect(() => {
    setIsLoading(false);
  }, []);

  const addMessage = useCallback(
    async (message: MessageInput) => {
      // Add message to database
      await db.messages.add({
        ...message,
        conversationId,
        createdAt: new Date(),
      });

      // Update conversation's updatedAt timestamp
      await db.conversations.update(conversationId, {
        updatedAt: new Date(),
      });
    },
    [conversationId]
  );

  return {
    messages,
    isLoading,
    addMessage,
  };
}

/**
 * Hook for listing recent conversations
 */
export function useRecentConversations(limit = 10) {
  const conversations = useLiveQuery(
    () => db.getRecentConversations(limit),
    [limit],
    []
  );

  return {
    conversations,
    isLoading: conversations === undefined,
  };
}

/**
 * Hook for listing conversations for a specific connection
 */
export function useConnectionConversations(connectionId: string | null) {
  const conversations = useLiveQuery(
    async () => {
      if (!connectionId) return [];
      return db.conversations
        .where("connectionId")
        .equals(connectionId)
        .reverse()
        .sortBy("updatedAt");
    },
    [connectionId],
    []
  );

  return {
    conversations,
    isLoading: conversations === undefined,
  };
}
