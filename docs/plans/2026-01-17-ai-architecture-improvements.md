# AI Architecture Improvements Design

**Date:** 2026-01-17
**Status:** Proposed
**Author:** Claude + Hieu

## Executive Summary

This document outlines improvements to Query Pilot's AI architecture, focusing on four areas: Performance, Developer Experience, User Experience, and Scalability. The current Bun sidecar architecture is retained and optimized.

## Current Architecture

```
┌─────────────┐     HTTP      ┌─────────────┐     HTTP      ┌─────────────┐
│  Frontend   │ ───────────►  │   Sidecar   │ ───────────►  │    Tauri    │
│  (React)    │   :47856      │ (Bun/TS)    │   :14420      │   (Rust)    │
└─────────────┘               └─────────────┘               └─────────────┘
```

### Current Pain Points

| Area | Issue |
|------|-------|
| Performance | Double HTTP hop for tool calls (~10-20ms overhead) |
| Performance | Repeated schema fetches in agentic loops |
| DX | Tool definitions verbose (706 lines, 14 tools) |
| DX | Provider config duplicated in 3 places |
| DX | Prompts hardcoded in TypeScript |
| UX | No conversation persistence |
| UX | Generic suggestions (not context-aware) |
| UX | Tool calls display as raw JSON |
| Scalability | Adding tool = 50 lines boilerplate |
| Scalability | Adding provider = 4 file changes |

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
├──────────────────┬──────────────────┬───────────────────────────────────┤
│   useAIChat()    │  Conversation    │   Tool UI                         │
│   (unchanged)    │  Store (Dexie)   │   (friendly names)                │
└────────┬─────────┴────────┬─────────┴───────────────────────────────────┘
         │                  │
         │ HTTP :47856      │ persist/restore
         │                  │
┌────────▼──────────────────▼─────────────────────────────────────────────┐
│                         Bun Sidecar (Optimized)                          │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│   Router    │    Tool     │  Provider   │   Prompt    │   Schema        │
│             │  Registry   │  Registry   │   Engine    │   Cache         │
│             │  (config)   │  (config)   │  (*.md)     │  (aggressive)   │
└─────────────┴──────┬──────┴──────┬──────┴──────┬──────┴────────┬────────┘
                     │             │             │               │
              ┌──────┴─────────────┴─────────────┴───────────────┘
              │  HTTP (connection pooling)
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Tauri Backend (unchanged)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Keep the Sidecar?

We evaluated embedding the JS runtime directly in Tauri:

