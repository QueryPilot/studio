/**
 * Conversation Database
 *
 * IndexedDB persistence for AI chat conversations using Dexie.
 */

import Dexie, { type Table } from "dexie";

export interface Conversation {
  id: string;
  connectionId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts: unknown[];
  createdAt: Date;
}

export class ConversationDB extends Dexie {
  conversations!: Table<Conversation>;
  messages!: Table<Message>;

  constructor() {
    super("ai-conversations");
    this.version(1).stores({
      conversations: "id, connectionId, updatedAt",
      messages: "id, conversationId, createdAt",
    });
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.messages.where("conversationId").equals(conversationId).delete();
    await this.conversations.delete(conversationId);
  }

  /**
   * Get all messages for a conversation, sorted by creation time
   */
  async getConversationMessages(conversationId: string): Promise<Message[]> {
    return this.messages
      .where("conversationId")
      .equals(conversationId)
      .sortBy("createdAt");
  }

  /**
   * Get recent conversations, sorted by most recently updated
   */
  async getRecentConversations(limit = 10): Promise<Conversation[]> {
    return this.conversations.orderBy("updatedAt").reverse().limit(limit).toArray();
  }
}

export const db = new ConversationDB();
