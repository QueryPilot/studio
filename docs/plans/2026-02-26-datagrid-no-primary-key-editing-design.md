# DataGrid Editing Without Primary Keys Design

**Goal:** Enable safe SQL table editing when a table has no primary key, while keeping strict safety defaults.

**Chosen policy:**
- `Strict` by default (only deterministic row identity can edit/delete).
- `Best-effort` is an explicit per-row escape hatch only.

## Problem Summary

Current SQL DataGrid editing assumes every editable row has primary key columns.

- `extractPrimaryKeys()` throws when no PK columns exist.
- `createUpdateCommand()` and `createDeleteCommand()` depend on that extraction.
- `SqlDataGrid` catches command creation errors and returns `null`, so edits silently do nothing.

This blocks edits on tables that are still uniquely identifiable through other means (unique constraints or unique indexes).

## Constraints and Existing Capabilities

1. SQL command generation already accepts generic `WHERE` maps (not true PK-only logic).
2. Table structure already loads constraints; unique information is available.
3. SQL grid already has strict read-only behavior for views/materialized views; table-level editability control exists.
4. Current staged/highlight flows are keyed around `primaryKeys` naming and PK-based row mapping.

## Approaches Considered

### 1. Minimal change: reuse `primaryKeys` as generic row matcher

Keep payload shape unchanged and fill `primaryKeys` from PK/unique/best-effort candidates.

- Pros: fastest implementation.
- Cons: semantic confusion, weak safety boundaries, harder long-term maintenance.

### 2. Identity strategy layer (selected)

Introduce explicit row identity strategy with strict deterministic default and explicit best-effort escape hatch.

- Pros: clear safety model, explicit UX, extensible.
- Cons: moderate refactor across command creation, row matching, and staged indicators.

### 3. Dialect-specific row tokens (`ctid`/`rowid`/etc.)

Use backend/system row identifiers.

- Pros: precise in specific dialects.
- Cons: poor portability, higher backend complexity, weaker cross-DB consistency.

## Selected Design

### A. Row Identity Strategy

Add SQL row identity resolution with two modes:

1. `deterministic`
- Priority order:
  1. Primary key columns
  2. Unique constraint columns
  3. Unique index columns (non-partial)
- Candidate is valid only when all identity columns are present in row and non-`undefined`.

2. `best_effort`
- Built from row snapshot values (column equality predicates).
- Not available by default; exposed only via explicit per-row action.

### B. Strict Default Behavior

For tables without deterministic identity:

- Disable standard inline edit/delete staging paths.
- Show non-blocking explanation banner: `Row editing disabled: no primary/unique key`.
- Keep browsing, sorting, filtering, and copy behaviors unchanged.

### C. Best-Effort Escape Hatch (Per-Row Only)

Add row context-menu actions:

- `Best-effort Edit...`
- `Best-effort Delete...`

Execution guardrails:

1. User explicit confirmation.
2. Build `WHERE` from row snapshot.
3. Pre-check current match count.
4. Continue only if match count is exactly `1`.
5. Block with clear reason when `0` or `>1`.

### D. Command Model

Keep SQL generation pipeline unchanged but make matcher intent explicit in metadata.

- Payload continues carrying row predicate map (existing `primaryKeys` field can remain for compatibility).
- Add metadata:
  - `rowMatcherMode: "deterministic" | "best_effort"`
  - `rowMatcherColumns: string[]`

This keeps `commandToSql()` and adapter `update/delete` methods reusable.

### E. DataGrid Integration Points

1. `SqlDataGrid`
- Build deterministic identity candidates from structure (`constraints` + `indexes`).
- Provide matcher strategy to command helpers.
- Enable/disable default editability based on deterministic availability.

2. `crudHelpers`
- Replace PK-only extraction with strategy-aware matcher extraction.
- Return actionable errors for unsupported mode or ambiguous matcher.

3. `BaseDataGrid`
- Preserve current command factory flow.
- Surface guardrail feedback (toast/banner) instead of silent failure.
- Add context-menu wiring for best-effort actions.

4. Staged mapping/highlighting
- Deterministic commands keep existing key-based behavior.
- Best-effort commands use conservative row mapping fallback (command-id scoped) to avoid false highlights.

## Error Handling

### Strict-mode validation errors
- No deterministic identity: block standard edit/delete and explain why.

### Best-effort pre-check failures
- `0 matches`: row changed/deleted; ask user to refresh.
- `>1 matches`: ambiguous match; operation blocked.

### Commit-time failures
- Keep transaction behavior unchanged.
- Include matcher mode and columns in error context for diagnostics.

## Testing Plan

1. Unit tests
- Deterministic identity selection priority: PK > unique constraint > unique index.
- No deterministic identity path disables standard edit/delete.
- Best-effort pre-check branches (`0`, `1`, `>1`).
- Command metadata includes matcher mode and columns.

2. Integration tests (SQL DataGrid)
- Table with no PK but unique constraint remains editable in strict mode.
- Table with no PK and no unique candidate is read-only for edit/delete.
- Best-effort actions are explicit and gated by pre-check result.

3. Regression tests
- Existing SQL generation snapshots remain valid.
- Existing CRUD commit/preview paths remain compatible.

## Rollout Notes

1. No feature flag: ship as default behavior.
2. Instrument blocked reasons (`no_deterministic_key`, `best_effort_ambiguous`, `best_effort_not_found`) for UX tuning.
3. Ship strict deterministic support first, then enable best-effort actions.

## Out of Scope

1. Fully automatic best-effort inline editing without explicit action.
2. Backend-specific hidden row-id implementation.
3. Expanding best-effort behavior to non-SQL paradigms.
