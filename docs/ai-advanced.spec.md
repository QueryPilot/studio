# AI Advanced Capabilities Specification

**Status**: Draft
**Last Updated**: 2025-11-01
**Author**: AI Architecture Team

## Table of Contents

1. [Overview](#overview)
2. [Current Implementation Analysis](#current-implementation-analysis)
3. [AI Mode Architecture](#ai-mode-architecture)
4. [Mode 1: Chat Mode (cmd+l)](#mode-1-chat-mode-cmdl)
5. [Mode 2: Agent Mode (cmd+i)](#mode-2-agent-mode-cmdi)
6. [Mode 3: Inline Query Editor Mode (cmd+k)](#mode-3-inline-query-editor-mode-cmdk)
7. [Mode 4: Schema Diff Assistant](#mode-4-schema-diff-assistant)
8. [Mode 5: Query Optimization Advisor](#mode-5-query-optimization-advisor)
9. [Mode 6: Natural Language to SQL](#mode-6-natural-language-to-sql)
10. [Implementation Roadmap](#implementation-roadmap)
11. [Technical Architecture](#technical-architecture)
12. [Security Considerations](#security-considerations)

---

## Overview

This specification outlines the advanced AI capabilities for DevDB Studio, transforming it from a simple chat tool into a comprehensive AI-powered database IDE with multiple specialized modes for different workflows.

### Goals

- **Multiple AI Modes**: Support different interaction patterns (chat, agent, inline editing)
- **Database-Aware**: Deep integration with database schema, queries, and operations
- **UI Control**: Allow AI to interact with the application UI via command pattern
- **Safety First**: Read-only by default, explicit confirmation for destructive operations
- **UX Excellence**: Seamless integration with existing workflows (CodeMirror, workbench, etc.)

---

## Current Implementation Analysis

### What Exists Today

#### AI Sidecar (Bun HTTP Server)
```
Location: src-tauri/sidecar-ai/
Technology: Bun + Vercel AI SDK v5
Port: 47856 (FIXED PORT - must match frontend constant)
```

**Current Features**:
- ✅ Multi-provider support (OpenAI, Anthropic, Google, Ollama)
- ✅ 13 database tools implemented (2 are placeholders, rest working):

**Working Tools (11):**
  - `list_tables` ✅ - Get all tables in schema
  - `get_table_structure` ✅ - Column definitions and constraints
  - `get_indexes` ✅ - Table indexes
  - `get_triggers` ✅ - Table triggers
  - `get_foreign_keys` ✅ - Foreign key relationships (via get_constraints)
  - `get_table_statistics` ✅ - Row counts and sizes
  - `get_views` ✅ - Database views
  - `get_functions` ✅ - Stored procedures
  - `list_schemas` ✅ - All schemas
  - `get_object_definition` ✅ - SQL definitions

**Placeholder Tools (2):**
  - `get_sample_data` ⚠️ - Returns "Would execute" message only
  - `execute_readonly_query` ⚠️ - Returns "Would execute" message only

- ✅ Streaming responses via AI SDK's `streamText()`
- ✅ Connection context (connectionId, database, schema) passed via headers
- ✅ Tool execution via HTTP proxy to Tauri backend (port 14420)
- ✅ MAX_TOOL_STEPS = 25 (prevents infinite loops)

**Current Limitations**:
- ❌ Only simple chat interface (no modes)
- ❌ No UI control capabilities
- ❌ `get_sample_data` and `execute_readonly_query` are NOT functional (placeholders)
- ❌ No inline editing integration
- ❌ No query plan analysis
- ❌ No schema diffing
- ❌ No optimization suggestions
- ❌ Chat messages NOT persisted (lost on refresh)
- ❌ No message copy/retry functionality
- ❌ @mention autocomplete bypasses sidecar (calls Tauri directly - inconsistent pattern)

#### Frontend AI Assistant
```
Location: src/components/AIAssistant/
Technology: React 19 + @ai-sdk/react
```

**Current Features**:
- ✅ `AIAssistantSidebar` - Chat UI with streaming messages
- ✅ `ModelSelector` - Switch between providers/models
- ✅ `@mention` autocomplete for tables/views
- ✅ Tool call visualization (`ToolCallDisplay`)
- ✅ Markdown rendering for assistant responses
- ✅ Auto-scroll and message history
- ✅ Provider configuration via Preferences

**Current Limitations**:
- ❌ Single chat mode only
- ❌ Limited keyboard shortcuts:
  - ⚠️ `cmd+l` is ALREADY MAPPED to `workbench.action.toggleRightSidebar` (CONFLICT!)
  - ❌ No `cmd+i` (agent mode)
  - ❌ No `cmd+k` (inline editor mode)
- ❌ No inline editor integration
- ❌ No UI command execution
- ❌ No multi-turn agent workflows
- ❌ @mention autocomplete calls `invoke("get_tables")` directly instead of using context from chat

#### Backend Infrastructure
```
Location: src-tauri/src/http_server.rs
Technology: Axum HTTP server
Port: 14420
```

**Current Features**:
- ✅ HTTP proxy for Tauri commands
- ✅ Supports 8 database commands:
  - `get_tables`
  - `get_columns`
  - `get_constraints`
  - `get_indexes`
  - `get_schemas`
  - `get_views`
  - `get_table_count`
  - `get_functions` (missing from proxy)
  - `get_object_definition` (missing from proxy)
- ✅ Connection retry logic
- ✅ Error handling with proper HTTP status codes

**Current Limitations**:
- ❌ Missing proxy for `get_functions` and `get_object_definition`
- ❌ No query execution support
- ❌ No UI command endpoint
- ❌ No query plan analysis endpoint

---

## AI Mode Architecture

### Mode State Management

Each AI mode will have its own state and UI treatment:

```typescript
// New AI mode types
export type AIModeType =
  | 'chat'           // cmd+l - Conversational database exploration
  | 'agent'          // cmd+i - Autonomous UI control and analysis
  | 'inline-query'   // cmd+k - Inline query editor assistance
  | 'schema-diff'    // Schema comparison and migration
  | 'query-optimize' // Query optimization suggestions
  | 'nl-to-sql';     // Natural language to SQL generation

export interface AIModeState {
  currentMode: AIModeType;
  isActive: boolean;
  context: {
    connectionId?: string;
    database?: string;
    schema?: string;
    tableName?: string;
    selectedQuery?: string;
    cursorPosition?: { line: number; column: number };
    activePanel?: string;
  };
}
```

### Mode Switching

Users can switch modes via:
1. **Keyboard shortcuts** (cmd+l, cmd+i, cmd+k)
2. **Command palette** (existing CommandPalette component)
3. **Mode selector** in AI sidebar header

---

## Mode 1: Chat Mode (cmd+shift+l)

### Description

Enhanced conversational interface for exploring databases, asking questions, and getting insights. This is the **default mode** and extends the current implementation.

### User Experience

**Trigger**:
- Press `cmd+shift+l` (or `ctrl+shift+l` on Windows/Linux) from anywhere in the app
  - **Note**: `cmd+l` is already used for toggling right sidebar, so we use `cmd+shift+l`
- Click "Chat" mode in AI sidebar

**Behavior**:
- Opens AI sidebar if closed
- Focuses chat input
- Shows chat history
- Displays database context (connection, schema, table)

### Enhanced Capabilities

#### 1. Expanded Tool Suite

**New Tools to Add**:

```typescript
// Execute read-only queries with actual results
export const execute_readonly_query = tool({
  description: "Execute a read-only SQL query (SELECT only) and return actual results",
  parameters: z.object({
    connectionId: z.string(),
    sql: z.string().describe("SELECT query to execute"),
    limit: z.number().optional().default(100),
  }),
  execute: async ({ connectionId, sql, limit }) => {
    // Validate SELECT only
    if (!sql.trim().toLowerCase().startsWith('select')) {
      return { success: false, error: "Only SELECT queries allowed" };
    }

    // Call Tauri stream_query command
    const result = await callTauri("stream_query", {
      conn_id: connectionId,
      sql: sql.includes('LIMIT') ? sql : `${sql} LIMIT ${limit}`,
    });

    return {
      success: true,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      executionTime: result.execution_time,
    };
  },
});

// Get sample data with actual rows
export const get_sample_data = tool({
  description: "Get sample rows from a table to understand data patterns",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    table: z.string(),
    limit: z.number().optional().default(10),
  }),
  execute: async ({ connectionId, schema, table, limit }) => {
    const sql = `SELECT * FROM "${schema}"."${table}" LIMIT ${Math.min(limit, 100)}`;

    const result = await callTauri("stream_query", {
      conn_id: connectionId,
      sql,
    });

    return {
      success: true,
      table,
      schema,
      columns: result.columns,
      rows: result.rows,
      sampleSize: result.rows.length,
    };
  },
});

// Analyze query performance
export const explain_query = tool({
  description: "Analyze query execution plan to understand performance",
  parameters: z.object({
    connectionId: z.string(),
    sql: z.string().describe("Query to analyze"),
    analyze: z.boolean().optional().default(false).describe("Run EXPLAIN ANALYZE (actually executes)"),
  }),
  execute: async ({ connectionId, sql, analyze }) => {
    const explainSql = analyze
      ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
      : `EXPLAIN (FORMAT JSON) ${sql}`;

    const result = await callTauri("stream_query", {
      conn_id: connectionId,
      sql: explainSql,
    });

    // Parse JSON plan
    const plan = JSON.parse(result.rows[0][0]);

    return {
      success: true,
      plan,
      estimatedCost: plan[0]?.Plan?.['Total Cost'],
      estimatedRows: plan[0]?.Plan?.['Plan Rows'],
      actualTime: analyze ? plan[0]?.Plan?.['Actual Total Time'] : undefined,
    };
  },
});

// Search across tables
export const search_database = tool({
  description: "Search for a value across all tables in a schema",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    searchTerm: z.string().describe("Value to search for"),
    dataTypes: z.array(z.string()).optional().describe("Limit to specific data types"),
  }),
  execute: async ({ connectionId, schema, searchTerm, dataTypes }) => {
    // Implementation would:
    // 1. Get all tables in schema
    // 2. For each table, get columns matching dataTypes
    // 3. Generate and execute SELECT queries with WHERE clauses
    // 4. Return tables and columns where value was found

    return {
      success: true,
      matches: [
        { table: "users", column: "email", count: 3 },
        { table: "logs", column: "user_id", count: 1247 },
      ],
    };
  },
});

// Get table dependencies
export const get_table_dependencies = tool({
  description: "Find all tables that reference or are referenced by a table",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    table: z.string(),
  }),
  execute: async ({ connectionId, schema, table }) => {
    // Query information_schema for foreign key relationships
    return {
      success: true,
      referencedBy: [], // Tables that reference this table
      references: [],   // Tables this table references
      dependencyGraph: {}, // Full dependency tree
    };
  },
});

// Get index recommendations
export const suggest_indexes = tool({
  description: "Suggest indexes based on query patterns or table structure",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    table: z.string().optional(),
    query: z.string().optional(),
  }),
  execute: async ({ connectionId, schema, table, query }) => {
    // Analyze:
    // - Missing indexes on foreign keys
    // - Columns frequently in WHERE/JOIN clauses
    // - Query plan showing sequential scans

    return {
      success: true,
      recommendations: [
        {
          type: "btree",
          columns: ["user_id", "created_at"],
          reason: "Frequent filtering on these columns",
          estimatedImpact: "50-70% query time reduction",
        },
      ],
    };
  },
});
```

#### 2. Context-Aware Conversations

**System Prompt Enhancement**:

```typescript
const systemPrompt = `You are an expert database assistant for DevDB Studio.

Current Context:
- Connection: ${connectionId}
- Database: ${database}
- Schema: ${schema}
${tableName ? `- Active Table: ${tableName}` : ''}
${selectedQuery ? `- Selected Query:\n${selectedQuery}` : ''}

Your capabilities:
1. Explore database schema (tables, views, functions)
2. Execute SELECT queries to analyze data
3. Explain query performance with EXPLAIN plans
4. Search across tables for specific values
5. Suggest optimizations and indexes
6. Identify table relationships and dependencies

Important Rules:
- You can ONLY execute SELECT queries (read-only)
- Always use LIMIT for large tables (default: 100 rows)
- Use EXPLAIN to analyze query performance before optimizing
- Suggest indexes but DO NOT create them (read-only mode)
- When showing data, format as markdown tables for readability
- If unsure, ask clarifying questions before executing queries

Interaction Style:
- Be concise but thorough
- Explain technical concepts clearly
- Show query results in formatted tables
- Provide actionable recommendations
- Reference table/column names with backticks

Remember: You are in CHAT mode (read-only). You can explore and analyze, but cannot modify the database.`;
```

#### 3. Enhanced UI Components

**Chat Message Enhancements**:

```typescript
// New component: QueryResultDisplay
export function QueryResultDisplay({ result }: { result: QueryResult }) {
  return (
    <div className="not-prose my-2">
      {/* Column headers */}
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full divide-y divide-border text-xs">
          <thead className="bg-muted/50">
            <tr>
              {result.columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {result.rows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/30">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 font-mono">
                    {formatCellValue(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Metadata */}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{result.rowCount} rows</span>
        <span>•</span>
        <span>{result.executionTime}ms</span>
        {result.limited && <Badge variant="outline">Limited</Badge>}
      </div>
    </div>
  );
}

// New component: ExplainPlanVisualization
export function ExplainPlanVisualization({ plan }: { plan: QueryPlan }) {
  return (
    <div className="not-prose my-2 rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-semibold">Query Plan</div>
      <div className="space-y-1 text-xs font-mono">
        <div>
          <span className="text-muted-foreground">Cost:</span>{" "}
          <span className="font-semibold">{plan.estimatedCost}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Estimated Rows:</span>{" "}
          <span>{plan.estimatedRows}</span>
        </div>
        {plan.actualTime && (
          <div>
            <span className="text-muted-foreground">Actual Time:</span>{" "}
            <span className="font-semibold">{plan.actualTime}ms</span>
          </div>
        )}
      </div>

      {/* Tree visualization of plan nodes */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-primary">
          View detailed plan
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto text-[10px]">
          {JSON.stringify(plan.plan, null, 2)}
        </pre>
      </details>
    </div>
  );
}
```

### Implementation Tasks

**Sidecar Changes** (`src-tauri/sidecar-ai/`):
1. ✅ Add `execute_readonly_query` tool with actual query execution
2. ✅ Add `explain_query` tool for performance analysis
3. ✅ Add `search_database` tool for cross-table search
4. ✅ Add `get_table_dependencies` tool for relationship mapping
5. ✅ Add `suggest_indexes` tool for optimization recommendations
6. ✅ Update `get_sample_data` to return actual rows
7. ✅ Enhance system prompt with context awareness

**Backend Changes** (`src-tauri/src/http_server.rs`):
1. ✅ Add missing proxies for `get_functions` and `get_object_definition`
2. ✅ Add `stream_query` proxy endpoint
3. ✅ Add query validation (ensure SELECT only for chat mode)
4. ✅ Add query timeout configuration

**Frontend Changes** (`src/components/AIAssistant/`):
1. ✅ Create `QueryResultDisplay` component
2. ✅ Create `ExplainPlanVisualization` component
3. ✅ Add keyboard shortcut handler for `cmd+l`
4. ✅ Add mode indicator in sidebar header
5. ✅ Update `ToolCallDisplay` to handle new tool types
6. ✅ Add query execution metadata display

---

## Mode 2: Agent Mode (cmd+i)

### Description

Autonomous agent that can analyze databases, propose changes, and **control the UI** via command pattern. This mode is more powerful than chat mode and can interact with the application itself.

### User Experience

**Trigger**:
- Press `cmd+i` from anywhere in the app
- Click "Agent" mode in AI sidebar

**Behavior**:
- Opens modal overlay with agent interface (similar to Cursor's composer)
- Shows agent thinking process and steps
- Displays UI commands being executed
- Requires user confirmation before executing destructive operations

### UI Control via Command Pattern

#### Command Architecture

```typescript
// New file: src/types/aiCommands.ts

export type AICommand =
  | OpenTableCommand
  | OpenQueryCommand
  | SplitPanelCommand
  | FocusPanelCommand
  | CreateTabCommand
  | CloseTabCommand
  | ShowDataCommand
  | ShowStructureCommand
  | ShowIndexesCommand
  | ShowTriggersCommand
  | NavigateToLineCommand
  | HighlightCodeCommand
  | InsertTextCommand
  | ReplaceTextCommand
  | OpenERDCommand
  | CompareTablesCommand;

export interface OpenTableCommand {
  type: 'open_table';
  schema: string;
  table: string;
  view: 'data' | 'structure' | 'indexes' | 'triggers';
  panelId?: string; // Optional: which panel to open in
}

export interface OpenQueryCommand {
  type: 'open_query';
  sql: string;
  title?: string;
  execute?: boolean; // Auto-execute after opening
  panelId?: string;
}

export interface SplitPanelCommand {
  type: 'split_panel';
  direction: 'horizontal' | 'vertical';
  targetPanelId: string;
}

export interface FocusPanelCommand {
  type: 'focus_panel';
  panelId: string;
}

export interface NavigateToLineCommand {
  type: 'navigate_to_line';
  panelId: string;
  line: number;
}

export interface InsertTextCommand {
  type: 'insert_text';
  panelId: string;
  text: string;
  position?: { line: number; column: number };
}

export interface ShowDataCommand {
  type: 'show_data';
  schema: string;
  table: string;
  filter?: string; // Optional WHERE clause
  limit?: number;
}

export interface OpenERDCommand {
  type: 'open_erd';
  schemas: string[];
  tables?: string[]; // Optional: specific tables only
}

export interface CompareTablesCommand {
  type: 'compare_tables';
  sourceSchema: string;
  sourceTable: string;
  targetSchema: string;
  targetTable: string;
}
```

#### Command Execution Flow

```
1. LLM decides to execute UI command
   ↓
2. Sends command via tool call to sidecar
   ↓
3. Sidecar forwards to Tauri backend /__tauri__/ui-command
   ↓
4. Backend validates command permissions
   ↓
5. Backend sends Tauri event to frontend
   ↓
6. Frontend command handler executes command
   ↓
7. Frontend sends confirmation back to agent
   ↓
8. Agent continues with next step
```

### Agent Tools

#### UI Control Tools

```typescript
// src-tauri/sidecar-ai/tools/agent-tools.ts

export const open_table = tool({
  description: "Open a table in the UI to show data, structure, indexes, or triggers",
  parameters: z.object({
    schema: z.string(),
    table: z.string(),
    view: z.enum(['data', 'structure', 'indexes', 'triggers']).default('data'),
    panelId: z.string().optional().describe("Which panel to open in (defaults to focused panel)"),
  }),
  execute: async ({ schema, table, view, panelId }) => {
    const command: OpenTableCommand = {
      type: 'open_table',
      schema,
      table,
      view,
      panelId,
    };

    await executeUICommand(command);

    return {
      success: true,
      message: `Opened ${schema}.${table} in ${view} view`,
    };
  },
});

export const open_query = tool({
  description: "Open a new query tab with SQL code, optionally execute it",
  parameters: z.object({
    sql: z.string().describe("The SQL query to open"),
    title: z.string().optional().describe("Tab title"),
    execute: z.boolean().optional().default(false).describe("Auto-execute after opening"),
    panelId: z.string().optional(),
  }),
  execute: async ({ sql, title, execute, panelId }) => {
    const command: OpenQueryCommand = {
      type: 'open_query',
      sql,
      title: title || 'New Query',
      execute,
      panelId,
    };

    await executeUICommand(command);

    return {
      success: true,
      message: execute
        ? `Opened and executed query in new tab`
        : `Opened query in new tab`,
    };
  },
});

export const split_panel = tool({
  description: "Split the current panel horizontally or vertically to show multiple views",
  parameters: z.object({
    direction: z.enum(['horizontal', 'vertical']),
    targetPanelId: z.string().describe("Panel to split"),
  }),
  execute: async ({ direction, targetPanelId }) => {
    const command: SplitPanelCommand = {
      type: 'split_panel',
      direction,
      targetPanelId,
    };

    await executeUICommand(command);

    return {
      success: true,
      message: `Split panel ${direction}ly`,
    };
  },
});

export const insert_text_at_cursor = tool({
  description: "Insert text at the cursor position in the query editor",
  parameters: z.object({
    text: z.string().describe("Text to insert (e.g., optimized SQL)"),
    panelId: z.string().describe("Panel containing the editor"),
  }),
  execute: async ({ text, panelId }) => {
    const command: InsertTextCommand = {
      type: 'insert_text',
      text,
      panelId,
    };

    await executeUICommand(command);

    return {
      success: true,
      message: `Inserted text into editor`,
    };
  },
});

export const compare_table_structures = tool({
  description: "Compare two table structures side-by-side to show differences",
  parameters: z.object({
    sourceSchema: z.string(),
    sourceTable: z.string(),
    targetSchema: z.string(),
    targetTable: z.string(),
  }),
  execute: async ({ sourceSchema, sourceTable, targetSchema, targetTable }) => {
    const command: CompareTablesCommand = {
      type: 'compare_tables',
      sourceSchema,
      sourceTable,
      targetSchema,
      targetTable,
    };

    await executeUICommand(command);

    // Also fetch and return diff data
    const [source, target] = await Promise.all([
      callTauri('get_table_structure', { schema: sourceSchema, table: sourceTable }),
      callTauri('get_table_structure', { schema: targetSchema, table: targetTable }),
    ]);

    const diff = computeStructureDiff(source, target);

    return {
      success: true,
      diff,
      message: `Opened comparison view`,
    };
  },
});

// Helper to execute UI commands
async function executeUICommand(command: AICommand): Promise<void> {
  await fetch(`${TAURI_API_URL}/__tauri__/ui-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
}
```

#### Analysis Tools (Agent Mode Only)

```typescript
export const analyze_table_usage = tool({
  description: "Analyze table access patterns, index usage, and performance metrics",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    table: z.string(),
  }),
  execute: async ({ connectionId, schema, table }) => {
    // Query pg_stat_user_tables and pg_stat_user_indexes
    const [tableStats, indexStats] = await Promise.all([
      callTauri('stream_query', {
        conn_id: connectionId,
        sql: `SELECT * FROM pg_stat_user_tables WHERE schemaname = '${schema}' AND relname = '${table}'`,
      }),
      callTauri('get_index_usage_stats', {
        conn_id: connectionId,
        table,
      }),
    ]);

    return {
      success: true,
      tableStats: {
        seqScans: tableStats.rows[0].seq_scan,
        seqTuples: tableStats.rows[0].seq_tup_read,
        indexScans: tableStats.rows[0].idx_scan,
        indexTuples: tableStats.rows[0].idx_tup_fetch,
        inserts: tableStats.rows[0].n_tup_ins,
        updates: tableStats.rows[0].n_tup_upd,
        deletes: tableStats.rows[0].n_tup_del,
      },
      indexStats,
      recommendations: [], // AI can analyze and suggest
    };
  },
});

export const analyze_query_performance = tool({
  description: "Deeply analyze a query's performance with EXPLAIN ANALYZE and provide optimization suggestions",
  parameters: z.object({
    connectionId: z.string(),
    sql: z.string(),
  }),
  execute: async ({ connectionId, sql }) => {
    // Run EXPLAIN ANALYZE
    const plan = await callTauri('stream_query', {
      conn_id: connectionId,
      sql: `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${sql}`,
    });

    const parsedPlan = JSON.parse(plan.rows[0][0]);

    // Analyze plan for issues
    const issues = analyzePlanForIssues(parsedPlan);

    return {
      success: true,
      plan: parsedPlan,
      executionTime: parsedPlan[0]['Execution Time'],
      planningTime: parsedPlan[0]['Planning Time'],
      issues,
      suggestions: [], // AI generates suggestions based on issues
    };
  },
});

export const generate_migration_script = tool({
  description: "Generate SQL migration script to sync two table structures",
  parameters: z.object({
    connectionId: z.string(),
    sourceSchema: z.string(),
    sourceTable: z.string(),
    targetSchema: z.string(),
    targetTable: z.string(),
  }),
  execute: async ({ connectionId, sourceSchema, sourceTable, targetSchema, targetTable }) => {
    // Get both structures
    const [source, target] = await Promise.all([
      callTauri('get_table_structure', {
        conn_id: connectionId,
        schema: sourceSchema,
        table: sourceTable,
      }),
      callTauri('get_table_structure', {
        conn_id: connectionId,
        schema: targetSchema,
        table: targetTable,
      }),
    ]);

    // Generate migration SQL
    const migration = generateMigrationSQL(source, target);

    return {
      success: true,
      migration: {
        upSql: migration.up,
        downSql: migration.down,
        changes: migration.changes,
      },
    };
  },
});
```

### Agent UI Components

#### Agent Modal

```typescript
// src/components/AIAssistant/AgentModal.tsx

export function AgentModal({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [task, setTask] = useState('');
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>AI Agent (cmd+i)</DialogTitle>
          <DialogDescription>
            Describe what you want to analyze or accomplish. The agent can explore your database,
            open tables, create queries, and show comparisons.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Task Input */}
          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Example: Compare the users table in dev and prod schemas, show me the differences..."
            className="min-h-[100px]"
          />

          {/* Agent Steps Display */}
          <ScrollArea className="flex-1 border rounded-md p-4">
            {agentSteps.length === 0 && !isThinking && (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p className="text-sm">Agent steps will appear here...</p>
              </div>
            )}

            {agentSteps.map((step, index) => (
              <AgentStepDisplay key={index} step={step} />
            ))}

            {isThinking && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Agent is thinking...</span>
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => executeAgentTask(task)}>
            <Sparkles className="h-4 w-4 mr-2" />
            Start Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AgentStep {
  type: 'thought' | 'tool' | 'command' | 'result';
  content: string;
  metadata?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

function AgentStepDisplay({ step }: { step: AgentStep }) {
  const icons = {
    thought: Lightbulb,
    tool: Wrench,
    command: Terminal,
    result: CheckCircle,
  };

  const Icon = icons[step.type];

  return (
    <div className="mb-3 flex gap-3">
      <div className="flex-shrink-0 mt-1">
        <Icon className={cn(
          "h-4 w-4",
          step.status === 'running' && "animate-pulse text-primary",
          step.status === 'completed' && "text-green-500",
          step.status === 'failed' && "text-destructive",
        )} />
      </div>
      <div className="flex-1">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
          {step.type}
        </div>
        <div className="text-sm">{step.content}</div>
        {step.metadata && (
          <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(step.metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
```

### Safety and Permissions

#### Permission System

```typescript
// Agent mode permissions
export interface AgentPermissions {
  canReadData: boolean;      // Execute SELECT queries
  canModifyUI: boolean;       // Execute UI commands
  canCreateTabs: boolean;     // Create new tabs/panels
  canCloseTab: boolean;      // Close tabs
  canExecuteQueries: boolean; // Auto-execute queries
  requireConfirmation: boolean; // Require user confirmation for each command
}

// Default permissions for agent mode
const AGENT_MODE_PERMISSIONS: AgentPermissions = {
  canReadData: true,
  canModifyUI: true,
  canCreateTabs: true,
  canCloseTab: false,        // Don't auto-close user tabs
  canExecuteQueries: false,   // Don't auto-execute (show only)
  requireConfirmation: false, // Trust the agent by default
};
```

#### Confirmation Dialog

For sensitive operations, show confirmation dialog:

```typescript
export function ConfirmCommandDialog({
  command,
  onConfirm,
  onReject
}: {
  command: AICommand;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Agent Action</AlertDialogTitle>
          <AlertDialogDescription>
            The AI agent wants to perform the following action:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-4 rounded-md border bg-muted p-3">
          <div className="text-sm font-mono">
            {formatCommandForDisplay(command)}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onReject}>
            Reject
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### Implementation Tasks

**Sidecar Changes**:
1. ✅ Create `agent-tools.ts` with UI control tools
2. ✅ Add `executeUICommand` helper function
3. ✅ Add analysis tools (table usage, query performance, migration generation)
4. ✅ Update system prompt for agent mode
5. ✅ Add step-by-step reasoning prompts

**Backend Changes**:
1. ✅ Add `/__tauri__/ui-command` endpoint
2. ✅ Implement command validation and permissions
3. ✅ Add Tauri event emission for UI commands
4. ✅ Add command execution logging

**Frontend Changes**:
1. ✅ Create `AgentModal` component
2. ✅ Create `AgentStepDisplay` component
3. ✅ Create `ConfirmCommandDialog` component
4. ✅ Add keyboard shortcut handler for `cmd+i`
5. ✅ Implement UI command handlers (open table, split panel, etc.)
6. ✅ Add command execution tracking
7. ✅ Create agent mode store (Zustand)

---

## Mode 3: Inline Query Editor Mode (cmd+k)

### Description

AI-powered inline editing assistance directly within the CodeMirror query editor. Similar to Cursor's inline edit feature, but specialized for SQL queries.

### User Experience

**Trigger**:
- Select text in query editor
- Press `cmd+k`
- Type instruction (e.g., "optimize this query", "add index hints", "explain what this does")

**Behavior**:
- Shows inline prompt input overlay above/below selected text
- Streams AI response directly into editor
- Shows diff preview before applying
- Undo/redo support

### CodeMirror Integration

#### Inline Widget Extension

```typescript
// src/components/CodeEditor/extensions/inlineAI.ts

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

// State effects for inline AI
export const showInlinePrompt = StateEffect.define<{ from: number; to: number }>();
export const hideInlinePrompt = StateEffect.define<void>();
export const applyInlineEdit = StateEffect.define<{ from: number; to: number; text: string }>();

// Inline prompt widget
class InlinePromptWidget extends WidgetType {
  constructor(
    public from: number,
    public to: number,
    public onSubmit: (prompt: string) => void,
    public onCancel: () => void,
  ) {}

  toDOM() {
    const container = document.createElement('div');
    container.className = 'inline-ai-prompt';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask AI to edit (e.g., optimize this query)...';
    input.className = 'inline-ai-input';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.onSubmit(input.value);
      } else if (e.key === 'Escape') {
        this.onCancel();
      }
    });

    // Auto-focus
    setTimeout(() => input.focus(), 0);

    container.appendChild(input);
    return container;
  }
}

// State field for inline prompts
export const inlineAIField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (let effect of tr.effects) {
      if (effect.is(showInlinePrompt)) {
        const { from, to } = effect.value;
        const widget = Decoration.widget({
          widget: new InlinePromptWidget(
            from,
            to,
            (prompt) => handleInlinePrompt(tr.state.doc, from, to, prompt),
            () => hideInlinePromptHandler(),
          ),
          side: 1,
        });
        decorations = decorations.update({
          add: [widget.range(to)],
        });
      } else if (effect.is(hideInlinePrompt)) {
        decorations = Decoration.none;
      }
    }

    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

// Handle inline prompt submission
async function handleInlinePrompt(
  doc: Text,
  from: number,
  to: number,
  prompt: string,
) {
  const selectedText = doc.sliceString(from, to);
  const fullQuery = doc.toString();

  // Call AI sidecar for inline edit
  const response = await fetch(`${AI_SIDECAR_URL}/inline-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      selectedText,
      fullQuery,
      cursorPosition: { from, to },
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let aiSuggestion = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    aiSuggestion += decoder.decode(value);
  }

  // Show diff preview
  showDiffPreview(selectedText, aiSuggestion, from, to);
}

// Diff preview
function showDiffPreview(
  original: string,
  suggested: string,
  from: number,
  to: number,
) {
  // Use react-diff-viewer-continued for side-by-side diff
  // Show modal with Accept/Reject buttons
  // On Accept: apply edit
  // On Reject: close modal
}
```

#### Keyboard Shortcut Integration

```typescript
// src/components/CodeEditor/extensions.ts

import { keymap } from "@codemirror/view";
import { showInlinePrompt } from "./extensions/inlineAI";

export function getInlineAIKeymap() {
  return keymap.of([
    {
      key: "Mod-k",
      run: (view) => {
        const { from, to } = view.state.selection.main;

        if (from === to) {
          // No selection - show toast
          toast.info("Select some SQL text first");
          return false;
        }

        // Show inline prompt
        view.dispatch({
          effects: showInlinePrompt.of({ from, to }),
        });

        return true;
      },
    },
  ]);
}
```

### AI Inline Edit Endpoint

#### Sidecar Route

```typescript
// src-tauri/sidecar-ai/routes/inline-edit.ts

export async function handleInlineEdit(request: Request): Promise<Response> {
  const body = await request.json();
  const { prompt, selectedText, fullQuery, cursorPosition } = body;

  const systemPrompt = `You are an expert SQL editor assistant.

Task: ${prompt}

Context:
- Selected Text:
\`\`\`sql
${selectedText}
\`\`\`

- Full Query (for context):
\`\`\`sql
${fullQuery}
\`\`\`

Instructions:
1. ONLY return the edited SQL code (no explanations, no markdown)
2. Preserve formatting and indentation
3. Focus only on the selected portion unless the full query needs changing
4. Ensure the result is valid SQL
5. If optimization, explain changes in a comment above the code

Example response:
\`\`\`sql
-- Optimized: Added index hint and reduced subquery complexity
SELECT u.*, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id
\`\`\``;

  const provider = ProviderService.createProvider('openai'); // Or user's default
  const model = provider('gpt-4-turbo');

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3, // Lower temperature for more precise edits
  });

  // Return streaming response
  return result.toTextStreamResponse();
}
```

### Diff Preview Modal

```typescript
// src/components/QueryPanel/DiffPreviewModal.tsx

import ReactDiffViewer from 'react-diff-viewer-continued';

export function DiffPreviewModal({
  isOpen,
  original,
  suggested,
  onAccept,
  onReject,
}: {
  isOpen: boolean;
  original: string;
  suggested: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onReject()}>
      <DialogContent className="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>AI Edit Suggestion</DialogTitle>
          <DialogDescription>
            Review the suggested changes before applying
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto max-h-[60vh]">
          <ReactDiffViewer
            oldValue={original}
            newValue={suggested}
            splitView={true}
            useDarkTheme={resolvedTheme === 'dark'}
            leftTitle="Original"
            rightTitle="Suggested"
            showDiffOnly={false}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onReject}>
            Reject
          </Button>
          <Button onClick={onAccept}>
            <Check className="h-4 w-4 mr-2" />
            Accept Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Common Use Cases

1. **Query Optimization**:
   - User: Select slow query → `cmd+k` → "optimize this"
   - AI: Returns optimized query with index hints and better JOIN order

2. **Add Explanations**:
   - User: Select complex query → `cmd+k` → "add comments explaining each part"
   - AI: Returns same query with inline comments

3. **Format SQL**:
   - User: Select messy SQL → `cmd+k` → "format this nicely"
   - AI: Returns properly formatted SQL

4. **Convert Syntax**:
   - User: Select MySQL query → `cmd+k` → "convert to PostgreSQL"
   - AI: Returns PostgreSQL-compatible version

5. **Add Error Handling**:
   - User: Select function → `cmd+k` → "add NULL checks and validation"
   - AI: Returns query with added COALESCE, validation, etc.

### Implementation Tasks

**Sidecar Changes**:
1. ✅ Create `/inline-edit` route
2. ✅ Implement streaming response handler
3. ✅ Add specialized system prompts for different edit types
4. ✅ Add edit validation

**Frontend Changes**:
1. ✅ Create `inlineAI.ts` CodeMirror extension
2. ✅ Add inline prompt widget
3. ✅ Create `DiffPreviewModal` component
4. ✅ Add keyboard shortcut handler (`cmd+k`)
5. ✅ Implement edit application logic
6. ✅ Add undo/redo support for AI edits

---

## Mode 4: Schema Diff Assistant

### Description

Compare database schemas across environments (dev, staging, prod) or over time. Generate migration scripts automatically.

### User Experience

**Trigger**:
- Open command palette → "Compare Schemas"
- Click "Schema Diff" in AI sidebar modes

**Features**:
- Select two schemas/databases to compare
- Visual diff highlighting added/removed/modified tables/columns
- Auto-generate migration SQL (both UP and DOWN)
- Detect breaking changes
- Preview migration impact

### Implementation

```typescript
// Tool: compare_schemas
export const compare_schemas = tool({
  description: "Compare two database schemas and generate migration script",
  parameters: z.object({
    sourceConnection: z.string(),
    sourceSchema: z.string(),
    targetConnection: z.string(),
    targetSchema: z.string(),
  }),
  execute: async ({ sourceConnection, sourceSchema, targetConnection, targetSchema }) => {
    // Fetch all objects from both schemas
    const [sourceTables, targetTables] = await Promise.all([
      getAllTablesWithDetails(sourceConnection, sourceSchema),
      getAllTablesWithDetails(targetConnection, targetSchema),
    ]);

    // Compute diff
    const diff = {
      added: [],      // Tables in target not in source
      removed: [],    // Tables in source not in target
      modified: [],   // Tables with structure changes
      unchanged: [],  // Identical tables
    };

    // Generate migration SQL
    const migration = {
      up: generateUpMigration(diff),
      down: generateDownMigration(diff),
      breaking: detectBreakingChanges(diff),
    };

    return { success: true, diff, migration };
  },
});
```

---

## Mode 5: Query Optimization Advisor

### Description

Automatically analyze queries for performance issues and suggest optimizations.

### Features

1. **Detect Sequential Scans**: Queries missing indexes
2. **Analyze Join Order**: Suggest better join strategies
3. **Identify N+1 Queries**: Detect inefficient query patterns
4. **Suggest Index Creation**: Based on query patterns
5. **Cost Estimation**: Show before/after performance metrics

### Implementation

```typescript
export const optimize_query = tool({
  description: "Analyze query and suggest optimizations",
  parameters: z.object({
    connectionId: z.string(),
    sql: z.string(),
  }),
  execute: async ({ connectionId, sql }) => {
    // Run EXPLAIN ANALYZE
    const plan = await explainAnalyze(connectionId, sql);

    // Analyze for issues
    const issues = [
      ...detectSequentialScans(plan),
      ...detectMissingIndexes(plan),
      ...detectSuboptimalJoins(plan),
    ];

    // Generate optimized query
    const optimized = await generateOptimizedQuery(sql, issues);

    return {
      success: true,
      original: { sql, cost: plan.totalCost, time: plan.executionTime },
      optimized: { sql: optimized.sql, estimatedCost: optimized.cost },
      issues,
      suggestions: optimized.suggestions,
    };
  },
});
```

---

## Mode 6: Natural Language to SQL

### Description

Convert natural language questions into SQL queries.

### User Experience

**Trigger**:
- Type question in chat → AI generates SQL
- In query editor → `cmd+k` → "Write a query that finds..."

**Features**:
- Schema-aware query generation
- Auto-complete table/column names
- Add LIMIT clauses for safety
- Explain generated query
- Show sample results

### Implementation

```typescript
export const nl_to_sql = tool({
  description: "Convert natural language question to SQL query",
  parameters: z.object({
    connectionId: z.string(),
    schema: z.string(),
    question: z.string().describe("Natural language question"),
  }),
  execute: async ({ connectionId, schema, question }) => {
    // Get schema context
    const tables = await callTauri('get_tables', { conn_id: connectionId, schema });

    // Build schema context for LLM
    const schemaContext = await buildSchemaContext(connectionId, schema, tables);

    // Generate SQL using LLM
    const sql = await generateSQL(question, schemaContext);

    // Validate and add LIMIT
    const safeSql = addLimitClause(sql, 100);

    // Optionally execute to show sample
    const sample = await callTauri('stream_query', {
      conn_id: connectionId,
      sql: safeSql,
    });

    return {
      success: true,
      sql: safeSql,
      explanation: generateExplanation(sql),
      sample: sample.rows.slice(0, 5),
    };
  },
});
```

---

## Critical Missing Features

### Chat Message Persistence (AI SDK v5)

**Current Issue**: Chat messages are lost on page refresh. This is a critical UX problem.

**AI SDK v5 Implementation Pattern**:

Based on AI SDK v5 documentation, we need to:

#### 1. Server-Side Storage

```typescript
// src-tauri/sidecar-ai/routes/chat.ts (UPDATED)

import { generateMessageId } from "ai";

export async function handleChatStream(request: Request): Promise<Response> {
  const body: ChatRequest = await request.json();
  const { messages, provider, model, chatId } = body; // Add chatId

  // Load previous messages if chatId exists
  let previousMessages: UIMessage[] = [];
  if (chatId) {
    previousMessages = await loadChatMessages(chatId); // New function
  }

  // Append new message to previous messages
  const allMessages = [...previousMessages, ...messages];

  // Create AI provider
  const aiProvider = ProviderService.createProvider(provider);
  const aiModel = aiProvider(model);

  // Stream response
  const result = streamText({
    model: aiModel,
    system: systemPrompt,
    messages: convertToModelMessages(allMessages),
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
  });

  // Return with onFinish callback to save messages
  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    generateMessageId, // SERVER-SIDE ID GENERATION (critical for persistence!)
    onFinish: ({ messages: finishedMessages }) => {
      // Save all messages to storage
      saveChatMessages(chatId || generateChatId(), finishedMessages);
    },
  });
}

// Storage functions (use Tauri backend or local file)
async function loadChatMessages(chatId: string): Promise<UIMessage[]> {
  // Option 1: Call Tauri backend to load from database
  const response = await fetch(`${TAURI_API_URL}/chat/${chatId}/messages`);
  return response.json();

  // Option 2: Use local file system (simple approach)
  // const file = await Bun.file(`./chats/${chatId}.json`).text();
  // return JSON.parse(file);
}

async function saveChatMessages(chatId: string, messages: UIMessage[]): Promise<void> {
  // Option 1: Call Tauri backend to save to database
  await fetch(`${TAURI_API_URL}/chat/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });

  // Option 2: Use local file system
  // await Bun.write(`./chats/${chatId}.json`, JSON.stringify(messages, null, 2));
}
```

#### 2. Frontend Integration

```typescript
// src/components/AIAssistant/AIAssistantSidebar.tsx (UPDATED)

import { generateId } from "ai";
import { useState, useEffect } from "react";

export function AIAssistantSidebar() {
  const { connectionId } = useParams();

  // Generate or load chat ID
  const [chatId, setChatId] = useState<string>(() => {
    // Load from localStorage or generate new
    const savedChatId = localStorage.getItem(`chat-${connectionId}`);
    return savedChatId || generateId();
  });

  // Save chatId to localStorage
  useEffect(() => {
    if (connectionId) {
      localStorage.setItem(`chat-${connectionId}`, chatId);
    }
  }, [connectionId, chatId]);

  // Load initial messages from backend
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch(`${sidecarUrl}/chat/${chatId}/messages`);
        if (response.ok) {
          const messages = await response.json();
          setInitialMessages(messages);
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    loadHistory();
  }, [chatId, sidecarUrl]);

  // useChat with persistence
  const { messages, sendMessage, status, error } = useChat({
    id: chatId, // CRITICAL: This enables persistence
    initialMessages, // Load saved messages
    transport: new DefaultChatTransport({
      api: `${sidecarUrl}/chat`,
      body: {
        model: currentModel,
        provider: currentProvider,
        chatId, // Send chatId to backend
      },
      headers: {
        "X-Connection-Id": connectionId || "",
        "X-Connection-Database": selectedDatabase || "",
        "X-Connection-Schema": selectedSchema || "",
      },
    }),
  });

  // Clear chat function
  const clearChat = () => {
    const newChatId = generateId();
    setChatId(newChatId);
    localStorage.setItem(`chat-${connectionId}`, newChatId);
    // Clear backend storage
    fetch(`${sidecarUrl}/chat/${chatId}`, { method: 'DELETE' });
  };

  if (isLoadingHistory) {
    return <div>Loading chat history...</div>;
  }

  // ... rest of component
}
```

#### 3. Backend Storage (Tauri)

```rust
// src-tauri/src/ai/chat_storage.rs (NEW FILE)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct UIMessage {
    id: String,
    role: String,
    parts: Vec<serde_json::Value>,
    created_at: Option<i64>,
}

pub struct ChatStorage {
    base_path: PathBuf,
}

impl ChatStorage {
    pub fn new() -> Self {
        let base_path = dirs::data_dir()
            .unwrap()
            .join("devdb-studio")
            .join("chats");

        fs::create_dir_all(&base_path).ok();

        Self { base_path }
    }

    pub fn load_messages(&self, chat_id: &str) -> Result<Vec<UIMessage>, String> {
        let file_path = self.base_path.join(format!("{}.json", chat_id));

        if !file_path.exists() {
            return Ok(vec![]);
        }

        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read chat file: {}", e))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse chat file: {}", e))
    }

    pub fn save_messages(&self, chat_id: &str, messages: Vec<UIMessage>) -> Result<(), String> {
        let file_path = self.base_path.join(format!("{}.json", chat_id));
        let content = serde_json::to_string_pretty(&messages)
            .map_err(|e| format!("Failed to serialize messages: {}", e))?;

        fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write chat file: {}", e))
    }

    pub fn delete_chat(&self, chat_id: &str) -> Result<(), String> {
        let file_path = self.base_path.join(format!("{}.json", chat_id));
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete chat file: {}", e))
    }
}
```

```rust
// src-tauri/src/http_server.rs (ADD ROUTES)

async fn get_chat_messages(
    Path(chat_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let storage = ChatStorage::new();
    let messages = storage.load_messages(&chat_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(messages.into_iter().map(|m| serde_json::to_value(m).unwrap()).collect()))
}

async fn save_chat_messages(
    Path(chat_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, String)> {
    let messages: Vec<serde_json::Value> = serde_json::from_value(payload["messages"].clone())
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let storage = ChatStorage::new();
    storage.save_messages(&chat_id, messages)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(StatusCode::OK)
}

// Add to router
let app = Router::new()
    .route("/__tauri__/invoke", post(proxy_tauri_invoke))
    .route("/chat/:chat_id/messages", get(get_chat_messages))
    .route("/chat/:chat_id/messages", post(save_chat_messages))
    .with_state(state);
```

---

### Message Copy and Retry Functionality

**Current Issue**: Users cannot copy messages or retry failed requests.

#### 1. Copy Message to Clipboard

```typescript
// src/components/AIAssistant/PartRenders/TextPart.tsx (UPDATED)

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function TextPart({ id, content }: { id: string; content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: CodeBlock,
            // ... other components
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {/* Copy button (appears on hover) */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
```

#### 2. Retry Failed Messages

```typescript
// src/components/AIAssistant/AIAssistantSidebar.tsx (UPDATED)

export function AIAssistantSidebar() {
  const { messages, sendMessage, reload, status, error } = useChat({
    // ... existing config
    onError: (error) => {
      console.error("AI Chat Error:", error);
      toast.error(error.message || "Failed to get AI response");
    },
  });

  // Retry last message
  const handleRetry = () => {
    reload(); // AI SDK v5 provides reload() function
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-4">
          {messages.map((message, index) => (
            <div key={message.id || index}>
              {/* Message content */}
              <div className={cn(/* ... */)}>
                {message.role === "assistant" ? (
                  <AssistantMessageParts message={message} />
                ) : (
                  <TextPart id={message.id} content={/* ... */} />
                )}
              </div>

              {/* Error indicator with retry */}
              {message.role === "user" &&
               index === messages.length - 1 &&
               error && (
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-xs text-destructive">{error.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    disabled={status === "streaming"}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* ... rest of component */}
    </div>
  );
}
```

#### 3. Copy Entire Conversation

```typescript
// Add to AIAssistantSidebar header

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="h-8 w-8">
      <MoreVertical className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={copyAllMessages}>
      <Copy className="h-4 w-4 mr-2" />
      Copy All Messages
    </DropdownMenuItem>
    <DropdownMenuItem onClick={clearChat}>
      <Trash className="h-4 w-4 mr-2" />
      Clear Chat
    </DropdownMenuItem>
    <DropdownMenuItem onClick={exportChat}>
      <Download className="h-4 w-4 mr-2" />
      Export as Markdown
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Implementation
const copyAllMessages = async () => {
  const text = messages
    .map((m) => {
      const role = m.role === "user" ? "You" : "AI";
      const content = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("");
      return `${role}: ${content}`;
    })
    .join("\n\n");

  await navigator.clipboard.writeText(text);
  toast.success("Copied all messages to clipboard");
};

const exportChat = () => {
  const markdown = messages
    .map((m) => {
      const role = m.role === "user" ? "## You" : "## AI Assistant";
      const content = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("");
      return `${role}\n\n${content}`;
    })
    .join("\n\n---\n\n");

  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${chatId}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Chat exported");
};
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Week 1: Critical Fixes & Chat Persistence**
- [ ] **FIX**: Implement `execute_readonly_query` with actual query execution (currently placeholder)
- [ ] **FIX**: Implement `get_sample_data` with actual results (currently placeholder)
- [ ] **FIX**: Change keyboard shortcut from `cmd+l` to `cmd+shift+l` (avoid conflict with sidebar toggle)
- [ ] **FIX**: @mention autocomplete - make it use chat context instead of direct invoke()
- [ ] **CRITICAL**: Implement chat message persistence (AI SDK v5 pattern)
  - Add server-side message ID generation
  - Add Tauri backend storage (ChatStorage)
  - Add frontend chatId management
  - Add onFinish callback to save messages
- [ ] **UX**: Add message copy/retry functionality
  - Copy individual messages
  - Retry failed messages (useChat.reload())
  - Copy entire conversation
  - Export chat as Markdown

**Week 2: Enhanced Tools & UI**
- [ ] Implement `explain_query` for query plan analysis
- [ ] Add `QueryResultDisplay` component with table formatting
- [ ] Add `ExplainPlanVisualization` component
- [ ] Add missing HTTP proxy endpoints (get_functions, get_object_definition)
- [ ] Create `AIModeState` store (Zustand)
- [ ] Add keyboard shortcut handlers (cmd+shift+l, cmd+i, cmd+k)
- [ ] Implement mode switching UI
- [ ] Add mode indicator in AI sidebar

### Phase 2: Agent Mode (Weeks 3-4)

**Week 3: UI Command System**
- [ ] Design and implement `AICommand` types
- [ ] Create `/__tauri__/ui-command` backend endpoint
- [ ] Implement UI command handlers (open_table, split_panel, etc.)
- [ ] Add command execution tracking
- [ ] Create `AgentModal` component

**Week 4: Agent Tools & Safety**
- [ ] Implement agent-specific tools (open_table, open_query, etc.)
- [ ] Add analysis tools (table usage, query performance)
- [ ] Implement permission system
- [ ] Create `ConfirmCommandDialog` component
- [ ] Add agent step visualization

### Phase 3: Inline Editor Mode (Weeks 5-6)

**Week 5: CodeMirror Integration**
- [ ] Create `inlineAI.ts` extension
- [ ] Implement inline prompt widget
- [ ] Add keyboard shortcut (cmd+k)
- [ ] Create `/inline-edit` sidecar endpoint

**Week 6: Diff & Application**
- [ ] Create `DiffPreviewModal` component
- [ ] Implement edit application logic
- [ ] Add undo/redo support
- [ ] Test common use cases (optimize, format, explain)

### Phase 4: Advanced Modes (Weeks 7-8)

**Week 7: Schema Diff & Optimization**
- [ ] Implement `compare_schemas` tool
- [ ] Create schema diff visualization
- [ ] Implement migration script generation
- [ ] Implement `optimize_query` tool
- [ ] Add optimization suggestions UI

**Week 8: NL to SQL & Polish**
- [ ] Implement `nl_to_sql` tool
- [ ] Add schema context building
- [ ] Polish all modes for consistency
- [ ] Comprehensive testing
- [ ] Documentation

---

## Technical Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ Chat UI        │  │ Agent Modal  │  │ Inline Editor   │ │
│  │ (AIAssistant)  │  │ (cmd+i)      │  │ (CodeMirror)    │ │
│  └────────┬───────┘  └──────┬───────┘  └────────┬────────┘ │
│           │                 │                    │          │
│           └─────────────────┴────────────────────┘          │
│                             ↓                                │
│                    ┌────────────────┐                        │
│                    │  AI Mode Store │                        │
│                    └────────┬───────┘                        │
│                             ↓                                │
│                    ┌────────────────┐                        │
│                    │  useChat Hook  │                        │
│                    │  (AI SDK)      │                        │
│                    └────────┬───────┘                        │
└─────────────────────────────┼────────────────────────────────┘
                              │ HTTP (SSE)
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      AI Sidecar (Bun)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ /chat        │  │ /inline-edit │  │ Provider Service │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         └─────────────────┴────────┐                        │
│                                     ↓                        │
│                           ┌──────────────────┐              │
│                           │ Vercel AI SDK    │              │
│                           │ streamText()     │              │
│                           └─────────┬────────┘              │
│                                     │                        │
│                           ┌─────────┴────────┐              │
│                           │  Database Tools  │              │
│                           │  UI Tools        │              │
│                           │  Analysis Tools  │              │
│                           └─────────┬────────┘              │
└─────────────────────────────────────┼────────────────────────┘
                                      │ HTTP
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                  Tauri Backend (Rust)                        │
│  ┌────────────────────┐  ┌───────────────────────────────┐  │
│  │ HTTP Server        │  │ Connection Manager            │  │
│  │ (Axum, port 14420) │  │ (Database Pools)              │  │
│  └────────┬───────────┘  └───────────────────────────────┘  │
│           │                                                  │
│  ┌────────┴────────────────────────────────────┐            │
│  │ Proxied Commands:                           │            │
│  │ - get_tables, get_columns, get_constraints  │            │
│  │ - get_indexes, get_schemas, get_views       │            │
│  │ - stream_query, explain_query               │            │
│  │ - NEW: ui_command endpoint                  │            │
│  └─────────────────────────────────────────────┘            │
│                             ↓                                │
│                    ┌────────────────┐                        │
│                    │  PostgreSQL    │                        │
│                    │  Adapter       │                        │
│                    └────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Store Architecture

```typescript
// Mode state
export const useAIModeStore = create<AIModeStore>((set) => ({
  currentMode: 'chat',
  isActive: false,
  context: {},

  setMode: (mode) => set({ currentMode: mode }),
  activate: () => set({ isActive: true }),
  deactivate: () => set({ isActive: false }),
  updateContext: (ctx) => set((state) => ({
    context: { ...state.context, ...ctx }
  })),
}));

// Agent state
export const useAgentStore = create<AgentStore>((set) => ({
  steps: [],
  isRunning: false,
  currentTask: null,

  addStep: (step) => set((state) => ({
    steps: [...state.steps, step]
  })),
  updateStep: (index, updates) => set((state) => ({
    steps: state.steps.map((s, i) => i === index ? { ...s, ...updates } : s)
  })),
  startTask: (task) => set({ currentTask: task, isRunning: true, steps: [] }),
  completeTask: () => set({ isRunning: false }),
}));
```

---

## Security Considerations

### Read-Only Enforcement

All modes except Agent mode are **strictly read-only**:

```typescript
// Validate SQL is SELECT only
function validateReadOnly(sql: string): boolean {
  const normalized = sql.trim().toLowerCase();
  const forbidden = [
    'insert', 'update', 'delete', 'drop', 'create', 'alter',
    'truncate', 'grant', 'revoke', 'set',
  ];

  return !forbidden.some(kw => normalized.includes(kw))
    && normalized.startsWith('select');
}
```

### Agent Mode Restrictions

Even in Agent mode, certain operations are forbidden:

```typescript
const FORBIDDEN_COMMANDS = [
  'drop_table',
  'drop_database',
  'delete_all_data',
  'modify_permissions',
];

function validateCommand(command: AICommand): boolean {
  // Never allow destructive operations
  if (command.type.includes('drop') || command.type.includes('delete')) {
    return false;
  }

  // UI commands are safe (they don't modify database)
  const uiCommands = [
    'open_table', 'open_query', 'split_panel',
    'focus_panel', 'insert_text', 'compare_tables',
  ];

  return uiCommands.includes(command.type);
}
```

### API Key Security

API keys remain in OS keychain and are never logged:

```typescript
// Never log sensitive data
function sanitizeLog(data: any) {
  const sanitized = { ...data };
  delete sanitized.apiKey;
  delete sanitized.api_key;
  return sanitized;
}

console.log('Request:', sanitizeLog(request));
```

### Rate Limiting

Add rate limiting to prevent abuse:

```typescript
const rateLimiter = new Map<string, number>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const lastRequest = rateLimiter.get(userId) || 0;

  if (now - lastRequest < 1000) { // 1 request per second
    return false;
  }

  rateLimiter.set(userId, now);
  return true;
}
```

---

## Conclusion

This specification outlines a comprehensive AI system with **6 distinct modes**, each optimized for specific workflows:

1. **Chat Mode (cmd+l)**: Enhanced conversational database exploration with read-only tools
2. **Agent Mode (cmd+i)**: Autonomous agent with UI control via command pattern
3. **Inline Query Editor (cmd+k)**: AI-powered inline editing in CodeMirror
4. **Schema Diff Assistant**: Compare schemas and generate migrations
5. **Query Optimization Advisor**: Automatic performance analysis and suggestions
6. **Natural Language to SQL**: Convert questions to SQL queries

The architecture is designed to be:
- **Extensible**: Easy to add new modes and tools
- **Safe**: Read-only by default, explicit permissions for agents
- **Performant**: Streaming responses, async execution
- **User-Friendly**: Keyboard shortcuts, visual feedback, confirmations

Implementation can proceed in phases, with each mode building on the infrastructure from previous phases.

---

**Next Steps**:
1. Review and approve this specification
2. Begin Phase 1 implementation (Chat Mode Enhancement)
3. Iterate based on user feedback
4. Expand to additional modes as needed
