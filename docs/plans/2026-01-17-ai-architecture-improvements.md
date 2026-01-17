# AI Architecture Improvements Design

**Date:** 2026-01-17
**Status:** Proposed
**Author:** Claude + Hieu

## Executive Summary

This document outlines improvements to Query Pilot's AI architecture, focusing on four areas: Performance, Developer Experience, User Experience, and Scalability. The current Bun sidecar architecture is retained and optimized, with expanded support for all database paradigms (SQL, Document, Key-Value) and an updated provider strategy using AI SDK v6 OAuth providers.

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
| Coverage | Tooling and introspection are effectively SQL-only (Postgres-specific) |
| Coverage | Document/Key-Value adapters are not exposed via AI tools |

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
├─────────────┴──────┬──────┴──────┴────────────┴───────────────┬────────┤
│     Capability Gate (SQL / Document / Key-Value tool sets)               │
└─────────────┬──────┴──────────────────────────────────────────┴────────┘
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

### Why No Per-Session Auth Token?

Per-session auth tokens between frontend, sidecar, and backend are explicitly out of scope by product decision. The sidecar remains localhost-only with strict CORS and security header validation.

### Provider Strategy (Tiered with Fallback)

Providers are organized in priority tiers with automatic fallback:

| Tier | Auth Type | Providers | When Used |
|------|-----------|-----------|-----------|
| 1 (Primary) | API Key | OpenAI, Anthropic, Google, xAI | Default, most reliable |
| 2 (Enhanced) | OAuth | Claude Code, OpenCode, ChatGPT OAuth | Opt-in, experimental |
| 3 (Local) | None | Ollama | Offline fallback |

**Fallback Chain:**
1. User selects provider → attempt connection
2. If OAuth token expired/unavailable → fall back to API key provider
3. If no API key configured → fall back to Ollama (if available)
4. If all fail → show configuration UI

**Why API Key First (not OAuth-first):**
- OAuth packages (`ai-sdk-provider-claude-code`, etc.) are community-maintained, untested at scale
- Current API key providers (OpenAI, Anthropic, Google) are production-proven
- OAuth adds complexity (token refresh, redirect flows) with marginal UX benefit for desktop app
- Revisit OAuth-first when official AI SDK OAuth providers are released

---

## Component Designs

### 1. Tool Registry

**Goal:** Reduce tool definition from ~50 lines to ~15 lines and expand coverage to SQL + Document + Key-Value databases.

