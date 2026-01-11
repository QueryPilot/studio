# DataGrid CRUD Redesign

## Overview

Comprehensive redesign of the DataGrid CRUD system to deliver a professional database editing experience. The goal is to match and exceed competitors (TablePlus, DBeaver, DataGrip) with Excel-like editing, robust safety features, and performance at 100k+ rows.

## Target Audience

- Power users / DBAs
- Developers
- Data analysts
- Business analysts
- Startup employees who work closely with databases

## Design Principles

1. **Excel-native feel** - Type to edit, Tab flows naturally, paste works like spreadsheet
2. **Safety-first** - SQL preview, dry-run, conflict detection, clear undo
3. **Progressive disclosure** - Clean default, power features via shortcuts/menus

---

## Architecture

### Cell State Machine

Explicit state machine replacing current ref-based approach for predictability and testability.

```
States: idle → focused → editing → validating → dirty → committing → error
```

| State | Description | User Can |
|-------|-------------|----------|
| `idle` | No interaction | Click, hover |
| `focused` | Cell selected, not editing | Type to edit, arrow keys, Enter |
| `editing` | Active input | Type, Escape to cancel |
| `validating` | Checking value | Wait (instant for most types) |
| `dirty` | Valid change staged | Edit again, commit, discard |
| `committing` | Sending to backend | Wait |
| `error` | Commit failed | Retry, edit, discard |

### Multi-Panel State Synchronization

Event-driven sync via StateEventBus for cross-panel visibility.

```typescript
// Events
cell:editing    { tableKey, rowKey, column }
cell:validated  { tableKey, rowKey, column, error? }
cell:staged     { tableKey, rowKey, column, newValue }
row:inserted    { tableKey, tempId }
row:deleted     { tableKey, rowKey }
table:committing { tableKey }
table:committed  { tableKey, success }
table:conflict   { tableKey, rowKey, serverValue }
```

**Sync Rules:**
- Panel A starts editing cell → other panels show "editing" indicator
- Panel A stages change → all panels see dirty indicator
- Panel A commits → all panels refresh data, clear dirty state
- Staged changes survive panel close (persist in CrudStore)

### State Storage Strategy

Hybrid approach: Zustand for persistence, refs for hot path.

```typescript
// COLD PATH (Zustand) - serializable, persisted, devtools
interface CrudStore {
  stagedCommands: Map<tableKey, CrudCommand[]>
  history: HistoryStack
}

// HOT PATH (Refs) - not serialized, no re-renders
interface GridRefs {
  cellStates: Map<CellKey, CellState>
  validationCache: Map<CellKey, boolean>
  editLocks: Map<CellKey, panelId>
  selectionState: SelectionState
}
```

---

## Keyboard Navigation

### Excel-like Behavior

| Action | Current | Target |
|--------|---------|--------|
| Click cell | Focus + edit mode | Focus only (selection) |
| Double-click | Edit mode | Edit mode |
| Type A-Z/0-9 | Nothing | Enter edit + replace value |
| Enter | Commit + exit | Commit + move down |
| Tab | Move right (in edit) | Commit + move right |
| Shift+Tab | - | Commit + move left |
| Escape | Cancel edit | Cancel edit / clear selection |
| Arrow keys | Trapped in input | Move selection (when focused) |
| F2 | - | Enter edit mode (keep value) |
| Delete/Backspace | Delete char | Clear cell (when focused) |
| Ctrl+C | - | Copy cell/selection |
| Ctrl+V | - | Paste into cell/selection |
| Ctrl+Z | Undo (global) | Undo last edit |
| Ctrl+D | - | Fill down |
| Ctrl+Enter | - | Commit + stay in cell |

### Navigation State Machine

```
BROWSING → (click) → SELECTED → (dblclick/F2/type) → EDITING
    ↑                    ↓                              ↓
    └── (Escape) ←───────┴──── (Enter/Tab) ────────────┘
```

### Two-Phase Input Handling

