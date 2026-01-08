# SQL Editor Rust Backend Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the orphaned Rust sql_engine backend to the frontend, enabling 19 smart SQL features.

**Architecture:** The Rust backend (14 modules, 3800+ lines) exists but frontend doesn't use it. This plan wires up schema population, completion bridge, validation integration, and removes legacy linters.

**Tech Stack:** Rust (sqlparser-rs 0.52), TypeScript, Tauri IPC, CodeMirror 6

---

## Overview

| Task | Description | Parallelizable |
|------|-------------|----------------|
| 1 | Add `sql_fetch_schema` Tauri command | Yes (with 2) |
| 2 | Create `rust-completion.ts` bridge | Yes (with 1) |
| 3 | Integrate schema fetching into completion | No (needs 1) |
| 4 | Wire Rust validation to unified-linter | No (needs 1) |
| 5 | Remove legacy linters from SqlEditor | No (needs 4) |
| 6 | Delete legacy linter files | No (needs 5) |
| 7 | Add bracket-matching extension | Yes (independent) |
| 8 | Clean up Rust warnings | Yes (independent) |

**Parallel Execution Strategy:**
- **Wave 1:** Tasks 1, 2, 7, 8 (all independent)
- **Wave 2:** Task 3 (depends on 1)
- **Wave 3:** Task 4 (depends on 1)
- **Wave 4:** Tasks 5, 6 (sequential cleanup)

---

## Task 1: Add `sql_fetch_schema` Tauri Command

**Files:**
- Modify: `src-tauri/src/sql_engine/commands.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/services/sqlEngineService.ts`

**Step 1: Add Rust command for schema fetching**

In `src-tauri/src/sql_engine/commands.rs`, add after existing commands:

