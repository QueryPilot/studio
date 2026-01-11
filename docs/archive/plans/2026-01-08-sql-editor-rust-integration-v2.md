# SQL Editor Rust Backend Integration Plan (v2 - Consolidated)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Rust sql_engine to frontend for 19 smart SQL features, using TypeScript adapters as SINGLE SOURCE OF TRUTH for schema introspection.

**Architecture Change:** Instead of duplicating schema queries in Rust, the frontend PUSHES pre-fetched schema data to Rust. This eliminates maintenance of two query sets when adding new database support.

**Tech Stack:** Rust (sqlparser-rs 0.52), TypeScript, Tauri IPC, CodeMirror 6

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (TypeScript)                        │
├─────────────────────────────────────────────────────────────────────┤
│  schemaCache.getTables() ──→ IntrospectionService ──→ Adapters      │
│         │                                                            │
│         └──→ sql_set_schema(connectionId, schema, data)  ──────────┐│
│                                                                      ││
│  SqlMetadataProvider ←── completion/hover uses schemaCache          ││
└──────────────────────────────────────────────────────────────────────┘│
                                                                        │
┌──────────────────────────────────────────────────────────────────────┐│
│                           BACKEND (Rust)                              ││
├──────────────────────────────────────────────────────────────────────┤│
│  SchemaStore.put() ←─────────────────────────────────────────────────┘│
│         │                                                             │
│  sql_complete() ──→ SchemaStore.get() → completions                  │
│  sql_validate() ──→ SchemaStore.get() → validation                   │
└───────────────────────────────────────────────────────────────────────┘
```

**Benefits:**

- Single source of truth (TypeScript adapters)
- Adding new DB only requires updating TypeScript
- No IPC latency for completions (schema pre-loaded)
- Simpler Rust code (receiver, not fetcher)

---

## Task Overview

| Task | Description                                               | Parallelizable  |
| ---- | --------------------------------------------------------- | --------------- |
| 1    | Add `sql_set_schema` and `sql_clear_schema` Rust commands | Yes             |
| 2    | Delete redundant `schema_queries.rs`                      | Yes (with 1)    |
| 3    | Create schema sync hook in frontend                       | No (needs 1)    |
| 4    | Create `rust-completion.ts` bridge                        | Yes             |
| 5    | Integrate Rust completion into optimized-completion       | No (needs 3, 4) |
| 6    | Wire Rust validation to unified-linter                    | No (needs 3)    |
| 7    | Remove legacy linters from SqlEditor                      | No (needs 6)    |
| 8    | Delete legacy linter files                                | No (needs 7)    |
| 9    | Clean up Rust warnings                                    | Yes             |

**Parallel Execution Strategy:**

- **Wave 1:** Tasks 1, 2, 4, 9 (independent)
- **Wave 2:** Task 3 (depends on 1)
- **Wave 3:** Tasks 5, 6 (depend on 3)
- **Wave 4:** Tasks 7, 8 (sequential cleanup)

---

## Task 1: Add `sql_set_schema` and `sql_clear_schema` Commands

**Files:**

- Modify: `src-tauri/src/sql_engine/commands.rs`
- Modify: `src-tauri/src/sql_engine/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/sqlEngineService.ts`

**Step 1: Add global SCHEMA_STORE to mod.rs**

In `src-tauri/src/sql_engine/mod.rs`, add after the imports (around line 63):

```rust
use once_cell::sync::Lazy;

/// Global schema store for caching schema metadata.
/// Populated by sql_set_schema, used by sql_complete/sql_validate.
pub static SCHEMA_STORE: Lazy<SchemaStore> = Lazy::new(SchemaStore::new);
```

**Step 2: Add once_cell dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
once_cell = "1.19"
```

**Step 3: Add schema commands in commands.rs**

In `src-tauri/src/sql_engine/commands.rs`, add imports at top:

```rust
use super::schema_store::{CacheKey, CachedSchemaBuilder, TableInfo, ColumnInfo, ForeignKeyInfo, EnumInfo, TableType};
use super::SCHEMA_STORE;
```

Then add the commands:

