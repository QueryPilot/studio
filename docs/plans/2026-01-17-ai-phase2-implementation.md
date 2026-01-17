# AI Phase 2 Implementation Plan - User Experience

**Date:** 2026-01-17
**Phase:** 2 - User Experience
**Status:** In Progress

## Overview

Phase 2 focuses on improving the user experience with conversation persistence, friendly tool visualization, and conversation management UI.

## Tasks

### Task 1: Conversation Persistence with Dexie

**Goal:** Persist chat history across refreshes using IndexedDB via Dexie.

**Files to create:**
- `src/lib/db/conversations.ts` (new - Dexie schema)
- `src/lib/db/conversations.test.ts` (new - tests)
- `src/hooks/usePersistedChat.ts` (new - hook)
- `src/hooks/usePersistedChat.test.ts` (new - tests)

#### Step 1.1: Install dependencies

```bash
cd /Users/hieuvu/Workspaces/QueryPilot/studio
pnpm add dexie dexie-react-hooks
pnpm add -D @types/dexie fake-indexeddb
```

#### Step 1.2: Write Dexie schema tests

```typescript
// src/lib/db/conversations.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { db, Conversation, Message } from "./conversations";

describe("ConversationDB", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should create a conversation", async () => {
    const conv = await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Test Chat",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(conv).toBe("conv1");
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

    const messages = await db.messages.where("conversationId").equals("conv1").toArray();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello");
  });

  it("should query conversations by connectionId", async () => {
    await db.conversations.bulkAdd([
      { id: "c1", connectionId: "conn1", title: "Chat 1", createdAt: new Date(), updatedAt: new Date() },
      { id: "c2", connectionId: "conn1", title: "Chat 2", createdAt: new Date(), updatedAt: new Date() },
      { id: "c3", connectionId: "conn2", title: "Chat 3", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const conn1Chats = await db.conversations.where("connectionId").equals("conn1").toArray();
    expect(conn1Chats).toHaveLength(2);
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
      { id: "m1", conversationId: "conv1", role: "user", content: "1", parts: [], createdAt: new Date() },
      { id: "m2", conversationId: "conv1", role: "assistant", content: "2", parts: [], createdAt: new Date() },
    ]);

    await db.deleteConversation("conv1");

    const conv = await db.conversations.get("conv1");
    const messages = await db.messages.where("conversationId").equals("conv1").toArray();

    expect(conv).toBeUndefined();
    expect(messages).toHaveLength(0);
  });
});
```

#### Step 1.3: Implement Dexie schema

```typescript
// src/lib/db/conversations.ts
import Dexie, { Table } from "dexie";

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

  async deleteConversation(conversationId: string) {
    await this.messages.where("conversationId").equals(conversationId).delete();
    await this.conversations.delete(conversationId);
  }

  async getConversationMessages(conversationId: string) {
    return this.messages
      .where("conversationId")
      .equals(conversationId)
      .sortBy("createdAt");
  }

  async getRecentConversations(limit = 10) {
    return this.conversations
      .orderBy("updatedAt")
      .reverse()
      .limit(limit)
      .toArray();
  }
}

export const db = new ConversationDB();
```

#### Step 1.4: Write usePersistedChat hook tests

```typescript
// src/hooks/usePersistedChat.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePersistedChat } from "./usePersistedChat";
import { db } from "@/lib/db/conversations";

describe("usePersistedChat", () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it("should create conversation if not exists", async () => {
    const { result } = renderHook(() =>
      usePersistedChat({
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
  });

  it("should load existing messages", async () => {
    await db.conversations.add({
      id: "conv1",
      connectionId: "conn1",
      title: "Existing",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.messages.bulkAdd([
      { id: "m1", conversationId: "conv1", role: "user", content: "Hello", parts: [], createdAt: new Date() },
      { id: "m2", conversationId: "conv1", role: "assistant", content: "Hi", parts: [], createdAt: new Date() },
    ]);

    const { result } = renderHook(() =>
      usePersistedChat({
        conversationId: "conv1",
        connectionId: "conn1",
        title: "Existing",
      })
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
  });

  it("should save messages on finish", async () => {
    const { result } = renderHook(() =>
      usePersistedChat({
        conversationId: "conv1",
        connectionId: "conn1",
        title: "Test",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Simulate adding a message
    await result.current.onMessageFinish({
      id: "m1",
      role: "user",
      content: "Test message",
      parts: [],
    });

    const messages = await db.messages.where("conversationId").equals("conv1").toArray();
    expect(messages).toHaveLength(1);
  });
});
```

#### Step 1.5: Implement usePersistedChat hook

**Verification:**
```bash
pnpm test:unit conversations
pnpm test:unit usePersistedChat
```

---

### Task 2: Tool Metadata Endpoint

**Goal:** Expose tool metadata for frontend consumption.

**Files to modify:**
- `src-tauri/sidecar-ai/routes/index.ts` (add /tools route - ALREADY DONE in Phase 1)

**Verification:**
```bash
curl http://localhost:47856/tools
```

Expected response:
```json
{
  "tools": [
    {
      "name": "list_tables",
      "friendlyName": "List Tables",
      "description": "Get all tables in a database schema with metadata",
      "category": "schema",
      "capabilities": ["sql"]
    }
  ],
  "stats": {
    "totalTools": 1,
    "toolsByCategory": { "schema": 1 },
    "toolsByCapability": { "sql": 1 }
  }
}
```

---

### Task 3: Friendly Tool Visualization

**Goal:** Display tool calls with friendly names and formatted output instead of raw JSON.

**Files to create:**
- `src/components/AIChat/ToolCallCard.tsx` (new)
- `src/components/AIChat/ToolCallCard.test.tsx` (new)