```rust
use super::schema_queries::{get_tables_query, get_columns_query, get_foreign_keys_query, get_enums_query};
use super::schema_store::{SCHEMA_STORE, CacheKey, CachedSchemaBuilder, TableInfo, ColumnInfo, ForeignKeyInfo, EnumInfo, TableType};
use crate::adapters::DbAdapter;

/// Request to fetch schema metadata
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchSchemaRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub dialect: String,
}

/// Schema metadata response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMetadata {
    pub tables: Vec<TableMetadata>,
    pub enums: Vec<EnumMetadata>,
    pub cached: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: String,
    pub columns: Vec<ColumnMetadata>,
    pub foreign_keys: Vec<ForeignKeyMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyMetadata {
    pub column: String,
    pub references_table: String,
    pub references_column: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumMetadata {
    pub name: String,
    pub values: Vec<String>,
}

/// Fetch schema metadata for a connection
#[tauri::command]
pub async fn sql_fetch_schema(
    request: FetchSchemaRequest,
    manager: State<'_, ConnectionManager>,
) -> Result<SchemaMetadata, String> {
    let dialect = parse_dialect(&request.dialect);
    let cache_key = CacheKey::new(&request.connection_id, &request.schema);

    // Check cache first
    if let Some(cached) = SCHEMA_STORE.get(&cache_key) {
        return Ok(convert_cached_to_response(cached, true));
    }

    // Fetch from database
    let conn = manager
        .get(&request.connection_id)
        .await
        .ok_or_else(|| format!("Connection {} not found", request.connection_id))?;

    let adapter = conn.adapter();

    // Fetch tables
    let tables_query = get_tables_query(dialect, &request.schema);
    let tables_result = adapter.query(&tables_query).await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let mut tables = Vec::new();
    for row in tables_result.rows {
        let table_name = row.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let table_type = row.get("table_type").and_then(|v| v.as_str()).unwrap_or("BASE TABLE").to_string();

        // Fetch columns for this table
        let columns_query = get_columns_query(dialect, &request.schema, &table_name);
        let columns_result = adapter.query(&columns_query).await.unwrap_or_default();

        let columns: Vec<ColumnMetadata> = columns_result.rows.iter().map(|col| {
            ColumnMetadata {
                name: col.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data_type: col.get("data_type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
                nullable: col.get("nullable").and_then(|v| v.as_bool()).unwrap_or(true),
                is_primary_key: col.get("is_primary_key").and_then(|v| v.as_bool()).unwrap_or(false),
            }
        }).collect();

        // Fetch foreign keys
        let fk_query = get_foreign_keys_query(dialect, &request.schema, &table_name);
        let fk_result = adapter.query(&fk_query).await.unwrap_or_default();

        let foreign_keys: Vec<ForeignKeyMetadata> = fk_result.rows.iter().map(|fk| {
            ForeignKeyMetadata {
                column: fk.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                references_table: fk.get("referenced_table").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                references_column: fk.get("referenced_column").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            }
        }).collect();

        tables.push(TableMetadata {
            name: table_name,
            schema: Some(request.schema.clone()),
            table_type,
            columns,
            foreign_keys,
        });
    }

    // Fetch enums (PostgreSQL only for now)
    let enums = if dialect == SqlDialect::PostgreSQL {
        let enums_query = get_enums_query(dialect, &request.schema);
        let enums_result = adapter.query(&enums_query).await.unwrap_or_default();

        enums_result.rows.iter().map(|e| {
            EnumMetadata {
                name: e.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                values: e.get("values").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            }
        }).collect()
    } else {
        Vec::new()
    };

    // Cache the result
    let mut builder = CachedSchemaBuilder::new();
    for table in &tables {
        builder = builder.add_table(TableInfo {
            name: table.name.clone(),
            schema: table.schema.clone(),
            table_type: if table.table_type == "VIEW" { TableType::View } else { TableType::Table },
            comment: None,
            row_count: None,
        });
        for col in &table.columns {
            builder = builder.add_column(&table.name, ColumnInfo {
                name: col.name.clone(),
                data_type: col.data_type.clone(),
                nullable: col.nullable,
                default_value: None,
                is_primary_key: col.is_primary_key,
                comment: None,
            });
        }
        for fk in &table.foreign_keys {
            builder = builder.add_foreign_key(&table.name, ForeignKeyInfo {
                column: fk.column.clone(),
                references_table: fk.references_table.clone(),
                references_column: fk.references_column.clone(),
                constraint_name: None,
            });
        }
    }
    for e in &enums {
        builder = builder.add_enum(EnumInfo {
            name: e.name.clone(),
            schema: Some(request.schema.clone()),
            values: e.values.clone(),
        });
    }
    SCHEMA_STORE.put(cache_key, builder.build());

    Ok(SchemaMetadata { tables, enums, cached: false })
}

fn convert_cached_to_response(cached: CachedSchema, is_cached: bool) -> SchemaMetadata {
    // Convert cached schema to response format
    SchemaMetadata {
        tables: cached.tables.iter().map(|t| {
            let columns = cached.columns.get(&t.name).cloned().unwrap_or_default();
            let fks = cached.foreign_keys.get(&t.name).cloned().unwrap_or_default();
            TableMetadata {
                name: t.name.clone(),
                schema: t.schema.clone(),
                table_type: format!("{:?}", t.table_type),
                columns: columns.into_iter().map(|c| ColumnMetadata {
                    name: c.name,
                    data_type: c.data_type,
                    nullable: c.nullable,
                    is_primary_key: c.is_primary_key,
                }).collect(),
                foreign_keys: fks.into_iter().map(|fk| ForeignKeyMetadata {
                    column: fk.column,
                    references_table: fk.references_table,
                    references_column: fk.references_column,
                }).collect(),
            }
        }).collect(),
        enums: cached.enums.iter().map(|e| EnumMetadata {
            name: e.name.clone(),
            values: e.values.clone(),
        }).collect(),
        cached: is_cached,
    }
}
```

**Step 2: Register command in main.rs**

In `src-tauri/src/main.rs`, add to the `invoke_handler`:

```rust
sql_engine::commands::sql_fetch_schema,
```

**Step 3: Add TypeScript interface**

In `src/services/sqlEngineService.ts`, add:

```typescript
// =============================================================================
// Schema Fetch Types
// =============================================================================

export interface FetchSchemaRequest {
  connectionId: string;
  database: string;
  schema: string;
  dialect: SqlDialect;
}

export interface SchemaMetadata {
  tables: TableMetadata[];
  enums: EnumMetadata[];
  cached: boolean;
}

export interface TableMetadata {
  name: string;
  schema: string | null;
  tableType: string;
  columns: ColumnMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyMetadata {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface EnumMetadata {
  name: string;
  values: string[];
}

// Add to SqlEngineService object:

  /**
   * Fetch schema metadata for a connection.
   * Results are cached in Rust with 30-second TTL.
   */
  async fetchSchema(
    connectionId: string,
    database: string,
    schema: string,
    dialect: SqlDialect
  ): Promise<SchemaMetadata> {
    return invoke<SchemaMetadata>("sql_fetch_schema", {
      request: { connectionId, database, schema, dialect },
    });
  },

  /**
   * Invalidate schema cache for a connection.
   */
  async invalidateSchema(connectionId: string, schema?: string): Promise<void> {
    return invoke("sql_invalidate_schema", {
      connectionId,
      schema,
    });
  },
```

