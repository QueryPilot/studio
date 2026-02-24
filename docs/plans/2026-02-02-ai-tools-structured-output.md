# AI Tools: Structured Output Commands (All Database Paradigms)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable AI agents to execute read queries and stage mutations across SQL, MongoDB, and Redis databases via structured output commands with user approval.

**Architecture:**
- Structured Output: Agent outputs `<command>` blocks in responses, parsed progressively during streaming
- Context Injection: Enhanced to include MongoDB collections and Redis key patterns
- Permission System: Per-command approval with "allow all this conversation" option
- Result Injection: Query results added back to conversation for agent to reason about

**Tech Stack:** TypeScript/React (command parser, approval UI, result display), Zustand (permission state)

---

## Trade-offs & Limitations

### Why Structured Output (Not MCP)

| Aspect | Structured Output | MCP Server |
|--------|-------------------|------------|
| **Complexity** | Low - just parsing | High - subprocess + IPC |
| **Implementation time** | Days | Weeks |
| **User control** | Visible approval UI | Hidden tool calls |
| **Multi-database** | Easy to extend | Need tool per DB type |

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Multi-turn queries** | Agent outputs command → user approves → results shown → agent continues | "Allow all" reduces friction |
| **No tool discovery** | Agent learns commands from prompt only | Comprehensive examples in system prompt |
| **Token usage** | Results injected as text | Truncate large results |
| **Agent hallucination** | May output wrong commands | Validation + error feedback |

### Future MCP Upgrade Path

If we need single-turn tool calls later:
1. Command types remain the same
2. Result formats remain the same
3. Add MCP server that wraps the same execution logic
4. MCP tools call same backend functions as structured output handlers

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QueryPilot AI System                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Context Injection (Enhanced)         Structured Output Commands            │
│  ────────────────────────────         ──────────────────────────            │
│  SQL:                                 SQL:                                  │
│  • schemas, tables, views, functions  • sql.execute (SELECT/WITH)           │
│  • @ mentions → full column details   • sql.explain (EXPLAIN)               │
│                                                                             │
│  MongoDB:                             MongoDB:                              │
│  • collections with sample fields     • mongodb.find (query documents)      │
│  • indexes per collection             • mongodb.aggregate (pipeline)        │
│  • document counts                    • mongodb.count (count docs)          │
│                                                                             │
│  Redis:                               Redis:                                │
│  • key patterns with counts           • redis.get (get value)               │
│  • data types per pattern             • redis.keys (list keys)              │
│                                       • redis.scan (cursor scan)            │
│                                                                             │
│  Universal:                           Universal:                            │
│  • connectionId for each connection   • crud.stage (stage mutation)         │
│  • focusedConnectionId                • tab.update (modify SQL)             │
│  • paradigm (sql/document/keyvalue)   • tab.create (new tab)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Task 1: Define Command Types

**Files:**
- Create: `src/types/aiCommands.ts`

**Step 1: Create command type definitions**

Create `src/types/aiCommands.ts`:

```typescript
/**
 * AI Command Types
 *
 * Defines all structured output commands the AI agent can emit.
 * Supports SQL, MongoDB, and Redis databases.
 */

// ============================================================================
// Base Types
// ============================================================================

export type AiCommandName =
  // SQL commands
  | "sql.execute"
  | "sql.explain"
  // MongoDB commands
  | "mongodb.find"
  | "mongodb.aggregate"
  | "mongodb.count"
  // Redis commands
  | "redis.get"
  | "redis.keys"
  | "redis.scan"
  // Universal commands
  | "crud.stage"
  | "tab.update"
  | "tab.create"
  | "editor.insert";

export type CommandApprovalLevel = "auto" | "approve" | "dangerous";

export interface AiCommandMeta {
  name: AiCommandName;
  paradigm: "sql" | "document" | "keyvalue" | "universal";
  approvalLevel: CommandApprovalLevel;
  description: string;
}

export const COMMAND_META: Record<AiCommandName, AiCommandMeta> = {
  // SQL
  "sql.execute": {
    name: "sql.execute",
    paradigm: "sql",
    approvalLevel: "approve",
    description: "Execute SELECT query",
  },
  "sql.explain": {
    name: "sql.explain",
    paradigm: "sql",
    approvalLevel: "auto",
    description: "Explain query plan",
  },
  // MongoDB
  "mongodb.find": {
    name: "mongodb.find",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Find documents",
  },
  "mongodb.aggregate": {
    name: "mongodb.aggregate",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Run aggregation",
  },
  "mongodb.count": {
    name: "mongodb.count",
    paradigm: "document",
    approvalLevel: "auto",
    description: "Count documents",
  },
  // Redis
  "redis.get": {
    name: "redis.get",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "Get key value",
  },
  "redis.keys": {
    name: "redis.keys",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "List keys",
  },
  "redis.scan": {
    name: "redis.scan",
    paradigm: "keyvalue",
    approvalLevel: "approve",
    description: "Scan keys",
  },
  // Universal
  "crud.stage": {
    name: "crud.stage",
    paradigm: "universal",
    approvalLevel: "approve",
    description: "Stage database change",
  },
  "tab.update": {
    name: "tab.update",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Update tab content",
  },
  "tab.create": {
    name: "tab.create",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Create new tab",
  },
  "editor.insert": {
    name: "editor.insert",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Insert at cursor",
  },
};

// ============================================================================
// Command Parameter Types
// ============================================================================

// SQL Commands
export interface SqlExecuteParams {
  connectionId: string;
  sql: string;
  limit?: number; // Default 100, max 1000
}

export interface SqlExplainParams {
  connectionId: string;
  sql: string;
}

// MongoDB Commands
export interface MongodbFindParams {
  connectionId: string;
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number; // Default 20, max 100
}

export interface MongodbAggregateParams {
  connectionId: string;
  collection: string;
  pipeline: Record<string, unknown>[];
}

export interface MongodbCountParams {
  connectionId: string;
  collection: string;
  filter?: Record<string, unknown>;
}

// Redis Commands
export interface RedisGetParams {
  connectionId: string;
  key: string;
}

export interface RedisKeysParams {
  connectionId: string;
  pattern?: string; // Default "*"
  limit?: number; // Default 100
}

export interface RedisScanParams {
  connectionId: string;
  pattern?: string;
  count?: number;
  cursor?: string;
}

// Universal Commands
export interface CrudStageParams {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string; // For SQL
  collection?: string; // For MongoDB
  operation: "insert" | "update" | "delete";
  // For insert
  document?: Record<string, unknown>;
  // For update
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  // For delete
  primaryKeys?: Record<string, unknown>;
  description?: string;
}

export interface TabUpdateParams {
  tabId?: string; // Optional, defaults to active tab
  content?: string; // New content (SQL, MongoDB query, etc.)
  title?: string;
}

export interface TabCreateParams {
  connectionId: string;
  type: "query";
  title?: string;
  content?: string;
}

export interface EditorInsertParams {
  text: string;
  position?: "cursor" | "end" | "replace";
}

// ============================================================================
// Command Result Types
// ============================================================================

export interface SqlExecuteResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface SqlExplainResult {
  plan: string;
  executionTimeMs: number;
}

export interface MongodbFindResult {
  documents: Record<string, unknown>[];
  count: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface MongodbAggregateResult {
  results: Record<string, unknown>[];
  executionTimeMs: number;
}

export interface MongodbCountResult {
  count: number;
  executionTimeMs: number;
}

export interface RedisGetResult {
  key: string;
  type: "string" | "hash" | "list" | "set" | "zset" | "stream" | "none";
  value: unknown;
  ttl: number | null; // -1 = no expiry, -2 = key doesn't exist
}

export interface RedisKeysResult {
  keys: string[];
  count: number;
  truncated: boolean;
}

export interface RedisScanResult {
  keys: string[];
  cursor: string;
  done: boolean;
}

export interface CrudStageResult {
  staged: boolean;
  commandId: string;
  tableKey: string;
}

export interface TabUpdateResult {
  success: boolean;
  tabId: string;
}

export interface TabCreateResult {
  success: boolean;
  tabId: string;
}

export interface EditorInsertResult {
  success: boolean;
}

// ============================================================================
// Parsed Command Type
// ============================================================================

export interface ParsedCommand<T = unknown> {
  id: string;
  name: AiCommandName;
  params: T;
  raw: string;
  startIndex: number;
  endIndex: number;
  error?: string;
}

export type AnyParsedCommand =
  | ParsedCommand<SqlExecuteParams>
  | ParsedCommand<SqlExplainParams>
  | ParsedCommand<MongodbFindParams>
  | ParsedCommand<MongodbAggregateParams>
  | ParsedCommand<MongodbCountParams>
  | ParsedCommand<RedisGetParams>
  | ParsedCommand<RedisKeysParams>
  | ParsedCommand<RedisScanParams>
  | ParsedCommand<CrudStageParams>
  | ParsedCommand<TabUpdateParams>
  | ParsedCommand<TabCreateParams>
  | ParsedCommand<EditorInsertParams>;
```

