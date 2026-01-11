# SQL Refactoring Tools Design

**Date:** 2026-01-10  
**Status:** Approved  
**Author:** AI-assisted design session

## Overview

This document describes the design for robust SQL refactoring tools in Query Pilot, replacing fragile regex-based parsing with AST-powered features. The implementation enables three key capabilities:

1. **Bulletproof Query Outline** - Accurate CTE/Table/Join/Subquery detection for any complexity
2. **Smart Rename** - Rename aliases, CTEs, or columns with all references updating correctly
3. **Extract to CTE** - Select a subquery and refactor it into a named CTE

### Scope

- **Dialects:** All supported dialects (PostgreSQL, MySQL, SQLite, SQL Server, Oracle)
- **UX:** Context menu + keyboard shortcuts + lightbulb code actions
- **Error Handling:** Graceful degradation when queries are unparseable
- **Processing:** All logic runs in Rust backend (single source of truth)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
├─────────────────────────────────────────────────────────────────┤
│  CodeEditor                    │  QueryOutline Panel            │
│  ├─ CodeActions (lightbulb)    │  ├─ Tree view of AST symbols   │
│  ├─ ContextMenu (right-click)  │  └─ Click to navigate          │
│  └─ Keyboard shortcuts (F2)    │                                │
└──────────────┬─────────────────┴────────────────────────────────┘
               │ Tauri IPC Commands
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Rust Backend (sql_engine)                    │
├─────────────────────────────────────────────────────────────────┤
│  New Commands:                                                   │
│  ├─ sql_get_outline(sql, dialect) → OutlineTree                 │
│  ├─ sql_get_refactor_actions(sql, dialect, cursor_pos) → Actions│
│  └─ sql_apply_refactor(sql, dialect, action, params) → NewSQL   │
│                                                                  │
│  New Module: refactor.rs                                         │
│  ├─ OutlineBuilder (AST → structured tree)                      │
│  ├─ SymbolFinder (locate all references to a symbol)            │
│  └─ Refactorings (rename, extract_cte)                          │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Frontend never parses SQL. It sends raw text to Rust and receives structured results.

---

## Rust Backend Module Design

### New Module Structure

```
src-tauri/src/sql_engine/
├── mod.rs              # Add: pub mod refactor; pub mod outline; pub mod symbol_finder;
├── refactor.rs         # NEW: Core refactoring logic
├── outline.rs          # NEW: AST → OutlineTree conversion
├── symbol_finder.rs    # NEW: Find all references to a symbol
└── ... (existing files)
```

### Core Data Types

```rust
// outline.rs

#[derive(Serialize)]
pub struct OutlineTree {
    pub statements: Vec<StatementOutline>,
    pub parse_status: ParseStatus,  // Full | Partial | Failed
}

#[derive(Serialize)]
pub enum ParseStatus {
    Full,      // Complete AST available, all features enabled
    Partial,   // Some statements parsed, refactoring disabled
    Failed,    // Parse failed, falls back to regex
}

#[derive(Serialize)]
pub struct StatementOutline {
    pub kind: StatementKind,        // Select, Insert, Update, Delete, CreateTable, etc.
    pub span: TextSpan,             // { start: usize, end: usize }
    pub ctes: Vec<CteOutline>,
    pub tables: Vec<TableOutline>,  // FROM/JOIN tables with aliases
    pub columns: Vec<ColumnRef>,    // Referenced columns
    pub subqueries: Vec<StatementOutline>,  // Recursive
}

#[derive(Serialize)]
pub struct CteOutline {
    pub name: String,
    pub span: TextSpan,
    pub name_span: TextSpan,        // Just the CTE name, for rename
    pub references: Vec<TextSpan>,  // Where this CTE is used
}

#[derive(Serialize)]
pub struct TableOutline {
    pub name: String,               // Schema-qualified if present
    pub alias: Option<String>,
    pub span: TextSpan,
    pub alias_span: Option<TextSpan>,
    pub join_type: Option<JoinType>,
}

#[derive(Serialize)]
pub struct TextSpan {
    pub start: usize,
    pub end: usize,
}
```

### Graceful Degradation Strategy

The `ParseStatus` enum drives frontend behavior:

| Status    | Outline Behavior                   | Refactoring Behavior                                   |
| --------- | ---------------------------------- | ------------------------------------------------------ |
| `Full`    | Complete AST-based tree            | All actions available                                  |
| `Partial` | Shows what could be parsed         | Disabled with tooltip "Fix syntax errors to enable..." |
| `Failed`  | Falls back to existing regex logic | Disabled                                               |

---

## Tauri Commands API

### Three New Commands

