# MCP Database Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move database read operations from AI command system to an MCP server, keeping mutations in the approval-based command system.

**Architecture:** MCP sidecar binary communicates with Tauri backend via IPC socket. LLM agents connect to sidecar via stdio. Sidecar exposes tools for querying databases and discovering schema.

**Tech Stack:** Rust (sidecar + Tauri bridge), MCP protocol (stdio JSON-RPC), Unix socket IPC

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Query Pilot App                             │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React)           │  Backend (Rust/Tauri)             │
│  ├── AI Panel               │  ├── ConnectionManager            │
│  ├── CommandCard (mutations)│  ├── SQL/Mongo/Redis adapters     │
│  └── ACP Service            │  ├── ACP Manager                  │
│                             │  └── MCP Bridge Server ◄────────┐ │
└─────────────────────────────┴─────────────────────────────────┼─┘
                                                                │
            ┌───────────────────────────────────────────────────┘
            │ IPC (Unix socket / named pipe)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Sidecar (Rust binary)                    │
│  ├── stdio transport (for LLM agents)                           │
│  ├── IPC client (connects to Tauri MCP Bridge)                  │
│  └── MCP Tools:                                                 │
│      • query_database - execute queries                         │
│      • list_tables - schema discovery                           │
│      • describe_table - column/field info                       │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ stdio (JSON-RPC)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│              LLM Agent (Claude Code, Codex, etc.)               │
│  Connects to MCP sidecar via mcp_servers in ACP session         │
└─────────────────────────────────────────────────────────────────┘
```

**Multi-window support:** ConnectionManager is shared across all windows. MCP Bridge has access to all connections. Each tool call includes explicit `connectionId`.

---

## MCP Tools

### Tool 1: `query_database`

Execute queries against any connected database.

```typescript
// Input
{
  connectionId: string,      // Required - target connection
  database?: string,         // Optional - override database
  schema?: string,           // Optional - override schema (PostgreSQL)
  query: string,             // Required - raw query string
  limit?: number,            // Optional - max rows (default: 100, max: 1000)
  order?: {                  // Optional - sort order
    column: string,
    direction: "asc" | "desc"
  }[],
}

// Output
{
  success: boolean,
  data?: [                   // Array of row objects (JSON)
    { id: 1, name: "Alice", email: "alice@example.com" },
    ...
  ],
  metadata: {
    columns: ["id", "name", "email"],
    rowCount: 5000,          // Total rows in result
    returned: 100,           // Rows actually returned
    truncated: true,         // Whether result was truncated
    executionTimeMs: 45,
    databaseType: "postgresql" | "mysql" | "sqlite" | "mongodb" | "redis",
  },
  error?: string,
}
```

**Query format by database type:**
- SQL: `SELECT * FROM users WHERE age > 21`
- MongoDB: `{ "collection": "users", "filter": { "age": { "$gt": 21 } } }`
- Redis: `GET user:123` or `KEYS user:*`

### Tool 2: `list_tables`

```typescript
// Input
{ connectionId: string, database?: string, schema?: string }

// Output
{
  tables: [
    { name: "users", type: "table", schema: "public" },
    { name: "orders", type: "table", schema: "public" },
    { name: "user_stats", type: "view", schema: "public" },
  ]
}
```

### Tool 3: `describe_table`

```typescript
// Input
{ connectionId: string, table: string, database?: string, schema?: string }

// Output
{
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "name", type: "varchar(255)", nullable: false },
    { name: "email", type: "varchar(255)", nullable: true },
    { name: "created_at", type: "timestamp", nullable: false },
  ],
  indexes: [...],
  foreignKeys: [...],
}
```

### Tool 4: `list_connections`

```typescript
// Input
{}

// Output
{
  connections: [
    { id: "conn-abc", name: "Production DB", dbType: "postgresql", database: "myapp" },
    { id: "conn-def", name: "Analytics", dbType: "mongodb", database: "analytics" },
  ]
}
```

---

## IPC Protocol (Sidecar ↔ Tauri)

**Socket location:** `~/.querypilot/mcp-bridge.sock` (Unix) or `\\.\pipe\querypilot-mcp-bridge` (Windows)

**Protocol:** JSON-RPC over socket

```typescript
// Request (Sidecar → Tauri)
{
  id: string,
  method: "query" | "list_tables" | "describe_table" | "list_connections",
  params: { ... }
}

