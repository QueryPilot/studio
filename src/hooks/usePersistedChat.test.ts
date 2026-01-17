/**
 * Persisted Chat Hook Tests
 *
 * Tests for conversation persistence hooks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useConversation, useConversationMessages } from "./usePersistedChat";
import { db } from "@/lib/db/conversations";

describe("useConversation", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should create conversation if not exists", async () => {
    const { result } = renderHook(() =>
      useConversation({
        conversationId: "new-conv",
        connectionId: "conn1",
        title: "New Chat",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const conv = await db.conversations.get("new-conv");
    expect(conv).toBeDefined();
    expect(conv?.title).toBe("New Chat");
    expect(conv?.connectionId).toBe("conn1");
  });

  it("should load existing conversation", async () => {
    await db.conversations.add({
      id: "existing-conv",
      connectionId: "conn1",
      title: "Existing",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { result } = renderHook(() =>
      useConversation({
        conversationId: "existing-conv",
        connectionId: "conn1",
        title: "Existing",
      })
    );

    await waitFor(() => {
      expect(result.current.conversation).toBeDefined();
    });

    expect(result.current.conversation?.title).toBe("Existing");
  });

  it("should update conversation title", async () => {
    const { result } = renderHook(() =>
      useConversation({
        conversationId: "conv1",
        connectionId: "conn1",
        title: "Original Title",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await result.current.updateTitle("Updated Title");

    const conv = await db.conversations.get("conv1");
    expect(conv?.title).toBe("Updated Title");
  });

  it("should delete conversation", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "To Delete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { result } = renderHook(() =>
      useConversation({
        conversationId: "conv1",
        connectionId: "conn1",
        title: "To Delete",
      })
    );

    await waitFor(() => {
      expect(result.current.conversation).toBeDefined();
    });

    await result.current.deleteConversation();

    const conv = await db.conversations.get("conv1");
    expect(conv).toBeUndefined();
  });
});

describe("useConversationMessages", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should load messages for conversation", async () => {
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
        content: "Hello",
        parts: [],
        createdAt: new Date(),
      },
      {
        id: "m2",
        conversationId: "conv1",
        role: "assistant",
        content: "Hi",
        parts: [],
        createdAt: new Date(),
      },
    ]);

    const { result } = renderHook(() =>
      useConversationMessages("conv1")
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0].content).toBe("Hello");
    expect(result.current.messages[1].content).toBe("Hi");
  });

  it("should add new message", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { result } = renderHook(() =>
      useConversationMessages("conv1")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await result.current.addMessage({
      id: "m1",
      role: "user",
      content: "Test message",
      parts: [],
    });

    const messages = await db.messages
      .where("conversationId")
      .equals("conv1")
      .toArray();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Test message");
  });

  it("should update conversation updatedAt when adding message", async () => {
    const now = new Date();
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test",
      createdAt: now,
      updatedAt: now,
    });

    const { result } = renderHook(() =>
      useConversationMessages("conv1")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Wait a bit to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    await result.current.addMessage({
      id: "m1",
      role: "user",
      content: "Test",
      parts: [],
    });

    const conv = await db.conversations.get("conv1");
    expect(conv?.updatedAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("should return empty array for non-existent conversation", async () => {
    const { result } = renderHook(() =>
      useConversationMessages("nonexistent")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.messages).toEqual([]);
  });
});