```rust
// src-tauri/src/sql_engine/commands.rs

/// Get structured outline for Query Outline panel
/// Called: On document change (debounced ~300ms)
#[tauri::command]
pub fn sql_get_outline(
    sql: String,
    dialect: String,
) -> Result<OutlineTree, String> {
    let dialect = parse_dialect(&dialect)?;
    match parse_sql(&sql, dialect) {
        Ok(ast) => Ok(OutlineBuilder::build(&ast, &sql)),
        Err(_) => Ok(OutlineBuilder::build_partial(&sql)),
    }
}

/// Get available refactor actions at cursor position
/// Called: On cursor move (debounced ~150ms) for lightbulb
/// Called: On right-click for context menu
#[tauri::command]
pub fn sql_get_refactor_actions(
    sql: String,
    dialect: String,
    cursor_offset: usize,
) -> Result<Vec<RefactorAction>, String> {
    // Returns actions like:
    // - { kind: "rename", label: "Rename 'u' alias", symbol_span: {...} }
    // - { kind: "extract_cte", label: "Extract to CTE", selection_span: {...} }
}

/// Apply a refactoring and return the new SQL
/// Called: When user confirms a refactor action
#[tauri::command]
pub fn sql_apply_refactor(
    sql: String,
    dialect: String,
    action: RefactorRequest,
) -> Result<RefactorResult, String> {
    // RefactorRequest variants:
    // - Rename { symbol_span, new_name }
    // - ExtractCte { selection_span, cte_name }
}
```

### Response Types

```rust
#[derive(Serialize)]
pub struct RefactorAction {
    pub kind: RefactorKind,             // Rename | ExtractCte
    pub label: String,                  // "Rename alias 'u'"
    pub symbol: Option<String>,         // The symbol name if applicable
    pub span: TextSpan,                 // What will be affected
    pub enabled: bool,                  // false if parse incomplete
    pub disabled_reason: Option<String>,// "Fix syntax errors first"
}

#[derive(Deserialize)]
pub enum RefactorRequest {
    Rename { symbol_span: TextSpan, new_name: String },
    ExtractCte { selection_span: TextSpan, cte_name: String },
}

#[derive(Serialize)]
pub struct RefactorResult {
    pub new_sql: String,
    pub edits: Vec<TextEdit>,
    pub cursor_position: usize,
}

#[derive(Serialize)]
pub struct TextEdit {
    pub span: TextSpan,
    pub new_text: String,
}
```

### Performance Considerations

- `sql_get_outline`: Cache AST per document, invalidate on change
- `sql_get_refactor_actions`: Lightweight lookup into cached AST
- All commands are synchronous (fast enough, <10ms for typical queries)

---

## Frontend Integration

### New Files & Changes

```
src/components/CodeEditor/
├── extensions/
│   ├── code-actions.ts           # NEW: Lightbulb UI + action provider
│   ├── inline-rename.ts          # NEW: Rename input widget
│   ├── extract-cte.ts            # NEW: CTE extraction flow
│   └── refactor-context-menu.ts  # NEW: Right-click refactor options
├── languages/sql/
│   └── refactor-service.ts       # NEW: Tauri command wrapper + caching

src/components/QueryPanel/
└── QueryOutline.tsx              # MODIFY: Replace regex with Tauri call
```

### Refactor Service

```typescript
// src/components/CodeEditor/languages/sql/refactor-service.ts

interface OutlineCache {
  sql: string;
  dialect: string;
  outline: OutlineTree;
}

let cache: OutlineCache | null = null;

export async function getOutline(sql: string, dialect: string): Promise<OutlineTree> {
  if (cache?.sql === sql && cache?.dialect === dialect) {
    return cache.outline;
  }
  const outline = await invoke<OutlineTree>("sql_get_outline", { sql, dialect });
  cache = { sql, dialect, outline };
  return outline;
}

export async function getRefactorActions(
  sql: string,
  dialect: string,
  cursorOffset: number
): Promise<RefactorAction[]> {
  return invoke<RefactorAction[]>("sql_get_refactor_actions", {
    sql,
    dialect,
    cursorOffset,
  });
}

export async function applyRefactor(
  sql: string,
  dialect: string,
  action: RefactorRequest
): Promise<RefactorResult> {
  return invoke<RefactorResult>("sql_apply_refactor", { sql, dialect, action });
}
```

### Keyboard Shortcuts

| Action         | Shortcut      | Trigger                           |
| -------------- | ------------- | --------------------------------- |
| Rename Symbol  | `F2`          | Cursor on alias, CTE name, table  |
| Extract to CTE | `Cmd+Shift+E` | Selection contains valid subquery |
| Show Actions   | `Cmd+.`       | Opens lightbulb menu at cursor    |

### Context Menu Integration

Extends existing `SqlContextMenu.tsx` to include refactoring options when available, grouped under "Refactor >" submenu.

---

## QueryOutline Component Migration

