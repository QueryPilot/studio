# SQL Editor Superpower Architecture Design

> **Date:** 2026-01-07
> **Status:** Approved for Implementation
> **Goal:** Transform Query Pilot's SQL editor from "good" to "superpower" - instant response, intelligent suggestions, and AI-ready architecture.

## Executive Summary

Two-phase implementation to fix cursor lag and add 19 intelligent features:

1. **Phase 1 (Week 1):** Fix JavaScript performance bottlenecks - smooth typing immediately
2. **Phase 2 (Weeks 2-3):** Add Rust backend with `sqlparser-rs` for smart features

## Current Problems

1. **Cursor lag on EVERY keystroke** - even in small files
2. **Slow autocomplete** - 200-500ms to appear
3. **Missing smart suggestions** - no auto-alias, limited JOIN help
4. **Triple linting overhead** - 3 separate linters parsing independently

## Root Causes

- `analyzeSqlContext()` runs synchronously on every completion
- `syntaxTree()` called 5+ times per operation
- Three linters with separate debounces (800ms + 1000ms + 2000ms)
- `activateOnTyping: true` triggers full analysis on every character

---

## Architecture Overview

```
PHASE 1: JS FIXES (Immediate cursor lag fix)
─────────────────────────────────────────────
Keystroke → CodeMirror
              │
              ├─→ Syntax Highlighting (Lezer - instant)
              ├─→ Completion (DEFERRED - 150ms debounce)
              └─→ Linting (UNIFIED - single async worker)

PHASE 2: RUST BACKEND (Smart features)
─────────────────────────────────────────────
CodeMirror ←──────→ Tauri IPC ←───→ SqlEngine (Rust)
     │                  │                 │
     │ • Editing        │                 ├─ sqlparser-rs
     │ • Highlighting   │                 ├─ SchemaStore
     │                  │                 └─ Smart Suggestions
     │                  │
     └─── Async requests:
          • sql_parse
          • sql_complete
          • sql_validate
          • sql_format
```

---

## Phase 1: JavaScript Performance Fixes

### Stream A: Deferred Completion Analysis

**Files:**
- `src/components/CodeEditor/languages/sql/deferred-completion.ts` (NEW)
- `src/components/CodeEditor/SqlEditor.tsx` (MODIFY)

**Changes:**
- 150ms debounce before analyzing context
- Only analyze on meaningful triggers (`.`, space after keyword, Ctrl+Space)
- Document-level caching with instant filtering
- In-flight request deduplication

```typescript
// Key pattern: deferred analysis
autocompletion({
  activateOnTyping: true,
  activateOnTypingDelay: 150,  // Wait for typing pause
})
```

### Stream B: Unified Linter

**Files:**
- `src/components/CodeEditor/languages/sql/unified-linter.ts` (NEW)
- `src/components/CodeEditor/languages/sql/unified-linter-worker.ts` (NEW)

**Changes:**
- Single linter replaces 3 separate linters
- One parse, multiple validation passes (syntax, semantic, version)
- Per-statement error isolation
- Single 400ms debounce

```typescript
// BEFORE: 3 linters
createDialectLinter(dialect),    // 800ms
createSemanticLinter(provider),  // 2000ms
createVersionLinter(dialect),    // 1000ms

// AFTER: 1 unified linter
createUnifiedLinter({
  dialect,
  connectionId,
  checks: ['syntax', 'semantic', 'version'],
  delay: 400,
})
```

### Stream C: AST Cache + Statement Splitter

**Files:**
- `src/components/CodeEditor/languages/sql/shared/ast-cache.ts` (NEW)
- `src/components/CodeEditor/languages/sql/statement-splitter.ts` (NEW)

**Changes:**
- Single `syntaxTree()` call per document change
- Pre-computed derived data: tables, CTEs, statements, scopes
- Statement boundaries handle: strings, dollar quotes, comments
- `getStatementAt(pos)` for scoped completions

### Stream D: Integration

**Deletions:**
- `sql-linter.ts` (merged into unified)
- `version-linter.ts` (merged)
- `linter-worker.ts` (replaced)

---

## Phase 2: Rust Backend with sqlparser-rs

### Stream E: Rust Core

**Files:**
```
src-tauri/src/sql_engine/
├─ mod.rs
├─ parser.rs
├─ dialect.rs
├─ schema_store.rs
└─ schema_queries.rs
```

**Cargo.toml:**
```toml
sqlparser = "0.52"
chrono = "0.4"
```

**Key Components:**
- `SqlDialect` enum (PostgreSQL, MySQL, SQLite, MsSQL, PlSQL)
- `parse_document()` → `ParsedDocument` with per-statement analysis
- `SchemaStore` with DashMap cache + TTL + auto-invalidation on DDL
- Dialect-specific `information_schema` queries

