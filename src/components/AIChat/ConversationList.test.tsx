/**
 * Conversation List Tests
 *
 * Tests for conversation list component.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationList } from "./ConversationList";
import { db } from "@/lib/db/conversations";

describe("ConversationList", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should display empty state", async () => {
    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
    });
  });

  it("should list conversations", async () => {
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
    ]);

    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText("Chat 1")).toBeInTheDocument();
    });

    expect(screen.getByText("Chat 2")).toBeInTheDocument();
  });

  it("should filter by connection", async () => {
    await db.conversations.bulkAdd([
      {
        id: "c1",
        connectionId: "conn1",
        title: "Conn1 Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c2",
        connectionId: "conn2",
        title: "Conn2 Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText("Conn1 Chat")).toBeInTheDocument();
    });

    expect(screen.queryByText("Conn2 Chat")).not.toBeInTheDocument();
  });

  it("should delete conversation", async () => {
    await db.conversations.add({
      id: "c1",
      connectionId: "conn1",
      title: "To Delete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = userEvent.setup();
    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText("To Delete")).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole("button", { name: "Delete conversation" });
    await user.click(deleteButton);

    await waitFor(async () => {
      const conv = await db.conversations.get("c1");
      expect(conv).toBeUndefined();
    });
  });

  it("should create new conversation", async () => {
    const onSelectConversation = vi.fn();
    const user = userEvent.setup();

    render(
      <ConversationList
        connectionId="conn1"
        onSelectConversation={onSelectConversation}
      />
    );

    const newButton = screen.getByRole("button", { name: /new conversation/i });
    await user.click(newButton);

    await waitFor(async () => {
      const conversations = await db.conversations.toArray();
      expect(conversations).toHaveLength(1);
    });

    expect(onSelectConversation).toHaveBeenCalled();
  });

  it("should select conversation on click", async () => {
    await db.conversations.add({
      id: "c1",
      connectionId: "conn1",
      title: "Test Chat",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const onSelectConversation = vi.fn();
    const user = userEvent.setup();

    render(
      <ConversationList
        connectionId="conn1"
        onSelectConversation={onSelectConversation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Test Chat")).toBeInTheDocument();
    });

    const conversationItem = screen.getByRole("button", { name: /test chat/i });
    await user.click(conversationItem);

    expect(onSelectConversation).toHaveBeenCalledWith("c1");
  });

  it("should show conversation count", async () => {
    await db.conversations.bulkAdd([
      {
        id: "c1",
        connectionId: "conn1",
        title: "1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c2",
        connectionId: "conn1",
        title: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c3",
        connectionId: "conn1",
        title: "3",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText(/3 conversations/i)).toBeInTheDocument();
    });
  });

  it("should display recent conversations first", async () => {
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
        title: "Newest",
        createdAt: new Date(now + 2000),
        updatedAt: new Date(now + 2000),
      },
      {
        id: "c3",
        connectionId: "conn1",
        title: "Middle",
        createdAt: new Date(now + 1000),
        updatedAt: new Date(now + 1000),
      },
    ]);

    render(<ConversationList connectionId="conn1" />);

    await waitFor(() => {
      expect(screen.getByText("Newest")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("button", { name: /Select conversation/i });
    expect(items[0]).toHaveTextContent("Newest");
    expect(items[1]).toHaveTextContent("Middle");
    expect(items[2]).toHaveTextContent("Oldest");
  });
});