```rust
// =============================================================================
// Schema Push Commands (receives data from frontend)
// =============================================================================

/// Schema data pushed from frontend (TypeScript is source of truth)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSchemaRequest {
    pub connection_id: String,
    pub schema: String,
    pub tables: Vec<TableInput>,
    pub foreign_keys: Vec<ForeignKeyInput>,
    pub enums: Vec<EnumInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInput {
    pub name: String,
    pub table_type: String,  // "table" | "view" | "materialized_view"
    pub columns: Vec<ColumnInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInput {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInput {
    pub constraint_name: String,
    pub source_table: String,
    pub source_column: String,
    pub target_table: String,
    pub target_column: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumInput {
    pub name: String,
    pub values: Vec<String>,
}

/// Response for set_schema
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSchemaResponse {
    pub success: bool,
    pub table_count: usize,
    pub column_count: usize,
}

/// Push schema data from frontend to Rust cache.
/// This is the ONLY way schema data enters Rust - no duplicate queries.
#[tauri::command]
pub async fn sql_set_schema(request: SetSchemaRequest) -> Result<SetSchemaResponse, String> {
    let cache_key = CacheKey::new(&request.connection_id, &request.schema);

    let mut builder = CachedSchemaBuilder::new();
    let mut total_columns = 0;

    // Add tables and their columns
    for table in &request.tables {
        let table_type = match table.table_type.as_str() {
            "view" => TableType::View,
            "materialized_view" => TableType::MaterializedView,
            _ => TableType::Table,
        };

        builder = builder.add_table(TableInfo {
            name: table.name.clone(),
            schema: Some(request.schema.clone()),
            table_type,
            comment: None,
            row_count: None,
        });

        // Add columns for this table
        let columns: Vec<ColumnInfo> = table.columns.iter().enumerate().map(|(idx, col)| {
            ColumnInfo {
                name: col.name.clone(),
                data_type: col.data_type.clone(),
                nullable: col.nullable,
                default_value: None,
                is_primary_key: col.is_primary_key,
                is_unique: false,
                comment: None,
                enum_values: None,
                ordinal: idx as i32,
                precision: None,
                scale: None,
            }
        }).collect();

        total_columns += columns.len();
        builder = builder.add_columns(&table.name, columns);
    }

    // Add foreign keys
    for fk in &request.foreign_keys {
        builder = builder.add_foreign_key(ForeignKeyInfo {
            constraint_name: fk.constraint_name.clone(),
            source_table: fk.source_table.clone(),
            source_schema: Some(request.schema.clone()),
            source_columns: vec![fk.source_column.clone()],
            target_table: fk.target_table.clone(),
            target_schema: Some(request.schema.clone()),
            target_columns: vec![fk.target_column.clone()],
            on_delete: None,
            on_update: None,
        });
    }

    // Add enums
    for e in &request.enums {
        builder = builder.add_enum(EnumInfo {
            name: e.name.clone(),
            values: e.values.clone(),
        });
    }

    let table_count = request.tables.len();
    SCHEMA_STORE.put(cache_key, builder.build());

    Ok(SetSchemaResponse {
        success: true,
        table_count,
        column_count: total_columns,
    })
}

/// Clear schema cache for a connection
#[tauri::command]
pub async fn sql_clear_schema(
    connection_id: String,
    schema: Option<String>,
) -> Result<(), String> {
    SCHEMA_STORE.invalidate(&connection_id, schema.as_deref());
    Ok(())
}
```

**Step 4: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the `invoke_handler`:

```rust
sql_engine::commands::sql_set_schema,
sql_engine::commands::sql_clear_schema,
```

**Step 5: Add TypeScript interfaces**

In `src/services/sqlEngineService.ts`, add at the end:

```typescript
// =============================================================================
// Schema Push Types (frontend → Rust)
// =============================================================================

export interface SetSchemaRequest {
  connectionId: string;
  schema: string;
  tables: TableInput[];
  foreignKeys: ForeignKeyInput[];
  enums: EnumInput[];
}

export interface TableInput {
  name: string;
  tableType: "table" | "view" | "materialized_view";
  columns: ColumnInput[];
}

export interface ColumnInput {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInput {
  constraintName: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}

export interface EnumInput {
  name: string;
  values: string[];
}

export interface SetSchemaResponse {
  success: boolean;
  tableCount: number;
  columnCount: number;
}
```

Then add to the `SqlEngineService` object:

