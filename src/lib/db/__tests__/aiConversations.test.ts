/**
 * AI Conversations DB Tests
 *
 * Tests for Dexie-based IndexedDB persistence of ACP sessions and messages.
 * Uses fake-indexeddb for testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  saveSession,
  getSession,
  listRecentSessions,
  saveMessage,
  getSessionMessages,
  deleteSession,
} from "../aiConversations";
import type { AcpSession, AcpMessage } from "@/types/acp";
import Dexie from "dexie";

describe("AI Conversations Database", () => {
  beforeEach(async () => {
    // Delete the database before each test to ensure clean state
    await Dexie.delete("QueryPilotAI");
  });

  describe("saveSession", () => {
    it("should save a session to the database", async () => {
      const session: AcpSession = {
        id: "session-1",
        agentId: "claude-code-acp",
        instanceId: "instance-1",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSession(session);

      const retrieved = await getSession("session-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("session-1");
      expect(retrieved?.title).toBe("Test Session");
    });

    it("should update an existing session", async () => {
      const session: AcpSession = {
        id: "session-1",
        agentId: "claude-code-acp",
        instanceId: "instance-1",
        title: "Original Title",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSession(session);

      // Update the session
      const updatedSession: AcpSession = {
        ...session,
        title: "Updated Title",
        updatedAt: Date.now() + 1000,
      };

      await saveSession(updatedSession);

      const retrieved = await getSession("session-1");
      expect(retrieved?.title).toBe("Updated Title");
    });

    it("should save session with optional connectionId", async () => {
      const session: AcpSession = {
        id: "session-with-conn",
        agentId: "claude-code-acp",
        instanceId: "instance-1",
        connectionId: "conn-123",
        title: "Connected Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSession(session);

      const retrieved = await getSession("session-with-conn");
      expect(retrieved?.connectionId).toBe("conn-123");
    });
  });

  describe("getSession", () => {
    it("should return undefined for non-existent session", async () => {
      const session = await getSession("nonexistent-id");
      expect(session).toBeUndefined();
    });

    it("should return the correct session by ID", async () => {
      const session1: AcpSession = {
        id: "session-1",
        agentId: "agent-1",
        instanceId: "instance-1",
        title: "Session 1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const session2: AcpSession = {
        id: "session-2",
        agentId: "agent-2",
        instanceId: "instance-2",
        title: "Session 2",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSession(session1);
      await saveSession(session2);

      const retrieved = await getSession("session-2");
      expect(retrieved?.id).toBe("session-2");
      expect(retrieved?.title).toBe("Session 2");
    });
  });

  describe("listRecentSessions", () => {
    it("should return empty array when no sessions exist", async () => {
      const sessions = await listRecentSessions();
      expect(sessions).toEqual([]);
    });

    it("should return sessions ordered by updatedAt descending", async () => {
      const now = Date.now();

      const sessions: AcpSession[] = [
        {
          id: "session-old",
          agentId: "agent",
          instanceId: "instance",
          title: "Old Session",
          createdAt: now - 3000,
          updatedAt: now - 3000,
        },
        {
          id: "session-new",
          agentId: "agent",
          instanceId: "instance",
          title: "New Session",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "session-mid",
          agentId: "agent",
          instanceId: "instance",
          title: "Middle Session",
          createdAt: now - 1500,
          updatedAt: now - 1500,
        },
      ];

      for (const session of sessions) {
        await saveSession(session);
      }

      const recent = await listRecentSessions();

      expect(recent).toHaveLength(3);
      expect(recent[0]?.title).toBe("New Session");
      expect(recent[1]?.title).toBe("Middle Session");
      expect(recent[2]?.title).toBe("Old Session");
    });

    it("should respect the limit parameter", async () => {
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        await saveSession({
          id: `session-${i}`,
          agentId: "agent",
          instanceId: "instance",
          title: `Session ${i}`,
          createdAt: now + i * 1000,
          updatedAt: now + i * 1000,
        });
      }

      const limited = await listRecentSessions(5);

      expect(limited).toHaveLength(5);
      // Should get the 5 most recent (sessions 9, 8, 7, 6, 5)
      expect(limited[0]?.title).toBe("Session 9");
      expect(limited[4]?.title).toBe("Session 5");
    });

    it("should use default limit of 20", async () => {
      const now = Date.now();

      for (let i = 0; i < 25; i++) {
        await saveSession({
          id: `session-${i}`,
          agentId: "agent",
          instanceId: "instance",
          title: `Session ${i}`,
          createdAt: now + i * 100,
          updatedAt: now + i * 100,
        });
      }

      const recent = await listRecentSessions();

      expect(recent).toHaveLength(20);
    });
  });

  describe("saveMessage", () => {
    it("should save a user message", async () => {
      const message: AcpMessage = {
        id: "msg-1",
        sessionId: "session-1",
        role: "user",
        content: "Hello, agent!",
        timestamp: Date.now(),
      };

      await saveMessage(message);

      const messages = await getSessionMessages("session-1");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("Hello, agent!");
      expect(messages[0]?.role).toBe("user");
    });

    it("should save an assistant message with thinking", async () => {
      const message: AcpMessage = {
        id: "msg-1",
        sessionId: "session-1",
        role: "assistant",
        content: "Here is my response",
        thinking: "Let me think about this...",
        timestamp: Date.now(),
      };

      await saveMessage(message);

      const messages = await getSessionMessages("session-1");
      expect(messages[0]?.thinking).toBe("Let me think about this...");
    });

    it("should save a message with tool calls", async () => {
      const message: AcpMessage = {
        id: "msg-1",
        sessionId: "session-1",
        role: "assistant",
        content: "Let me read that file",
        timestamp: Date.now(),
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            status: "completed",
            input: { path: "/test.txt" },
            output: "File contents here",
          },
        ],
      };

      await saveMessage(message);

      const messages = await getSessionMessages("session-1");
      expect(messages[0]?.toolCalls).toHaveLength(1);
      expect(messages[0]?.toolCalls?.[0]?.name).toBe("read_file");
    });

    it("should update an existing message", async () => {
      const message: AcpMessage = {
        id: "msg-1",
        sessionId: "session-1",
        role: "assistant",
        content: "Original content",
        timestamp: Date.now(),
      };

      await saveMessage(message);

      // Update the message
      await saveMessage({
        ...message,
        content: "Updated content",
      });

      const messages = await getSessionMessages("session-1");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("Updated content");
    });
  });

  describe("getSessionMessages", () => {
    it("should return empty array for non-existent session", async () => {
      const messages = await getSessionMessages("nonexistent");
      expect(messages).toEqual([]);
    });

    it("should return messages ordered by timestamp ascending", async () => {
      const now = Date.now();

      const messages: AcpMessage[] = [
        {
          id: "msg-3",
          sessionId: "session-1",
          role: "assistant",
          content: "Third",
          timestamp: now + 2000,
        },
        {
          id: "msg-1",
          sessionId: "session-1",
          role: "user",
          content: "First",
          timestamp: now,
        },
        {
          id: "msg-2",
          sessionId: "session-1",
          role: "assistant",
          content: "Second",
          timestamp: now + 1000,
        },
      ];

      for (const msg of messages) {
        await saveMessage(msg);
      }

      const retrieved = await getSessionMessages("session-1");

      expect(retrieved).toHaveLength(3);
      expect(retrieved[0]?.content).toBe("First");
      expect(retrieved[1]?.content).toBe("Second");
      expect(retrieved[2]?.content).toBe("Third");
    });

    it("should only return messages for the specified session", async () => {
      await saveMessage({
        id: "msg-1",
        sessionId: "session-1",
        role: "user",
        content: "Session 1 message",
        timestamp: Date.now(),
      });

      await saveMessage({
        id: "msg-2",
        sessionId: "session-2",
        role: "user",
        content: "Session 2 message",
        timestamp: Date.now(),
      });

      const session1Messages = await getSessionMessages("session-1");
      const session2Messages = await getSessionMessages("session-2");

      expect(session1Messages).toHaveLength(1);
      expect(session1Messages[0]?.content).toBe("Session 1 message");

      expect(session2Messages).toHaveLength(1);
      expect(session2Messages[0]?.content).toBe("Session 2 message");
    });
  });

  describe("deleteSession", () => {
    it("should delete session and all its messages", async () => {
      // Create session
      await saveSession({
        id: "session-to-delete",
        agentId: "agent",
        instanceId: "instance",
        title: "Session to Delete",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Add messages
      await saveMessage({
        id: "msg-1",
        sessionId: "session-to-delete",
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      });

      await saveMessage({
        id: "msg-2",
        sessionId: "session-to-delete",
        role: "assistant",
        content: "Hi",
        timestamp: Date.now() + 1000,
      });

      // Verify data exists
      expect(await getSession("session-to-delete")).toBeDefined();
      expect(await getSessionMessages("session-to-delete")).toHaveLength(2);

      // Delete session
      await deleteSession("session-to-delete");

      // Verify deletion
      expect(await getSession("session-to-delete")).toBeUndefined();
      expect(await getSessionMessages("session-to-delete")).toHaveLength(0);
    });

    it("should not affect other sessions when deleting", async () => {
      // Create two sessions
      await saveSession({
        id: "session-1",
        agentId: "agent",
        instanceId: "instance",
        title: "Session 1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await saveSession({
        id: "session-2",
        agentId: "agent",
        instanceId: "instance",
        title: "Session 2",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Add messages to both
      await saveMessage({
        id: "msg-1",
        sessionId: "session-1",
        role: "user",
        content: "Session 1 message",
        timestamp: Date.now(),
      });

      await saveMessage({
        id: "msg-2",
        sessionId: "session-2",
        role: "user",
        content: "Session 2 message",
        timestamp: Date.now(),
      });

      // Delete session 1
      await deleteSession("session-1");

      // Verify session 2 is unaffected
      expect(await getSession("session-2")).toBeDefined();
      expect(await getSessionMessages("session-2")).toHaveLength(1);
    });

    it("should handle deleting non-existent session gracefully", async () => {
      // Should not throw
      await expect(deleteSession("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long message content", async () => {
      const longContent = "x".repeat(100000);

      await saveMessage({
        id: "msg-long",
        sessionId: "session-1",
        role: "assistant",
        content: longContent,
        timestamp: Date.now(),
      });

      const messages = await getSessionMessages("session-1");
      expect(messages[0]?.content).toBe(longContent);
    });

    it("should handle unicode content", async () => {
      const unicodeContent = "Hello, World! \u{1F600} \u{1F4BB} \u{2764}";

      await saveMessage({
        id: "msg-unicode",
        sessionId: "session-1",
        role: "user",
        content: unicodeContent,
        timestamp: Date.now(),
      });

      const messages = await getSessionMessages("session-1");
      expect(messages[0]?.content).toBe(unicodeContent);
    });

    it("should handle special characters in session title", async () => {
      await saveSession({
        id: "session-special",
        agentId: "agent",
        instanceId: "instance",
        title: 'Title with "quotes" and <tags> & symbols',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const session = await getSession("session-special");
      expect(session?.title).toBe('Title with "quotes" and <tags> & symbols');
    });

    it("should handle concurrent message saves", async () => {
      const promises = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          saveMessage({
            id: `concurrent-msg-${i}`,
            sessionId: "session-concurrent",
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i}`,
            timestamp: Date.now() + i,
          })
        );
      }

      await Promise.all(promises);

      const messages = await getSessionMessages("session-concurrent");
      expect(messages).toHaveLength(20);
    });

    it("should handle empty content", async () => {
      await saveMessage({
        id: "msg-empty",
        sessionId: "session-1",
        role: "user",
        content: "",
        timestamp: Date.now(),
      });

      const messages = await getSessionMessages("session-1");
      expect(messages[0]?.content).toBe("");
    });

    it("should preserve message role types", async () => {
      const now = Date.now();
      const roles: ("user" | "assistant" | "system")[] = [
        "user",
        "assistant",
        "system",
      ];

      for (let i = 0; i < roles.length; i++) {
        const role = roles[i]!;
        await saveMessage({
          id: `msg-${role}`,
          sessionId: "session-roles",
          role,
          content: `${role} message`,
          timestamp: now + i * 1000, // Ensure proper ordering by timestamp
        });
      }

      const messages = await getSessionMessages("session-roles");
      expect(messages.map((m) => m.role)).toEqual(roles);
    });
  });

  describe("Conversation Flow", () => {
    it("should handle a complete conversation flow", async () => {
      // 1. Create session
      const session: AcpSession = {
        id: "conv-flow-session",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Complete Conversation",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSession(session);

      // 2. User sends first message
      await saveMessage({
        id: "msg-1",
        sessionId: "conv-flow-session",
        role: "user",
        content: "Can you help me write a query?",
        timestamp: Date.now(),
      });

      // 3. Assistant responds
      await saveMessage({
        id: "msg-2",
        sessionId: "conv-flow-session",
        role: "assistant",
        content: "Of course! What would you like to query?",
        thinking: "User needs help with SQL",
        timestamp: Date.now() + 1000,
      });

      // 4. User follows up
      await saveMessage({
        id: "msg-3",
        sessionId: "conv-flow-session",
        role: "user",
        content: "I want to select all users from the users table",
        timestamp: Date.now() + 2000,
      });

      // 5. Assistant provides answer with tool call
      await saveMessage({
        id: "msg-4",
        sessionId: "conv-flow-session",
        role: "assistant",
        content: "Here is the query: SELECT * FROM users;",
        timestamp: Date.now() + 3000,
        toolCalls: [
          {
            id: "tool-1",
            name: "execute_query",
            status: "completed",
            input: { sql: "SELECT * FROM users;" },
            output: { rows: 10 },
          },
        ],
      });

      // 6. Update session timestamp
      await saveSession({
        ...session,
        updatedAt: Date.now() + 4000,
      });

      // Verify the conversation
      const messages = await getSessionMessages("conv-flow-session");
      expect(messages).toHaveLength(4);
      expect(messages[0]?.role).toBe("user");
      expect(messages[1]?.role).toBe("assistant");
      expect(messages[1]?.thinking).toBe("User needs help with SQL");
      expect(messages[3]?.toolCalls).toHaveLength(1);

      // Verify session shows up in recent
      const recent = await listRecentSessions();
      expect(recent[0]?.id).toBe("conv-flow-session");
    });
  });
});