```typescript
// Phase 1: SELECTED state - keys navigate or trigger edit
handleKeyDown_Selected(e: KeyboardEvent) {
  if (isNavigationKey(e)) moveSelection(e.key)
  else if (isPrintableChar(e) || e.key === 'F2') enterEditMode(...)
  else if (e.key === 'Delete' || e.key === 'Backspace') clearCell()
}

// Phase 2: EDITING state - keys go to input
handleKeyDown_Editing(e: KeyboardEvent) {
  if (e.key === 'Enter') commitAndMove('down', ...)
  else if (e.key === 'Tab') commitAndMove('right', ...)
  else if (e.key === 'Escape') cancelEdit()
}
```

---

## Clipboard & Batch Operations

### Copy Shortcuts

| Shortcut | Action | Output |
|----------|--------|--------|
| `Cmd+C` | Copy cell value (raw) | `John Doe` |
| `Cmd+Shift+C` | Copy as JSON | `{"name": "John Doe"}` |
| `Cmd+Alt+C` | Copy as TSV | `John Doe\tjohn@email.com` |
| `Cmd+Ctrl+C` | Copy as CSV | `"John Doe","john@email.com"` |
| `Cmd+Alt+Shift+C` | Copy as INSERT SQL | `INSERT INTO users...` |

### Multi-Cell Copy Formats

| Selection | JSON Output |
|-----------|-------------|
| Single cell | `"value"` |
| Single row | `{"id": 1, "name": "John", ...}` |
| Multiple rows | `[{...}, {...}, {...}]` |
| Column | `["val1", "val2", "val3"]` |
| Range | `[{"col1": "a", "col2": "b"}, ...]` |

### Paste Modes

| Scenario | Behavior |
|----------|----------|
| Single cell → paste single | Replace cell |
| Single cell → paste multi | Expand from anchor |
| Range → paste matching | Fill range |
| Range → paste smaller | Tile/repeat pattern |
| Range → paste larger | Clip to selection |
| Paste into readonly | Skip, show warning |
| Paste type mismatch | Validate, show errors inline |

### Batch Operations

```typescript
interface BatchOperations {
  fillDown(selection: CellRange): void      // Ctrl+D
  fillRight(selection: CellRange): void     // Ctrl+R
  clearCells(selection: CellRange): void    // Delete key
  duplicateRows(rows: number[]): void       // Ctrl+D on row
  deleteRows(rows: number[]): void
  insertRowsAbove(count: number): void
  insertRowsBelow(count: number): void
}
```

### Batch Command Staging

```typescript
interface BatchCommand {
  type: 'batch'
  operations: CrudCommand[]
  metadata: { source: 'paste' | 'fill' | 'bulk-edit', affectedCells: number }
}

// Undo/Redo treats batch as single operation
```

---

## Validation & Error Feedback

### Validation Pipeline

```
Typing → Debounce (150ms) → Validate (async) → Valid/Invalid
```

### Validation Layers

| Layer | When | Examples |
|-------|------|----------|
| Format | On keystroke (debounced) | UUID format, date format, JSON syntax |
| Type | On blur/commit | Integer bounds, numeric precision |
| Constraint | On blur/commit | NOT NULL, CHECK constraints |
| Backend | On commit | FK violations, unique conflicts |

### Visual Feedback States

| State | Visual |
|-------|--------|
| Default | No modifications |
| Focused | Primary color border |
| Editing | Input visible, cursor blinking |
| Dirty/Staged | Amber left border |
| Validation Error | Red border + warning icon + tooltip |
| Insert Row | Green background (entire row) |
| Delete Row | Dimmed + red background |

### Validation Store

```typescript
interface ValidationStore {
  errors: Map<CellKey, ValidationError>
  warnings: Map<CellKey, ValidationError>
  validating: Set<CellKey>

  setError(cellKey: CellKey, error: ValidationError): void
  clearError(cellKey: CellKey): void
  hasErrors(tableKey: string): boolean
  getErrorCount(tableKey: string): number
}
```

---

## Commit Safety

### SQL Preview Modal

Always shown before execute with:
- Summary (X rows updated, Y inserted, Z deleted)
- Full SQL statements with syntax highlighting
- Copy All button
- Option to skip preview for small changes

### Safety Features

| Feature | Description |
|---------|-------------|
| SQL Preview | Always show generated SQL before execute |
| Copy SQL | One-click copy for manual review |
| Row Count Warning | Highlight if DELETE affects > 10 rows |
| Dry Run Mode | Execute in transaction, show results, ROLLBACK |
| Conflict Detection | Check row version before UPDATE |