**File structure:**
```
src-tauri/sidecar-ai/
├── tools/
│   ├── registry.ts          # Auto-loads all tools
│   ├── base.ts              # BaseTool class with shared logic
│   ├── sql/
│   │   ├── list-tables.ts
│   │   ├── get-structure.ts
│   │   ├── get-indexes.ts
│   │   ├── execute-readonly.ts
│   │   └── explain-query.ts
│   ├── document/
│   │   ├── list-collections.ts
│   │   ├── get-collection-schema.ts
│   │   ├── find-documents.ts
│   │   └── aggregate.ts
│   ├── keyvalue/
│   │   ├── scan-keys.ts
│   │   ├── get-key.ts
│   │   ├── get-key-type.ts
│   │   └── get-ttl.ts
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
  capabilities: ["sql"],

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

Each tool declares its required capability set (e.g., `["sql"]`, `["document"]`, `["keyvalue"]`).

**Base class handles:**
- Zod schema generation from parameters
- Retry logic with exponential backoff
- Caching with configurable TTL
- Error normalization
- Metrics/logging

**Capability Gate (SQL/Document/Key-Value):**
- Tool registry filters tools based on adapter capabilities returned from backend.
- Sidecar requests a minimal capability profile when a connection is selected.
- Frontend only renders tools valid for the active connection type.

**Backend alignment (critical):**
- Replace Postgres-only raw SQL introspection with capability-aware adapter APIs.
- Add unified "introspection" commands for SQL + Document + Key-Value (no raw SQL in the sidecar).

---

### 2. Provider Registry

**Goal:** Add new provider in 1 config entry instead of 3 files, with first-class OAuth provider support.

**Config file:**
```typescript
// sidecar-ai/config/providers.ts
export const providers = {
  claudeCode: {
    name: "Claude Code",
    package: "ai-sdk-provider-claude-code",
    factory: "createClaudeCode",
    auth: { type: "oauth" },
    models: [{ id: "claude-code-latest", name: "Claude Code (Latest)", context: 200000 }],
  },
  openCode: {
    name: "OpenCode",
    package: "ai-sdk-provider-opencode-sdk",
    factory: "createOpenCode",
    auth: { type: "oauth" },
    models: [{ id: "opencode-latest", name: "OpenCode (Latest)", context: 200000 }],
  },
  chatgptOauth: {
    name: "ChatGPT (OAuth)",
    package: "ai-sdk-provider-chatgpt-oauth",
    factory: "createChatGPTOAuth",
    auth: { type: "oauth" },
    models: [{ id: "chatgpt-latest", name: "ChatGPT (Latest)", context: 128000 }],
  },
  // Optional API key providers as fallbacks
  openai: { name: "OpenAI", package: "@ai-sdk/openai", factory: "createOpenAI", auth: { type: "apiKey", keyName: "OPENAI_API_KEY" } },
  anthropic: { name: "Anthropic", package: "@ai-sdk/anthropic", factory: "createAnthropic", auth: { type: "apiKey", keyName: "ANTHROPIC_API_KEY" } },
} as const;
```

**Frontend fetches from sidecar** (no hardcoded list):
```typescript
const { data: providers } = useQuery({
  queryKey: ["providers"],
  queryFn: () => fetch(`${AI_SIDECAR_URL}/providers`).then(r => r.json()),
});
```

**OAuth token management plan:**
- Implement secure token storage in Tauri (system keychain/vault).
- Sidecar receives short-lived access tokens on demand (or via a secure IPC call).
- Token refresh handled in backend; sidecar never persists refresh tokens.

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
│   ├── document/
│   │   ├── system.md
│   │   └── with-connection.md
│   ├── keyvalue/
│   │   ├── system.md
│   │   └── with-connection.md
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

  async load() {
    const glob = new Bun.Glob("./**/*.md");
    for (const path of glob.scanSync({ cwd: import.meta.dir })) {
      const content = await Bun.file(`${import.meta.dir}/${path}`).text();
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

**Goal:** Reduce latency in agentic loops by ~250ms across SQL, Document, and Key-Value flows.

**Cache TTLs:**
```typescript
const ttls = {
  tables: 10 * 60 * 1000,      // 10 min
  structure: 10 * 60 * 1000,   // 10 min
  indexes: 10 * 60 * 1000,     // 10 min
  columnValues: 2 * 60 * 1000, // 2 min
  queryResult: 30 * 1000,      // 30 sec
  collections: 10 * 60 * 1000, // 10 min
  keyPatterns: 2 * 60 * 1000,  // 2 min
};
```

**Paradigm-Aware Preloading:**

Different database types have different preloading characteristics:

| Paradigm | Max Preload | What to Preload | Rationale |
|----------|-------------|-----------------|-----------|
| SQL | 10 tables | Table list + structure for top 10 | Tables are fixed, structure is stable |
| Document | 5 collections | Collection list only | Collections can have millions of docs; don't fetch schemas |
| Key-Value | 0 | Nothing | Keys are too numerous; rely on on-demand fetching |

**Implementation:**

```typescript
// sidecar-ai/services/schema-cache.ts
interface PreloadStrategy {
  maxPreload: number;
  prioritize: (items: string[]) => string[];
}

const strategies: Record<string, PreloadStrategy> = {
  sql: {
    maxPreload: 10,
    prioritize: (tables) => {
      // Prioritize common business entity names
      const priority = ["user", "account", "order", "product", "customer", "item"];
      return tables.sort((a, b) => {
        const aScore = priority.findIndex(p => a.toLowerCase().includes(p));
        const bScore = priority.findIndex(p => b.toLowerCase().includes(p));
        return (aScore === -1 ? 999 : aScore) - (bScore === -1 ? 999 : bScore);
      });
    },
  },
  document: {
    maxPreload: 5,
    prioritize: (collections) => collections.slice(0, 5),
  },
  keyvalue: {
    maxPreload: 0,
    prioritize: () => [],  // No preloading for key-value
  },
};