### Current Problem

The existing `QueryOutline.tsx` uses regex patterns like `/WITH\s+(\w+)\s+AS/gi` to detect CTEs. This breaks on:

- Quoted identifiers (`"MyTable"`)
- Comments containing SQL keywords
- Nested subqueries
- Complex JOIN syntax

### New Implementation

```typescript
// src/components/QueryPanel/QueryOutline.tsx

import { getOutline } from "@/components/CodeEditor/languages/sql/refactor-service";

export function QueryOutline({ sql, dialect, onNavigate }: QueryOutlineProps) {
  const [outline, setOutline] = useState<OutlineTree | null>(null);
  
  useEffect(() => {
    const controller = new AbortController();
    
    const timer = setTimeout(async () => {
      const result = await getOutline(sql, dialect);
      if (!controller.signal.aborted) {
        setOutline(result);
      }
    }, 300);  // Debounce 300ms
    
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sql, dialect]);

  return (
    <div className="query-outline">
      {outline?.parse_status === "Failed" && (
        <div className="text-muted-foreground text-xs">
          Parse error - showing partial outline
        </div>
      )}
      
      {outline?.statements.map((stmt, i) => (
        <StatementNode 
          key={i} 
          statement={stmt} 
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
```

---

## Smart Rename Implementation

### Symbol Reference Finding

```rust
// src-tauri/src/sql_engine/symbol_finder.rs

pub struct SymbolReferences {
    pub symbol_kind: SymbolKind,
    pub definition_span: TextSpan,
    pub references: Vec<TextSpan>,
}

pub enum SymbolKind {
    TableAlias,   // FROM users u  →  "u"
    CteName,      // WITH active_users AS (...)  →  "active_users"  
    ColumnAlias,  // SELECT id AS user_id  →  "user_id"
    TableName,    // Actual table name
}

impl SymbolFinder {
    pub fn find_references(
        ast: &[Statement],
        source: &str,
        offset: usize,
    ) -> Option<SymbolReferences> {
        // 1. Identify what symbol is at offset
        // 2. Walk AST to find definition
        // 3. Walk AST again to collect all references
        // 4. Return spans for all occurrences
    }
}
```

### Rename Transformation

```rust
// src-tauri/src/sql_engine/refactor.rs

pub fn apply_rename(
    source: &str,
    references: &SymbolReferences,
    new_name: &str,
) -> RefactorResult {
    // Sort spans by position (descending) to avoid offset shifting
    let mut edits: Vec<TextEdit> = references
        .references
        .iter()
        .chain(std::iter::once(&references.definition_span))
        .map(|span| TextEdit {
            span: *span,
            new_text: format_identifier(new_name, needs_quoting(new_name)),
        })
        .collect();
    
    edits.sort_by(|a, b| b.span.start.cmp(&a.span.start));
    
    // Apply edits from end to start
    let mut result = source.to_string();
    for edit in &edits {
        result.replace_range(edit.span.start..edit.span.end, &edit.new_text);
    }
    
    RefactorResult {
        new_sql: result,
        edits,
        cursor_position: references.definition_span.start + new_name.len(),
    }
}
```

### Validation Rules

| Rule             | Example                       | Error Message                               |
| ---------------- | ----------------------------- | ------------------------------------------- |
| Not empty        | `""`                          | "Name cannot be empty"                      |
| Valid identifier | `"123abc"`                    | "Name must start with letter or underscore" |
| No conflicts     | Renaming to existing CTE name | "Name 'x' already exists in scope"          |

---

## Extract to CTE Implementation

### Subquery Detection

```rust
// src-tauri/src/sql_engine/refactor.rs

pub struct ExtractableSubquery {
    pub span: TextSpan,
    pub suggested_name: String,
}

pub enum ExtractError {
    NotASubquery,
    PartialSelection,
    AlreadyCte,
    ParseError(String),
}

impl SubqueryDetector {
    pub fn validate_selection(
        ast: &[Statement],
        source: &str,
        selection_start: usize,
        selection_end: usize,
    ) -> Result<ExtractableSubquery, ExtractError> {
        // 1. Find AST node that matches selection span
        // 2. Verify it's a subquery (SELECT inside parens)
        // 3. Verify it's not already a CTE reference
        // 4. Return extractable info or error
    }
}
```

### CTE Extraction Transform

