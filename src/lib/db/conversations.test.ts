/**
 * Conversation DB Tests
 *
 * Tests for Dexie-based conversation persistence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./conversations";

describe("ConversationDB", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should create a conversation", async () => {
    const convId = await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test Chat",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(convId).toBe("conv1");

    const conv = await db.conversations.get("conv1");
    expect(conv).toBeDefined();
    expect(conv?.title).toBe("Test Chat");
  });

  it("should add messages to conversation", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.messages.add({
      id: "msg1",
      conversationId: "conv1",
      role: "user",
      content: "Hello",
      parts: [],
      createdAt: new Date(),
    });

    const messages = await db.messages
      .where("conversationId")
      .equals("conv1")
      .toArray();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello");
    expect(messages[0].role).toBe("user");
  });

  it("should query conversations by connectionId", async () => {
    await db.conversations.bulkAdd([
      {
        id: "c1",
        connectionId: "conn1",
        title: "Chat 1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c2",
        connectionId: "conn1",
        title: "Chat 2",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c3",
        connectionId: "conn2",
        title: "Chat 3",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const conn1Chats = await db.conversations
      .where("connectionId")
      .equals("conn1")
      .toArray();

    expect(conn1Chats).toHaveLength(2);
    expect(conn1Chats.map((c) => c.title)).toContain("Chat 1");
    expect(conn1Chats.map((c) => c.title)).toContain("Chat 2");
  });

  it("should delete conversation and messages", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.messages.bulkAdd([
      {
        id: "m1",
        conversationId: "conv1",
        role: "user",
        content: "1",
        parts: [],
        createdAt: new Date(),
      },
      {
        id: "m2",
        conversationId: "conv1",
        role: "assistant",
        content: "2",
        parts: [],
        createdAt: new Date(),
      },
    ]);

    await db.deleteConversation("conv1");

    const conv = await db.conversations.get("conv1");
    const messages = await db.messages
      .where("conversationId")
      .equals("conv1")
      .toArray();

    expect(conv).toBeUndefined();
    expect(messages).toHaveLength(0);
  });

  it("should get conversation messages sorted by creation time", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = Date.now();
    await db.messages.bulkAdd([
      {
        id: "m1",
        conversationId: "conv1",
        role: "user",
        content: "First",
        parts: [],
        createdAt: new Date(now),
      },
      {
        id: "m2",
        conversationId: "conv1",
        role: "assistant",
        content: "Second",
        parts: [],
        createdAt: new Date(now + 1000),
      },
      {
        id: "m3",
        conversationId: "conv1",
        role: "user",
        content: "Third",
        parts: [],
        createdAt: new Date(now + 2000),
      },
    ]);

    const messages = await db.getConversationMessages("conv1");

    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("First");
    expect(messages[1].content).toBe("Second");
    expect(messages[2].content).toBe("Third");
  });

  it("should get recent conversations sorted by update time", async () => {
    const now = Date.now();
    await db.conversations.bulkAdd([
      {
        id: "c1",
        connectionId: "conn1",
        title: "Oldest",
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
      {
        id: "c2",
        connectionId: "conn1",
        title: "Middle",
        createdAt: new Date(now + 1000),
        updatedAt: new Date(now + 1000),
      },
      {
        id: "c3",
        connectionId: "conn1",
        title: "Newest",
        createdAt: new Date(now + 2000),
        updatedAt: new Date(now + 2000),
      },
    ]);

    const recent = await db.getRecentConversations(10);

    expect(recent).toHaveLength(3);
    expect(recent[0].title).toBe("Newest");
    expect(recent[1].title).toBe("Middle");
    expect(recent[2].title).toBe("Oldest");
  });

  it("should limit recent conversations", async () => {
    await db.conversations.bulkAdd([
      {
        id: "c1",
        connectionId: "conn1",
        title: "1",
        createdAt: new Date(),
        updatedAt: new Date(Date.now()),
      },
      {
        id: "c2",
        connectionId: "conn1",
        title: "2",
        createdAt: new Date(),
        updatedAt: new Date(Date.now() + 1000),
      },
      {
        id: "c3",
        connectionId: "conn1",
        title: "3",
        createdAt: new Date(),
        updatedAt: new Date(Date.now() + 2000),
      },
    ]);

    const recent = await db.getRecentConversations(2);

    expect(recent).toHaveLength(2);
  });
});