#### Step 3.1: Write ToolCallCard tests

```typescript
// src/components/AIChat/ToolCallCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolCallCard } from "./ToolCallCard";

describe("ToolCallCard", () => {
  it("should display friendly tool name", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: ["users", "posts"] }}
      />
    );

    expect(screen.getByText("List Tables")).toBeInTheDocument();
    expect(screen.queryByText("list_tables")).not.toBeInTheDocument();
  });

  it("should show pending state", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="pending"
        input={{ schema: "public" }}
      />
    );

    expect(screen.getByText(/Listing tables/i)).toBeInTheDocument();
  });

  it("should show success state with summary", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: ["users", "posts"] }}
        summary="Found 2 tables in schema public"
      />
    );

    expect(screen.getByText(/Found 2 tables/i)).toBeInTheDocument();
  });

  it("should show error state", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="error"
        input={{ schema: "public" }}
        error="Connection timeout"
      />
    );

    expect(screen.getByText(/Connection timeout/i)).toBeInTheDocument();
  });

  it("should expand to show details", async () => {
    const { user } = render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: ["users", "posts"] }}
      />
    );

    const expandButton = screen.getByRole("button", { name: /show details/i });
    await user.click(expandButton);

    expect(screen.getByText(/users/i)).toBeInTheDocument();
    expect(screen.getByText(/posts/i)).toBeInTheDocument();
  });
});
```

#### Step 3.2: Implement ToolCallCard component

**Verification:**
```bash
pnpm test:unit ToolCallCard
```

---

### Task 4: Conversation List UI

**Goal:** Allow users to browse and manage conversation history.

**Files to create:**
- `src/components/AIChat/ConversationList.tsx` (new)
- `src/components/AIChat/ConversationList.test.tsx` (new)
- `src/components/AIChat/ConversationListItem.tsx` (new)

#### Step 4.1: Write ConversationList tests

```typescript
// src/components/AIChat/ConversationList.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationList } from "./ConversationList";
import { db } from "@/lib/db/conversations";

describe("ConversationList", () => {
  beforeEach(async () => {
    await db.conversations.clear();
  });

  it("should display empty state", () => {
    render(<ConversationList connectionId="conn1" />);
    expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
  });

  it("should list conversations", async () => {
    await db.conversations.bulkAdd([
      { id: "c1", connectionId: "conn1", title: "Chat 1", createdAt: new Date(), updatedAt: new Date() },
      { id: "c2", connectionId: "conn1", title: "Chat 2", createdAt: new Date(), updatedAt: new Date() },
    ]);

    render(<ConversationList connectionId="conn1" />);

    expect(await screen.findByText("Chat 1")).toBeInTheDocument();
    expect(await screen.findByText("Chat 2")).toBeInTheDocument();
  });

  it("should filter by connection", async () => {
    await db.conversations.bulkAdd([
      { id: "c1", connectionId: "conn1", title: "Conn1 Chat", createdAt: new Date(), updatedAt: new Date() },
      { id: "c2", connectionId: "conn2", title: "Conn2 Chat", createdAt: new Date(), updatedAt: new Date() },
    ]);

    render(<ConversationList connectionId="conn1" />);

    expect(await screen.findByText("Conn1 Chat")).toBeInTheDocument();
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

    const { user } = render(<ConversationList connectionId="conn1" />);

    const deleteButton = await screen.findByRole("button", { name: /delete/i });
    await user.click(deleteButton);

    const conv = await db.conversations.get("c1");
    expect(conv).toBeUndefined();
  });

  it("should create new conversation", async () => {
    const { user } = render(<ConversationList connectionId="conn1" onSelectConversation={vi.fn()} />);

    const newButton = screen.getByRole("button", { name: /new conversation/i });
    await user.click(newButton);

    const conversations = await db.conversations.toArray();
    expect(conversations).toHaveLength(1);
  });
});
```

#### Step 4.2: Implement ConversationList component

**Verification:**
```bash
pnpm test:unit ConversationList
```

---

## Batch Execution Strategy

**Batch 1 (Tasks 1-2):**
- Task 1: Conversation Persistence with Dexie
- Task 2: Tool Metadata Endpoint (already done)

**Batch 2 (Tasks 3-4):**
- Task 3: Friendly Tool Visualization
- Task 4: Conversation List UI

---

## Verification Commands

### After Batch 1:
```bash
pnpm test:unit conversations
pnpm test:unit usePersistedChat
curl http://localhost:47856/tools
```

### After Batch 2:
```bash
pnpm test:unit ToolCallCard
pnpm test:unit ConversationList
pnpm test:coverage
```

### Final Integration:
```bash
pnpm build
pnpm tauri:dev
# Manual: Create conversation, refresh page, verify persistence
# Manual: Send AI message, verify tool calls display with friendly names
# Manual: Browse conversation list, delete conversations
```

---

## Dependencies

```
Task 1 (Dexie) ──────────────┬──► Task 4 (Conversation List)
                             │
Task 2 (Metadata Endpoint) ──┴──► Task 3 (Tool Visualization)
```

**Parallelizable:**
- Tasks 1-2 can run in parallel (different systems)

**Sequential:**
- Task 3 depends on Task 2 (needs metadata)
- Task 4 depends on Task 1 (needs Dexie schema)

---

## Success Criteria

- [ ] Conversations persist across page refreshes
- [ ] Tool calls display with friendly names (not raw JSON)
- [ ] Users can browse conversation history
- [ ] Users can delete old conversations
- [ ] Users can create new conversations
- [ ] All tests pass (target: 50+ new tests)
