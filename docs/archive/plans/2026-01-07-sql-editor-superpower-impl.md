# SQL Editor Superpower Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix cursor lag and add 19 intelligent SQL completion features using a two-phase approach (JS optimizations → Rust backend).

**Architecture:** Phase 1 fixes JS performance bottlenecks (deferred completion, unified linter, AST cache). Phase 2 adds Rust backend with sqlparser-rs for smart features (auto-alias, JOIN suggestions, templates, etc).

**Tech Stack:** TypeScript, CodeMirror 6, Rust, sqlparser-rs 0.52, Tauri IPC, Web Workers

---

## Phase 1: JavaScript Performance Fixes

### Task 1: AST Cache Foundation

**Files:**
- Create: `src/components/CodeEditor/languages/sql/shared/ast-cache.ts`
- Test: `src/components/CodeEditor/languages/sql/shared/ast-cache.test.ts`

**Step 1: Write the test file**

```typescript
// src/components/CodeEditor/languages/sql/shared/ast-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AstCache } from './ast-cache';

describe('AstCache', () => {
  let cache: AstCache;

  beforeEach(() => {
    cache = new AstCache();
  });

  it('should cache derived data for document version', () => {
    const docId = 'test-doc';
    const version = 1;
    const data = { tables: ['users'], columns: ['id', 'name'] };

    cache.set(docId, version, data);
    expect(cache.get(docId, version)).toEqual(data);
  });

  it('should invalidate on version change', () => {
    const docId = 'test-doc';
    cache.set(docId, 1, { tables: ['old'] });
    expect(cache.get(docId, 2)).toBeNull();
  });

  it('should return null for missing entries', () => {
    expect(cache.get('missing', 1)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit ast-cache`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/components/CodeEditor/languages/sql/shared/ast-cache.ts
export interface CachedData {
  tables: string[];
  columns: string[];
  ctes?: string[];
  aliases?: Map<string, string>;
}

interface CacheEntry {
  version: number;
  data: CachedData;
  timestamp: number;
}

export class AstCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxAge = 30000; // 30 seconds

  get(docId: string, version: number): CachedData | null {
    const entry = this.cache.get(docId);
    if (!entry) return null;
    if (entry.version !== version) return null;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(docId);
      return null;
    }
    return entry.data;
  }

  set(docId: string, version: number, data: CachedData): void {
    this.cache.set(docId, { version, data, timestamp: Date.now() });
  }

  invalidate(docId: string): void {
    this.cache.delete(docId);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance for global use
export const astCache = new AstCache();
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit ast-cache`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CodeEditor/languages/sql/shared/
git commit -m "feat(sql): add AST cache for document-level caching"
```

---

### Task 2: Statement Splitter

**Files:**
- Create: `src/components/CodeEditor/languages/sql/statement-splitter.ts`
- Test: `src/components/CodeEditor/languages/sql/statement-splitter.test.ts`

**Step 1: Write the test file**

```typescript
// src/components/CodeEditor/languages/sql/statement-splitter.test.ts
import { describe, it, expect } from 'vitest';
import { splitStatements, getStatementAt } from './statement-splitter';

describe('splitStatements', () => {
  it('should split simple statements', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toBe('SELECT 1');
    expect(statements[1].text).toBe('SELECT 2');
  });

  it('should handle strings with semicolons', () => {
    const sql = "SELECT 'a;b'; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toBe("SELECT 'a;b'");
  });

  it('should handle dollar quotes (PostgreSQL)', () => {
    const sql = "SELECT $$ a;b $$; SELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });

  it('should handle comments', () => {
    const sql = "SELECT 1; -- comment; \nSELECT 2;";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
  });
});

describe('getStatementAt', () => {
  it('should return statement containing position', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    const stmt = getStatementAt(sql, 12); // Position in "SELECT 2"
    expect(stmt?.text).toBe('SELECT 2');
  });

  it('should return null for position outside statements', () => {
    const sql = 'SELECT 1;';
    const stmt = getStatementAt(sql, 100);
    expect(stmt).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit statement-splitter`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/components/CodeEditor/languages/sql/statement-splitter.ts
export interface StatementRange {
  from: number;
  to: number;
  text: string;
}

/**
 * Split SQL document into individual statements.
 * Handles: strings, dollar quotes, comments.
 */
export function splitStatements(sql: string): StatementRange[] {
  const statements: StatementRange[] = [];
  let currentStart = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];

    // Skip single-quoted strings
    if (char === "'") {
      i++;
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else i++;
      }
      i++;
      continue;
    }

    // Skip double-quoted identifiers
    if (char === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      continue;
    }

    // Skip dollar quotes (PostgreSQL)
    if (char === '$') {
      const tagMatch = sql.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIndex = sql.indexOf(tag, i + tag.length);
        if (endIndex !== -1) {
          i = endIndex + tag.length;
          continue;
        }
      }
      i++;
      continue;
    }

    // Skip line comments
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      i++;
      continue;
    }

    // Skip block comments
    if (char === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Statement terminator
    if (char === ';') {
      const text = sql.slice(currentStart, i).trim();
      if (text) {
        statements.push({ from: currentStart, to: i, text });
      }
      currentStart = i + 1;
    }

    i++;
  }

  // Handle final statement without trailing semicolon
  const finalText = sql.slice(currentStart).trim();
  if (finalText) {
    statements.push({ from: currentStart, to: sql.length, text: finalText });
  }

  return statements;
}