async function preloadForConnection(connectionId: string, kind: string, schema?: string) {
  const strategy = strategies[kind] ?? strategies.sql;

  if (kind === "sql" && schema) {
    const tables = await fetchAndCache("tables", { connectionId, schema });
    const toPreload = strategy.prioritize(tables.map(t => t.name))
      .slice(0, strategy.maxPreload);

    await Promise.all(
      toPreload.map(t =>
        fetchAndCache("structure", { connectionId, schema, table: t })
      )
    );
  } else if (kind === "document") {
    // Just cache the collection list, don't preload schemas (too expensive)
    const collections = await fetchAndCache("collections", { connectionId });
    // Schema inference happens on-demand when user asks about a specific collection
  }
  // keyvalue: no preload, rely on on-demand fetching
}
```

**On-Demand Schema Inference (Document DBs):**

For MongoDB, schema inference is expensive (requires sampling documents). Only run when explicitly requested:

```typescript
// tools/document/get-collection-schema.ts
export default defineTool({
  name: "get_collection_schema",
  capabilities: ["document"],

  async execute({ connectionId, collection }, ctx) {
    // Check cache first
    const cached = ctx.cache.get(`${connectionId}:schema:${collection}`);
    if (cached) return cached;

    // Sample up to 100 documents and infer schema
    const schema = await ctx.tauri.invoke("ai_document_execute", {
      connectionId,
      operation: { type: "infer_schema", collection, sampleSize: 100 },
    });

    // Cache with shorter TTL (schemas can change)
    ctx.cache.set(`${connectionId}:schema:${collection}`, schema, { ttl: 5 * 60 * 1000 });
    return schema;
  },
});
```

**HTTP connection reuse (Bun):**
```typescript
// Bun fetch reuses connections by default; enable keepalive where appropriate.
await fetch(url, { keepalive: true });
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

### 5. Error Recovery & Graceful Degradation

**Goal:** Ensure AI features remain usable even when capability detection or tool execution fails.

**Capability Detection Failures:**

When `ai_get_capabilities` fails, the system should degrade gracefully:

```typescript
interface CapabilityResult {
  kind: "sql" | "document" | "keyvalue" | "unknown";
  capabilities: string[];
  error?: string;
  fallbackTools: string[];  // Safe tools that work without full capabilities
}
```

**Fallback Tool Sets:**

| Failure Mode | Available Tools | Rationale |
|--------------|-----------------|-----------|
| Connection not found | None | Cannot operate without connection |
| Capability detection timeout | `list_tables`, `get_sample_data` | Basic introspection always works |
| Unknown adapter type | `execute_readonly_query` | Raw SQL as last resort |
| Partial capability data | Tools matching available caps | Use what we have |

**Implementation:**

```typescript
// sidecar-ai/tools/registry.ts
export async function getToolsForConnection(connectionId: string): Promise<Tool[]> {
  try {
    const caps = await callTauri("ai_get_capabilities", { connectionId });

    if (caps.error) {
      console.warn(`Capability detection failed: ${caps.error}`);
      // Return safe fallback tools
      return caps.fallbackTools
        .map(name => allTools.get(name))
        .filter(Boolean);
    }

    // Filter tools by capabilities
    return Array.from(allTools.values()).filter(tool =>
      tool.capabilities.every(c => caps.capabilities.includes(c))
    );
  } catch (e) {
    // Complete failure - return minimal safe set
    console.error("Failed to get capabilities:", e);
    return [allTools.get("list_tables")].filter(Boolean);
  }
}
```

**Frontend Error Boundaries:**

```typescript
// components/AIChat/ErrorBoundary.tsx
function AIChatErrorBoundary({ children }: Props) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="p-4 text-sm">
          <p>AI features temporarily unavailable</p>
          <p className="text-muted-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={reset}>
            Retry
          </Button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
```