**Step 4: Run Rust compilation check**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds (may have warnings)

**Step 5: Run TypeScript type check**

Run: `pnpm typecheck`
Expected: No type errors

**Step 6: Commit**

```bash
git add src-tauri/src/sql_engine/commands.rs src-tauri/src/main.rs src/services/sqlEngineService.ts
git commit -m "feat(sql-engine): add sql_fetch_schema command for schema metadata"
```

---

## Task 2: Create `rust-completion.ts` Bridge

**Files:**
- Create: `src/components/CodeEditor/languages/sql/rust-completion.ts`
- Test: `src/components/CodeEditor/languages/sql/rust-completion.test.ts`

**Step 1: Write the test file**

```typescript
// src/components/CodeEditor/languages/sql/rust-completion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRustCompletionSource } from './rust-completion';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('createRustCompletionSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a completion source function', () => {
    const source = createRustCompletionSource({
      connectionId: 'test-conn',
      database: 'testdb',
      schema: 'public',
      dialect: 'postgresql',
    });

    expect(typeof source).toBe('function');
  });

  it('should return null for empty document', async () => {
    const source = createRustCompletionSource({
      connectionId: 'test-conn',
      database: 'testdb',
      schema: 'public',
      dialect: 'postgresql',
    });

    // Mock empty context
    const mockContext = {
      state: { doc: { toString: () => '' } },
      pos: 0,
      explicit: false,
    };

    const result = await source(mockContext as any);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit rust-completion`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/components/CodeEditor/languages/sql/rust-completion.ts
/**
 * Rust Backend Completion Source
 *
 * Bridges CodeMirror autocomplete to Rust sql_complete command.
 * Uses Tauri IPC for high-performance completion.
 */

import { invoke } from "@tauri-apps/api/core";
import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
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
 * Create a completion source that uses the Rust backend.
 */
