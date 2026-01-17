# AI Architecture Phase 1: Implementation Plan

**Date:** 2026-01-17
**Status:** Ready for Execution
**Parent:** [AI Architecture Improvements Design](./2026-01-17-ai-architecture-improvements.md)
**Approach:** Test-driven development - write tests first, then implement

---

## Overview

This plan breaks down Phase 1 (Foundation) into executable tasks with specific file paths, implementation steps, and verification commands.

**Execution Order:**
1. Rust Backend (ai commands) - foundation for sidecar
2. Sidecar Infrastructure (base tool, circuit breaker) - shared utilities
3. Tool Registry - uses base tool + ai commands
4. Provider Registry - independent, can parallelize
5. Schema Cache - uses tool registry

---

## Task 1: Rust `ai_get_capabilities` Command

**Goal:** Expose adapter capabilities to the sidecar via a new Tauri command.

**Files to create/modify:**
- `src-tauri/src/commands/ai.rs` (new)
- `src-tauri/src/commands/mod.rs` (add module)
- `src-tauri/src/lib.rs` (register command)

### Step 1.1: Create ai.rs with types and ai_get_capabilities

Create the new command file with capability result types.

```rust
// src-tauri/src/commands/ai.rs
use crate::core::manager::ConnectionManager;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct CapabilityResult {
    pub kind: String,
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub fallback_tools: Vec<String>,
}

#[tauri::command]
pub async fn ai_get_capabilities(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<CapabilityResult, String> {
    // Implementation
}
```

### Step 1.2: Write tests for ai_get_capabilities

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capability_result_serialization() {
        // Test that CapabilityResult serializes correctly
    }

    #[tokio::test]
    async fn test_ai_get_capabilities_unknown_connection() {
        // Should return error with fallback tools
    }
}
```

### Step 1.3: Register command in mod.rs and lib.rs

**Verification:**
```bash
cd src-tauri && cargo test ai:: --lib
cd src-tauri && cargo build
```

---

## Task 2: Rust `ai_sql_execute` Command

**Goal:** Security wrapper for read-only SQL introspection operations.

**Files to modify:**
- `src-tauri/src/commands/ai.rs`

### Step 2.1: Define SqlIntrospectionOp enum

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SqlIntrospectionOp {
    ListSchemas,
    ListTables { schema: String },
    GetTableStructure { schema: String, table: String },
    GetIndexes { schema: String, table: String },
    GetForeignKeys { schema: String, table: String },
    GetViews { schema: String },
    GetFunctions { schema: String },
    ExplainQuery { sql: String },
}
```

### Step 2.2: Write tests first

```rust
#[tokio::test]
async fn test_ai_sql_execute_list_tables() {
    // Test with mock connection
}

#[tokio::test]
async fn test_ai_sql_execute_rejects_mutations() {
    // Ensure INSERT/UPDATE/DELETE are rejected
}
```

### Step 2.3: Implement ai_sql_execute

**Verification:**
```bash
cd src-tauri && cargo test ai_sql --lib
```

---

## Task 3: Rust `ai_document_execute` Command

**Goal:** Security wrapper for read-only MongoDB operations.

**Files to modify:**
- `src-tauri/src/commands/ai.rs`

### Step 3.1: Define allowlist constant

```rust
const AI_DOCUMENT_ALLOWLIST: &[&str] = &[
    "Find", "Aggregate", "Count", "ListCollections", "Sample", "ListDatabases"
];
```

### Step 3.2: Write tests first

```rust
#[tokio::test]
async fn test_ai_document_execute_allows_find() {
    // Should allow Find operation
}

#[tokio::test]
async fn test_ai_document_execute_blocks_insert() {
    // Should reject Insert operation
}
```

### Step 3.3: Implement ai_document_execute

**Verification:**
```bash
cd src-tauri && cargo test ai_document --lib
```

---

## Task 4: Rust `ai_keyvalue_execute` Command

**Goal:** Security wrapper for read-only Redis operations.

**Files to modify:**
- `src-tauri/src/commands/ai.rs`

### Step 4.1: Define allowlist constant

```rust
const AI_KEYVALUE_ALLOWLIST: &[&str] = &[
    "Get", "Scan", "Type", "Ttl", "DbSize", "ServerInfo",
    "HashGetAll", "ListRange", "SetMembers", "ZSetRange", "StreamRange"
];
```

### Step 4.2: Write tests first

```rust
#[tokio::test]
async fn test_ai_keyvalue_execute_allows_scan() {
    // Should allow Scan operation
}

#[tokio::test]
async fn test_ai_keyvalue_execute_blocks_set() {
    // Should reject Set operation
}
```

### Step 4.3: Implement ai_keyvalue_execute

