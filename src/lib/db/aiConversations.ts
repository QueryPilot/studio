/**
 * AI Conversations Database
 *
 * Dexie-based IndexedDB schema for AI chat sessions and messages.
 * Follows the pattern established by queryHistory.ts.
 */

import Dexie, { type Table } from "dexie";
import type { AcpSession, AcpMessage } from "@/types/acp";

// ============ Database ============

class AIConversationsDB extends Dexie {
  sessions!: Table<AcpSession, string>;
  messages!: Table<AcpMessage, string>;

  constructor() {
    super("QueryPilotAI");

    this.version(1).stores({
      sessions: "&id, agentId, connectionId, updatedAt",
      messages: "&id, sessionId, timestamp",
    });
  }
}

// Lazy initialization of database instance
let db: AIConversationsDB | null = null;

function getDb(): AIConversationsDB {
  if (!db) {
    db = new AIConversationsDB();
  }
  return db;
}

// ============ In-Memory Fallback ============

// Fallback for environments without IndexedDB (e.g., testing, SSR)
const memoryStore = {
  sessions: new Map<string, AcpSession>(),
  messages: new Map<string, AcpMessage>(),
};

// ============ Sessions API ============

/**
 * Save or update a session
 */
export async function saveSession(session: AcpSession): Promise<void> {
  try {
    await getDb().sessions.put(session);
  } catch {
    memoryStore.sessions.set(session.id, session);
  }
}

/**
 * Get a session by ID
 */
export async function getSession(id: string): Promise<AcpSession | undefined> {
  try {
    return await getDb().sessions.get(id);
  } catch {
    return memoryStore.sessions.get(id);
  }
}

/**
 * List recent sessions, ordered by updatedAt descending
 */
export async function listRecentSessions(limit = 20): Promise<AcpSession[]> {
  try {
    return await getDb()
      .sessions.orderBy("updatedAt")
      .reverse()
      .limit(limit)
      .toArray();
  } catch {
    return Array.from(memoryStore.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

// ============ Messages API ============

/**
 * Save or update a message
 */
export async function saveMessage(message: AcpMessage): Promise<void> {
  try {
    await getDb().messages.put(message);
  } catch {
    memoryStore.messages.set(message.id, message);
  }
}

/**
 * Get all messages for a session, ordered by timestamp
 */
export async function getSessionMessages(
  sessionId: string
): Promise<AcpMessage[]> {
  try {
    return await getDb()
      .messages.where("sessionId")
      .equals(sessionId)
      .sortBy("timestamp");
  } catch {
    return Array.from(memoryStore.messages.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

// ============ Delete API ============

/**
 * Delete a session and all its messages
 */
export async function deleteSession(id: string): Promise<void> {
  try {
    await getDb().transaction(
      "rw",
      [getDb().sessions, getDb().messages],
      async () => {
        await getDb().messages.where("sessionId").equals(id).delete();
        await getDb().sessions.delete(id);
      }
    );
  } catch {
    memoryStore.sessions.delete(id);
    for (const [key, msg] of memoryStore.messages) {
      if (msg.sessionId === id) {
        memoryStore.messages.delete(key);
      }
    }
  }
}