// Response (Tauri → Sidecar)
{
  id: string,
  result?: { ... },
  error?: { code: number, message: string }
}
```

---

## Changes to Existing AI Command System

### Commands to REMOVE (moving to MCP):
- `sql.execute`
- `sql.explain`
- `mongodb.find`
- `mongodb.aggregate`
- `mongodb.count`
- `redis.get`
- `redis.keys`
- `redis.scan`

### Commands to KEEP (mutations/UI):
- `crud.stage`
- `tab.update`
- `tab.create`
- `editor.insert`

---

## Files to Create

### Rust - MCP Bridge (src-tauri/)

| File | Purpose |
|------|--------|
| `src/mcp/mod.rs` | MCP module entry |
| `src/mcp/bridge.rs` | IPC server, listens on socket |
| `src/mcp/handlers.rs` | Implements query, list_tables, describe_table |

### Rust - MCP Sidecar (new crate)

```
src-mcp-sidecar/
├── Cargo.toml
├── src/
│   ├── main.rs           # Entry point, stdio MCP server
│   ├── ipc_client.rs     # Connects to Tauri bridge socket
│   ├── tools/
│   │   ├── mod.rs
│   │   ├── query.rs      # query_database tool
│   │   ├── list.rs       # list_tables tool
│   │   └── describe.rs   # describe_table tool
│   └── types.rs          # Shared types
```

### Frontend Changes

| File | Change |
|------|--------|
| `src/types/aiCommands.ts` | Remove read command types |
| `src/utils/aiCommandParser.ts` | Simplify - fewer commands |
| `src/services/aiCommandExecutor.ts` | Remove read executors |
| `src/stores/acpStore.ts` | Add MCP server config to session |

---

## Startup Flow

```
1. Query Pilot launches
2. Tauri backend initializes
   ├── ConnectionManager ready
   └── MCP Bridge starts (creates socket)
3. MCP Sidecar spawns (Tauri sidecar)
   ├── Connects to bridge socket
   └── Starts stdio MCP server
4. User opens AI Panel, selects agent
5. ACP session created with mcp_servers:
   └── { "name": "querypilot", "command": "<sidecar>", "args": [] }
6. LLM connects to sidecar, can call tools
```

---

## Implementation Tasks

### Phase 1: MCP Bridge in Tauri

1. Create `src-tauri/src/mcp/mod.rs` module structure
2. Implement socket server in `bridge.rs`
3. Implement `list_connections` handler
4. Implement `query` handler (reuse existing query logic)
5. Implement `list_tables` handler
6. Implement `describe_table` handler
7. Start bridge on app launch
8. Add tests for handlers

### Phase 2: MCP Sidecar Binary

1. Create `src-mcp-sidecar` crate in workspace
2. Implement IPC client (socket connection)
3. Implement MCP stdio server (use `mcp-server` crate or similar)
4. Implement `query_database` tool
5. Implement `list_tables` tool
6. Implement `describe_table` tool
7. Implement `list_connections` tool
8. Add to `tauri.conf.json` as external binary
9. Test sidecar standalone

### Phase 3: Frontend Integration

1. Update `acpStore.ts` to include MCP server in session config
2. Update `acpService.ts` to pass sidecar path
3. Remove read commands from `aiCommands.ts`
4. Remove read executors from `aiCommandExecutor.ts`
5. Simplify `CommandCard.tsx` for mutations only
6. Update tests

### Phase 4: Testing & Polish

1. End-to-end test: LLM → MCP → query → result
2. Test multi-window scenarios
3. Test error handling (connection lost, invalid query, etc.)
4. Test sidecar restart on crash
5. Update documentation

---

## Verification

1. `cargo clippy` in src-tauri/ and src-mcp-sidecar/
2. `pnpm lint && pnpm typecheck` for frontend
3. `pnpm test:unit` for frontend tests
4. Manual test: Ask LLM "show me the largest tables" → should use MCP tools