**Verification:**
```bash
cd src-tauri && cargo test ai_keyvalue --lib
cargo test --lib  # Run all tests
```

---

## Task 5: Sidecar Circuit Breaker

**Goal:** Prevent runaway tool calls in agentic loops.

**Files to create:**
- `src-tauri/sidecar-ai/utils/circuit-breaker.ts` (new)
- `src-tauri/sidecar-ai/utils/circuit-breaker.test.ts` (new)

### Step 5.1: Write tests first

```typescript
// circuit-breaker.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { checkTurnLimit, recordToolCall, resetTurn } from "./circuit-breaker";

describe("circuit-breaker", () => {
  beforeEach(() => {
    resetTurn("test-conv");
  });

  it("should allow first tool call", () => {
    const result = checkTurnLimit("test-conv", "list_tables");
    expect(result.allowed).toBe(true);
  });

  it("should block after 15 tool calls", () => {
    for (let i = 0; i < 15; i++) {
      recordToolCall("test-conv", "tool", true);
    }
    const result = checkTurnLimit("test-conv", "tool");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("15 max");
  });

  it("should block after 3 consecutive errors", () => {
    recordToolCall("test-conv", "tool", false);
    recordToolCall("test-conv", "tool", false);
    recordToolCall("test-conv", "tool", false);
    const result = checkTurnLimit("test-conv", "tool");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("consecutive");
  });

  it("should block repeated same tool calls", () => {
    for (let i = 0; i < 5; i++) {
      recordToolCall("test-conv", "list_tables", true);
    }
    const result = checkTurnLimit("test-conv", "list_tables");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("too many times");
  });

  it("should reset error count on success", () => {
    recordToolCall("test-conv", "tool", false);
    recordToolCall("test-conv", "tool", false);
    recordToolCall("test-conv", "tool", true);  // Success resets
    recordToolCall("test-conv", "tool", false);
    const result = checkTurnLimit("test-conv", "tool");
    expect(result.allowed).toBe(true);  // Only 1 consecutive error
  });
});
```

### Step 5.2: Implement circuit-breaker.ts

Implement the circuit breaker as specified in the design doc (lines 940-1017).

### Step 5.3: Export from utils/index.ts

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test circuit-breaker
```

---

## Task 6: Sidecar Base Tool Class

**Goal:** Reduce tool definition boilerplate with a declarative base class.

**Files to create:**
- `src-tauri/sidecar-ai/tools/base.ts` (new)
- `src-tauri/sidecar-ai/tools/base.test.ts` (new)
- `src-tauri/sidecar-ai/tools/types.ts` (new)

### Step 6.1: Define tool types

```typescript
// tools/types.ts
export interface ToolDefinition<TInput, TOutput> {
  name: string;
  friendlyName: string;
  description: string;
  category: string;
  icon?: string;
  capabilities: ("sql" | "document" | "keyvalue")[];
  parameters: Record<string, ParameterDef>;
  messages: {
    pending: (input: TInput) => string;
    success: (input: TInput, output: TOutput) => string;
    error: (input: TInput, err: Error) => string;
  };
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

export interface ToolContext {
  connectionId: string;
  conversationId: string;
  cache: MetadataCache;
  tauri: TauriClient;
}

export interface ParameterDef {
  type: "string" | "number" | "boolean" | "object";
  required?: boolean;
  default?: unknown;
  description?: string;
}
```

### Step 6.2: Write tests for defineTool

```typescript
// base.test.ts
import { describe, it, expect } from "bun:test";
import { defineTool, createZodSchema } from "./base";

describe("defineTool", () => {
  it("should create a tool with correct metadata", () => {
    const tool = defineTool({
      name: "test_tool",
      friendlyName: "Test Tool",
      description: "A test tool",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        connectionId: { type: "string", required: true },
        limit: { type: "number", default: 10 },
      },
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => e.message,
      },
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.name).toBe("test_tool");
    expect(tool.capabilities).toContain("sql");
  });

  it("should generate valid Zod schema from parameters", () => {
    const schema = createZodSchema({
      connectionId: { type: "string", required: true },
      limit: { type: "number", default: 10 },
    });

    const valid = schema.safeParse({ connectionId: "abc" });
    expect(valid.success).toBe(true);

    const invalid = schema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});
```

### Step 6.3: Implement base.ts with defineTool and Zod schema generation

### Step 6.4: Integrate circuit breaker into base tool execution

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test base
```

---

## Task 7: Tool Registry

**Goal:** Auto-load tools and filter by capabilities.

**Files to create:**
- `src-tauri/sidecar-ai/tools/registry.ts` (new)
- `src-tauri/sidecar-ai/tools/registry.test.ts` (new)

### Step 7.1: Write tests first

```typescript
// registry.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { ToolRegistry } from "./registry";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should register a tool", () => {
    registry.register(mockTool);
    expect(registry.get("mock_tool")).toBeDefined();
  });

  it("should filter tools by capabilities", () => {
    registry.register(sqlTool);
    registry.register(documentTool);

    const sqlTools = registry.getForCapabilities(["sql"]);
    expect(sqlTools).toHaveLength(1);
    expect(sqlTools[0].name).toBe("sql_tool");
  });

  it("should return all tools", () => {
    registry.register(sqlTool);
    registry.register(documentTool);
    expect(registry.getAll()).toHaveLength(2);
  });
});
```

### Step 7.2: Implement registry.ts

```typescript
// registry.ts
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getForCapabilities(caps: string[]): Tool[];
  async getToolsForConnection(connectionId: string): Promise<Tool[]>;
}
```

### Step 7.3: Implement getToolsForConnection with capability fetching

Uses `ai_get_capabilities` Tauri command and applies fallback logic.

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test registry
```

---

## Task 8: Migrate list_tables Tool

**Goal:** Convert first existing tool to new registry pattern as proof of concept.

**Files to create/modify:**
- `src-tauri/sidecar-ai/tools/sql/list-tables.ts` (new)
- `src-tauri/sidecar-ai/tools/sql/list-tables.test.ts` (new)
- `src-tauri/sidecar-ai/tools/sql/index.ts` (new)

### Step 8.1: Write tests for list-tables

```typescript
// list-tables.test.ts
import { describe, it, expect, mock } from "bun:test";
import listTablesTool from "./list-tables";

describe("list_tables tool", () => {
  it("should have correct metadata", () => {
    expect(listTablesTool.name).toBe("list_tables");
    expect(listTablesTool.capabilities).toContain("sql");
  });

  it("should generate pending message", () => {
    const msg = listTablesTool.messages.pending({ schema: "public" });
    expect(msg).toContain("public");
  });

  it("should execute via ai_sql_execute", async () => {
    const mockCtx = {
      tauri: {
        invoke: mock(() => Promise.resolve([{ name: "users" }])),
      },
    };

    const result = await listTablesTool.execute(
      { connectionId: "conn1", schema: "public" },
      mockCtx
    );

    expect(result).toHaveLength(1);
  });
});
```

### Step 8.2: Implement list-tables.ts

```typescript
// tools/sql/list-tables.ts
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
    return ctx.tauri.invoke("ai_sql_execute", {
      connId: connectionId,
      operation: { type: "list_tables", schema },
    });
  },
});
```

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test list-tables
```