```typescript
  /**
   * Push schema data to Rust cache.
   * TypeScript adapters are the source of truth - this syncs data to Rust
   * for use by sql_complete and sql_validate.
   */
  async setSchema(
    connectionId: string,
    schema: string,
    tables: TableInput[],
    foreignKeys: ForeignKeyInput[],
    enums: EnumInput[]
  ): Promise<SetSchemaResponse> {
    return invoke<SetSchemaResponse>("sql_set_schema", {
      request: { connectionId, schema, tables, foreignKeys, enums },
    });
  },

  /**
   * Clear schema cache for a connection.
   * Call when connection is closed or schema is refreshed.
   */
  async clearSchema(connectionId: string, schema?: string): Promise<void> {
    return invoke("sql_clear_schema", {
      connectionId,
      schema,
    });
  },
```

**Step 6: Run Rust compilation check**

```bash
cd src-tauri && cargo check
```

**Step 7: Run TypeScript type check**

```bash
pnpm typecheck
```

**Step 8: Commit**

```bash
git add src-tauri/src/sql_engine/commands.rs src-tauri/src/sql_engine/mod.rs \
        src-tauri/src/lib.rs src-tauri/Cargo.toml src/services/sqlEngineService.ts
git commit -m "feat(sql-engine): add sql_set_schema command for push-based schema sync"
```

---

## Task 2: Delete Redundant `schema_queries.rs`

**Files:**

- Delete: `src-tauri/src/sql_engine/schema_queries.rs`
- Modify: `src-tauri/src/sql_engine/mod.rs`

**Step 1: Remove module declaration from mod.rs**

In `src-tauri/src/sql_engine/mod.rs`, remove:

```rust
// DELETE THIS LINE:
pub mod schema_queries;
```

**Step 2: Delete the file**

```bash
rm src-tauri/src/sql_engine/schema_queries.rs
```

**Step 3: Verify no other imports**

```bash
grep -r "schema_queries" src-tauri/src/
```

Expected: No results (or only in this file being deleted)

**Step 4: Run Rust compilation check**

```bash
cd src-tauri && cargo check
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore(rust): delete schema_queries.rs - TypeScript adapters are single source of truth"
```

---

## Task 3: Create Schema Sync Hook in Frontend

**Files:**

- Create: `src/hooks/useRustSchemaSync.ts`
- Modify: `src/components/CodeEditor/SqlEditor.tsx`

**Step 1: Create the sync hook**