```rust
pub fn apply_extract_cte(
    source: &str,
    subquery_span: TextSpan,
    cte_name: &str,
    ast: &[Statement],
) -> Result<RefactorResult, String> {
    let subquery_text = &source[subquery_span.start + 1..subquery_span.end - 1];
    
    let (insert_pos, prefix) = if has_existing_with_clause(ast) {
        // Add to existing WITH clause
        (find_last_cte_end(ast, source), 
         format!(",\n  {} AS (\n    {}\n  )", cte_name, subquery_text))
    } else {
        // Create new WITH clause
        (find_statement_start(ast), 
         format!("WITH {} AS (\n  {}\n)\n", cte_name, subquery_text))
    };
    
    let edits = vec![
        TextEdit { span: TextSpan { start: insert_pos, end: insert_pos }, new_text: prefix },
        TextEdit { span: subquery_span, new_text: cte_name.to_string() },
    ];
    
    let new_sql = apply_edits(source, &edits);
    
    Ok(RefactorResult { new_sql, edits, cursor_position: insert_pos })
}
```

### Example Transformation

**Before:**
```sql
SELECT o.id, o.total
FROM orders o
WHERE o.user_id IN (
    SELECT id FROM users WHERE active = true
)
```

**After (CTE named "active_users"):**
```sql
WITH active_users AS (
    SELECT id FROM users WHERE active = true
)
SELECT o.id, o.total
FROM orders o
WHERE o.user_id IN (active_users)
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

| Task                          | Description                                   |
| ----------------------------- | --------------------------------------------- |
| Create `outline.rs`           | AST → OutlineTree conversion for all dialects |
| Create `symbol_finder.rs`     | Reference finding logic                       |
| Add `sql_get_outline` command | Wire up Tauri command                         |
| Add unit tests                | Test outline generation for each dialect      |

### Phase 2: Query Outline Migration (Week 2-3)

| Task                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| Create `refactor-service.ts` | Frontend Tauri wrapper with caching            |
| Migrate `QueryOutline.tsx`   | Replace regex with AST-based outline           |
| Add fallback logic           | Graceful degradation to regex on parse failure |
| Manual QA                    | Test across all dialects with complex queries  |

### Phase 3: Smart Rename (Week 3-4)

| Task                                   | Description                 |
| -------------------------------------- | --------------------------- |
| Create `refactor.rs`                   | Rename transformation logic |
| Add `sql_get_refactor_actions` command | Actions at cursor position  |
| Add `sql_apply_refactor` command       | Apply rename transformation |
| Create `inline-rename.ts` extension    | CodeMirror rename widget    |
| Add F2 keybinding                      | Wire up keyboard shortcut   |
| Extend context menu                    | Add "Rename" option         |

### Phase 4: Extract to CTE (Week 4-5)

| Task                         | Description                       |
| ---------------------------- | --------------------------------- |
| Add subquery detection       | Validate selection is extractable |
| Add CTE extraction logic     | Transform SQL with new CTE        |
| Create extract prompt dialog | CTE name input UI                 |
| Add Cmd+Shift+E keybinding   | Wire up keyboard shortcut         |
| Extend context menu          | Add "Extract to CTE" option       |

### Phase 5: Code Actions / Lightbulb (Week 5-6)

| Task                               | Description                           |
| ---------------------------------- | ------------------------------------- |
| Create `code-actions.ts` extension | Gutter lightbulb widget               |
| Add Cmd+. keybinding               | Show actions menu                     |
| Debounced action fetching          | 150ms delay on cursor move            |
| Polish UI                          | Animations, disabled states, tooltips |

---

## Testing Strategy

### Unit Tests (Rust)

```
src-tauri/src/sql_engine/tests/
├── outline_postgres_test.rs    # CTE, subquery, join detection
├── outline_mysql_test.rs       # MySQL-specific syntax  
├── outline_sqlite_test.rs      # SQLite-specific syntax
├── outline_mssql_test.rs       # SQL Server-specific syntax
├── outline_fallback_test.rs    # Graceful degradation
├── rename_test.rs              # All symbol types
├── extract_cte_test.rs         # Various subquery positions
└── dialect_edge_cases_test.rs  # Quoted identifiers, comments
```

### Integration Tests (Frontend)

```
src/components/QueryPanel/__tests__/
├── QueryOutline.test.tsx       # Component renders outline

src/components/CodeEditor/__tests__/
├── rename.test.ts              # End-to-end rename flow
└── extract-cte.test.ts         # End-to-end extract flow
```

---

## Rollout Plan

1. **Internal dogfooding** - Use for 1 week internally
2. **Feature flag** - Ship behind `experimental.refactoring` preference flag
3. **Beta release** - Announce to power users for feedback
4. **GA release** - Enable by default after stability confirmed

---

## Success Criteria

- [ ] Query Outline works correctly for all dialect edge cases (quoted identifiers, comments, nested subqueries)
- [ ] Smart Rename updates all references without breaking query semantics
- [ ] Extract to CTE handles both new WITH clauses and appending to existing ones
- [ ] Graceful degradation shows partial results for unparseable queries
- [ ] Performance: All operations complete in <50ms for typical queries
- [ ] No regressions in existing linting/completion functionality