---

## Task 9: Provider Registry with Tiered Fallback

**Goal:** Centralize provider configuration with automatic fallback.

**Files to create/modify:**
- `src-tauri/sidecar-ai/config/providers.ts` (refactor)
- `src-tauri/sidecar-ai/services/provider.service.ts` (refactor)
- `src-tauri/sidecar-ai/services/provider.service.test.ts` (new)

### Step 9.1: Write tests first

```typescript
// provider.service.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ProviderService } from "./provider.service";

describe("ProviderService", () => {
  beforeEach(() => {
    ProviderService.clearCache();
  });

  it("should return provider by name", async () => {
    const provider = await ProviderService.getProvider("openai");
    expect(provider).toBeDefined();
  });

  it("should fallback when primary fails", async () => {
    // Mock OAuth failure
    const provider = await ProviderService.getProvider("claudeCode");
    // Should fall back to openai or anthropic
  });

  it("should cache provider instances", async () => {
    const p1 = await ProviderService.getProvider("openai");
    const p2 = await ProviderService.getProvider("openai");
    expect(p1).toBe(p2);
  });

  it("should list available providers", () => {
    const providers = ProviderService.listProviders();
    expect(providers.length).toBeGreaterThan(0);
  });
});
```

### Step 9.2: Refactor providers.ts with tier information

```typescript
// config/providers.ts
export const providers = {
  openai: {
    tier: 1,
    name: "OpenAI",
    // ...
  },
  claudeCode: {
    tier: 2,
    experimental: true,
    fallback: "anthropic",
    // ...
  },
  ollama: {
    tier: 3,
    requiresApiKey: false,
    // ...
  },
} as const;
```

### Step 9.3: Implement fallback logic in ProviderService

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test provider.service
```

---

## Task 10: Schema Cache with Paradigm-Aware Preloading

**Goal:** Implement adaptive preloading based on database type.

**Files to modify:**
- `src-tauri/sidecar-ai/services/schema-cache.ts` (new or refactor)
- `src-tauri/sidecar-ai/services/schema-cache.test.ts` (new)

### Step 10.1: Write tests first

```typescript
// schema-cache.test.ts
import { describe, it, expect } from "bun:test";
import { SchemaCache, getPreloadStrategy } from "./schema-cache";