export function createRustCompletionSource(
  config: RustCompletionConfig
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const sql = context.state.doc.toString();

    // Skip empty documents
    if (!sql.trim()) {
      return null;
    }

    // Skip if not explicit and no trigger character
    if (!context.explicit) {
      const before = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos);
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

      const response = await invoke<RustCompleteResponse>("sql_complete", { request });

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

/**
 * Check if Rust completion is available (Tauri environment).
 */
export function isRustCompletionAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit rust-completion`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CodeEditor/languages/sql/rust-completion.*
git commit -m "feat(sql): add rust-completion bridge for Tauri IPC"
```

---

## Task 3: Integrate Schema Fetching into Completion

**Files:**
- Modify: `src/components/CodeEditor/languages/sql/optimized-completion.ts`
- Modify: `src/components/CodeEditor/languages/sql/rust-completion.ts`

**Step 1: Add schema prefetching to rust-completion.ts**

Add to `rust-completion.ts`:

```typescript
import { SqlEngineService } from "@/services/sqlEngineService";

// Schema cache
let schemaCache: Map<string, { data: any; timestamp: number }> = new Map();
const SCHEMA_CACHE_TTL = 30000; // 30 seconds (matches Rust TTL)

async function ensureSchemaLoaded(config: RustCompletionConfig): Promise<void> {
  const cacheKey = `${config.connectionId}:${config.schema || "public"}`;
  const cached = schemaCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL) {
    return; // Schema already cached
  }

  try {
    // This populates the Rust SchemaStore
    await SqlEngineService.fetchSchema(
      config.connectionId,
      config.database,
      config.schema || "public",
      config.dialect
    );

    schemaCache.set(cacheKey, { data: true, timestamp: Date.now() });
  } catch (error) {
    console.warn("[rust-completion] Schema fetch failed:", error);
  }
}

// Update createRustCompletionSource to call ensureSchemaLoaded before completion
```

**Step 2: Update optimized-completion.ts to use Rust backend**

Add to top of `optimized-completion.ts`:

```typescript
import { createRustCompletionSource, isRustCompletionAvailable } from "./rust-completion";

// ... existing code ...

// In createOptimizedCompletionSource, add hybrid approach:
export function createOptimizedCompletionSource(config: CompletionConfig) {
  // Use Rust backend when available
  if (isRustCompletionAvailable()) {
    const rustSource = createRustCompletionSource({
      connectionId: config.connectionId,
      database: config.database,
      schema: config.schema,
      dialect: config.dialect || "postgresql",
    });

    // Combine with existing TS source for fallback
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      // Try Rust first
      try {
        const rustResult = await rustSource(context);
        if (rustResult && rustResult.options.length > 0) {
          return rustResult;
        }
      } catch (error) {
        console.warn("[optimized-completion] Rust fallback:", error);
      }

      // Fall back to TypeScript implementation
      return existingCompletionLogic(context);
    };
  }

  // Non-Tauri: use existing TypeScript implementation
  return existingCompletionLogic;
}
```

**Step 3: Run TypeScript check**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Run test suite**

Run: `pnpm test:unit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/CodeEditor/languages/sql/optimized-completion.ts src/components/CodeEditor/languages/sql/rust-completion.ts
git commit -m "feat(sql): integrate Rust completion with schema prefetching"
```

---

## Task 4: Wire Rust Validation to Unified Linter

**Files:**
- Modify: `src/components/CodeEditor/languages/sql/unified-linter-worker.ts`
- Modify: `src/components/CodeEditor/languages/sql/unified-linter.ts`

**Step 1: Update unified-linter.ts to use Rust validation**

Replace the `lint` function:

```typescript
import { invoke } from "@tauri-apps/api/core";

interface RustValidateRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface RustValidateResponse {
  valid: boolean;
  errors: RustError[];
  warnings: RustError[];
}

interface RustError {
  from: number;
  to: number;
  message: string;
  severity: string;
  source: string;
}

async function lintWithRust(
  sql: string,
  config: UnifiedLinterConfig
): Promise<LintDiagnostic[]> {
  try {
    const request: RustValidateRequest = {
      sql,
      dialect: config.dialect,
      connectionId: config.connectionId,
    };

    const response = await invoke<RustValidateResponse>("sql_validate", { request });

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
  } catch (error) {
    console.error("[unified-linter] Rust validation error:", error);
    // Fall back to worker
    return lintWithWorker(sql, config);
  }
}

// Update the linter to try Rust first
async function lint(sql: string, config: UnifiedLinterConfig): Promise<LintDiagnostic[]> {
  // Check if Tauri is available
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return lintWithRust(sql, config);
  }
  return lintWithWorker(sql, config);
}
```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: All pass

**Step 3: Commit**

```bash
git add src/components/CodeEditor/languages/sql/unified-linter.ts
git commit -m "feat(sql): wire Rust validation into unified linter"
```

---

## Task 5: Remove Legacy Linters from SqlEditor

**Files:**
- Modify: `src/components/CodeEditor/SqlEditor.tsx`

**Step 1: Remove legacy linter imports**

In `SqlEditor.tsx`, remove these imports (lines 90-91):

```typescript
// DELETE THESE LINES:
import { createSemanticLinter } from "./languages/sql/sql-linter";
import { createVersionLinter } from "./languages/sql/version-linter";
```

**Step 2: Remove legacy linter usage**

In the `semanticExtensions` useMemo (around line 509-511), remove:

```typescript
// DELETE THESE LINES:
createSemanticLinter(provider, defaultSchema),
createVersionLinter(effectiveDialect, connectionId),
```

The remaining extensions should be:

```typescript
const semanticExtensions = useMemo(() => {
  return [
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 150,
      maxRenderedOptions: 30,
      defaultKeymap: true,
    }),
    createSqlHoverExtension(provider, defaultSchema),
    createExpandStarExtension(provider, defaultSchema, effectiveDialect),
  ];
}, [connectionId, defaultSchema, effectiveDialect, sqlLang]);
```

**Step 3: Run TypeScript check**

Run: `pnpm typecheck`
Expected: No errors (may show unused imports warning in deleted files)

**Step 4: Run test suite**

Run: `pnpm test:unit`
Expected: All pass

**Step 5: Manual test**

Run: `pnpm tauri:dev`
Test: Open SQL editor, verify linting still works

**Step 6: Commit**

```bash
git add src/components/CodeEditor/SqlEditor.tsx
git commit -m "refactor(sql-editor): remove legacy semantic and version linters"
```

---

## Task 6: Delete Legacy Linter Files

**Files:**
- Delete: `src/components/CodeEditor/languages/sql/sql-linter.ts`
- Delete: `src/components/CodeEditor/languages/sql/version-linter.ts`
- Delete: `src/components/CodeEditor/languages/sql/linter-worker.ts`

**Step 1: Check for remaining imports**

Run: `grep -r "sql-linter\|version-linter\|linter-worker" src/components/CodeEditor/`
Expected: Only in index.ts or no matches

**Step 2: Update index.ts if needed**

If `index.ts` exports these files, remove those exports.

**Step 3: Delete files**

```bash
rm src/components/CodeEditor/languages/sql/sql-linter.ts
rm src/components/CodeEditor/languages/sql/version-linter.ts
rm src/components/CodeEditor/languages/sql/linter-worker.ts
```

**Step 4: Run TypeScript check**

Run: `pnpm typecheck`
Expected: No errors

**Step 5: Run test suite**

Run: `pnpm test:unit`
Expected: All pass (tests for deleted files should also be removed if they exist)

**Step 6: Commit**

```bash
git add -A
git commit -m "chore(sql): delete legacy linter files (merged into unified-linter)"
```

---

## Task 7: Add Bracket Matching Extension

**Files:**
- Create: `src/components/CodeEditor/extensions/bracket-matching.ts`
- Modify: `src/components/CodeEditor/SqlEditor.tsx`

**Step 1: Create bracket matching extension**

```typescript
// src/components/CodeEditor/extensions/bracket-matching.ts
/**
 * SQL Keyword Bracket Matching
 *
 * Extends CodeMirror's bracket matching to handle SQL keyword pairs:
 * - BEGIN/END
 * - CASE/END
 * - IF/END IF
 * - LOOP/END LOOP
 */

import { Extension } from "@codemirror/state";
import { bracketMatching, MatchResult } from "@codemirror/language";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";

// SQL keyword pairs for matching
const SQL_KEYWORD_PAIRS: Array<[string, string]> = [
  ["BEGIN", "END"],
  ["CASE", "END"],
  ["IF", "END IF"],
  ["LOOP", "END LOOP"],
  ["DO", "END"],
];

// Decoration for matched keywords
const matchedKeywordMark = Decoration.mark({ class: "cm-matchingBracket" });
const unmatchedKeywordMark = Decoration.mark({ class: "cm-nonmatchingBracket" });

/**
 * Create SQL bracket matching extension.
 * Includes standard bracket matching plus SQL keyword pairs.
 */
export function createSqlBracketMatchingExtension(): Extension {
  return [
    // Standard bracket matching for (), [], {}
    bracketMatching(),
    // SQL keyword pair highlighting
    sqlKeywordMatchingPlugin,
  ];
}

const sqlKeywordMatchingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.getDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.getDecorations(update.view);
      }
    }

    getDecorations(view: EditorView): DecorationSet {
      const decorations: any[] = [];
      const cursor = view.state.selection.main.head;
      const doc = view.state.doc.toString().toUpperCase();

      // Find keyword at cursor
      const word = this.getWordAt(view.state.doc.toString(), cursor);
      if (!word) return Decoration.none;

      const upperWord = word.text.toUpperCase();

      for (const [open, close] of SQL_KEYWORD_PAIRS) {
        if (upperWord === open) {
          // Find matching close
          const matchPos = this.findMatchingClose(doc, word.to, open, close);
          if (matchPos >= 0) {
            decorations.push(matchedKeywordMark.range(word.from, word.to));
            decorations.push(matchedKeywordMark.range(matchPos, matchPos + close.length));
          } else {
            decorations.push(unmatchedKeywordMark.range(word.from, word.to));
          }
          break;
        } else if (upperWord === close || upperWord === close.split(" ")[0]) {
          // Find matching open
          const matchPos = this.findMatchingOpen(doc, word.from, open, close);
          if (matchPos >= 0) {
            decorations.push(matchedKeywordMark.range(matchPos, matchPos + open.length));
            decorations.push(matchedKeywordMark.range(word.from, word.to));
          } else {
            decorations.push(unmatchedKeywordMark.range(word.from, word.to));
          }
          break;
        }
      }

      return Decoration.set(decorations, true);
    }

    getWordAt(doc: string, pos: number): { from: number; to: number; text: string } | null {
      const before = doc.slice(0, pos);
      const after = doc.slice(pos);
      const beforeMatch = before.match(/\w+$/);
      const afterMatch = after.match(/^\w*/);

      if (!beforeMatch && !afterMatch) return null;

      const from = pos - (beforeMatch?.[0].length || 0);
      const to = pos + (afterMatch?.[0].length || 0);
      const text = doc.slice(from, to);

      return text ? { from, to, text } : null;
    }

    findMatchingClose(doc: string, start: number, open: string, close: string): number {
      let depth = 1;
      let i = start;

      while (i < doc.length && depth > 0) {
        if (doc.slice(i).startsWith(open) && /\b/.test(doc[i - 1] || " ")) {
          depth++;
          i += open.length;
        } else if (doc.slice(i).startsWith(close) && /\b/.test(doc[i - 1] || " ")) {
          depth--;
          if (depth === 0) return i;
          i += close.length;
        } else {
          i++;
        }
      }
      return -1;
    }

    findMatchingOpen(doc: string, end: number, open: string, close: string): number {
      let depth = 1;
      let i = end - 1;

      while (i >= 0 && depth > 0) {
        if (doc.slice(i, i + close.length) === close) {
          depth++;
          i--;
        } else if (doc.slice(i, i + open.length) === open) {
          depth--;
          if (depth === 0) return i;
          i--;
        } else {
          i--;
        }
      }
      return -1;
    }
  },
  { decorations: (v) => v.decorations }
);
```

**Step 2: Import and use in SqlEditor.tsx**

Add import:

```typescript
import { createSqlBracketMatchingExtension } from "./extensions/bracket-matching";
```

Replace `bracketMatching()` usage:

```typescript
// Replace:
bracketMatching(),

// With:
createSqlBracketMatchingExtension(),
```

**Step 3: Run tests**

Run: `pnpm test:unit && pnpm typecheck`
Expected: All pass

**Step 4: Commit**

```bash
git add src/components/CodeEditor/extensions/bracket-matching.ts src/components/CodeEditor/SqlEditor.tsx
git commit -m "feat(sql): add SQL keyword bracket matching (BEGIN/END, CASE/END)"
```

---

## Task 8: Clean Up Rust Warnings

**Files:**
- Modify: `src-tauri/src/sql_engine/commands.rs`
- Modify: `src-tauri/src/sql_engine/cte_inference.rs`
- Modify: `src-tauri/src/sql_engine/parser.rs`
- Modify: `src-tauri/src/sql_engine/schema_store.rs`
- Modify: `src-tauri/src/sql_engine/sp_params.rs`

**Step 1: Run cargo check to see warnings**

Run: `cd src-tauri && cargo check 2>&1 | grep "warning:"`

**Step 2: Fix unused imports**

Remove unused imports from each file as indicated by warnings.

Example for `commands.rs`:
```rust
// Remove unused imports from line 10-11
use super::{
    complete, parse_document, validate_document,
    CompletionRequest, SqlDialect,
};
```

**Step 3: Verify clean build**

Run: `cd src-tauri && cargo check`
Expected: No warnings

**Step 4: Commit**

```bash
git add src-tauri/src/sql_engine/
git commit -m "chore(rust): fix unused import warnings in sql_engine"
```

---

## Summary

| Task | Files Changed | Parallelizable |
|------|---------------|----------------|
| 1. sql_fetch_schema | 3 files | Yes |
| 2. rust-completion.ts | 2 files | Yes |
| 3. Schema integration | 2 files | No (needs 1) |
| 4. Rust validation | 1 file | No (needs 1) |
| 5. Remove legacy linters | 1 file | No (needs 4) |
| 6. Delete legacy files | 3 files deleted | No (needs 5) |
| 7. Bracket matching | 2 files | Yes |
| 8. Clean Rust warnings | 5 files | Yes |

**Total: 8 tasks across 19 files**

---

Plan complete and saved to `docs/plans/2026-01-08-sql-editor-rust-integration.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