/**
 * Get the statement containing the given position.
 */
export function getStatementAt(sql: string, pos: number): StatementRange | null {
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    if (pos >= stmt.from && pos <= stmt.to) {
      return stmt;
    }
  }
  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit statement-splitter`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CodeEditor/languages/sql/statement-splitter.*
git commit -m "feat(sql): add statement splitter with string/comment handling"
```

---

### Task 3: Deferred Completion Extension

**Files:**
- Create: `src/components/CodeEditor/languages/sql/deferred-completion.ts`
- Test: `src/components/CodeEditor/languages/sql/deferred-completion.test.ts`

**Step 1: Write the test file**

```typescript
// src/components/CodeEditor/languages/sql/deferred-completion.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldTriggerCompletion, DeferredCompletionState } from './deferred-completion';

describe('shouldTriggerCompletion', () => {
  it('should trigger on dot', () => {
    expect(shouldTriggerCompletion('.', 'users')).toBe(true);
  });

  it('should trigger after FROM keyword', () => {
    expect(shouldTriggerCompletion(' ', 'SELECT * FROM')).toBe(true);
  });

  it('should trigger after JOIN keyword', () => {
    expect(shouldTriggerCompletion(' ', 'FROM users JOIN')).toBe(true);
  });

  it('should NOT trigger on regular typing', () => {
    expect(shouldTriggerCompletion('e', 'SELECT nam')).toBe(false);
  });

  it('should trigger on explicit activation (empty)', () => {
    expect(shouldTriggerCompletion('', '', true)).toBe(true);
  });
});

describe('DeferredCompletionState', () => {
  let state: DeferredCompletionState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new DeferredCompletionState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should deduplicate in-flight requests', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['result']);

    const promise1 = state.fetch('key1', fetchFn);
    const promise2 = state.fetch('key1', fetchFn);

    await vi.runAllTimersAsync();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await promise1).toEqual(await promise2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit deferred-completion`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/components/CodeEditor/languages/sql/deferred-completion.ts
import type { CompletionContext } from '@codemirror/autocomplete';

const TRIGGER_KEYWORDS = [
  'FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
  'CROSS JOIN', 'ON', 'WHERE', 'AND', 'OR', 'SET', 'INTO', 'VALUES',
  'SELECT', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'UPDATE', 'DELETE', 'INSERT'
];

/**
 * Determine if completion should be triggered based on typed character and context.
 */
export function shouldTriggerCompletion(
  typed: string,
  textBefore: string,
  explicit = false
): boolean {
  // Always trigger on explicit request (Ctrl+Space)
  if (explicit) return true;

  // Trigger on dot (qualified identifier)
  if (typed === '.') return true;

  // Trigger after keywords followed by space
  if (typed === ' ') {
    const upperBefore = textBefore.toUpperCase().trim();
    for (const keyword of TRIGGER_KEYWORDS) {
      if (upperBefore.endsWith(keyword)) return true;
    }
  }

  // Trigger on opening quote for string completion
  if (typed === "'" || typed === '"') return true;

  // Trigger on arrow operators (JSON)
  if (typed === '>' && textBefore.endsWith('-')) return true;

  return false;
}

/**
 * State manager for deferred completion with request deduplication.
 */