describe("SchemaCache", () => {
  it("should cache and retrieve values", () => {
    const cache = new SchemaCache();
    cache.set("key", { data: "value" }, { ttl: 60000 });
    expect(cache.get("key")).toEqual({ data: "value" });
  });

  it("should expire values after TTL", async () => {
    const cache = new SchemaCache();
    cache.set("key", { data: "value" }, { ttl: 10 });
    await new Promise(r => setTimeout(r, 20));
    expect(cache.get("key")).toBeUndefined();
  });

  it("should respect per-connection limits", () => {
    const cache = new SchemaCache({ maxEntriesPerConnection: 2 });
    cache.set("conn1:a", "a");
    cache.set("conn1:b", "b");
    cache.set("conn1:c", "c");  // Should evict oldest
    expect(cache.get("conn1:a")).toBeUndefined();
  });
});

describe("getPreloadStrategy", () => {
  it("should return sql strategy for sql kind", () => {
    const strategy = getPreloadStrategy("sql");
    expect(strategy.maxPreload).toBe(10);
  });

  it("should return document strategy for document kind", () => {
    const strategy = getPreloadStrategy("document");
    expect(strategy.maxPreload).toBe(5);
  });

  it("should return keyvalue strategy with no preload", () => {
    const strategy = getPreloadStrategy("keyvalue");
    expect(strategy.maxPreload).toBe(0);
  });

  it("should prioritize common table names for sql", () => {
    const strategy = getPreloadStrategy("sql");
    const tables = ["logs", "users", "metrics", "orders"];
    const prioritized = strategy.prioritize(tables);
    expect(prioritized[0]).toBe("users");
    expect(prioritized[1]).toBe("orders");
  });
});
```

### Step 10.2: Implement SchemaCache class

### Step 10.3: Implement preloadForConnection function

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test schema-cache
```

---

## Task 11: HTTP Server Integration

**Goal:** Wire up new tool registry to existing HTTP routes.

**Files to modify:**
- `src-tauri/sidecar-ai/routes/chat.ts`
- `src-tauri/sidecar-ai/index.ts`

### Step 11.1: Update chat.ts to use tool registry

Replace hardcoded tools import with registry lookup:

```typescript
// Before
import { tools } from "../tools";

// After
import { registry } from "../tools/registry";

// In handler
const tools = await registry.getToolsForConnection(context.connectionId);
```

### Step 11.2: Initialize registry on startup

### Step 11.3: Add /tools endpoint for debugging

**Verification:**
```bash
cd src-tauri/sidecar-ai && bun test
make dev-sidecar  # Manual test
```

---

## Task 12: Integration Testing

**Goal:** End-to-end verification that all components work together.

### Step 12.1: Run all sidecar tests

```bash
cd src-tauri/sidecar-ai && bun test
```

### Step 12.2: Run all Rust tests

```bash
cd src-tauri && cargo test
```

### Step 12.3: Run full test suite

```bash
make test
```

### Step 12.4: Manual smoke test

```bash
make dev  # Start app
# Connect to PostgreSQL
# Open AI chat
# Ask "List all tables"
# Verify tool is called via new registry
```

---

## Verification Checklist

After completing all tasks:

- [ ] `cargo test ai::` passes (Rust AI commands)
- [ ] `bun test` passes in sidecar-ai (all sidecar tests)
- [ ] `make test` passes (full suite)
- [ ] Circuit breaker blocks after 15 calls
- [ ] Tool registry filters by capabilities
- [ ] list_tables tool works via new pattern
- [ ] Provider fallback works when primary unavailable
- [ ] Schema cache respects paradigm-specific limits

---

## Dependencies

```
Task 1 (ai_get_capabilities) ─┬─► Task 7 (Registry) ─► Task 8 (list_tables)
Task 2 (ai_sql_execute) ──────┘                        │
Task 3 (ai_document_execute) ─────────────────────────►│
Task 4 (ai_keyvalue_execute) ─────────────────────────►│
                                                       │
Task 5 (Circuit Breaker) ─► Task 6 (Base Tool) ────────┘

Task 9 (Provider Registry) ─────────────────► Task 11 (Integration)
Task 10 (Schema Cache) ─────────────────────► Task 11 (Integration)
```

**Parallelizable:**
- Tasks 1-4 (Rust commands) can run in parallel
- Task 5 (Circuit Breaker) is independent
- Task 9 (Provider Registry) is independent
- Task 10 (Schema Cache) is independent

**Sequential:**
- Task 6 depends on Task 5
- Task 7 depends on Tasks 1-4 and Task 6
- Task 8 depends on Task 7
- Task 11 depends on Tasks 7-10
- Task 12 depends on Task 11