**Step 2: Verify types compile**

```bash
pnpm typecheck
```
Expected: No errors

**Step 3: Commit**

```bash
git add src/types/aiCommands.ts
git commit -m "feat(ai): add command type definitions for all database paradigms

- SQL commands: sql.execute, sql.explain
- MongoDB commands: mongodb.find, mongodb.aggregate, mongodb.count
- Redis commands: redis.get, redis.keys, redis.scan
- Universal commands: crud.stage, tab.update, tab.create, editor.insert
- Command metadata with approval levels
- Result types for each command"
```

---

## Task 2: Enhance AI Context for NoSQL

**Files:**
- Modify: `src/types/aiContext.ts`
- Modify: `src/hooks/useAIContext.ts`
- Modify: `src/services/schemaCache.ts`

**Step 1: Update AI context types**

First, read the current types:

```bash
cat src/types/aiContext.ts
```

Then update to add MongoDB and Redis context:

In `src/types/aiContext.ts`, add/update:

```typescript
// Add to AISchemaContext or create new types:

/**
 * MongoDB collection info for AI context
 */
export interface AIMongoCollection {
  name: string;
  documentCount?: number;
  indexes: string[];
  sampleFields: string[]; // Field names from sample document
}

/**
 * Redis key pattern info for AI context
 */
export interface AIRedisKeyPattern {
  pattern: string;
  count: number;
  types: Array<"string" | "hash" | "list" | "set" | "zset" | "stream">;
  sampleKeys?: string[]; // A few example keys
}

/**
 * Enhanced connection context supporting all paradigms
 */
export interface AIConnectionContext {
  id: string;
  name: string;
  dbType: string;
  paradigm: "sql" | "document" | "keyvalue";
  database: string;

  // SQL specific
  schemas?: AISchemaContext[];

  // MongoDB specific
  collections?: AIMongoCollection[];

  // Redis specific
  keyPatterns?: AIRedisKeyPattern[];
}
```

**Step 2: Update useAIContext hook**

In `src/hooks/useAIContext.ts`, update `useAIContextWithSchema` to handle all paradigms:

```typescript
// Add imports
import { getParadigm } from "@/types/connection";

// In useAIContextWithSchema, update the query logic:

// Load schema data based on paradigm
const schemaQueries = useQueries({
  queries: openConnections.map((conn) => ({
    queryKey: ["ai-schema", conn.id, conn.database, conn.schema, conn.paradigm],
    queryFn: async () => {
      await databaseService.connectById(conn.id);

      const paradigm = getParadigm(conn.dbType);

      if (paradigm === "sql") {
        // Existing SQL logic
        schemaCache.setConnection(conn.id);
        const [tables, functions] = await Promise.all([
          schemaCache.getTables(conn.id, conn.schema),
          schemaCache.getFunctions(conn.id, conn.schema),
        ]);
        return {
          connectionId: conn.id,
          paradigm: "sql" as const,
          schema: conn.schema,
          tables: tables.filter((t) => t.kind === "Table").map((t) => t.name),
          views: tables.filter((t) => t.kind === "View" || t.kind === "MaterializedView").map((t) => t.name),
          functions: functions.map((f) => f.name),
        };
      } else if (paradigm === "document") {
        // MongoDB - get collections
        const collections = await schemaCache.getMongoCollections(conn.id, conn.database);
        return {
          connectionId: conn.id,
          paradigm: "document" as const,
          collections: collections.map((c) => ({
            name: c.name,
            documentCount: c.documentCount,
            indexes: c.indexes,
            sampleFields: c.sampleFields,
          })),
        };
      } else {
        // Redis - get key patterns
        const keyPatterns = await schemaCache.getRedisKeyPatterns(conn.id);
        return {
          connectionId: conn.id,
          paradigm: "keyvalue" as const,
          keyPatterns: keyPatterns.map((p) => ({
            pattern: p.pattern,
            count: p.count,
            types: p.types,
            sampleKeys: p.sampleKeys,
          })),
        };
      }
    },
    enabled: !!conn.id && !!conn.database,
    staleTime: 5 * 60 * 1000,
  })),
});
```

**Step 3: Add schema cache methods for NoSQL**

In `src/services/schemaCache.ts`, add methods:

```typescript
/**
 * Get MongoDB collections for AI context
 */
async getMongoCollections(
  connectionId: string,
  database: string
): Promise<Array<{
  name: string;
  documentCount?: number;
  indexes: string[];
  sampleFields: string[];
}>> {
  const cacheKey = `mongo-collections:${connectionId}:${database}`;
  const cached = this.cache.get(cacheKey);
  if (cached) return cached.data;

  try {
    // Use existing backend command
    const collections = await BackendAPI.listMongoCollections(connectionId, database);

    // Get sample fields for each collection (first doc)
    const enriched = await Promise.all(
      collections.map(async (coll) => {
        try {
          const sample = await BackendAPI.findMongoDocuments(
            connectionId,
            database,
            coll.name,
            {},
            1
          );
          const sampleFields = sample.length > 0
            ? Object.keys(sample[0]).slice(0, 20) // Limit to 20 fields
            : [];
          return {
            name: coll.name,
            documentCount: coll.count,
            indexes: coll.indexes || [],
            sampleFields,
          };
        } catch {
          return {
            name: coll.name,
            documentCount: coll.count,
            indexes: coll.indexes || [],
            sampleFields: [],
          };
        }
      })
    );

    this.cache.set(cacheKey, {
      data: enriched,
      timestamp: Date.now(),
      ttl: 10 * 60 * 1000, // 10 min
      connectionId,
      priority: "medium",
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    return enriched;
  } catch (error) {
    console.error("Failed to get MongoDB collections:", error);
    return [];
  }
}

/**
 * Get Redis key patterns for AI context
 */
async getRedisKeyPatterns(
  connectionId: string
): Promise<Array<{
  pattern: string;
  count: number;
  types: string[];
  sampleKeys: string[];
}>> {
  const cacheKey = `redis-patterns:${connectionId}`;
  const cached = this.cache.get(cacheKey);
  if (cached) return cached.data;

  try {
    // Scan keys and group by pattern
    const keys = await BackendAPI.scanRedisKeys(connectionId, "*", 1000);

    // Group keys by prefix pattern
    const patternMap = new Map<string, { keys: string[]; types: Set<string> }>();

    for (const key of keys) {
      // Extract pattern (e.g., "user:123" -> "user:*")
      const parts = key.split(":");
      const pattern = parts.length > 1
        ? `${parts[0]}:*`
        : key.includes("_")
          ? `${key.split("_")[0]}_*`
          : key;

      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, { keys: [], types: new Set() });
      }
      const entry = patternMap.get(pattern)!;
      if (entry.keys.length < 5) {
        entry.keys.push(key);
      }
    }

    // Get types for sample keys
    const patterns = await Promise.all(
      Array.from(patternMap.entries()).map(async ([pattern, { keys: sampleKeys }]) => {
        const types = new Set<string>();
        for (const key of sampleKeys.slice(0, 3)) {
          try {
            const type = await BackendAPI.getRedisKeyType(connectionId, key);
            types.add(type);
          } catch {
            // Ignore errors
          }
        }
        return {
          pattern,
          count: patternMap.get(pattern)?.keys.length || 0,
          types: Array.from(types),
          sampleKeys: sampleKeys.slice(0, 3),
        };
      })
    );

    // Sort by count descending, limit to top 20 patterns
    const sorted = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    this.cache.set(cacheKey, {
      data: sorted,
      timestamp: Date.now(),
      ttl: 5 * 60 * 1000, // 5 min (Redis is more dynamic)
      connectionId,
      priority: "medium",
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    return sorted;
  } catch (error) {
    console.error("Failed to get Redis key patterns:", error);
    return [];
  }
}
```