### Stream F: Validation Engine

**Files:**
- `src-tauri/src/sql_engine/validator.rs`
- `src-tauri/src/sql_engine/semantic.rs`

**Validation Types:**
- Syntax errors (from parse)
- Semantic (table/column existence)
- Type compatibility
- Best practices (SELECT *, missing WHERE)

### Stream G: Smart Completion (19 Features)

**Files:**
```
src-tauri/src/sql_engine/
├─ completion.rs
├─ join_suggester.rs
├─ templates.rs          # INSERT/UPDATE templates
├─ snippets.rs
├─ sp_params.rs          # Stored procedure/function params
└─ cte_inference.rs      # CTE column inference
```

**Features (19 total - covers ~95% of real-world cases):**

| # | Feature | Trigger | Example |
|---|---------|---------|---------|
| 1 | Auto-Alias | `FROM users` | `FROM users u` |
| 2 | JOIN Smart | `JOIN ` | `orders o ON u.id = o.user_id` |
| 3 | Column Any | `email` | `u.email` with source |
| 4 | INSERT Template | `INSERT INTO users` | Full columns + VALUES |
| 5 | Snippets | `sel`, `cte` | Query templates |
| 6 | Enum Values | `status = '` | `'pending'`, `'active'` |
| 7 | Boolean | `is_active = ` | `TRUE`, `FALSE` |
| 8 | NULL | `deleted_at ` | `IS NULL`, `IS NOT NULL` |
| 9 | JSON Paths | `data->>'` | `'name'`, `'address'` |
| 10 | Date/Time | `created_at > ` | `NOW()`, `INTERVAL` |
| 11 | DB Objects | `DROP INDEX ` | Index names |
| 12 | Operators | `WHERE age ` | `=`, `BETWEEN`, `IN` |
| 13 | SELECT * Expand | `SELECT *` action | `SELECT id, name, email, ...` |
| 14 | Window OVER() | `ROW_NUMBER()` | `ROW_NUMBER() OVER (PARTITION BY ...)` |
| 15 | Fuzzy Match | `usrNme` | Matches `user_name`, `userName` |
| 16 | SP/Func Params | `EXEC sp_name @` | Parameter names + types + defaults |
| 17 | UPDATE Template | `UPDATE users SET` | `SET col1 = ?, col2 = ?` |
| 18 | CTE Column Infer | `WITH cte AS (...) SELECT ` | Columns from CTE definition |
| 19 | Bracket Match | `(`, `BEGIN` | Highlight matching `)`/`END` |

### Stream H: SQL Formatter

**File:** `src-tauri/src/sql_engine/formatter.rs`

### Stream I: JS Integration

**Files:**
- `src-tauri/src/sql_engine/commands.rs`
- `src/services/sqlEngineService.ts`
- `src/components/CodeEditor/languages/sql/rust-completion.ts`
- `src/components/CodeEditor/languages/sql/bracket-matching.ts` (NEW)

