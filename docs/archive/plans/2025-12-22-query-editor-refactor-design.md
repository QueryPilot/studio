# Query Editor Refactor & Enhancement Design

**Date**: 2025-12-22
**Status**: Draft
**Scope**: QueryPanel, SqlEditor, ResultViewer

---

## Executive Summary

Deep analysis of the query editor implementation revealed:
- **4 architecture issues** causing maintainability problems
- **5 performance bottlenecks** affecting responsiveness
- **6 bugs** including race conditions and memory leaks
- **20+ feature gaps** compared to DataGrip/DBeaver

This document prioritizes fixes and enhancements into phases.

---

## Part 1: Architecture Issues

### 1.1 God Component (QueryPanel.tsx - 1,446 lines)

**Problem**: Single component handles execution, streaming, caching, mutation detection, transaction tracking, history, formatting, multi-query execution.

**Impact**:
- Every change risks breaking unrelated features
- Testing requires mocking half the application
- Onboarding developers takes longer

**Solution**: Extract into focused modules:
```
QueryPanel/
├── QueryPanel.tsx          # Orchestration only (~200 lines)
├── hooks/
│   ├── useQueryExecution.ts    # Single + multi-query execution
│   ├── useQueryStreaming.ts    # Streaming state management
│   ├── useMutationDetection.ts # Cache invalidation logic
│   └── useTransactionState.ts  # BEGIN/COMMIT/ROLLBACK tracking
├── components/
│   ├── QueryEditor.tsx         # (exists)
│   ├── ResultViewer.tsx        # (exists)
│   └── TransactionBadge.tsx    # Extract from QueryPanel
└── utils/
    └── queryTypeDetection.ts   # isMutation, isDDL, isTransaction
```

### 1.2 State Fragmentation (4 Stores)

**Problem**: Query state split across:
1. Local `useReducer` (QueryPanel)
2. `tabStateStore` (global persistence)
3. `workbenchStore.updateTabMetadata` (SQL persistence)
4. `dataInvalidationStore` (cache)

**Impact**: Sync drift, double memory for large results, debugging difficulty.

**Solution**: Single source of truth pattern:
```typescript
// Option A: tabStateStore as sole owner
// QueryPanel reads from store, dispatches actions, never holds local copy

// Option B: Local state with selective sync
// Only sync non-volatile state (query text, viewMode, dialect)
// Keep volatile state local (result, isExecuting, isStreaming)
```

**Recommendation**: Option B - keeps streaming state local for performance.

### 1.3 Circular Update Pattern

**Problem**: Component reads `globalState`, updates it in `useEffect`, triggers re-read.

**Solution**: Unidirectional flow - actions dispatch to store, selectors read.

### 1.4 Compartment Instance Complexity

**Problem**: Per-instance compartments via `useRef` is non-standard.

**Solution**: Keep current approach (it works), add documentation explaining why module-level compartments caused state corruption.

---

## Part 2: Performance Issues

### 2.1 Triple-Layer Deferral (Critical)

**Location**: `QueryPanel.tsx:720-788`

**Problem**:
```typescript
setTimeout(120ms) → requestAnimationFrame → startTransition
```
Unpredictable delays, first batch appears sluggish.

**Fix**:
```typescript
// Single RAF with frame budget
const scheduleUpdate = () => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (accumulatedRows.length > renderedCount) {
      flushUpdate();
    }
  });
};
```

### 2.2 Statement Parsing on Cursor Move (High)

**Location**: `statement-highlight.ts:35-66`

**Problem**: `getAllStatements()` parses entire document on every selection change.

**Fix**:
```typescript
const activeStatementField = StateField.define<{
  statements: Statement[];
  activeIndex: number | null;
}>({
  create(state) {
    return { statements: getAllStatements(state), activeIndex: null };
  },
  update(value, tr) {
    // Only reparse on document change
    const statements = tr.docChanged
      ? getAllStatements(tr.state)
      : value.statements;

    // Selection change only updates activeIndex
    const activeIndex = tr.selectionSet
      ? findActiveStatement(statements, tr.state.selection.main.head)
      : value.activeIndex;

    return { statements, activeIndex };
  },
});
```

### 2.3 Context Cache 100% Miss Rate (Medium)

**Location**: `context.ts:63-65`

**Problem**: Cache key includes cursor position - any movement = miss.

**Fix**:
```typescript
// Cache by document hash only
function getContextCacheKey(docHash: number): string {
  return `${docHash}`;
}

// Store position-independent analysis
interface CachedAnalysis {
  tables: TableRef[];
  ctes: CteRef[];
  statementBoundaries: Range[];
}

// Resolve position-specific info at lookup time
function analyzeSqlContext(context: CompletionContext): SqlContextAnalysis {
  const cached = getOrComputeDocumentAnalysis(context.state);
  return resolveAtPosition(cached, context.pos);
}
```