export class DeferredCompletionState {
  private inFlight = new Map<string, Promise<unknown>>();
  private cache = new Map<string, { result: unknown; timestamp: number }>();
  private readonly cacheTTL = 5000; // 5 seconds

  async fetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result as T;
    }

    // Deduplicate in-flight requests
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    // Execute and cache
    const promise = fetchFn().then((result) => {
      this.cache.set(key, { result, timestamp: Date.now() });
      this.inFlight.delete(key);
      return result;
    }).catch((err) => {
      this.inFlight.delete(key);
      throw err;
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

// Global instance
export const deferredState = new DeferredCompletionState();

/**
 * Create completion context key for deduplication.
 */
export function getCompletionKey(ctx: CompletionContext): string {
  const line = ctx.state.doc.lineAt(ctx.pos);
  return `${ctx.pos}:${line.text.slice(0, ctx.pos - line.from)}`;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit deferred-completion`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CodeEditor/languages/sql/deferred-completion.*
git commit -m "feat(sql): add deferred completion with smart triggers"
```

---

### Task 4: Unified Linter Worker

**Files:**
- Create: `src/components/CodeEditor/languages/sql/unified-linter-worker.ts`
- Create: `src/components/CodeEditor/languages/sql/unified-linter.ts`

**Step 1: Write the worker file**

```typescript
// src/components/CodeEditor/languages/sql/unified-linter-worker.ts
import type { SqlDialect } from '../../types';

export interface LintRequest {
  id: number;
  sql: string;
  dialect: SqlDialect;
  connectionId?: string;
  checks: ('syntax' | 'semantic' | 'version')[];
}

export interface LintDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'syntax' | 'semantic' | 'version';
}

export interface LintResponse {
  id: number;
  diagnostics: LintDiagnostic[];
}

// Worker message handler
self.onmessage = async (event: MessageEvent<LintRequest>) => {
  const { id, sql, dialect, checks } = event.data;
  const diagnostics: LintDiagnostic[] = [];

  try {
    // Run enabled checks
    if (checks.includes('syntax')) {
      diagnostics.push(...await runSyntaxCheck(sql, dialect));
    }
    // Note: semantic and version checks will be implemented with Rust backend
  } catch (error) {
    console.error('[unified-linter-worker] Error:', error);
  }

  const response: LintResponse = { id, diagnostics };
  self.postMessage(response);
};

async function runSyntaxCheck(sql: string, dialect: SqlDialect): Promise<LintDiagnostic[]> {
  // Basic syntax validation - will be enhanced with Rust backend
  const diagnostics: LintDiagnostic[] = [];

  // Check for unclosed strings
  let inString = false;
  let stringStart = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'" && sql[i - 1] !== '\\') {
      if (!inString) {
        inString = true;
        stringStart = i;
      } else {
        inString = false;
      }
    }
  }

  if (inString) {
    diagnostics.push({
      from: stringStart,
      to: sql.length,
      severity: 'error',
      message: 'Unclosed string literal',
      source: 'syntax'
    });
  }

  return diagnostics;
}
```

**Step 2: Write the manager file**

```typescript
// src/components/CodeEditor/languages/sql/unified-linter.ts
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SqlDialect } from '../../types';
import type { LintRequest, LintResponse, LintDiagnostic } from './unified-linter-worker';

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  checks?: ('syntax' | 'semantic' | 'version')[];
  delay?: number;
}

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, (diagnostics: LintDiagnostic[]) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./unified-linter-worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (event: MessageEvent<LintResponse>) => {
      const { id, diagnostics } = event.data;
      const resolve = pendingRequests.get(id);
      if (resolve) {
        pendingRequests.delete(id);
        resolve(diagnostics);
      }
    };
  }
  return worker;
}

async function lint(
  sql: string,
  config: UnifiedLinterConfig
): Promise<LintDiagnostic[]> {
  return new Promise((resolve) => {
    const id = ++requestId;
    const request: LintRequest = {
      id,
      sql,
      dialect: config.dialect,
      connectionId: config.connectionId,
      checks: config.checks || ['syntax', 'semantic', 'version'],
    };

    pendingRequests.set(id, resolve);
    getWorker().postMessage(request);

    // Timeout after 5 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        resolve([]);
      }
    }, 5000);
  });
}

/**
 * Create a unified linter extension that replaces the 3 separate linters.
 */
export function createUnifiedLinter(config: UnifiedLinterConfig): Extension {
  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      const sql = view.state.doc.toString();
      if (!sql.trim()) return [];

      const diagnostics = await lint(sql, config);

      return diagnostics.map((d) => ({
        from: Math.max(0, d.from),
        to: Math.min(sql.length, d.to),
        severity: d.severity,
        message: d.message,
        source: `sql-${d.source}`,
      }));
    },
    { delay: config.delay ?? 400 }
  );
}

/**
 * Cleanup worker resources.
 */
export function terminateUnifiedLinter(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pendingRequests.clear();
}
```

**Step 3: Run tests to ensure no regressions**

Run: `pnpm test:unit`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add src/components/CodeEditor/languages/sql/unified-linter*
git commit -m "feat(sql): add unified linter with single 400ms debounce"
```

---

### Task 5: Integrate Phase 1 Changes

**Files:**
- Modify: `src/components/CodeEditor/extensions.ts`
- Modify: `src/components/CodeEditor/languages/sql/linter-strategy.ts`

**Step 1: Update linter-strategy.ts to use unified linter**

```typescript
// In linter-strategy.ts, add import and update strategies
import { createUnifiedLinter } from './unified-linter';

// Update LINTER_STRATEGIES to use unified linter for non-PostgreSQL
const LINTER_STRATEGIES: Record<SqlDialect, LinterStrategy> = {
  postgresql: {
    linter: () => createPgParserLinter(),
    description: "pg-parser WASM (PL/pgSQL support)",
  },
  mysql: {
    linter: () => createUnifiedLinter({ dialect: 'mysql' }),
    description: "Unified linter (400ms)",
  },
  sqlite: {
    linter: () => createUnifiedLinter({ dialect: 'sqlite' }),
    description: "Unified linter (400ms)",
  },
  mssql: {
    linter: () => createUnifiedLinter({ dialect: 'mssql' }),
    description: "Unified linter (400ms)",
  },
  plsql: {
    linter: () => createUnifiedLinter({ dialect: 'plsql' }),
    description: "Unified linter (400ms)",
  },
};
```

**Step 2: Update extensions.ts to use activateOnTypingDelay**

In `getLanguageExtension`, update the autocompletion config:

```typescript
autocompletion({
  activateOnTyping: true,
  activateOnTypingDelay: 150,  // 150ms debounce
  maxRenderedOptions: 50,
  defaultKeymap: true,
}),
```

**Step 3: Run full test suite**

Run: `pnpm test:unit && pnpm typecheck`
Expected: All PASS

**Step 4: Manual test cursor lag**

Run: `pnpm tauri:dev`
Test: Type rapidly in SQL editor, verify no cursor lag

**Step 5: Commit Phase 1 integration**

```bash
git add src/components/CodeEditor/
git commit -m "feat(sql): integrate Phase 1 - 150ms completion, unified linting"
```

---

## Phase 2: Rust Backend with sqlparser-rs

### Task 6: Add sqlparser-rs Dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add dependency**

Add to `[dependencies]` section:

```toml
# SQL parsing engine
sqlparser = { version = "0.52", features = ["serde"] }
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add sqlparser-rs 0.52 for SQL parsing"
```

---

### Task 7: Rust SQL Engine Module Structure

**Files:**
- Create: `src-tauri/src/sql_engine/mod.rs`
- Create: `src-tauri/src/sql_engine/dialect.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create module structure**

```rust
// src-tauri/src/sql_engine/mod.rs
pub mod dialect;
pub mod parser;
pub mod schema_store;
pub mod completion;
pub mod validator;

pub use dialect::SqlDialect;
pub use parser::{parse_document, ParsedDocument, ParsedStatement};
pub use schema_store::SchemaStore;
```

```rust
// src-tauri/src/sql_engine/dialect.rs
use serde::{Deserialize, Serialize};
use sqlparser::dialect::{
    Dialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SqlDialect {
    PostgreSQL,
    MySQL,
    SQLite,
    MsSQL,
    PlSQL,
}

impl SqlDialect {
    pub fn to_sqlparser_dialect(&self) -> Box<dyn Dialect> {
        match self {
            SqlDialect::PostgreSQL => Box::new(PostgreSqlDialect {}),
            SqlDialect::MySQL => Box::new(MySqlDialect {}),
            SqlDialect::SQLite => Box::new(SQLiteDialect {}),
            SqlDialect::MsSQL => Box::new(MsSqlDialect {}),
            SqlDialect::PlSQL => Box::new(GenericDialect {}), // Oracle uses generic
        }
    }
}

impl Default for SqlDialect {
    fn default() -> Self {
        SqlDialect::PostgreSQL
    }
}
```

**Step 2: Add to lib.rs**

```rust
// In src-tauri/src/lib.rs, add:
pub mod sql_engine;
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/sql_engine/ src-tauri/src/lib.rs
git commit -m "feat(rust): add sql_engine module structure"
```

---

### Task 8: SQL Parser Implementation

**Files:**
- Create: `src-tauri/src/sql_engine/parser.rs`

**Step 1: Write parser**

```rust
// src-tauri/src/sql_engine/parser.rs
use serde::{Deserialize, Serialize};
use sqlparser::ast::Statement;
use sqlparser::parser::Parser;

use super::dialect::SqlDialect;

#[derive(Debug, Clone, Serialize)]
pub struct ParsedStatement {
    pub from: usize,
    pub to: usize,
    pub text: String,
    pub ast: Option<String>, // JSON serialized AST
    pub error: Option<String>,
    pub tables: Vec<TableRef>,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableRef {
    pub name: String,
    pub alias: Option<String>,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedDocument {
    pub statements: Vec<ParsedStatement>,
    pub dialect: SqlDialect,
}

/// Parse a SQL document into individual statements with AST analysis.
pub fn parse_document(sql: &str, dialect: SqlDialect) -> ParsedDocument {
    let parser_dialect = dialect.to_sqlparser_dialect();
    let statements = split_statements(sql);

    let parsed_statements: Vec<ParsedStatement> = statements
        .into_iter()
        .map(|(from, to, text)| {
            match Parser::parse_sql(&*parser_dialect, &text) {
                Ok(ast) if !ast.is_empty() => {
                    let tables = extract_tables(&ast[0]);
                    let columns = extract_columns(&ast[0]);
                    ParsedStatement {
                        from,
                        to,
                        text,
                        ast: serde_json::to_string(&ast[0]).ok(),
                        error: None,
                        tables,
                        columns,
                    }
                }
                Ok(_) => ParsedStatement {
                    from,
                    to,
                    text,
                    ast: None,
                    error: None,
                    tables: vec![],
                    columns: vec![],
                },
                Err(e) => ParsedStatement {
                    from,
                    to,
                    text,
                    ast: None,
                    error: Some(e.to_string()),
                    tables: vec![],
                    columns: vec![],
                },
            }
        })
        .collect();

    ParsedDocument {
        statements: parsed_statements,
        dialect,
    }
}

/// Split SQL into statements (handles strings, comments, dollar quotes).
fn split_statements(sql: &str) -> Vec<(usize, usize, String)> {
    let mut statements = Vec::new();
    let mut current_start = 0;
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Skip single-quoted strings
        if chars[i] == '\'' {
            i += 1;
            while i < chars.len() && chars[i] != '\'' {
                if chars[i] == '\'' && i + 1 < chars.len() && chars[i + 1] == '\'' {
                    i += 2;
                } else {
                    i += 1;
                }
            }
            i += 1;
            continue;
        }

        // Skip line comments
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Skip block comments
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }

        // Statement terminator
        if chars[i] == ';' {
            let text: String = chars[current_start..i].iter().collect();
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                statements.push((current_start, i, trimmed.to_string()));
            }
            current_start = i + 1;
        }

        i += 1;
    }

    // Final statement
    let final_text: String = chars[current_start..].iter().collect();
    let trimmed = final_text.trim();
    if !trimmed.is_empty() {
        statements.push((current_start, chars.len(), trimmed.to_string()));
    }

    statements
}

fn extract_tables(stmt: &Statement) -> Vec<TableRef> {
    let mut tables = Vec::new();
    // Basic extraction - will be enhanced
    if let Statement::Query(query) = stmt {
        if let Some(from) = &query.body.as_select().and_then(|s| s.from.first()) {
            if let sqlparser::ast::TableFactor::Table { name, alias, .. } = &from.relation {
                tables.push(TableRef {
                    name: name.to_string(),
                    alias: alias.as_ref().map(|a| a.name.value.clone()),
                    schema: None,
                });
            }
        }
    }
    tables
}

fn extract_columns(_stmt: &Statement) -> Vec<String> {
    // Will be implemented with AST visitor
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_select() {
        let result = parse_document("SELECT * FROM users;", SqlDialect::PostgreSQL);
        assert_eq!(result.statements.len(), 1);
        assert!(result.statements[0].error.is_none());
    }

    #[test]
    fn test_parse_multiple_statements() {
        let result = parse_document("SELECT 1; SELECT 2;", SqlDialect::PostgreSQL);
        assert_eq!(result.statements.len(), 2);
    }
}
```

**Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test sql_engine`
Expected: PASS

**Step 3: Commit**

```bash
git add src-tauri/src/sql_engine/parser.rs
git commit -m "feat(rust): add SQL parser with statement splitting"
```

---

### Task 9: Schema Store with Caching

**Files:**
- Create: `src-tauri/src/sql_engine/schema_store.rs`

**Step 1: Write schema store**

```rust
// src-tauri/src/sql_engine/schema_store.rs
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Vec<String>,
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignKey {
    pub column: String,
    pub references_table: String,
    pub references_column: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnumType {
    pub name: String,
    pub values: Vec<String>,
}

struct CacheEntry<T> {
    data: T,
    created_at: Instant,
}

impl<T> CacheEntry<T> {
    fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

pub struct SchemaStore {
    tables: DashMap<String, CacheEntry<Vec<TableInfo>>>,
    enums: DashMap<String, CacheEntry<Vec<EnumType>>>,
    ttl: Duration,
}

impl SchemaStore {
    pub fn new() -> Self {
        Self {
            tables: DashMap::new(),
            enums: DashMap::new(),
            ttl: Duration::from_secs(30),
        }
    }

    fn cache_key(connection_id: &str, schema: &str) -> String {
        format!("{}:{}", connection_id, schema)
    }

    pub fn get_tables(&self, connection_id: &str, schema: &str) -> Option<Vec<TableInfo>> {
        let key = Self::cache_key(connection_id, schema);
        self.tables.get(&key).and_then(|entry| {
            if entry.is_expired(self.ttl) {
                None
            } else {
                Some(entry.data.clone())
            }
        })
    }

    pub fn set_tables(&self, connection_id: &str, schema: &str, tables: Vec<TableInfo>) {
        let key = Self::cache_key(connection_id, schema);
        self.tables.insert(key, CacheEntry {
            data: tables,
            created_at: Instant::now(),
        });
    }

    pub fn get_enums(&self, connection_id: &str, schema: &str) -> Option<Vec<EnumType>> {
        let key = Self::cache_key(connection_id, schema);
        self.enums.get(&key).and_then(|entry| {
            if entry.is_expired(self.ttl) {
                None
            } else {
                Some(entry.data.clone())
            }
        })
    }

    pub fn set_enums(&self, connection_id: &str, schema: &str, enums: Vec<EnumType>) {
        let key = Self::cache_key(connection_id, schema);
        self.enums.insert(key, CacheEntry {
            data: enums,
            created_at: Instant::now(),
        });
    }

    pub fn invalidate(&self, connection_id: &str, schema: Option<&str>) {
        if let Some(schema) = schema {
            let key = Self::cache_key(connection_id, schema);
            self.tables.remove(&key);
            self.enums.remove(&key);
        } else {
            // Invalidate all for connection
            let prefix = format!("{}:", connection_id);
            self.tables.retain(|k, _| !k.starts_with(&prefix));
            self.enums.retain(|k, _| !k.starts_with(&prefix));
        }
    }
}

impl Default for SchemaStore {
    fn default() -> Self {
        Self::new()
    }
}

// Global singleton
lazy_static::lazy_static! {
    pub static ref SCHEMA_STORE: Arc<SchemaStore> = Arc::new(SchemaStore::new());
}
```

**Step 2: Add lazy_static dependency**

In Cargo.toml:
```toml
lazy_static = "1.4"
```

**Step 3: Run tests**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/sql_engine/schema_store.rs
git commit -m "feat(rust): add SchemaStore with DashMap cache + TTL"
```

---

### Task 10: Tauri Commands for SQL Engine

**Files:**
- Create: `src-tauri/src/sql_engine/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write commands**

```rust
// src-tauri/src/sql_engine/commands.rs
use tauri::State;
use super::{parse_document, ParsedDocument, SqlDialect};
use super::schema_store::SCHEMA_STORE;

#[tauri::command]
pub fn sql_parse(sql: String, dialect: SqlDialect) -> ParsedDocument {
    parse_document(&sql, dialect)
}

#[tauri::command]
pub fn sql_invalidate_schema(connection_id: String, schema: Option<String>) {
    SCHEMA_STORE.invalidate(&connection_id, schema.as_deref());
}

#[tauri::command]
pub fn sql_split_statements(sql: String, dialect: SqlDialect) -> Vec<StatementRange> {
    let doc = parse_document(&sql, dialect);
    doc.statements
        .into_iter()
        .map(|s| StatementRange {
            from: s.from,
            to: s.to,
            text: s.text,
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct StatementRange {
    pub from: usize,
    pub to: usize,
    pub text: String,
}
```

**Step 2: Register commands in lib.rs**

```rust
// In src-tauri/src/lib.rs
use sql_engine::commands::{sql_parse, sql_invalidate_schema, sql_split_statements};

// In invoke_handler, add:
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    sql_parse,
    sql_invalidate_schema,
    sql_split_statements,
])
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/sql_engine/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add Tauri commands for SQL parsing"
```

---

### Task 11: Frontend SQL Engine Service

**Files:**
- Create: `src/services/sqlEngineService.ts`

**Step 1: Write service**

```typescript
// src/services/sqlEngineService.ts
import { invoke } from '@tauri-apps/api/core';
import type { SqlDialect } from '@/components/CodeEditor/types';

export interface ParsedStatement {
  from: number;
  to: number;
  text: string;
  ast: string | null;
  error: string | null;
  tables: TableRef[];
  columns: string[];
}

export interface TableRef {
  name: string;
  alias: string | null;
  schema: string | null;
}

export interface ParsedDocument {
  statements: ParsedStatement[];
  dialect: string;
}

export interface StatementRange {
  from: number;
  to: number;
  text: string;
}

/**
 * SQL Engine service for Rust backend integration.
 */
export const sqlEngineService = {
  /**
   * Parse SQL document into statements with AST analysis.
   */
  async parse(sql: string, dialect: SqlDialect): Promise<ParsedDocument> {
    return invoke('sql_parse', { sql, dialect });
  },

  /**
   * Split SQL into statement ranges.
   */
  async splitStatements(sql: string, dialect: SqlDialect): Promise<StatementRange[]> {
    return invoke('sql_split_statements', { sql, dialect });
  },

  /**
   * Invalidate schema cache for a connection.
   */
  async invalidateSchema(connectionId: string, schema?: string): Promise<void> {
    return invoke('sql_invalidate_schema', { connectionId, schema });
  },
};

export default sqlEngineService;
```

**Step 2: Verify TypeScript compilation**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/services/sqlEngineService.ts
git commit -m "feat: add sqlEngineService for Rust backend integration"
```

---

## Remaining Tasks (Summary)

The following tasks follow the same pattern:

### Task 12-15: Smart Completion Features (Rust)
- `completion.rs` - Core completion engine
- `join_suggester.rs` - FK-based JOIN suggestions
- `templates.rs` - INSERT/UPDATE templates
- `sp_params.rs` - Stored procedure parameters
- `cte_inference.rs` - CTE column inference

### Task 16-17: Validation Engine (Rust)
- `validator.rs` - Syntax + semantic validation
- `semantic.rs` - Table/column existence checks

### Task 18: SQL Formatter (Rust)
- `formatter.rs` - SQL formatting with options

### Task 19: Frontend Rust Completion Integration
- `rust-completion.ts` - Bridge to Rust completion
- Update `completion.ts` to use Rust backend

### Task 20: Bracket Matching Extension
- `bracket-matching.ts` - SQL keyword pair matching

### Task 21: Integration Testing
- End-to-end tests for all 19 features

### Task 22: Cleanup Legacy Code
- Delete `sql-linter.ts`, `version-linter.ts`, `linter-worker.ts`
- Update imports

---

## Summary

| Phase | Tasks | Files | Key Changes |
|-------|-------|-------|-------------|
| Phase 1 | 1-5 | 8 TS files | Cursor lag FIXED |
| Phase 2 | 6-22 | 15 Rust + 3 TS | 19 smart features |

**Total: 22 bite-sized tasks**

---

Plan complete and saved to `docs/plans/2026-01-07-sql-editor-superpower-impl.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
