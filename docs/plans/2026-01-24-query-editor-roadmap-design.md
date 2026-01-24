# Query Editor Roadmap Design

Date: 2026-01-24
Owner: Sisyphus
Status: Draft (Revised after deep review)

## Summary
This document defines a multi-quarter roadmap for the SQL query editor focused on refactoring and code actions, inspections and validation, performance at large scale, and completion polish. PostgreSQL and MySQL are tier-1 targets; all other dialects should maintain parity where practical.

## Goals
- Increase IDE-like refactoring coverage (aliasing, CTE transforms, qualification).
- Add schema-aware inspections and quick fixes that surface correctness issues.
- Keep the editor responsive for large scripts (10k+ lines) with adaptive feature load.
- Improve completion relevance and ergonomics (INSERT lists, postfix, smart triggers).

## Non-Goals
- AI-driven features (e.g., text-to-SQL, AI explain/fix) are out of scope here.
- Results grid features and data editing workflows are not included.
- Cross-file or cross-object refactoring outside the current editor buffer.

## Current State (Highlights)
- CodeMirror 6 direct integration with per-instance compartments.
- Rust-first completion with TS fallback, fuzzy ranking, usage boosts.
- Unified linting (pg-parser for PostgreSQL; worker-based for others).
- Refactor actions: rename, extract CTE; expand star code action.
- Semantic highlighting, hover tooltips, query outline, run gutter.
- Rust backend has `sql_validate`, `sql_get_outline`, `sql_get_refactor_actions` commands.

## Competitive Gaps (DataGrip, DBeaver, TablePlus)
- Broader inspection set with quick fixes (e.g., DELETE without WHERE, unused CTE).
- Insert column list generation and postfix completions.
- Better completion behavior in mid-query contexts (no query-start keywords).
- More refactorings (introduce alias, inline CTE, qualify columns).

## Technical Risks and Foundational Gaps

### Critical (blocking correctness)
- **Tauri detection mismatch**: `unified-linter.ts` checks `__TAURI__`, but `refactor-service.ts` and `rust-completion.ts` check `__TAURI_INTERNALS__`. On Tauri 2 this causes Rust linting to silently skip.
- **Linter not receiving schema context**: `createDialectLinter()` in `linter-strategy.ts` only passes `{ dialect }`. The Rust `sql_validate` command supports `connectionId` and `schema` but frontend doesn't provide them.

### High (data correctness)
- **Semantic highlight cache is module-level**: `semantic-highlighting.ts` uses global `tokenCache` keyed by `doc.length` only. Different editors or same-length edits can reuse stale tokens.
- **Outline cache is global and simple**: `refactor-service.ts` caches by string equality with single global cache. Tab switching causes cache thrashing.
- **Completion metadata cache missing schema**: Cache key is `connectionId` only. Schema switches in same connection can surface stale columns/tables.

### Medium (feature gaps)
- **Code actions UI disabled**: `sql-refactoring.ts` has lightbulb plugin commented out due to Base UI MenuGroupLabel error.
- **Symbol table duplicates Rust work**: TypeScript `symbol-table.ts` uses CodeMirror AST while Rust has `symbol_finder.rs`. Can cause inconsistent resolution.
- **Worker linting has no schema access**: Fallback worker-based linting is syntax-only, no semantic checks.
- **Inline rename requires Tauri**: No graceful degradation for non-Tauri environments.

## Roadmap

### Phase 0 - Foundations (1-2 months)
Focus: correctness bugs and performance infrastructure.

#### Tauri and IPC
- **Fix Tauri detection consistency**: Create single `isTauriAvailable()` helper using `__TAURI_INTERNALS__` and use everywhere.
- Graceful degradation for non-Tauri: inline rename, code actions should check availability and disable cleanly.

#### Refactor and actions
- Re-enable code actions UI (lightbulb) with stable menu integration.
- Normalize refactor event flow between editor and parent container.

#### Inspections
- Thread `connectionId` and `schema` through unified linter to Rust `sql_validate`.
- Surface inspection results in gutter and diagnostics.

#### Performance
- Per-editor caches for semantic highlighting (not module-level).
- Per-editor caches for outline (not global).
- Adaptive debounce infrastructure: detect doc size, apply thresholds (2k, 5k, 10k lines).
- Parse only active statement for outline unless full outline explicitly requested.

#### Completion
- Include schema in metadata cache key (`connectionId:schema`).
- Clear caches on schema change events.

#### Success Criteria
- Rust linting uses schema for table/column validation.
- No cache pollution between editor instances.
- Tauri detection is consistent across all modules.

### Phase 1A - Inspections & Performance (6-8 weeks)
Focus: schema-aware inspections and non-blocking outline.