```typescript
// src/hooks/useRustSchemaSync.ts
/**
 * Hook to sync schema data from TypeScript to Rust.
 *
 * TypeScript adapters (via IntrospectionService) are the SINGLE SOURCE OF TRUTH
 * for schema introspection. This hook pushes that data to Rust's SchemaStore
 * for use by sql_complete and sql_validate.
 */

import { useEffect, useRef } from "react";
import { schemaCache } from "@/services/schemaCache";
import {
  SqlEngineService,
  type TableInput,
  type ForeignKeyInput,
  type EnumInput,
} from "@/services/sqlEngineService";
import { logger } from "@/lib/logger";

interface UseRustSchemaSyncOptions {
  connectionId: string;
  schema: string;
  enabled?: boolean;
}

// Track which schemas have been synced to avoid redundant pushes
const syncedSchemas = new Map<string, number>(); // key -> timestamp
const SYNC_DEBOUNCE_MS = 5000; // Don't re-sync within 5 seconds

/**
 * Check if Rust schema sync is available (Tauri environment)
 */
export function isRustSchemaSyncAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Sync schema data to Rust for completion/validation.
 * Non-blocking - failures are logged but don't throw.
 */
export async function syncSchemaToRust(
  connectionId: string,
  schema: string,
): Promise<void> {
  if (!isRustSchemaSyncAvailable()) {
    return;
  }

  const syncKey = `${connectionId}:${schema}`;
  const lastSync = syncedSchemas.get(syncKey);

  if (lastSync && Date.now() - lastSync < SYNC_DEBOUNCE_MS) {
    return; // Recently synced, skip
  }

  try {
    // Fetch from TypeScript cache (source of truth)
    const [tables, graph] = await Promise.all([
      schemaCache.getTables(connectionId, schema),
      schemaCache.getRelationshipGraph(connectionId, schema).catch(() => ({
        relationships: new Map(),
        reverseRelationships: new Map(),
      })),
    ]);

    // Build table data with columns
    const tableInputs: TableInput[] = await Promise.all(
      tables.map(async (t) => {
        const columns = await schemaCache.getTableColumns(
          connectionId,
          schema,
          t.name,
        );
        return {
          name: t.name,
          tableType: mapTableKind(t.kind),
          columns: columns.map((col) => ({
            name: col.name,
            dataType: col.db_type,
            nullable: col.nullable,
            isPrimaryKey: col.is_pk,
          })),
        };
      }),
    );

    // Build FK data from relationship graph
    const foreignKeys: ForeignKeyInput[] = [];
    for (const [sourceTable, rels] of graph.relationships) {
      for (const rel of rels) {
        foreignKeys.push({
          constraintName:
            rel.constraintName || `fk_${sourceTable}_${rel.sourceColumn}`,
          sourceTable,
          sourceColumn: rel.sourceColumn,
          targetTable: rel.targetTable,
          targetColumn: rel.targetColumn,
        });
      }
    }

    // TODO: Fetch enums if needed (PostgreSQL only)
    const enums: EnumInput[] = [];

    // Push to Rust
    const result = await SqlEngineService.setSchema(
      connectionId,
      schema,
      tableInputs,
      foreignKeys,
      enums,
    );

    syncedSchemas.set(syncKey, Date.now());

    logger.debug("rust-schema-sync", "Schema synced to Rust", {
      connectionId,
      schema,
      tables: result.tableCount,
      columns: result.columnCount,
    });
  } catch (error) {
    logger.warn("rust-schema-sync", "Failed to sync schema to Rust", {
      connectionId,
      schema,
      error,
    });
  }
}

function mapTableKind(kind: string): "table" | "view" | "materialized_view" {
  switch (kind) {
    case "View":
      return "view";
    case "MaterializedView":
      return "materialized_view";
    default:
      return "table";
  }
}

/**
 * Clear Rust schema cache and reset sync state
 */
export async function clearRustSchema(
  connectionId: string,
  schema?: string,
): Promise<void> {
  if (!isRustSchemaSyncAvailable()) {
    return;
  }

  try {
    await SqlEngineService.clearSchema(connectionId, schema);

    // Clear sync tracking
    if (schema) {
      syncedSchemas.delete(`${connectionId}:${schema}`);
    } else {
      for (const key of syncedSchemas.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          syncedSchemas.delete(key);
        }
      }
    }
  } catch (error) {
    logger.warn("rust-schema-sync", "Failed to clear Rust schema", {
      connectionId,
      schema,
      error,
    });
  }
}

/**
 * Hook to automatically sync schema to Rust when connection/schema changes.
 * Use in SqlEditor or other components that need Rust completion.
 */
export function useRustSchemaSync(options: UseRustSchemaSyncOptions): void {
  const { connectionId, schema, enabled = true } = options;
  const syncInProgress = useRef(false);

  useEffect(() => {
    if (!enabled || !connectionId || syncInProgress.current) {
      return;
    }

    syncInProgress.current = true;

    syncSchemaToRust(connectionId, schema).finally(() => {
      syncInProgress.current = false;
    });
  }, [connectionId, schema, enabled]);

  // Cleanup on unmount - don't clear schema, just reset state
  useEffect(() => {
    return () => {
      syncInProgress.current = false;
    };
  }, []);
}

export default useRustSchemaSync;
```

**Step 2: Integrate into SqlEditor.tsx**

In `src/components/CodeEditor/SqlEditor.tsx`, add import:

```typescript
import { useRustSchemaSync } from "@/hooks/useRustSchemaSync";
```

Then add the hook inside the component (after other hooks):

```typescript
// Sync schema to Rust for completion/validation
useRustSchemaSync({
  connectionId,
  schema: defaultSchema,
  enabled: !!connectionId && !!database,
});
```

**Step 3: Run tests**

```bash
pnpm typecheck
pnpm test:unit
```

**Step 4: Commit**

```bash
git add src/hooks/useRustSchemaSync.ts src/components/CodeEditor/SqlEditor.tsx
git commit -m "feat(sql): add useRustSchemaSync hook for push-based schema sync"
```

---

## Task 4: Create `rust-completion.ts` Bridge

**Files:**

- Create: `src/components/CodeEditor/languages/sql/rust-completion.ts`

**Step 1: Create the bridge**