**Step 4: Update serializeAIContext for all paradigms**

In `src/hooks/useAIContext.ts`, update `serializeAIContext`:

```typescript
export function serializeAIContext(context: AIContext): string {
  const schemaContext = {
    focusedConnection: context.focusedConnectionId,
    connections: context.connections.map((conn) => {
      const base = {
        id: conn.id,
        name: conn.name,
        type: conn.dbType,
        paradigm: conn.paradigm,
        database: conn.database,
      };

      if (conn.paradigm === "sql" && conn.schemas) {
        return {
          ...base,
          schemas: conn.schemas.map((s) => ({
            name: s.name,
            tables: s.tables,
            views: s.views,
            functions: s.functions,
          })),
        };
      } else if (conn.paradigm === "document" && conn.collections) {
        return {
          ...base,
          collections: conn.collections.map((c) => ({
            name: c.name,
            documentCount: c.documentCount,
            indexes: c.indexes,
            sampleFields: c.sampleFields,
          })),
        };
      } else if (conn.paradigm === "keyvalue" && conn.keyPatterns) {
        return {
          ...base,
          keyPatterns: conn.keyPatterns.map((p) => ({
            pattern: p.pattern,
            count: p.count,
            types: p.types,
            sampleKeys: p.sampleKeys,
          })),
        };
      }
      return base;
    }),
    mentions: context.mentions.map((m) => {
      // ... existing mention serialization
    }),
  };

  return `${QUERYPILOT_SYSTEM_INSTRUCTIONS}

## Database Schema

\`\`\`json
${JSON.stringify(schemaContext, null, 2)}
\`\`\``;
}
```

**Step 5: Verify compilation**

```bash
pnpm typecheck
```

**Step 6: Commit**

```bash
git add src/types/aiContext.ts src/hooks/useAIContext.ts src/services/schemaCache.ts
git commit -m "feat(ai): enhance context for MongoDB and Redis

- Add AIMongoCollection type with indexes and sample fields
- Add AIRedisKeyPattern type with counts and types
- Add schemaCache.getMongoCollections() method
- Add schemaCache.getRedisKeyPatterns() method
- Update serializeAIContext for all paradigms"
```

---

## Task 3: Command Parser with Progressive Streaming

**Files:**
- Create: `src/utils/aiCommandParser.ts`
- Create: `src/utils/__tests__/aiCommandParser.test.ts`

**Step 1: Write tests**

Create `src/utils/__tests__/aiCommandParser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseCommands,
  parseCommandsProgressive,
  stripCommands,
  hasCommands,
} from "../aiCommandParser";

describe("parseCommands", () => {
  it("returns empty array for text without commands", () => {
    const text = "Here is some SQL:\n```sql\nSELECT * FROM users\n```";
    expect(parseCommands(text)).toEqual([]);
  });

  it("parses sql.execute command", () => {
    const text = `Let me query that.

<command name="sql.execute">
{
  "connectionId": "conn-123",
  "sql": "SELECT * FROM users LIMIT 10"
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("sql.execute");
    expect(commands[0].params.connectionId).toBe("conn-123");
  });

  it("parses mongodb.find command", () => {
    const text = `<command name="mongodb.find">
{
  "connectionId": "conn-mongo",
  "collection": "users",
  "filter": { "active": true },
  "limit": 20
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("mongodb.find");
    expect(commands[0].params.collection).toBe("users");
  });

  it("parses redis.get command", () => {
    const text = `<command name="redis.get">
{"connectionId": "conn-redis", "key": "user:123"}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("redis.get");
  });

  it("parses multiple commands", () => {
    const text = `First query:
<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 1"}</command>

Second query:
<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 2"}</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(2);
  });

  it("handles malformed JSON gracefully", () => {
    const text = `<command name="sql.execute">{ invalid }</command>`;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0].error).toBeDefined();
  });

  it("extracts position in text", () => {
    const text = "Before\n<command name=\"sql.execute\">{}</command>\nAfter";
    const commands = parseCommands(text);
    expect(commands[0].startIndex).toBe(7);
  });
});