**Note:** Bracket matching (#19) uses CodeMirror's built-in `bracketMatching()` extension
with custom SQL keyword pairs (`BEGIN/END`, `CASE/END`, `IF/END IF`).

**Tauri Commands:**
```rust
sql_parse(sql, dialect) → ParsedDocument
sql_validate(sql, dialect, connection_id, schema) → ValidationResult
sql_complete(request) → CompletionResult
sql_format(sql, dialect, options) → String
sql_split_statements(sql, dialect) → StatementRange[]
sql_suggest_joins(tables, connection_id, schema) → JoinSuggestion[]
sql_invalidate_schema(connection_id, schema)
```

---

## Multi-Statement Support

Each editor can contain multiple SQL statements. The system:

1. **Parses independently** - Each statement is a separate AST
2. **Lints per-statement** - Errors scoped to their statement
3. **Completes with scope** - Tables from current statement only
4. **Executes individually** - Cmd+Enter runs statement at cursor

```sql
-- Statement 1: Tables in scope = [users(u)]
SELECT * FROM users u WHERE u.id = 1;

-- Statement 2: Tables in scope = [orders(o), products(p)]
SELECT o.*, p.name
FROM orders o
JOIN products p ON o.product_id = p.id;
-- ^ Completion here sees 'o' and 'p', NOT 'u' from statement 1
```

---

## Schema Awareness

**SchemaStore** in Rust caches database metadata:

- Tables, views, materialized views
- Columns with types, nullability, defaults
- Foreign keys (for JOIN suggestions)
- Indexes, triggers, sequences
- Enums and custom types
- Roles and schemas

**Cache Strategy:**
- Fetch on first request per connection+schema
- 30-second TTL
- Auto-invalidate on DDL (CREATE, ALTER, DROP)

---

## Parallelization Strategy

### Phase 1 (4 agents, ~1 week)
```
Day 1-3:
  Agent 1 → Stream A (Completion)
  Agent 2 → Stream B (Linter)
  Agent 3 → Stream C (AST Cache)

Day 4-5:
  Main → Stream D (Integration)
```

### Phase 2 (5 agents, ~2 weeks)
```
Day 1-4:
  Agent 1 → Stream E (Rust Core) - START FIRST

Day 2-5:
  Agent 2 → Stream F (Validation)
  Agent 3 → Stream G (Completion)
  Agent 4 → Stream H (Formatter)

Day 6-8:
  Main → Stream I (Integration)
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Keystroke latency | ~50-100ms | <16ms (60fps) |
| Completion popup | ~200-500ms | <100ms |
| Large file (1000 lines) | Lag | Smooth |
| Linting delay | 800+1000+2000ms | 400ms |
| Smart suggestions | 5 basic | 19 intelligent |
| Multi-dialect | Partial | Full (5) |

---

## File Summary

**New Files (22):**
- Phase 1: 4 TypeScript files
- Phase 2 Rust: 15 Rust files (+2 for sp_params.rs, cte_inference.rs)
- Phase 2 JS: 3 TypeScript files (+1 for bracket-matching.ts)

**Modified Files (6):**
- SqlEditor.tsx, extensions.ts, context.ts, linter-strategy.ts, lib.rs, Cargo.toml

**Deleted Files (3):**
- sql-linter.ts, version-linter.ts, linter-worker.ts

---

## Timeline

| Week | Deliverable |
|------|-------------|
| 1 | Phase 1 complete - cursor lag FIXED |
| 2 | Phase 2 Rust backend ready |
| 3 | Phase 2 integration + 19 smart features LIVE |

---

## Competitive Analysis

Compared against DataGrip, DBeaver, SQL Prompt, and dbForge (industry leaders):

| Feature | Query Pilot | DataGrip | DBeaver | SQL Prompt | dbForge |
|---------|:-----------:|:--------:|:-------:|:----------:|:-------:|
| Auto-Alias | ✓ | ✓ | ✓ | ✓ | ✓ |
| FK-based JOIN | ✓ | ✓ | ✓ | ✓ | ✓ |
| Column suggestions | ✓ | ✓ | ✓ | ✓ | ✓ |
| INSERT template | ✓ | ✓ | ✓ | ✓ | ✓ |
| UPDATE template | ✓ | ✓ | - | ✓ | ✓ |
| Snippets | ✓ | ✓ | ✓ | ✓ | ✓ |
| Enum values | ✓ | ✓ | ✓ | ✓ | ✓ |
| Boolean/NULL | ✓ | ✓ | ✓ | ✓ | ✓ |
| JSON paths | ✓ | ✓ | - | - | - |
| Date/Time functions | ✓ | ✓ | ✓ | ✓ | ✓ |
| DB objects | ✓ | ✓ | ✓ | ✓ | ✓ |
| Operators | ✓ | ✓ | ✓ | ✓ | ✓ |
| SELECT * expand | ✓ | ✓ | ✓ | ✓ | ✓ |
| Window OVER() | ✓ | ✓ | - | - | ✓ |
| Fuzzy matching | ✓ | ✓ | - | - | ✓ |
| SP/Func params | ✓ | ✓ | ✓ | ✓ | ✓ |
| CTE column infer | ✓ | ✓ | ✓ | - | ✓ |
| Bracket matching | ✓ | ✓ | ✓ | ✓ | ✓ |
| ML-powered ranking | Phase 3 | ✓ | - | ✓ | - |

**Coverage: ~95% of combined features across all competitors**

### Research Sources

- [Red Gate SQL Prompt](https://www.red-gate.com/hub/product-learning/sql-prompt/sql-intellisense-and-autocomplete-in-ssms-and-sql-prompt)
- [DBeaver SQL Assist](https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/)
- [dbForge SQL Complete](https://www.devart.com/dbforge/sql/sqlcomplete/features.html)
- [Oracle SQL Developer](https://www.thatjeffsmith.com/archive/2019/03/code-completion-for-your-pl-sql/)
- [PopSQL Changelog](https://popsql.dev/changelog/more-autocomplete-improvements)

### Deliberately Excluded (Low ROI)

| Feature | Why Excluded |
|---------|--------------|
| Table hints (NOLOCK, INDEX) | SQL Server specific, niche use case |
| Code folding | Nice-to-have, not completion feature |
| Multi-column picker UI | Visual feature, not core completion |
| Cloud-based completion | Requires external service |
| SQLCMD mode | SSMS-specific scripting mode |

---

## Future: AI Integration (Phase 3)

The Rust AST can feed into the AI sidecar for:
- Natural language → SQL generation
- Query optimization suggestions
- Error explanation
- Schema-aware chat

Architecture is AI-ready once Phase 2 completes.