### 2.4 setResult Stale Closure (Medium)

**Location**: `QueryPanel.tsx:245-259`

**Fix**:
```typescript
// Use reducer dispatch directly, no wrapper
const handleStreamUpdate = useCallback((newRows: unknown[][]) => {
  dispatch({
    type: "APPEND_ROWS",
    payload: newRows
  });
}, []); // No dependencies - dispatch is stable
```

### 2.5 Multi-Query N Streams (Low - Backend Change)

**Problem**: 10 statements = 10 IPC roundtrips.

**Fix**: Add `stream_batch_query` backend command that accepts array of statements.

---

## Part 3: Bugs

### 3.1 Auto-Refresh Race Condition (Critical)

**Location**: `QueryPanel.tsx:996-1002`

**Fix**:
```typescript
const pendingRefreshRef = useRef<number | null>(null);

// In mutation handler:
if (lastSelectQuery) {
  // Cancel any pending refresh
  if (pendingRefreshRef.current) {
    clearTimeout(pendingRefreshRef.current);
  }

  // Guard against concurrent execution
  if (!isExecuting) {
    pendingRefreshRef.current = window.setTimeout(() => {
      pendingRefreshRef.current = null;
      if (!isExecutingRef.current) {
        handleExecute(lastSelectQuery);
      }
    }, 100);
  }
}
```

### 3.2 AbortController Global Cancel (Critical)

**Location**: `QueryPanel.tsx:696-697, 1105-1106`

**Fix**:
```typescript
// Pass signal to streaming service
const streamPromise = tableStreamingService.streamQuery(
  effectiveConnectionId,
  tabId,
  sql,
  pageSize,
  onProgress,
  onError,
  smartQueryLimit,
  onLimitCallback,
  controller.signal  // Add this parameter
);

// In handleCancel - cancel only this stream
tableStreamingService.cancelStream(tabId);
```

### 3.3 Event Handler Ghost Accumulation (High)

**Location**: `QueryPanel.tsx:1220-1257`

**Fix**:
```typescript
// Use refs for stable handler identity
const handlersRef = useRef({
  format: () => {},
  execute: () => {},
  // ...
});

// Update refs (doesn't change identity)
useEffect(() => {
  handlersRef.current.format = handleBeautify;
  handlersRef.current.execute = handleExecute;
}, [handleBeautify, handleExecute]);

// Subscribe once with stable wrapper
useEffect(() => {
  const onFormat = () => {
    if (isFocusedRef.current) handlersRef.current.format();
  };
  eventBus.on("query-editor:format", onFormat);
  return () => eventBus.off("query-editor:format", onFormat);
}, []); // Empty deps - subscribe once
```

### 3.4 Controlled/Uncontrolled Mode Switch (Medium)

**Location**: `ResultViewer.tsx:76-88`

**Fix**:
```typescript
// Always controlled - parent manages state
interface ResultViewerProps {
  activeResultIndex: number;
  onResultTabChange: (index: number) => void;
  // Remove local state entirely
}
```

### 3.5 Persist Timer Race on Remount (Medium)

**Location**: `QueryPanel.tsx:379-403`

**Fix**:
```typescript
// Use abort-safe pattern
useEffect(() => {
  const abortController = new AbortController();

  const persistSql = debounce((value: string) => {
    if (abortController.signal.aborted) return;
    updateTabMetadata(panelId, tabId, { sql: value });
  }, 250);

  // Store in ref for use
  persistSqlRef.current = persistSql;

  return () => {
    abortController.abort();
    persistSql.cancel();
  };
}, [panelId, tabId, updateTabMetadata]);
```

### 3.6 Multi-Query Missing Cache Invalidation (Medium)

**Location**: `QueryPanel.tsx:409-607`

**Fix**: Add same mutation detection logic from single-query path:
```typescript
// After each statement in loop:
if (isMutationQuery(stmt)) {
  handleMutationCache(stmt, effectiveConnectionId);
  const affectedTables = parseMutationTables(stmt);
  affectedTables.forEach(({ schema, table }) => {
    invalidateTable(effectiveConnectionId, database, schema ?? "public", table);
  });
}
```

---

## Part 4: Feature Gaps

### Tier 1: Quick Wins (< 1 day each)

| Feature | Description | Files |
|---------|-------------|-------|
| **Export CSV** | Download results as CSV | ResultViewer.tsx |
| **Export JSON** | Download results as JSON | ResultViewer.tsx |
| **Copy as INSERT** | Copy selected rows as INSERT statements | TableDataGrid |
| **Column statistics** | Show NULL%, distinct count on hover | ResultViewer.tsx |
| **Filter results** | Client-side WHERE on loaded data | ResultViewer.tsx |

### Tier 2: Medium Effort (1-3 days each)