### Conflict Detection

```typescript
interface RowVersion {
  rowKey: string
  checksum: string    // Hash of original values
  fetchedAt: number
}

// Before commit, verify row unchanged on server
async function checkConflicts(commands: CrudCommand[]): Promise<Conflict[]>
```

### Conflict Resolution UI

Options when conflict detected:
- Keep Mine
- Keep Theirs
- Edit Manually

---

## Performance

### Strategy

| Avoid | Prefer |
|-------|--------|
| Full row re-renders | Cell-level updates only |
| State in React state | Refs + selective setState |
| Map.get() in render | Pre-computed indexes |
| New objects every render | Stable references (useMemo) |
| Sync validation | Debounced + Web Worker |

### Virtualization-Aware State

Only track state for visible + buffer rows. Evict states when scrolling out of range.

### Validation Performance

Web Worker for heavy validation (JSON, complex regex). Debounced, batched validation queue.

### Optimistic Updates Optimization

Pre-indexed lookups instead of O(N) scan:

```typescript
interface OptimisticIndex {
  updatesByPk: Map<string, CrudCommand>
  insertTempIds: Set<string>
  deletedPks: Set<string>
  version: number
}
```

### Benchmark Targets

| Operation | Target |
|-----------|--------|
| Cell state lookup | < 1ms |
| Validation (simple) | < 10ms |
| Validation (JSON) | < 50ms |
| Optimistic apply (10k rows) | < 50ms |
| Scroll FPS | 60fps |
| Paste 1000 cells | < 200ms |

---

## Implementation Phases

### Phase 1: Foundation
- Cell state machine (idle → focused → editing → dirty)
- Validation store (replace refs)
- Visual states (focus, dirty, error indicators)
- Basic keyboard nav (arrows in focused mode)

### Phase 2: Excel-like Editing
- Type-to-edit (replace mode)
- F2 to edit (preserve mode)
- Enter/Tab commit + move
- Escape cancel
- Delete/Backspace clear cell

### Phase 3: Clipboard & Batch
- Copy formats (raw, JSON, TSV, CSV, SQL)
- Paste single/multi-cell
- Multi-cell selection
- Fill down (Ctrl+D)
- Batch command staging

### Phase 4: Commit Safety
- SQL preview modal
- Dry run mode
- Conflict detection
- Conflict resolution UI

### Phase 5: Multi-Panel Sync
- StateEventBus
- Cross-panel dirty indicators
- Edit lock awareness

### Phase 6: Performance Polish
- Web Worker validation
- Optimistic update indexing
- Virtualization-aware state
- Benchmark + optimize

### Dependencies

```
Phase 1 → Phase 2 → Phase 3
              ↓
          Phase 4

Phase 1 → Phase 5
Phase 1 → Phase 6
```

Phases 4, 5, 6 can run in parallel after Phase 2.

---

## Files to Create/Modify

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1 | `stores/cellStateStore.ts`, `stores/validationStore.ts` | `renderers/*`, `hooks/useTableCrud.ts` |
| 2 | `hooks/useKeyboardNavigation.ts` | `base/EditableDataGrid.tsx` |
| 3 | `utils/clipboard.ts`, `hooks/useClipboard.ts`, `hooks/useSelection.ts` | `crudStore.ts` |
| 4 | `components/SqlPreviewModal.tsx`, `components/ConflictDialog.tsx` | Backend commands |
| 5 | `utils/stateEventBus.ts` | `crudStore.ts`, panel components |
| 6 | `workers/validation.worker.ts` | `hooks/useOptimisticRows.ts` |

---

## Research Sources

- [TablePlus keyboard issues](https://github.com/TablePlus/TablePlus-Windows/issues/600)
- [TablePlus long text editing](https://github.com/TablePlus/TablePlus/issues/760)
- [UX Design World - Inline Editing Best Practices](https://uxdworld.com/inline-editing-in-tables-design/)
- [Pega - Navigating Complexity of Inline Editing](https://community.pega.com/blog/navigating-complexity-inline-editing-tables)
- [Galaxy 2025 SQL Editor Buyer's Guide](https://www.getgalaxy.io/resources/galaxy-vs-datagrip-tableplus-dbeaver-more-the-ultimate-2025-sql-editor-buyers-guide)