```typescript
// src/components/CodeEditor/languages/sql/rust-completion.ts
/**
 * Rust Backend Completion Source
 *
 * Bridges CodeMirror autocomplete to Rust sql_complete command.
 * Uses Tauri IPC for high-performance completion.
 *
 * IMPORTANT: Schema data must be synced via useRustSchemaSync before
 * this completion source will return schema-aware results.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import type { SqlDialect } from "../../types";

interface RustCompletionConfig {
  connectionId: string;
  database: string;
  schema?: string;
  dialect: SqlDialect;
}

interface RustCompleteRequest {
  sql: string;
  position: number;
  dialect: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  explicit: boolean;
}

interface RustCompleteResponse {
  items: RustCompletionItem[];
  from: number;
  to: number;
}

interface RustCompletionItem {
  label: string;
  kind: string;
  detail: string | null;
  insertText: string | null;
  sortOrder: number;
}

// Map Rust completion kinds to CodeMirror types
const KIND_MAP: Record<string, string> = {
  keyword: "keyword",
  table: "class",
  column: "property",
  function: "function",
  schema: "namespace",
  alias: "variable",
  cte: "variable",
  snippet: "text",
  database: "namespace",
  enum: "enum",
};

/**
 * Check if Rust completion is available (Tauri environment).
 */
export function isRustCompletionAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Create a completion source that uses the Rust backend.
 */
export function createRustCompletionSource(
  config: RustCompletionConfig,
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const sql = context.state.doc.toString();

    // Skip empty documents
    if (!sql.trim()) {
      return null;
    }

    // Skip if not explicit and no trigger character
    if (!context.explicit) {
      const before = context.state.doc.sliceString(
        Math.max(0, context.pos - 1),
        context.pos,
      );
      const triggerChars = [".", " ", "(", ",", "'", '"'];
      if (!triggerChars.includes(before)) {
        // Check for word being typed (at least 2 chars)
        const word = context.matchBefore(/\w+/);
        if (!word || word.text.length < 2) {
          return null;
        }
      }
    }

    try {
      const request: RustCompleteRequest = {
        sql,
        position: context.pos,
        dialect: config.dialect,
        connectionId: config.connectionId,
        database: config.database,
        schema: config.schema,
        explicit: context.explicit,
      };

      const response = await invoke<RustCompleteResponse>("sql_complete", {
        request,
      });

      if (!response.items.length) {
        return null;
      }

      const completions: Completion[] = response.items.map((item) => ({
        label: item.label,
        type: KIND_MAP[item.kind] || "text",
        detail: item.detail || undefined,
        apply: item.insertText || item.label,
        boost: -item.sortOrder, // Lower sortOrder = higher priority
      }));

      return {
        from: response.from,
        to: response.to,
        options: completions,
        validFor: /^\w*$/,
      };
    } catch (error) {
      console.error("[rust-completion] Error:", error);
      return null;
    }
  };
}
```

**Step 2: Commit**

```bash
git add src/components/CodeEditor/languages/sql/rust-completion.ts
git commit -m "feat(sql): add rust-completion bridge for Tauri IPC"
```

---

## Task 5: Integrate Rust Completion into optimized-completion

**Files:**

- Modify: `src/components/CodeEditor/languages/sql/optimized-completion.ts`

**Step 1: Add imports**

```typescript
import {
  createRustCompletionSource,
  isRustCompletionAvailable,
} from "./rust-completion";
```

**Step 2: Modify createOptimizedCompletionSource**

Replace the function implementation to try Rust first:

```typescript
export function createOptimizedCompletionSource(config: CompletionConfig) {
  const { connectionId, schema, dialect = "postgresql", database } = config;
  const defaultSchema = schema || "public";

  // Create TypeScript provider as fallback
  const provider = createSqlMetadataProvider(connectionId, defaultSchema);

  // Create Rust source if available
  const rustSource = isRustCompletionAvailable() && connectionId && database
    ? createRustCompletionSource({
        connectionId,
        database,
        schema: defaultSchema,
        dialect,
      })
    : null;

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Try Rust completion first (faster, uses pre-synced schema)
    if (rustSource) {
      try {
        const rustResult = await rustSource(context);
        if (rustResult && rustResult.options.length > 0) {
          return rustResult;
        }
      } catch (error) {
        console.warn("[optimized-completion] Rust completion failed, falling back to TypeScript:", error);
      }
    }

    // Fall back to TypeScript completion (existing implementation)
    // ... rest of existing code stays the same
```

**Step 3: Run tests**