| Feature | Description | Files |
|---------|-------------|-------|
| **Pin results** | Keep result while running new query | QueryPanel, tabStateStore |
| **Go to DDL** | Cmd+Click table → CREATE statement | goto-definition.ts, new panel |
| **Query outline** | Tree view of CTEs/subqueries/JOINs | New component |
| **Value preview** | JSON/XML pretty-print popup | TableDataGrid cell renderer |
| **Live formatter** | Preview formatted SQL before apply | QueryToolbar, modal |

### Tier 3: Larger Features (3-5 days each)

| Feature | Description | Files |
|---------|-------------|-------|
| **Plan diff** | Compare two EXPLAIN plans | ExplainViewer enhancement |
| **Background execution** | Run query with notification | New service, UI indicators |
| **Charts** | Quick visualizations from results | New chart component |
| **Parameter binding** | Input values for $1, :param, @var | SqlEditor extension, UI |
| **FK navigation** | Click FK value → jump to row | TableDataGrid, navigation |

### Tier 4: Major Features (1+ week each)

| Feature | Description | Files |
|---------|-------------|-------|
| **Result diff** | Compare two result sets | New component |
| **Batch export** | Export multi-query to files | Export service |
| **Extract to CTE** | Refactor selection to WITH | SqlEditor code action |
| **Postfix completions** | `users.sel` → SELECT | Completion extension |

---

## Implementation Plan

### Phase 1: Stability (Week 1)

**Goal**: Fix critical bugs, no new features.

1. **Day 1-2**: Fix race conditions
   - [ ] Auto-refresh race condition (3.1)
   - [ ] AbortController global cancel (3.2)

2. **Day 3**: Fix memory/handler leaks
   - [ ] Event handler ghost accumulation (3.3)
   - [ ] Persist timer race on remount (3.5)

3. **Day 4-5**: Fix state issues
   - [ ] Controlled/uncontrolled mode switch (3.4)
   - [ ] Multi-query cache invalidation (3.6)

### Phase 2: Performance (Week 2)

**Goal**: Make editor feel snappy.

1. **Day 1-2**: Streaming performance
   - [ ] Remove triple-layer deferral (2.1)
   - [ ] Benchmark before/after with 100K rows

2. **Day 3-4**: Parsing performance
   - [ ] Statement parsing cache (2.2)
   - [ ] Context analysis cache fix (2.3)

3. **Day 5**: Cleanup
   - [ ] Fix setResult stale closure (2.4)
   - [ ] Add performance tests

### Phase 3: Quick Wins (Week 3)

**Goal**: Visible user value, low effort.

1. **Day 1**: Export features
   - [ ] Export CSV with options (delimiter, encoding)
   - [ ] Export JSON (pretty/compact)

2. **Day 2**: Copy features
   - [ ] Copy as INSERT statements
   - [ ] Copy as Markdown table

3. **Day 3-4**: Result enhancements
   - [ ] Column statistics on hover
   - [ ] Client-side result filtering

4. **Day 5**: Polish
   - [ ] Keyboard shortcuts for new features
   - [ ] Documentation

### Phase 4: Architecture (Week 4-5)

**Goal**: Sustainable codebase.

1. **Week 4**: Extract hooks
   - [ ] useQueryExecution hook
   - [ ] useQueryStreaming hook
   - [ ] useMutationDetection hook

2. **Week 5**: State consolidation
   - [ ] Single source of truth for query state
   - [ ] Remove redundant syncs
   - [ ] Add integration tests

### Phase 5: Power Features (Week 6+)

**Goal**: Competitive with DataGrip/DBeaver.

1. **Pin results** - Keep previous result visible
2. **Go to DDL** - Navigate to table definition
3. **Query outline** - Visual query structure
4. **Plan diff** - Compare execution plans
5. **Background execution** - Non-blocking queries

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| QueryPanel.tsx lines | 1,446 | < 300 |
| First result batch latency | ~150ms | < 50ms |
| Statement highlight on cursor move | Full reparse | Cached lookup |
| Known bugs | 6 | 0 |
| Export options | 0 | 4+ |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes during refactor | High | Feature flags, incremental rollout |
| Performance regression | Medium | Benchmark suite, A/B testing |
| State migration complexity | Medium | Backward-compatible store changes |
| Scope creep on features | Medium | Strict phase boundaries |

---

## Appendix: File Reference

| File | Lines | Role |
|------|-------|------|
| `QueryPanel.tsx` | 1,446 | Main orchestrator |
| `SqlEditor.tsx` | 616 | CodeMirror wrapper |
| `ResultViewer.tsx` | 625 | Result display |
| `QueryEditor.tsx` | 142 | SqlEditor wrapper |
| `QueryToolbar.tsx` | 336 | Action buttons |
| `context.ts` | 654 | SQL context analysis |
| `optimized-completion.ts` | 744 | Autocomplete |
| `statement-highlight.ts` | 189 | Active statement |
| `tabStateStore.ts` | 115 | Global query state |