#### Inspections
- UPDATE or DELETE without WHERE (warning + quick fix scaffold).
- SELECT * in non-ad-hoc context (suggest expand star).
- Ambiguous column reference (suggest qualify).
- Unused CTE (warning + quick fix to remove).

#### Performance
- Outline parsing off main thread via Rust async or dedicated worker.
- Statement-level incremental outline (only re-parse changed statement).

#### Success Criteria
- At least 4 inspections with quick fixes shipping.
- Outline never blocks typing even on 5k line scripts.

### Phase 1B - Refactors & Completion Polish (6-8 weeks)
Focus: IDE-like refactorings and completion ergonomics.

#### Refactor and actions
- Introduce alias for tables and subqueries.
- Inline CTE (replace usages with CTE body).
- Qualify and unqualify column references.

#### Completion
- INSERT column list generation (Ctrl+Space after `INSERT INTO table (`).
- Ctrl+Space expand star (cursor on `*` triggers expansion).
- Postfix completions: `.count`, `.exists`, `.distinct`.
- Avoid query-start keyword suggestions mid-query.

#### Success Criteria
- At least 3 new refactor actions shipping.
- INSERT column list works for Postgres and MySQL.

### Phase 2 - IDE Parity (4-6 months)
Focus: advanced refactors, smarter diagnostics, and large file resilience.

#### Refactor and actions
- Rename symbol across statement scope with preview.
- Extract subquery from selection.
- Inline alias (rewrite usages and remove alias).

#### Inspections
- Duplicate alias or column name.
- Non-sargable pattern heuristics.
- Unreachable predicates in WHERE (constant false).
- Unused table alias.

#### Performance
- Feature degradation ladder:
  - >10k lines: disable semantic highlighting.
  - >20k lines: disable outline and parameter hints.
  - >50k lines: disable linting, keep only execution.
- Lazy semantic tokenization by visible viewport only.

#### Completion
- Qualify-on-collision option (only qualify when names collide).
- Improved function overload hints with parameter docs.

#### Success Criteria
- Editor remains responsive at 10k lines (no typing stalls >100ms).
- Rename correctly updates all references within scope.

### Phase 3 - Differentiators (multi-quarter)
Focus: long-term competitive edge.

#### Refactor and actions
- Introduce parameter (extract literal to parameter).
- Extract WHERE clause to CTE.
- Apply all quick fixes in current statement.

#### Inspections
- Schema drift warnings (table/column exists in query but not in schema).
- Anti-pattern detection for risky joins (CROSS JOIN, cartesian product).

#### Performance
- LRU caches with explicit schema invalidation.
- Lazy loading for metadata in very large scripts (>100k lines).

#### Completion
- Join path suggestions across multiple tables (FK graph traversal).
- Ranking based on query history and result column usage.

## Dialect Strategy
- Tier-1: PostgreSQL and MySQL. Build and validate features here first.
- Tier-2: SQL Server, SQLite, PLSQL. Keep parity; allow reduced accuracy if metadata is limited.

## Dependencies
- Rust IPC for schema-aware linting and refactor actions (exists, needs wiring).
- Metadata provider must expose `connectionId` and `schema` (exists).
- UI components for code actions menu (needs Base UI fix).
- Single Tauri detection helper (needs creation).

## Success Metrics
- P95 completion latency < 50ms for cached metadata.
- Editor remains responsive at 10k lines (no typing stalls > 100ms).
- Linting validates table/column existence against schema (Phase 0).
- At least 4 inspections with quick fixes in Phase 1A.
- At least 3 new refactor actions in Phase 1B.
- No cache pollution between multiple editor instances.

## Open Questions
- Should we unify symbol table resolution between TypeScript and Rust? (Currently duplicated)
- Should inspections run in worker for non-Tauri environments? (Fallback path)
- Do we need a user preference for feature degradation thresholds?
- Should we expose Rust outline/refactor to non-Tauri via HTTP sidecar?

## Timeline Assessment

| Phase | Duration | Risk Level | Notes |
|-------|----------|------------|-------|
| Phase 0 | 1-2 months | Medium | Base UI menu fix is unknown complexity |
| Phase 1A | 6-8 weeks | Low | Well-scoped inspections |
| Phase 1B | 6-8 weeks | Medium | Refactors depend on Rust backend |
| Phase 2 | 4-6 months | Medium-High | Rename across scope is complex |
| Phase 3 | Multi-quarter | High | Research-heavy, exploratory |

## Changelog
- 2026-01-24: Initial draft.
- 2026-01-24: Revised after deep codebase review. Split Phase 1, added Tauri detection fix, per-editor caches, new risks, timeline assessment.