```bash
pnpm typecheck
pnpm test:unit
```

**Step 4: Commit**

```bash
git add src/components/CodeEditor/languages/sql/optimized-completion.ts
git commit -m "feat(sql): integrate Rust completion with TypeScript fallback"
```

---

## Task 6: Wire Rust Validation to Unified Linter

**Files:**

- Modify: `src/components/CodeEditor/languages/sql/unified-linter.ts`

**Step 1: Add Rust validation support**

Add imports and helper function:

```typescript
import { invoke } from "@tauri-apps/api/core";

function isRustLintingAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

interface RustValidateRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface RustValidateResponse {
  valid: boolean;
  errors: Array<{
    from: number;
    to: number;
    message: string;
    severity: string;
    source: string;
  }>;
  warnings: Array<{
    from: number;
    to: number;
    message: string;
    severity: string;
    source: string;
  }>;
}

async function lintWithRust(
  sql: string,
  dialect: string,
  connectionId?: string,
  schema?: string,
): Promise<LintDiagnostic[]> {
  const response = await invoke<RustValidateResponse>("sql_validate", {
    request: { sql, dialect, connectionId, schema },
  });

  const diagnostics: LintDiagnostic[] = [];

  for (const err of response.errors) {
    diagnostics.push({
      from: err.from,
      to: err.to,
      severity: "error",
      message: err.message,
      source: err.source as "syntax" | "semantic" | "version",
    });
  }

  for (const warn of response.warnings) {
    diagnostics.push({
      from: warn.from,
      to: warn.to,
      severity: "warning",
      message: warn.message,
      source: warn.source as "syntax" | "semantic" | "version",
    });
  }

  return diagnostics;
}
```

**Step 2: Update main lint function to try Rust first**

```typescript
async function lint(
  sql: string,
  config: UnifiedLinterConfig,
): Promise<LintDiagnostic[]> {
  // Try Rust validation first (faster, more accurate for syntax)
  if (isRustLintingAvailable()) {
    try {
      return await lintWithRust(
        sql,
        config.dialect,
        config.connectionId,
        config.schema,
      );
    } catch (error) {
      console.warn(
        "[unified-linter] Rust validation failed, falling back to worker:",
        error,
      );
    }
  }

  // Fall back to worker-based validation
  return lintWithWorker(sql, config);
}
```

**Step 3: Run tests**

```bash
pnpm test:unit
```

**Step 4: Commit**

```bash
git add src/components/CodeEditor/languages/sql/unified-linter.ts
git commit -m "feat(sql): wire Rust validation into unified linter"
```

---

## Task 7 & 8: Remove Legacy Linters

(Same as original plan - Tasks 5 & 6 in v1)

**Files:**

- Modify: `src/components/CodeEditor/SqlEditor.tsx`
- Modify: `src/components/CodeEditor/extensions.ts`
- Modify: `src/components/CodeEditor/languages/sql/index.ts`
- Delete: `src/components/CodeEditor/languages/sql/sql-linter.ts`
- Delete: `src/components/CodeEditor/languages/sql/version-linter.ts`

See original plan for detailed steps.

---

## Task 9: Clean Up Rust Warnings

Run `cargo check` and fix any unused import warnings.

---

## Summary

| Task | Description                | Key Change                          |
| ---- | -------------------------- | ----------------------------------- |
| 1    | `sql_set_schema` command   | Receives schema from frontend       |
| 2    | Delete `schema_queries.rs` | TypeScript is single source         |
| 3    | `useRustSchemaSync` hook   | Push schema to Rust on connection   |
| 4    | `rust-completion.ts`       | Bridge to Rust completion           |
| 5    | Integrate Rust completion  | Try Rust first, TypeScript fallback |
| 6    | Rust validation            | Try Rust first, worker fallback     |
| 7-8  | Remove legacy linters      | Cleanup                             |

**Adding New Database Support:**

- Only update TypeScript adapters (`src/adapters/dialects/`)
- Rust automatically receives schema data via `sql_set_schema`
- No duplicate query maintenance!

---

## Migration Notes

This plan supersedes `2026-01-08-sql-editor-rust-integration.md` (v1).

Key differences:

1. **v1**: Rust fetches schema via own `schema_queries.rs`
2. **v2**: Frontend pushes schema to Rust via `sql_set_schema`

v2 eliminates duplicate query maintenance across TypeScript and Rust.