describe("parseCommandsProgressive", () => {
  it("returns incomplete for partial command", () => {
    const text = "Here is a command: <command name=\"sql.execute\">{\"sql\":";
    const result = parseCommandsProgressive(text);
    expect(result.complete).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("returns complete when command is finished", () => {
    const text = `<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 1"}</command>`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(false);
  });

  it("handles mix of complete and streaming", () => {
    const text = `<command name="sql.execute">{"connectionId": "c1"}</command>
More text...
<command name="sql.execute">{"connectionId":`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });
});

describe("stripCommands", () => {
  it("removes command blocks from text", () => {
    const text = `Before <command name="test">{}</command> After`;
    expect(stripCommands(text)).toBe("Before  After");
  });
});

describe("hasCommands", () => {
  it("returns true when commands present", () => {
    expect(hasCommands(`<command name="test">{}</command>`)).toBe(true);
  });

  it("returns false when no commands", () => {
    expect(hasCommands("Just plain text")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test:unit src/utils/__tests__/aiCommandParser.test.ts
```
Expected: FAIL

**Step 3: Implement parser**

Create `src/utils/aiCommandParser.ts`:

```typescript
/**
 * AI Command Parser
 *
 * Parses <command> blocks from AI agent responses.
 * Supports progressive parsing during streaming.
 */

import { nanoid } from "nanoid";
import type { AiCommandName, ParsedCommand, COMMAND_META } from "@/types/aiCommands";

// ============================================================================
// Parser
// ============================================================================

const COMMAND_REGEX = /<command\s+name="([^"]+)">([\s\S]*?)<\/command>/g;
const PARTIAL_COMMAND_REGEX = /<command\s+name="[^"]*">[^<]*$/;

/**
 * Parse complete commands from text.
 */
export function parseCommands(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  COMMAND_REGEX.lastIndex = 0;

  while ((match = COMMAND_REGEX.exec(text)) !== null) {
    const [raw, name, content] = match;
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    const command: ParsedCommand = {
      id: nanoid(),
      name: name as AiCommandName,
      params: {},
      raw,
      startIndex,
      endIndex,
    };

    try {
      command.params = content.trim() ? JSON.parse(content.trim()) : {};
    } catch (e) {
      command.error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }

    commands.push(command);
  }

  return commands;
}

/**
 * Progressive parsing result
 */
export interface ProgressiveParseResult {
  complete: ParsedCommand[];
  incomplete: boolean;
  incompleteStart?: number;
}

/**
 * Parse commands progressively during streaming.
 * Returns complete commands and whether there's an incomplete one being typed.
 */
export function parseCommandsProgressive(text: string): ProgressiveParseResult {
  const complete = parseCommands(text);

  // Check if there's an incomplete command at the end
  // (opening tag started but no closing tag yet)
  const lastCompleteEnd = complete.length > 0
    ? Math.max(...complete.map(c => c.endIndex))
    : 0;

  const remaining = text.slice(lastCompleteEnd);
  const hasIncomplete = PARTIAL_COMMAND_REGEX.test(remaining);

  let incompleteStart: number | undefined;
  if (hasIncomplete) {
    const match = remaining.match(/<command\s+name="[^"]*">/);
    if (match && match.index !== undefined) {
      incompleteStart = lastCompleteEnd + match.index;
    }
  }

  return {
    complete,
    incomplete: hasIncomplete,
    incompleteStart,
  };
}

/**
 * Remove command blocks from text.
 */
export function stripCommands(text: string): string {
  return text.replace(COMMAND_REGEX, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Check if text contains any commands.
 */
export function hasCommands(text: string): boolean {
  COMMAND_REGEX.lastIndex = 0;
  return COMMAND_REGEX.test(text);
}

/**
 * Check if text has an incomplete command being streamed.
 */
export function hasIncompleteCommand(text: string): boolean {
  return PARTIAL_COMMAND_REGEX.test(text);
}

/**
 * Get human-readable description for a command.
 */
export function getCommandDescription(command: ParsedCommand): string {
  switch (command.name) {
    case "sql.execute":
      return `Execute SQL query`;
    case "sql.explain":
      return `Explain query plan`;
    case "mongodb.find":
      return `Find documents in ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "mongodb.aggregate":
      return `Run aggregation on ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "mongodb.count":
      return `Count documents in ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "redis.get":
      return `Get key: ${(command.params as { key?: string }).key ?? "key"}`;
    case "redis.keys":
      return `List keys: ${(command.params as { pattern?: string }).pattern ?? "*"}`;
    case "redis.scan":
      return `Scan keys`;
    case "crud.stage":
      return `Stage ${(command.params as { operation?: string }).operation ?? "change"}`;
    case "tab.update":
      return `Update tab content`;
    case "tab.create":
      return `Create new tab`;
    case "editor.insert":
      return `Insert at cursor`;
    default:
      return `Unknown command: ${command.name}`;
  }
}

/**
 * Validate command parameters.
 */
export function validateCommand(command: ParsedCommand): string | null {
  const params = command.params as Record<string, unknown>;

  // All commands except tab.update and editor.insert need connectionId
  const needsConnection = !["tab.update", "editor.insert"].includes(command.name);
  if (needsConnection && !params.connectionId) {
    return "Missing required parameter: connectionId";
  }

  switch (command.name) {
    case "sql.execute":
    case "sql.explain":
      if (!params.sql) return "Missing required parameter: sql";
      break;
    case "mongodb.find":
    case "mongodb.aggregate":
    case "mongodb.count":
      if (!params.collection) return "Missing required parameter: collection";
      break;
    case "redis.get":
      if (!params.key) return "Missing required parameter: key";
      break;
    case "crud.stage":
      if (!params.operation) return "Missing required parameter: operation";
      break;
  }

  return null;
}
```

**Step 4: Run tests**

```bash
pnpm test:unit src/utils/__tests__/aiCommandParser.test.ts
```
Expected: All pass

**Step 5: Commit**

```bash
git add src/utils/aiCommandParser.ts src/utils/__tests__/aiCommandParser.test.ts
git commit -m "feat(ai): add command parser with progressive streaming support

- Parse sql.*, mongodb.*, redis.*, crud.*, tab.*, editor.* commands
- Progressive parsing for streaming responses
- Validation for required parameters
- Human-readable descriptions"
```

---

## Task 4: Permission Store

**Files:**
- Create: `src/stores/aiCommandPermissionStore.ts`
- Create: `src/stores/__tests__/aiCommandPermissionStore.test.ts`

**Step 1: Write tests**

Create `src/stores/__tests__/aiCommandPermissionStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAiCommandPermissionStore } from "../aiCommandPermissionStore";

describe("aiCommandPermissionStore", () => {
  beforeEach(() => {
    useAiCommandPermissionStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useAiCommandPermissionStore.getState();
    expect(state.allowAllThisConversation).toBe(false);
    expect(state.commandStates.size).toBe(0);
  });

  it("tracks pending commands", () => {
    const { trackCommand, getCommandState } = useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "sql.execute");
    expect(getCommandState("cmd-1")).toBe("pending");
  });

  it("approves commands", () => {
    const { trackCommand, approveCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "sql.execute");
    approveCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("approved");
  });

  it("rejects commands", () => {
    const { trackCommand, rejectCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "sql.execute");
    rejectCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("rejected");
  });

  it("auto-approves when allowAllThisConversation is true", () => {
    const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
    setAllowAll(true);
    expect(shouldAutoApprove("sql.execute")).toBe(true);
    expect(shouldAutoApprove("mongodb.find")).toBe(true);
  });

  it("never auto-approves dangerous commands", () => {
    const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
    setAllowAll(true);
    // crud.stage is dangerous
    expect(shouldAutoApprove("crud.stage")).toBe(false);
  });

  it("auto-approves auto-level commands", () => {
    const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
    // sql.explain is auto-approve level
    expect(shouldAutoApprove("sql.explain")).toBe(true);
    expect(shouldAutoApprove("redis.get")).toBe(true);
    expect(shouldAutoApprove("tab.update")).toBe(true);
  });

  it("resets on new conversation", () => {
    const store = useAiCommandPermissionStore.getState();
    store.setAllowAll(true);
    store.trackCommand("cmd-1", "sql.execute");
    store.approveCommand("cmd-1");

    store.reset();

    const state = useAiCommandPermissionStore.getState();
    expect(state.allowAllThisConversation).toBe(false);
    expect(state.commandStates.size).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test:unit src/stores/__tests__/aiCommandPermissionStore.test.ts
```

**Step 3: Implement store**

Create `src/stores/aiCommandPermissionStore.ts`:

```typescript
/**
 * AI Command Permission Store
 *
 * Tracks approval state for AI-generated commands.
 * Supports per-command and conversation-level approval.
 */

import { create } from "zustand";
import { COMMAND_META, type AiCommandName } from "@/types/aiCommands";

export type CommandState = "pending" | "approved" | "rejected" | "executing" | "completed" | "failed";

interface AiCommandPermissionState {
  // Conversation-level setting
  allowAllThisConversation: boolean;

  // Per-command state: commandId -> state
  commandStates: Map<string, CommandState>;

  // Command name tracking: commandId -> commandName
  commandNames: Map<string, AiCommandName>;

  // Actions
  setAllowAll: (allow: boolean) => void;
  trackCommand: (commandId: string, commandName: AiCommandName) => void;
  approveCommand: (commandId: string) => void;
  rejectCommand: (commandId: string) => void;
  setCommandState: (commandId: string, state: CommandState) => void;
  getCommandState: (commandId: string) => CommandState;
  shouldAutoApprove: (commandName: AiCommandName) => boolean;
  reset: () => void;
}

export const useAiCommandPermissionStore = create<AiCommandPermissionState>()(
  (set, get) => ({
    allowAllThisConversation: false,
    commandStates: new Map(),
    commandNames: new Map(),

    setAllowAll: (allow) => {
      set({ allowAllThisConversation: allow });
    },

    trackCommand: (commandId, commandName) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        const commandNames = new Map(state.commandNames);
        commandStates.set(commandId, "pending");
        commandNames.set(commandId, commandName);
        return { commandStates, commandNames };
      });
    },

    approveCommand: (commandId) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, "approved");
        return { commandStates };
      });
    },

    rejectCommand: (commandId) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, "rejected");
        return { commandStates };
      });
    },

    setCommandState: (commandId, newState) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, newState);
        return { commandStates };
      });
    },

    getCommandState: (commandId) => {
      return get().commandStates.get(commandId) ?? "pending";
    },

    shouldAutoApprove: (commandName) => {
      const meta = COMMAND_META[commandName];
      if (!meta) return false;

      // Auto-level commands always auto-approve
      if (meta.approvalLevel === "auto") {
        return true;
      }

      // Dangerous commands never auto-approve
      if (meta.approvalLevel === "dangerous") {
        return false;
      }

      // Approve-level commands auto-approve if allowAll is set
      if (meta.approvalLevel === "approve" && get().allowAllThisConversation) {
        return true;
      }

      return false;
    },

    reset: () => {
      set({
        allowAllThisConversation: false,
        commandStates: new Map(),
        commandNames: new Map(),
      });
    },
  })
);
```

**Step 4: Run tests**

```bash
pnpm test:unit src/stores/__tests__/aiCommandPermissionStore.test.ts
```

**Step 5: Commit**

```bash
git add src/stores/aiCommandPermissionStore.ts src/stores/__tests__/aiCommandPermissionStore.test.ts
git commit -m "feat(ai): add command permission store

- Track command state (pending/approved/rejected/executing/completed/failed)
- Support 'allow all this conversation' mode
- Auto-approve based on command approval level
- Reset on new conversation"
```

---

## Task 5: Command Executor Service

**Files:**
- Create: `src/services/aiCommandExecutor.ts`

**Step 1: Create executor service**

Create `src/services/aiCommandExecutor.ts`:

```typescript
/**
 * AI Command Executor
 *
 * Executes approved AI commands against the database.
 * Returns results for injection back into conversation.
 */

import { nanoid } from "nanoid";
import { BackendAPI } from "./backend";
import { useCrudStore } from "@/stores/crudStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import type {
  ParsedCommand,
  SqlExecuteParams,
  SqlExecuteResult,
  SqlExplainParams,
  SqlExplainResult,
  MongodbFindParams,
  MongodbFindResult,
  MongodbAggregateParams,
  MongodbAggregateResult,
  MongodbCountParams,
  MongodbCountResult,
  RedisGetParams,
  RedisGetResult,
  RedisKeysParams,
  RedisKeysResult,
  RedisScanParams,
  RedisScanResult,
  CrudStageParams,
  CrudStageResult,
  TabUpdateParams,
  TabUpdateResult,
  TabCreateParams,
  TabCreateResult,
  EditorInsertParams,
  EditorInsertResult,
} from "@/types/aiCommands";

export type CommandResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Execute an AI command and return the result.
 */
export async function executeCommand(command: ParsedCommand): Promise<CommandResult> {
  try {
    switch (command.name) {
      case "sql.execute":
        return await executeSqlQuery(command.params as SqlExecuteParams);
      case "sql.explain":
        return await executeSqlExplain(command.params as SqlExplainParams);
      case "mongodb.find":
        return await executeMongoFind(command.params as MongodbFindParams);
      case "mongodb.aggregate":
        return await executeMongoAggregate(command.params as MongodbAggregateParams);
      case "mongodb.count":
        return await executeMongoCount(command.params as MongodbCountParams);
      case "redis.get":
        return await executeRedisGet(command.params as RedisGetParams);
      case "redis.keys":
        return await executeRedisKeys(command.params as RedisKeysParams);
      case "redis.scan":
        return await executeRedisScan(command.params as RedisScanParams);
      case "crud.stage":
        return await executeCrudStage(command.params as CrudStageParams);
      case "tab.update":
        return await executeTabUpdate(command.params as TabUpdateParams);
      case "tab.create":
        return await executeTabCreate(command.params as TabCreateParams);
      case "editor.insert":
        return await executeEditorInsert(command.params as EditorInsertParams);
      default:
        return { success: false, error: `Unknown command: ${command.name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// SQL Executors
// ============================================================================

async function executeSqlQuery(params: SqlExecuteParams): Promise<CommandResult> {
  const { connectionId, sql, limit = 100 } = params;

  // Validate read-only
  const sqlUpper = sql.trim().toUpperCase();
  const isReadOnly =
    sqlUpper.startsWith("SELECT") ||
    sqlUpper.startsWith("WITH") ||
    sqlUpper.startsWith("SHOW") ||
    sqlUpper.startsWith("DESCRIBE");

  if (!isReadOnly) {
    return { success: false, error: "Only SELECT queries are allowed. Use crud.stage for mutations." };
  }

  // Add LIMIT if not present
  const limitedSql = sqlUpper.includes("LIMIT") ? sql : `${sql.trim().replace(/;$/, "")} LIMIT ${Math.min(limit, 1000)}`;

  const startTime = performance.now();
  const result = await BackendAPI.executeQuery(connectionId, limitedSql);
  const executionTimeMs = Math.round(performance.now() - startTime);

  const data: SqlExecuteResult = {
    columns: result.columns.map((c) => c.name),
    rows: result.rows,
    rowCount: result.rows.length,
    executionTimeMs,
    truncated: result.rows.length >= limit,
  };

  return { success: true, data };
}

async function executeSqlExplain(params: SqlExplainParams): Promise<CommandResult> {
  const { connectionId, sql } = params;
  const explainSql = `EXPLAIN ${sql}`;

  const startTime = performance.now();
  const result = await BackendAPI.executeQuery(connectionId, explainSql);
  const executionTimeMs = Math.round(performance.now() - startTime);

  const data: SqlExplainResult = {
    plan: result.rows.map((r) => r.join(" ")).join("\n"),
    executionTimeMs,
  };

  return { success: true, data };
}

// ============================================================================
// MongoDB Executors
// ============================================================================

async function executeMongoFind(params: MongodbFindParams): Promise<CommandResult> {
  const { connectionId, collection, filter = {}, projection, sort, limit = 20 } = params;

  const startTime = performance.now();
  const documents = await BackendAPI.findMongoDocuments(
    connectionId,
    collection,
    filter,
    Math.min(limit, 100),
    projection,
    sort
  );
  const executionTimeMs = Math.round(performance.now() - startTime);

  const data: MongodbFindResult = {
    documents,
    count: documents.length,
    executionTimeMs,
    truncated: documents.length >= limit,
  };

  return { success: true, data };
}

async function executeMongoAggregate(params: MongodbAggregateParams): Promise<CommandResult> {
  const { connectionId, collection, pipeline } = params;

  const startTime = performance.now();
  const results = await BackendAPI.aggregateMongo(connectionId, collection, pipeline);
  const executionTimeMs = Math.round(performance.now() - startTime);

  const data: MongodbAggregateResult = {
    results,
    executionTimeMs,
  };

  return { success: true, data };
}

async function executeMongoCount(params: MongodbCountParams): Promise<CommandResult> {
  const { connectionId, collection, filter = {} } = params;

  const startTime = performance.now();
  const count = await BackendAPI.countMongoDocuments(connectionId, collection, filter);
  const executionTimeMs = Math.round(performance.now() - startTime);

  const data: MongodbCountResult = {
    count,
    executionTimeMs,
  };

  return { success: true, data };
}

// ============================================================================
// Redis Executors
// ============================================================================

async function executeRedisGet(params: RedisGetParams): Promise<CommandResult> {
  const { connectionId, key } = params;

  const [type, value, ttl] = await Promise.all([
    BackendAPI.getRedisKeyType(connectionId, key),
    BackendAPI.getRedisValue(connectionId, key),
    BackendAPI.getRedisKeyTtl(connectionId, key),
  ]);

  const data: RedisGetResult = {
    key,
    type: type as RedisGetResult["type"],
    value,
    ttl,
  };

  return { success: true, data };
}

async function executeRedisKeys(params: RedisKeysParams): Promise<CommandResult> {
  const { connectionId, pattern = "*", limit = 100 } = params;

  const keys = await BackendAPI.scanRedisKeys(connectionId, pattern, Math.min(limit, 1000));

  const data: RedisKeysResult = {
    keys,
    count: keys.length,
    truncated: keys.length >= limit,
  };

  return { success: true, data };
}

async function executeRedisScan(params: RedisScanParams): Promise<CommandResult> {
  const { connectionId, pattern = "*", count = 100, cursor = "0" } = params;

  const result = await BackendAPI.scanRedisKeysWithCursor(connectionId, pattern, cursor, count);

  const data: RedisScanResult = {
    keys: result.keys,
    cursor: result.cursor,
    done: result.cursor === "0",
  };

  return { success: true, data };
}

// ============================================================================
// CRUD Executor
// ============================================================================

async function executeCrudStage(params: CrudStageParams): Promise<CommandResult> {
  const { connectionId, database, schema, table, collection, operation, document, filter, update, primaryKeys, description } = params;

  const target = {
    connectionId,
    database,
    schema,
    table: table ?? collection,
  };

  let type: string;
  let payload: Record<string, unknown>;

  switch (operation) {
    case "insert":
      type = "data.insert";
      payload = { values: document ?? {} };
      break;
    case "update":
      type = "data.update";
      payload = { primaryKeys: primaryKeys ?? filter, ...update };
      break;
    case "delete":
      type = "data.delete";
      payload = { primaryKeys: primaryKeys ?? filter };
      break;
    default:
      return { success: false, error: `Unknown operation: ${operation}` };
  }

  const commandId = nanoid();
  const tableKey = useCrudStore.getState().getTableKey(target);

  useCrudStore.getState().stageCommand({
    id: commandId,
    type: type as "data.insert" | "data.update" | "data.delete",
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description,
      source: "ai",
    },
    state: "staged",
  });

  const data: CrudStageResult = {
    staged: true,
    commandId,
    tableKey,
  };

  return { success: true, data };
}

// ============================================================================
// Tab Executors
// ============================================================================

async function executeTabUpdate(params: TabUpdateParams): Promise<CommandResult> {
  const { tabId, content, title } = params;
  const store = useWorkspaceScreenStore.getState();

  // Find the tab
  const panels = store.getPanels();
  let targetPanelId: string | null = null;
  let targetTabId = tabId;

  for (const [panelId, panel] of panels) {
    if (tabId && panel.tabs.has(tabId)) {
      targetPanelId = panelId;
      break;
    } else if (!tabId && panel.activeTabId) {
      targetPanelId = panelId;
      targetTabId = panel.activeTabId;
      break;
    }
  }

  if (!targetPanelId || !targetTabId) {
    return { success: false, error: "Tab not found" };
  }

  const updates: Partial<{ title: string; payload: { sql: string } }> = {};
  if (title) updates.title = title;
  if (content) updates.payload = { sql: content };

  store.updateTab(targetPanelId, targetTabId, updates);

  const data: TabUpdateResult = {
    success: true,
    tabId: targetTabId,
  };

  return { success: true, data };
}

async function executeTabCreate(params: TabCreateParams): Promise<CommandResult> {
  const { connectionId, type, title, content } = params;
  const store = useWorkspaceScreenStore.getState();

  const panelId = store.getActivePanelId();
  const tabId = store.addTab(panelId, {
    type,
    connectionId,
    title: title ?? "New Query",
    payload: { sql: content ?? "" },
  });

  const data: TabCreateResult = {
    success: true,
    tabId,
  };

  return { success: true, data };
}

async function executeEditorInsert(params: EditorInsertParams): Promise<CommandResult> {
  // TODO: Implement via editorRegistry
  // For now, just update the active tab's content
  const { text, position = "cursor" } = params;
  const store = useWorkspaceScreenStore.getState();

  const panels = store.getPanels();
  for (const [panelId, panel] of panels) {
    if (panel.activeTabId) {
      const tab = panel.tabs.get(panel.activeTabId);
      if (tab?.payload?.sql !== undefined) {
        const currentSql = tab.payload.sql ?? "";
        let newSql: string;

        switch (position) {
          case "replace":
            newSql = text;
            break;
          case "end":
            newSql = currentSql + "\n" + text;
            break;
          case "cursor":
          default:
            // Without cursor position, append
            newSql = currentSql + "\n" + text;
            break;
        }

        store.updateTab(panelId, panel.activeTabId, { payload: { sql: newSql } });

        const data: EditorInsertResult = { success: true };
        return { success: true, data };
      }
    }
  }

  return { success: false, error: "No active editor tab" };
}

// ============================================================================
// Result Formatter
// ============================================================================

/**
 * Format command result for display in conversation.
 */
export function formatResultForConversation(
  command: ParsedCommand,
  result: CommandResult
): string {
  if (!result.success) {
    return `**Error:** ${result.error}`;
  }

  const data = result.data as Record<string, unknown>;

  switch (command.name) {
    case "sql.execute": {
      const sqlResult = data as SqlExecuteResult;
      if (sqlResult.rowCount === 0) {
        return `**Query returned no results** (${sqlResult.executionTimeMs}ms)`;
      }
      return formatTableResult(sqlResult.columns, sqlResult.rows, sqlResult.rowCount, sqlResult.truncated, sqlResult.executionTimeMs);
    }
    case "sql.explain": {
      const explainResult = data as SqlExplainResult;
      return `**Query Plan** (${explainResult.executionTimeMs}ms)\n\`\`\`\n${explainResult.plan}\n\`\`\``;
    }
    case "mongodb.find": {
      const mongoResult = data as MongodbFindResult;
      if (mongoResult.count === 0) {
        return `**No documents found** (${mongoResult.executionTimeMs}ms)`;
      }
      return `**Found ${mongoResult.count} documents** (${mongoResult.executionTimeMs}ms)${mongoResult.truncated ? " (truncated)" : ""}\n\`\`\`json\n${JSON.stringify(mongoResult.documents, null, 2)}\n\`\`\``;
    }
    case "mongodb.aggregate": {
      const aggResult = data as MongodbAggregateResult;
      return `**Aggregation Result** (${aggResult.executionTimeMs}ms)\n\`\`\`json\n${JSON.stringify(aggResult.results, null, 2)}\n\`\`\``;
    }
    case "mongodb.count": {
      const countResult = data as MongodbCountResult;
      return `**Document count: ${countResult.count}** (${countResult.executionTimeMs}ms)`;
    }
    case "redis.get": {
      const redisResult = data as RedisGetResult;
      if (redisResult.type === "none") {
        return `**Key not found:** ${redisResult.key}`;
      }
      const ttlInfo = redisResult.ttl === -1 ? "no expiry" : redisResult.ttl === -2 ? "expired" : `TTL: ${redisResult.ttl}s`;
      return `**${redisResult.key}** (${redisResult.type}, ${ttlInfo})\n\`\`\`json\n${JSON.stringify(redisResult.value, null, 2)}\n\`\`\``;
    }
    case "redis.keys": {
      const keysResult = data as RedisKeysResult;
      return `**Found ${keysResult.count} keys**${keysResult.truncated ? " (truncated)" : ""}\n\`\`\`\n${keysResult.keys.join("\n")}\n\`\`\``;
    }
    case "crud.stage": {
      const stageResult = data as CrudStageResult;
      return `**Change staged** (ID: ${stageResult.commandId})\nReview in the Changes panel and commit when ready.`;
    }
    case "tab.update":
    case "tab.create":
    case "editor.insert":
      return `**Done**`;
    default:
      return `**Result:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}

function formatTableResult(
  columns: string[],
  rows: unknown[][],
  rowCount: number,
  truncated: boolean,
  executionTimeMs: number
): string {
  const maxRows = 20;
  const displayRows = rows.slice(0, maxRows);
  const header = `**${rowCount} rows** (${executionTimeMs}ms)${truncated ? " - truncated" : ""}`;

  // Build markdown table
  const headerRow = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const dataRows = displayRows.map((row) =>
    `| ${row.map((cell) => formatCell(cell)).join(" | ")} |`
  ).join("\n");

  let result = `${header}\n\n${headerRow}\n${separator}\n${dataRows}`;

  if (rows.length > maxRows) {
    result += `\n\n*... and ${rows.length - maxRows} more rows*`;
  }

  return result;
}

function formatCell(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 50);
}
```

**Step 2: Verify compilation**

```bash
pnpm typecheck
```

**Step 3: Commit**

```bash
git add src/services/aiCommandExecutor.ts
git commit -m "feat(ai): add command executor service

- SQL: execute SELECT queries, EXPLAIN plans
- MongoDB: find, aggregate, count documents
- Redis: get, keys, scan
- CRUD: stage mutations to CRUD store
- Tabs: update, create tabs
- Editor: insert at cursor
- Format results as markdown for conversation"
```

---

## Task 6: Command Approval UI Component

**Files:**
- Create: `src/components/AI/CommandCard.tsx`

**Step 1: Create command card component**

Create `src/components/AI/CommandCard.tsx`:

```tsx
/**
 * Command Card Component
 *
 * Displays AI commands inline with approve/reject actions.
 * Shows execution status and results.
 */

import { useState, useEffect } from "react";
import {
  IconCheck,
  IconX,
  IconPlayerPlay,
  IconLoader2,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconBrandMongodb,
  IconServer,
  IconTable,
  IconCode,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ParsedCommand } from "@/types/aiCommands";
import { COMMAND_META } from "@/types/aiCommands";
import { getCommandDescription, validateCommand } from "@/utils/aiCommandParser";
import { useAiCommandPermissionStore } from "@/stores/aiCommandPermissionStore";
import { executeCommand, formatResultForConversation } from "@/services/aiCommandExecutor";

interface CommandCardProps {
  command: ParsedCommand;
  onResult?: (result: string) => void;
}

export function CommandCard({ command, onResult }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const {
    trackCommand,
    approveCommand,
    rejectCommand,
    setCommandState,
    getCommandState,
    shouldAutoApprove,
  } = useAiCommandPermissionStore();

  const state = getCommandState(command.id);
  const meta = COMMAND_META[command.name];
  const description = getCommandDescription(command);
  const validationError = validateCommand(command);

  // Track command on mount
  useEffect(() => {
    trackCommand(command.id, command.name);

    // Auto-approve if eligible
    if (shouldAutoApprove(command.name) && !command.error && !validationError) {
      handleApprove();
    }
  }, [command.id]);

  const handleApprove = async () => {
    if (command.error || validationError) return;

    setCommandState(command.id, "executing");

    const execResult = await executeCommand(command);
    const formatted = formatResultForConversation(command, execResult);

    setResult(formatted);
    setCommandState(command.id, execResult.success ? "completed" : "failed");
    approveCommand(command.id);
    onResult?.(formatted);
  };

  const handleReject = () => {
    rejectCommand(command.id);
    setCommandState(command.id, "rejected");
  };

  // Get paradigm icon
  const getIcon = () => {
    switch (meta?.paradigm) {
      case "sql":
        return IconDatabase;
      case "document":
        return IconBrandMongodb;
      case "keyvalue":
        return IconServer;
      case "universal":
        return command.name.startsWith("crud") ? IconTable : IconCode;
      default:
        return IconCode;
    }
  };

  const Icon = getIcon();

  // Render based on state
  if (state === "completed" || state === "failed") {
    return (
      <div className={cn(
        "rounded-md border my-2 overflow-hidden",
        state === "completed" ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
      )}>
        <div className="flex items-center gap-2 px-3 py-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-xs">{description}</span>
          {state === "completed" ? (
            <IconCheck className="h-4 w-4 text-green-500" />
          ) : (
            <IconX className="h-4 w-4 text-red-500" />
          )}
        </div>
        {result && (
          <div className="px-3 pb-3 text-xs border-t border-border/50">
            <div className="pt-2 prose prose-sm dark:prose-invert max-w-none">
              {/* Render result as markdown would go here - simplified for now */}
              <pre className="whitespace-pre-wrap text-[11px]">{result}</pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (state === "rejected") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 opacity-50">
        <Icon className="h-3.5 w-3.5" />
        <span className="line-through">{description}</span>
        <span>- Rejected</span>
      </div>
    );
  }

  if (state === "executing") {
    return (
      <div className="rounded-md border bg-muted/30 my-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <IconLoader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="flex-1 text-xs">{description}</span>
          <span className="text-[10px] text-muted-foreground">Executing...</span>
        </div>
      </div>
    );
  }

  // Pending state - show approval UI
  return (
    <div className="rounded-md border bg-muted/30 my-2">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4 text-primary" />
        <span className="flex-1 text-xs font-medium">{description}</span>

        {(command.error || validationError) ? (
          <span className="text-[10px] text-destructive">
            {command.error || validationError}
          </span>
        ) : (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleApprove();
              }}
            >
              <IconPlayerPlay className="h-3 w-3 mr-1" />
              Run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleReject();
              }}
            >
              <IconX className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t">
          <pre className="text-[10px] bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(command.params, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface CommandListProps {
  commands: ParsedCommand[];
  onResult?: (commandId: string, result: string) => void;
}

export function CommandList({ commands, onResult }: CommandListProps) {
  const { allowAllThisConversation, setAllowAll } = useAiCommandPermissionStore();

  if (commands.length === 0) return null;

  const pendingCount = commands.filter(
    (c) => !c.error && useAiCommandPermissionStore.getState().getCommandState(c.id) === "pending"
  ).length;

  return (
    <div className="space-y-1">
      {pendingCount > 1 && !allowAllThisConversation && (
        <div className="flex justify-end mb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={() => setAllowAll(true)}
          >
            Allow all this conversation
          </Button>
        </div>
      )}
      {commands.map((cmd) => (
        <CommandCard
          key={cmd.id}
          command={cmd}
          onResult={(result) => onResult?.(cmd.id, result)}
        />
      ))}
    </div>
  );
}
```

**Step 2: Export from AI components**

In `src/components/AI/index.ts`, add:

```typescript
export { CommandCard, CommandList } from "./CommandCard";
```

**Step 3: Verify compilation**

```bash
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/components/AI/CommandCard.tsx src/components/AI/index.ts
git commit -m "feat(ai): add command card UI component

- Display pending commands with Run/Reject buttons
- Show execution status (executing, completed, failed, rejected)
- Expand to see command parameters
- Display formatted results inline
- Support 'allow all this conversation' for multiple commands"
```

---

## Task 7: Integrate into AI Panel

**Files:**
- Modify: `src/components/AI/AIPanel.tsx`
- Modify: `src/hooks/useAIContext.ts`

**Step 1: Update system prompt**

In `src/hooks/useAIContext.ts`, replace `QUERYPILOT_SYSTEM_INSTRUCTIONS`:

```typescript
const QUERYPILOT_SYSTEM_INSTRUCTIONS = `
## Context: QueryPilot Database IDE

You are assisting a user in QueryPilot, a database IDE that supports SQL databases (PostgreSQL, MySQL, SQLite, MSSQL), MongoDB, and Redis.

## Your Capabilities

You can:
1. **Read database schema** - Use the provided context to understand tables, collections, keys
2. **Execute read queries** - Output commands to run SELECT queries, find documents, or get Redis values
3. **Stage mutations** - Output commands to stage INSERT/UPDATE/DELETE (user must review and commit)
4. **Modify tabs** - Update SQL in editor tabs or create new tabs

## Command Format

To execute actions, output command blocks:

\`\`\`
<command name="command.name">
{
  "param1": "value1",
  "param2": "value2"
}
</command>
\`\`\`

The user will see these commands and can approve or reject them.

## Available Commands

### SQL Databases (PostgreSQL, MySQL, SQLite, MSSQL)

**sql.execute** - Run a SELECT query
\`\`\`
<command name="sql.execute">
{
  "connectionId": "use-id-from-context",
  "sql": "SELECT * FROM users WHERE active = true",
  "limit": 100
}
</command>
\`\`\`

**sql.explain** - Get query execution plan
\`\`\`
<command name="sql.explain">
{
  "connectionId": "...",
  "sql": "SELECT * FROM orders WHERE created_at > '2024-01-01'"
}
</command>
\`\`\`

### MongoDB

**mongodb.find** - Find documents
\`\`\`
<command name="mongodb.find">
{
  "connectionId": "...",
  "collection": "users",
  "filter": { "status": "active" },
  "limit": 20
}
</command>
\`\`\`

**mongodb.aggregate** - Run aggregation pipeline
\`\`\`
<command name="mongodb.aggregate">
{
  "connectionId": "...",
  "collection": "orders",
  "pipeline": [
    { "$match": { "status": "completed" } },
    { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } }
  ]
}
</command>
\`\`\`

**mongodb.count** - Count documents
\`\`\`
<command name="mongodb.count">
{
  "connectionId": "...",
  "collection": "events",
  "filter": { "type": "click" }
}
</command>
\`\`\`

### Redis

**redis.get** - Get key value
\`\`\`
<command name="redis.get">
{
  "connectionId": "...",
  "key": "user:123"
}
</command>
\`\`\`

**redis.keys** - List keys by pattern
\`\`\`
<command name="redis.keys">
{
  "connectionId": "...",
  "pattern": "session:*",
  "limit": 100
}
</command>
\`\`\`

### Mutations (All Databases)

**crud.stage** - Stage a change (INSERT, UPDATE, or DELETE)
\`\`\`
<command name="crud.stage">
{
  "connectionId": "...",
  "table": "users",
  "operation": "insert",
  "document": { "name": "John", "email": "john@example.com" },
  "description": "Add new user John"
}
</command>
\`\`\`

⚠️ Mutations are STAGED, not executed immediately. The user must review and commit from the Changes panel.

### Tab Operations

**tab.update** - Update current tab content
\`\`\`
<command name="tab.update">
{
  "content": "SELECT * FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
}
</command>
\`\`\`

**tab.create** - Create new query tab
\`\`\`
<command name="tab.create">
{
  "connectionId": "...",
  "type": "query",
  "title": "User Analysis",
  "content": "SELECT COUNT(*) FROM users"
}
</command>
\`\`\`

## Important Rules

1. **Always use connectionId from context** - Look at the \`connections\` array and use the correct \`id\`
2. **Check the paradigm** - SQL commands for sql paradigm, mongodb.* for document, redis.* for keyvalue
3. **Read-only by default** - sql.execute only allows SELECT. Use crud.stage for mutations
4. **Results come back** - After a command executes, you'll see the results and can continue reasoning

## Schema Context

Below you'll find the database context with:
- All connected databases with their connectionId, type, and paradigm
- SQL: schemas, tables, views, functions
- MongoDB: collections with sample fields and indexes
- Redis: key patterns with counts and types
- If the user used @ mentions, detailed column/field info is included
`.trim();
```

**Step 2: Update AIPanel to render commands**

In `src/components/AI/AIPanel.tsx`, add imports and update message rendering:

```typescript
// Add imports
import { parseCommandsProgressive, stripCommands } from "@/utils/aiCommandParser";
import { CommandList } from "./CommandCard";
import { useAiCommandPermissionStore } from "@/stores/aiCommandPermissionStore";

// In the component, reset permissions on new conversation
const resetPermissions = useAiCommandPermissionStore((s) => s.reset);

// When creating new conversation, add:
const handleNewConversation = () => {
  resetPermissions();
  newConversation();
};

// In message rendering, update assistant messages:
{message.role === "assistant" && (
  <>
    {/* Text content with commands stripped */}
    <Streamdown
      content={stripCommands(message.content)}
      // ... existing props
    />

    {/* Command cards */}
    {(() => {
      const { complete } = parseCommandsProgressive(message.content);
      return complete.length > 0 && (
        <CommandList
          commands={complete}
          onResult={(commandId, result) => {
            // Optionally inject results back
            // For now, results are shown inline in CommandCard
          }}
        />
      );
    })()}
  </>
)}
```

**Step 3: Verify compilation**

```bash
pnpm typecheck && pnpm lint
```

**Step 4: Commit**

```bash
git add src/hooks/useAIContext.ts src/components/AI/AIPanel.tsx
git commit -m "feat(ai): integrate structured commands into AI panel

- Comprehensive system prompt with all command examples
- Parse commands progressively during streaming
- Render CommandList for commands in messages
- Reset permissions on new conversation"
```

---

## Task 8: Add Backend API Methods (If Missing)

**Files:**
- Modify: `src/services/backend.ts`

This task adds any missing Backend API methods for MongoDB and Redis operations. Check existing methods and add what's missing:

```typescript
// Add to BackendAPI object if not present:

// MongoDB
async listMongoCollections(connectionId: string, database: string): Promise<Array<{ name: string; count?: number; indexes?: string[] }>> {
  return invoke("list_mongo_collections", { connectionId, database });
}

async findMongoDocuments(
  connectionId: string,
  collection: string,
  filter: Record<string, unknown>,
  limit: number,
  projection?: Record<string, 0 | 1>,
  sort?: Record<string, 1 | -1>
): Promise<Record<string, unknown>[]> {
  return invoke("find_mongo_documents", { connectionId, collection, filter, limit, projection, sort });
}

async aggregateMongo(
  connectionId: string,
  collection: string,
  pipeline: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  return invoke("aggregate_mongo", { connectionId, collection, pipeline });
}

async countMongoDocuments(
  connectionId: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<number> {
  return invoke("count_mongo_documents", { connectionId, collection, filter });
}

// Redis
async getRedisKeyType(connectionId: string, key: string): Promise<string> {
  return invoke("redis_key_type", { connectionId, key });
}

async getRedisValue(connectionId: string, key: string): Promise<unknown> {
  return invoke("redis_get", { connectionId, key });
}

async getRedisKeyTtl(connectionId: string, key: string): Promise<number> {
  return invoke("redis_ttl", { connectionId, key });
}

async scanRedisKeys(connectionId: string, pattern: string, limit: number): Promise<string[]> {
  return invoke("redis_scan_keys", { connectionId, pattern, limit });
}

async scanRedisKeysWithCursor(
  connectionId: string,
  pattern: string,
  cursor: string,
  count: number
): Promise<{ keys: string[]; cursor: string }> {
  return invoke("redis_scan_with_cursor", { connectionId, pattern, cursor, count });
}
```

**Commit:**

```bash
git add src/services/backend.ts
git commit -m "feat(backend): add MongoDB and Redis API methods

- MongoDB: listCollections, find, aggregate, count
- Redis: getKeyType, getValue, getTtl, scanKeys"
```

---

## Task 9: Testing & Verification

**Step 1: Run all tests**

```bash
pnpm test:unit
```

**Step 2: Type check**

```bash
pnpm typecheck
```

**Step 3: Lint**

```bash
pnpm lint
```

**Step 4: Manual Testing Checklist**

1. **SQL Query Command**
   - Connect to PostgreSQL/MySQL
   - Ask AI: "Show me the top 5 users by order count"
   - Verify: Command card appears with sql.execute
   - Click "Run" and verify results display

2. **MongoDB Command**
   - Connect to MongoDB
   - Ask AI: "Find all active users"
   - Verify: mongodb.find command appears
   - Verify results as JSON

3. **Redis Command**
   - Connect to Redis
   - Ask AI: "What's in the session:* keys?"
   - Verify: redis.keys command appears

4. **CRUD Staging**
   - Ask AI: "Insert a new user named Test"
   - Verify: crud.stage command appears
   - Approve and verify it appears in CRUD panel
   - Do NOT auto-commit

5. **Allow All**
   - Get multiple commands in one response
   - Click "Allow all this conversation"
   - Verify subsequent commands auto-execute

6. **New Conversation Reset**
   - Set allow all
   - Start new conversation
   - Verify allow all is reset

**Step 5: Commit final**

```bash
git add -A
git commit -m "feat(ai): complete structured output command system

- SQL, MongoDB, Redis query commands
- CRUD staging with manual commit
- Tab and editor commands
- Permission system with allow all option
- Progressive streaming parse
- Result formatting and display"
```

---

## Summary

### Files Created
- `src/types/aiCommands.ts` - Command type definitions
- `src/utils/aiCommandParser.ts` - Progressive command parser
- `src/utils/__tests__/aiCommandParser.test.ts` - Parser tests
- `src/stores/aiCommandPermissionStore.ts` - Permission state
- `src/stores/__tests__/aiCommandPermissionStore.test.ts` - Permission tests
- `src/services/aiCommandExecutor.ts` - Command executor
- `src/components/AI/CommandCard.tsx` - Approval UI

### Files Modified
- `src/types/aiContext.ts` - Add MongoDB/Redis context types
- `src/hooks/useAIContext.ts` - Enhanced context + system prompt
- `src/services/schemaCache.ts` - MongoDB/Redis introspection
- `src/services/backend.ts` - Add missing API methods
- `src/components/AI/AIPanel.tsx` - Integrate commands

### Command Summary

| Command | Paradigm | Approval | Description |
|---------|----------|----------|-------------|
| sql.execute | SQL | Approve | Run SELECT query |
| sql.explain | SQL | Auto | Show query plan |
| mongodb.find | Document | Approve | Find documents |
| mongodb.aggregate | Document | Approve | Run aggregation |
| mongodb.count | Document | Auto | Count documents |
| redis.get | KeyValue | Auto | Get key value |
| redis.keys | KeyValue | Auto | List keys |
| redis.scan | KeyValue | Approve | Scan with cursor |
| crud.stage | Universal | Approve | Stage mutation |
| tab.update | Universal | Auto | Update tab |
| tab.create | Universal | Auto | Create tab |
| editor.insert | Universal | Auto | Insert at cursor |

### Architecture Benefits
- No MCP subprocess or IPC complexity
- Progressive streaming support
- Full user control with approval UI
- Easy to extend with new commands
- Future MCP upgrade path preserved