**Sidecar Health Monitoring:**

The frontend should monitor sidecar health and show degraded state:

```typescript
// hooks/useAISidecarHealth.ts
export function useAISidecarHealth() {
  const { data: health, error } = useQuery({
    queryKey: ["ai-sidecar-health"],
    queryFn: () => fetch(`${AI_SIDECAR_URL}/health`).then(r => r.json()),
    refetchInterval: 30000,  // Check every 30s
    retry: 2,
  });

  return {
    isHealthy: !error && health?.status === "ok",
    configuredProviders: health?.providers ?? [],
    error,
  };
}
```

---

### 6. Conversation Persistence

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
  activeCollection: string | null;
  activeKey: string | null;
  activeQuery: string | null;
  recentTables: string[];
  recentCollections: string[];
  recentKeys: string[];
  lastAction: "browse" | "query" | "filter" | null;
}
```

**Injected via request body (not headers):**

Context is passed in the request body rather than HTTP headers to avoid:
- Accidental logging of sensitive table/collection names
- Header size limits
- Proxy stripping custom headers

```typescript
// Frontend: POST /chat request
const response = await fetch(`${AI_SIDECAR_URL}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages,
    provider,
    model,
    context: {  // Workspace context embedded in body
      connectionId,
      database,
      schema,
      activeTable,
      activeCollection,
      activeKey,
      recentTables,
      recentCollections,
      recentKeys,
      lastAction,
    },
  }),
});
```

```typescript
// Sidecar: Extract context from body
app.post("/chat", async (req) => {
  const { messages, provider, model, context } = await req.json();

  // Validate context
  if (!context?.connectionId) {
    return new Response(JSON.stringify({ error: "Missing context.connectionId" }), { status: 400 });
  }

  // Build system prompt with context
  const systemPrompt = await promptEngine.render("chat/system.md", {
    connection: context,
    tools: await getToolsForConnection(context.connectionId),
  });

  // ...
});
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
  if (context.activeCollection) {
    return [
      `Show me sample documents from ${context.activeCollection}`,
      `What fields are common in ${context.activeCollection}?`,
      `Suggest an aggregation pipeline for ${context.activeCollection}`,
    ];
  }
  if (context.activeKey) {
    return [
      `Explain the structure of ${context.activeKey}`,
      `Show TTL and type info for ${context.activeKey}`,
      `Find related keys to ${context.activeKey}`,
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

### 8. Adapter-Aware Backend API

**Goal:** Remove Postgres-only SQL in the sidecar, and expose introspection through adapter capabilities.

**New Tauri commands (AI-facing, read-only):**
- `ai_get_capabilities(connectionId)` -> `{ kind: "sql" | "document" | "keyvalue", capabilities: [...] }`
- `ai_sql_execute(connectionId, op)` -> read-only SQL introspection ops
- `ai_document_execute(connectionId, op)` -> read-only document introspection ops
- `ai_keyvalue_execute(connectionId, op)` -> read-only key-value introspection ops

**SQL introspection ops (examples):**
- `list_schemas`
- `list_tables`
- `get_table_structure`
- `get_indexes`
- `get_foreign_keys`
- `get_views`
- `get_functions`
- `explain_query` (read-only)

**Document introspection ops (examples):**
- `list_databases` (if supported)
- `list_collections`
- `find` (with limit; read-only)
- `aggregate` (read-only)
- `count`
- `sample`
- `infer_schema` (backend-side sampling)
- `list_indexes` (if supported)

**Key-Value introspection ops (examples):**
- `scan`
- `get`
- `type`
- `ttl`
- `db_size`
- `server_info`
- `hash_get_all`
- `list_range`
- `set_members`
- `zset_range`
- `stream_range`
- `key_meta` (type + ttl + size when available)

**Implementation notes:**

These AI commands are **security wrappers** around existing commands, not new database logic:

| AI Command | Wraps Existing | Purpose |
|------------|----------------|---------|
| `ai_get_capabilities` | `adapter.get_capabilities()` | Expose capability info to sidecar |
| `ai_sql_execute` | `query()` command | Restrict to read-only introspection SQL |
| `ai_document_execute` | `document_execute()` | Allowlist read-only document ops |
| `ai_keyvalue_execute` | `keyvalue_execute()` | Allowlist read-only key-value ops |

**Rust implementation (security wrapper pattern):**

```rust
// src-tauri/src/commands/ai.rs
const AI_DOCUMENT_ALLOWLIST: &[&str] = &[
    "Find", "Aggregate", "Count", "ListCollections", "Sample", "ListDatabases"
];

const AI_KEYVALUE_ALLOWLIST: &[&str] = &[
    "Get", "Scan", "Type", "Ttl", "DbSize", "ServerInfo",
    "HashGetAll", "ListRange", "SetMembers", "ZSetRange", "StreamRange"
];

#[tauri::command]
pub async fn ai_document_execute(
    conn_id: String,
    operation: DocumentOperation,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DocumentResult, String> {
    // Validate operation is in read-only allowlist
    let op_name = operation.variant_name();
    if !AI_DOCUMENT_ALLOWLIST.contains(&op_name) {
        return Err(format!("Operation '{}' not allowed for AI (write operations blocked)", op_name));
    }

    // Delegate to existing command
    document_execute(conn_id, operation, manager).await
}

#[tauri::command]
pub async fn ai_keyvalue_execute(
    conn_id: String,
    operation: KeyValueOperation,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<KeyValueResult, String> {
    let op_name = operation.variant_name();
    if !AI_KEYVALUE_ALLOWLIST.contains(&op_name) {
        return Err(format!("Operation '{}' not allowed for AI (write operations blocked)", op_name));
    }

    keyvalue_execute(conn_id, operation, manager).await
}
```

**Key principles:**
- No new database logic needed—reuse existing adapters
- AI commands are pure security gates with allowlists
- All AI tools must route through these commands to keep SQL out of the sidecar
- Sidecar never builds raw SQL; adapters handle dialect differences

**Capability map (ops -> required adapter capability):**

| Command / Op | Required Capability | Notes |
|--------------|---------------------|-------|
| `ai_sql_execute.list_schemas` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.list_tables` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.get_table_structure` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.get_indexes` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.get_foreign_keys` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.get_views` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.get_functions` | `SqlQueryable` | SQL adapters only |
| `ai_sql_execute.explain_query` | `SqlQueryable` | Read-only explain |
| `ai_document_execute.list_collections` | `DocumentQueryable` | All document adapters |
| `ai_document_execute.find` | `DocumentQueryable` | Read-only, bounded |
| `ai_document_execute.aggregate` | `DocumentQueryable` | Read-only |
| `ai_document_execute.count` | `DocumentQueryable` | Read-only |
| `ai_document_execute.sample` | `DocumentQueryable` | Wrapper around `find` |
| `ai_document_execute.infer_schema` | `DocumentQueryable` | Backend-side sampling |
| `ai_document_execute.list_databases` | `DocumentQueryable` + optional | Adapter-specific |
| `ai_document_execute.list_indexes` | `DocumentQueryable` + optional | Adapter-specific |
| `ai_keyvalue_execute.scan` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.get` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.type` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.ttl` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.db_size` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.server_info` | `KeyValueOperable` | Read-only |
| `ai_keyvalue_execute.key_meta` | `KeyValueOperable` | type + ttl + size |
| `ai_keyvalue_execute.hash_get_all` | `RichKeyValueOperable` | Read-only |
| `ai_keyvalue_execute.list_range` | `RichKeyValueOperable` | Read-only |
| `ai_keyvalue_execute.set_members` | `RichKeyValueOperable` | Read-only |
| `ai_keyvalue_execute.zset_range` | `RichKeyValueOperable` | Read-only |
| `ai_keyvalue_execute.stream_range` | `RichKeyValueOperable` | Read-only |

**Optional capability flags (future-proofing):**

| Flag | Applies To | Purpose |
|------|------------|---------|
| `DocumentListDatabases` | Document | Adapter can list databases (Mongo supports) |
| `DocumentListIndexes` | Document | Adapter can list collection indexes |
| `SqlExplain` | SQL | Adapter supports EXPLAIN (most SQL do) |
| `SqlRoutines` | SQL | Adapter exposes routines/functions metadata |
| `SqlViews` | SQL | Adapter exposes views metadata |
| `KeyValueKeySize` | Key-Value | Adapter can estimate key size (optional) |

**Adapter support matrix (current adapters):**

| Adapter | Kind | Core Introspection | Optional Introspection |
|---------|------|--------------------|------------------------|
| PostgreSQL | SQL | schemas, tables, structure, indexes, foreign_keys, views, functions, explain | `SqlExplain`, `SqlViews`, `SqlRoutines` |
| MySQL/MariaDB | SQL | schemas, tables, structure, indexes, foreign_keys, views, functions, explain | `SqlExplain`, `SqlViews`, `SqlRoutines` |
| SQLite | SQL | tables, structure, indexes, foreign_keys, views | `SqlExplain` (plan), `SqlViews` |
| SQL Server | SQL | schemas, tables, structure, indexes, foreign_keys, views, functions, explain | `SqlExplain`, `SqlViews`, `SqlRoutines` |
| MongoDB | Document | list_collections, find, aggregate, count, sample, infer_schema | `DocumentListDatabases`, `DocumentListIndexes` |
| Redis | Key-Value | scan, get, type, ttl, db_size, server_info, key_meta | `KeyValueKeySize`, rich ops (hash/list/set/zset/stream) |

**Sidecar usage:**
- Call `ai_get_capabilities` once when a connection is selected.
- Tool registry selects the appropriate tool set based on capabilities.
- Sidecar never builds raw SQL for introspection; adapters do.

---

### 9. Circuit Breaker for Agentic Loops

**Goal:** Prevent runaway tool calls from burning tokens and creating poor UX.

**Problem:**
With `MAX_TOOL_STEPS=25`, a single user message can trigger up to 25 tool calls. If the AI gets stuck in a loop (e.g., repeatedly querying the same table), this wastes tokens and confuses users.

**Turn-Level Limits:**

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max tool calls per turn | 15 | Leave buffer below MAX_TOOL_STEPS |
| Max consecutive errors | 3 | Stop if tools keep failing |
| Max turn duration | 60s | Prevent hung conversations |

**Implementation:**

```typescript
// sidecar-ai/utils/circuit-breaker.ts
interface TurnState {
  toolCalls: number;
  startTime: number;
  consecutiveErrors: number;
  lastToolName: string | null;
  repeatCount: number;
}

const turnStates = new Map<string, TurnState>();

export function checkTurnLimit(conversationId: string, toolName: string): {
  allowed: boolean;
  reason?: string;
} {
  const state = turnStates.get(conversationId) ?? {
    toolCalls: 0,
    startTime: Date.now(),
    consecutiveErrors: 0,
    lastToolName: null,
    repeatCount: 0,
  };

  // Max 15 tool calls per turn
  if (state.toolCalls >= 15) {
    return { allowed: false, reason: "Tool call limit reached (15 max per turn)" };
  }

  // Max 3 consecutive errors
  if (state.consecutiveErrors >= 3) {
    return { allowed: false, reason: "Too many consecutive tool errors" };
  }

  // Max 60 seconds per turn
  if (Date.now() - state.startTime > 60_000) {
    return { allowed: false, reason: "Turn timeout exceeded (60s)" };
  }

  // Detect repetition (same tool called 5+ times in a row)
  if (state.lastToolName === toolName && state.repeatCount >= 5) {
    return { allowed: false, reason: `Tool '${toolName}' called too many times in a row` };
  }

  return { allowed: true };
}

export function recordToolCall(conversationId: string, toolName: string, success: boolean) {
  const state = turnStates.get(conversationId) ?? {
    toolCalls: 0,
    startTime: Date.now(),
    consecutiveErrors: 0,
    lastToolName: null,
    repeatCount: 0,
  };

  state.toolCalls++;

  if (success) {
    state.consecutiveErrors = 0;
  } else {
    state.consecutiveErrors++;
  }

  // Track repetition
  if (state.lastToolName === toolName) {
    state.repeatCount++;
  } else {
    state.lastToolName = toolName;
    state.repeatCount = 1;
  }

  turnStates.set(conversationId, state);
}

export function resetTurn(conversationId: string) {
  turnStates.delete(conversationId);
}
```

**Integration with Tool Execution:**

```typescript
// tools/base.ts
class BaseTool<T, R> {
  async execute(args: T, ctx: ToolContext): Promise<R> {
    const { allowed, reason } = checkTurnLimit(ctx.conversationId, this.name);
    if (!allowed) {
      throw new CircuitBreakerError(reason);
    }

    try {
      const result = await this.doExecute(args, ctx);
      recordToolCall(ctx.conversationId, this.name, true);
      return result;
    } catch (e) {
      recordToolCall(ctx.conversationId, this.name, false);
      throw e;
    }
  }
}
```

**Frontend Handling:**

When circuit breaker triggers, show user-friendly message:

```typescript
// components/AIChat/ChatMessage.tsx
if (error instanceof CircuitBreakerError) {
  return (
    <Alert variant="warning">
      <AlertTitle>Paused</AlertTitle>
      <AlertDescription>
        {error.message}. You can continue the conversation or start fresh.
      </AlertDescription>
    </Alert>
  );
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

| Task | Effort | Impact |
|------|--------|--------|
| Tool Registry pattern | 2-3 days | High DX |
| Capability-gated tools (SQL/Document/Key-Value) | 2-3 days | High Coverage |
| Adapter-aware introspection commands (`ai_*_execute` wrappers) | 2 days | High Coverage |
| Provider Registry with tiered fallback | 1 day | Medium DX |
| Circuit Breaker for agentic loops | 1 day | High Reliability |
| Error recovery & graceful degradation | 1 day | High Reliability |
| Schema Cache improvements (paradigm-aware preloading) | 1 day | Medium Perf |
| HTTP connection pooling | 0.5 day | Low Perf |

**Note:** OAuth provider integration moved to Phase 3 as opt-in enhancement (depends on community package stability).

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
| Context-aware request body (not headers) | 1 day | Medium UX |
| Smart suggestions | 1 day | Medium UX |
| System prompt enhancement | 1 day | Medium UX |
| Non-SQL tool coverage (Document/Key-Value) | 2-3 days | High Coverage |
| OAuth provider integration (opt-in, experimental) | 2 days | Medium UX |

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebSocket transport | HTTP+SSE works fine, not worth complexity |
| Conversation branching | Nice-to-have, not essential |
| Feature flags | Add when needed for A/B testing |
| Embedded Bun runtime | Not currently possible |
| Per-session auth tokens | Product decision: no blocking |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Lines per tool | ~50 | ~15 |
| Files to add provider | 3 | 1 |
| Agentic loop latency | ~400ms | ~150ms |
| Chat history | Lost on refresh | Persisted |
| Schema cache hit rate | Unknown | >80% |
| Tool coverage across DB types | SQL-only | SQL + Document + Key-Value |
| Runaway loop prevention | None | Circuit breaker active |
| Capability detection failures | Hard error | Graceful degradation |
| Provider fallback | None | Tiered fallback chain |

---

## References

- [AI SDK v6 Documentation](https://ai-sdk.dev/docs/introduction)
- [AI SDK Transport Docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [ToolLoopAgent Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [Bun Embedding Issue #12017](https://github.com/oven-sh/bun/issues/12017)
- [tauri-plugin-deno](https://github.com/marcomq/tauri-plugin-deno)
- [ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code)
- [ai-sdk-provider-opencode-sdk](https://github.com/ben-vargas/ai-sdk-provider-opencode-sdk)
- [ai-sdk-provider-chatgpt-oauth](https://github.com/ben-vargas/ai-sdk-provider-chatgpt-oauth)