| Option | Feasibility | Notes |
|--------|-------------|-------|
| Embed Bun in Tauri | Not possible | [GitHub Issue #12017](https://github.com/oven-sh/bun/issues/12017) - no ETA |
| Embed Deno in Tauri | Possible but risky | [tauri-plugin-deno](https://github.com/marcomq/tauri-plugin-deno) v0.2.0, Windows issues |
| Keep Bun Sidecar | Recommended | Production-ready, optimize existing architecture |

### Why HTTP + SSE (Not WebSocket)?

AI SDK v6 uses HTTP + Server-Sent Events natively. WebSocket is not built-in and would require custom implementation with minimal benefit.

Sources:
- [AI SDK Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [AI SDK Transport Docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [WebSocket Discussion #5607](https://github.com/vercel/ai/discussions/5607)

---

## Component Designs

### 1. Tool Registry

**Goal:** Reduce tool definition from ~50 lines to ~15 lines.

**File structure:**
```
src-tauri/sidecar-ai/
├── tools/
│   ├── registry.ts          # Auto-loads all tools
│   ├── base.ts              # BaseTool class with shared logic
│   ├── schema/
│   │   ├── list-tables.ts
│   │   ├── get-structure.ts
│   │   └── get-indexes.ts
│   ├── query/
│   │   ├── execute-readonly.ts
│   │   └── explain-query.ts
│   └── index.ts
```

**Tool definition format:**
```typescript
// tools/schema/list-tables.ts
import { defineTool } from "../base";

export default defineTool({
  name: "list_tables",
  friendlyName: "List Tables",
  description: "List all tables in a schema with row counts",
  category: "schema",
  icon: "table",

  parameters: {
    connectionId: { type: "string", required: true },
    schema: { type: "string", default: "public" },
  },

  messages: {
    pending: (input) => `Listing tables in ${input.schema}...`,
    success: (input, output) => `Found ${output.length} tables`,
    error: (input, err) => `Failed to list tables: ${err.message}`,
  },

  async execute({ connectionId, schema }, ctx) {
    return ctx.tauri.invoke("get_tables", { connectionId, schema });
  },
});
```

**Base class handles:**
- Zod schema generation from parameters
- Retry logic with exponential backoff
- Caching with configurable TTL
- Error normalization
- Metrics/logging

---

### 2. Provider Registry

**Goal:** Add new provider in 1 config entry instead of 3 files.

**Config file:**
```typescript
// sidecar-ai/config/providers.ts
export const providers = {
  openai: {
    name: "OpenAI",
    package: "@ai-sdk/openai",
    factory: "createOpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o", context: 128000 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", context: 128000 },
      { id: "o1", name: "o1", context: 200000, reasoning: true },
    ],
    keyName: "OPENAI_API_KEY",
    signupUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    name: "Anthropic",
    package: "@ai-sdk/anthropic",
    factory: "createAnthropic",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", context: 200000 },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", context: 200000 },
    ],
    keyName: "ANTHROPIC_API_KEY",
    signupUrl: "https://console.anthropic.com/",
  },
  // ... other providers
} as const;
```

**Frontend fetches from sidecar** (no hardcoded list):
```typescript
const { data: providers } = useQuery({
  queryKey: ["providers"],
  queryFn: () => fetch(`${AI_SIDECAR_URL}/providers`).then(r => r.json()),
});
```

---

### 3. Prompt Engine

**Goal:** Edit prompts without rebuilding, support templating.

**File structure:**
```
src-tauri/sidecar-ai/
├── prompts/
│   ├── chat/
│   │   ├── system.md
│   │   ├── with-connection.md
│   │   └── no-connection.md
│   ├── text-to-sql/
│   │   ├── system.md
│   │   └── dialects/
│   │       ├── postgresql.md
│   │       ├── mysql.md
│   │       └── sqlite.md
│   └── engine.ts
```

**Template syntax (Handlebars):**
```markdown
# Query Pilot

You are Query Pilot, an AI assistant for database exploration.

## Your Capabilities

{{#each tools}}
- **{{friendlyName}}**: {{description}}
{{/each}}

## Context

{{#if connection}}
{{> with-connection}}
{{else}}
{{> no-connection}}
{{/if}}
```

**Engine loads at startup:**
```typescript
class PromptEngine {
  private templates = new Map<string, HandlebarsTemplateDelegate>();

  constructor() {
    const files = import.meta.glob("./**/*.md", { as: "raw", eager: true });
    for (const [path, content] of Object.entries(files)) {
      this.templates.set(path, Handlebars.compile(content));
    }
  }

  render(template: string, data: Record<string, unknown>) {
    return this.templates.get(template)?.(data) ?? "";
  }
}
```

---

### 4. Schema Cache & Performance

**Goal:** Reduce latency in agentic loops by ~250ms.

**Cache TTLs:**
```typescript
const ttls = {
  tables: 10 * 60 * 1000,      // 10 min
  structure: 10 * 60 * 1000,   // 10 min
  indexes: 10 * 60 * 1000,     // 10 min
  columnValues: 2 * 60 * 1000, // 2 min
  queryResult: 30 * 1000,      // 30 sec
};
```

**Preloading on chat start:**
```typescript
async preloadForConnection(connectionId: string, schema: string) {
  const tables = await this.fetchAndCache("tables", { connectionId, schema });
  await Promise.all(
    tables.slice(0, 10).map(t =>
      this.fetchAndCache("structure", { connectionId, schema, table: t.name })
    )
  );
}
```

**HTTP connection pooling:**
```typescript
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
});
```

**Request deduplication:**
```typescript
class ToolExecutor {
  private pending = new Map<string, Promise<unknown>>();

  async execute(toolName: string, args: unknown) {
    const key = `${toolName}:${JSON.stringify(args)}`;
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }
    const promise = this.doExecute(toolName, args);
    this.pending.set(key, promise);
    promise.finally(() => this.pending.delete(key));
    return promise;
  }
}
```

---

### 5. Conversation Persistence

**Goal:** Chat history survives refresh, browsable history.

**Dexie schema:**
```typescript
interface Conversation {
  id: string;
  connectionId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  parts: unknown[];
  createdAt: Date;
}

class ConversationDB extends Dexie {
  conversations!: Dexie.Table<Conversation>;
  messages!: Dexie.Table<Message>;

  constructor() {
    super("ai-conversations");
    this.version(1).stores({
      conversations: "id, connectionId, updatedAt",
      messages: "id, conversationId, createdAt",
    });
  }
}
```

**Hook integration:**
```typescript
export function usePersistedChat(conversationId: string) {
  const savedMessages = useLiveQuery(
    () => db.messages.where("conversationId").equals(conversationId).toArray(),
    [conversationId]
  );

  const chat = useChat({
    id: conversationId,
    initialMessages: savedMessages ?? [],
    onFinish: async (message) => {
      await db.messages.add({ /* ... */ });
      await db.conversations.update(conversationId, { updatedAt: new Date() });
    },
  });

  return chat;
}
```

---

### 6. Context-Aware Suggestions

**Goal:** AI knows what user is currently viewing.

**Extended workspace context:**
```typescript
interface WorkspaceSelection {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  activeTable: string | null;
  activeQuery: string | null;
  recentTables: string[];
  lastAction: "browse" | "query" | "filter" | null;
}
```

**Injected via headers:**
```typescript
headers: {
  "X-Connection-Id": connectionId || "",
  "X-Active-Table": activeTable || "",
  "X-Recent-Tables": recentTables.join(","),
  "X-Last-Action": lastAction || "",
},
```

**Smart suggestion generator:**
```typescript
function generateSuggestions(context: ChatContext): string[] {
  if (context.activeTable) {
    return [
      `Explain the structure of ${context.activeTable}`,
      `What are the relationships for ${context.activeTable}?`,
      `Show me sample data from ${context.activeTable}`,
    ];
  }
  if (context.recentTables.length > 1) {
    return [
      `How are ${context.recentTables[0]} and ${context.recentTables[1]} related?`,
    ];
  }
  // ... fallback suggestions
}
```

---

### 7. Friendly Tool Visualization

**Goal:** Human-readable tool calls instead of JSON.

**Before:**
```
┌─────────────────────────────────────────┐
│ 🔧 get_table_structure                  │
│ Input: {"connectionId":"conn_abc123"... │
└─────────────────────────────────────────┘
```

**After:**
```
┌─────────────────────────────────────────┐
│ 📋 Inspect Table                    ✓   │
│ Found 8 columns in users                │
│ ▸ Show details                          │
└─────────────────────────────────────────┘
```

**Tool metadata in registry:**
```typescript
messages: {
  pending: (input) => `Looking up structure of ${input.table}...`,
  success: (input, output) => `Found ${output.columns.length} columns`,
  error: (input, error) => `Couldn't read ${input.table}`,
},
formatOutput: (output) => ({
  summary: `${output.columns.length} columns`,
  details: output.columns.map(c => `${c.name} (${c.type})`),
}),
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

| Task | Effort | Impact |
|------|--------|--------|
| Tool Registry pattern | 2-3 days | High DX |
| Provider Registry | 1 day | Medium DX |
| Schema Cache improvements | 1 day | Medium Perf |
| HTTP connection pooling | 0.5 day | Low Perf |

### Phase 2: User Experience (Week 3-4)

| Task | Effort | Impact |
|------|--------|--------|
| Conversation persistence (Dexie) | 2 days | High UX |
| Conversation list UI | 1 day | High UX |
| Friendly tool visualization | 2 days | Medium UX |
| Tool metadata endpoint | 0.5 day | Low |

### Phase 3: Intelligence (Week 5-6)

| Task | Effort | Impact |
|------|--------|--------|
| Prompt Engine (markdown) | 2 days | High DX |
| Context-aware headers | 1 day | Medium UX |
| Smart suggestions | 1 day | Medium UX |
| System prompt enhancement | 1 day | Medium UX |

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebSocket transport | HTTP+SSE works fine, not worth complexity |
| Conversation branching | Nice-to-have, not essential |
| Feature flags | Add when needed for A/B testing |
| Embedded Bun runtime | Not currently possible |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Lines per tool | ~50 | ~15 |
| Files to add provider | 3 | 1 |
| Agentic loop latency | ~400ms | ~150ms |
| Chat history | Lost on refresh | Persisted |
| Schema cache hit rate | Unknown | >80% |

---

## References

- [AI SDK v6 Documentation](https://ai-sdk.dev/docs/introduction)
- [AI SDK Transport Docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [ToolLoopAgent Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [Bun Embedding Issue #12017](https://github.com/oven-sh/bun/issues/12017)
- [tauri-plugin-deno](https://github.com/marcomq/tauri-plugin-deno)
