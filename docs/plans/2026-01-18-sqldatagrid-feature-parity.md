# SqlDataGrid Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Port all features from TableDataGrid (2700 lines) to SqlDataGrid (354 lines) while maintaining the unified BaseDataGrid architecture.

**Architecture:** Keep BaseDataGrid as foundation, add SQL-specific features to SqlDataGrid

**Problem:** SqlDataGrid is a bare skeleton missing ALL rich features from TableDataGrid:
- No custom cell renderers (already uses buildGridCellV2 ✓)
- No hover icons for FK preview
- No context menus
- No quick filter
- No clipboard operations
- No fill operations
- No embedded FK display values
- No staged changes highlighting
- No column management UI
- No keyboard shortcuts
- No export to CSV

---

## Task 1: Set up imports and state

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Add imports:**
```typescript
// Feature hooks
import {
  useCellHoverIcons,
  useClipboardBridge,
  useStagedChangesIndicator,
  useQuickFilter,
  useFillOperations,
  hasStagedCellChange,
  isRowPendingDeletion,
  isRowPendingInsertion,
} from '../hooks';

import {
  useColumnPinning,
  useColumnSizing,
  useColumnVisibility,
  useRowPinning,
  useColumnSorting,
} from '../hooks';

// Components
import { QuickFilter, type QuickFilterRef } from '../components/QuickFilter';
import { FKPreviewPopover } from '../components/FKPreviewPopover';
import { UnifiedContextMenu, type ContextMenuTarget } from '../components/UnifiedContextMenu';
import { DataGridEmptyState, DataGridErrorState } from '../components/DataGridStates';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import { DataGridStatusBar } from '../components/DataGridStatusBar';

// Utils
import { createDrawHeader } from '../utils/headerUtils';
import { exportToCSV } from '../utils/exportUtils';
import { truncateTextToWidth } from '../utils/textUtils';
import { applyClientSideFilter } from '../utils/clientSideFilter';
import { useAIFilter } from '../hooks/useAIFilter';
import type { FilterColumnInfo } from '@/utils/filterParser';

// Stores
import {
  useGridPreferences,
  useGridPreferencesHydrated,
  upsertGridColumnsState,
  useGridPreferencesStore,
  useEmbeddedFKPreferencesStore,
} from '../stores';

// Additional imports
import { useDeferredValue } from 'react';
import { useContextKey, useScopedKeybindings } from '@/hooks/useContextKey';
import { useCommand } from '@/hooks/useCommand';
import { CompactSelection } from '@glideapps/glide-data-grid';
import { eventBus } from '@/services/eventBus';
import { toast } from 'sonner';
```

**Add state:**
```typescript
const wrapperRef = useRef<HTMLDivElement | null>(null);
const containerRef = useRef<HTMLDivElement | null>(null);
const gridRef = useRef<EditableDataGridRef>(null);
const quickFilterRef = useRef<QuickFilterRef>(null);

const [isGridFocused, setIsGridFocused] = useState(false);
const [isEditingCell, setIsEditingCell] = useState(false);
const [isPastePending, setIsPastePending] = useState(false);
const [showDetailsSheet, setShowDetailsSheet] = useState(false);

const scopeId = useScopedKeybindings(gridId);
```

---

## Task 2: Add column management features

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Load grid preferences from store
2. Add useColumnPinning, useColumnSizing, useColumnVisibility, useColumnSorting hooks
3. Implement column reordering logic
4. Add width persistence with debouncing
5. Build final columns with pinning + visibility + sizing applied

**Code pattern:**
```typescript
const preferences = useGridPreferences(gridId);
const columnState = preferences?.columns ?? DEFAULT_COLUMN_STATE;

const { sizedColumns, columnWidths, handleColumnResize, handleColumnResizeEnd } = useColumnSizing({
  columns: reorderedColumns,
  initialWidths: columnState.widths,
});

// Apply visibility, pinning, sizing transformations
```

---

## Task 3: Add QuickFilter component

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Build filterColumns from tableStructure (with FK metadata)
2. Add useAIFilter hook with dialect detection
3. Add useQuickFilter hook for filter state management
4. Render QuickFilter component in toolbar
5. Add keyboard shortcuts (Cmd+F, /) to focus filter

**Code pattern:**
```typescript
const filterColumns = useMemo<FilterColumnInfo[]>(() => {
  if (!tableStructure?.columns) return [];
  // Build FK lookup and column metadata
}, [tableStructure]);

const { generateFilter } = useAIFilter(filterColumns, table, dialect);
const { value, mode, activeFilter, setValue, setMode, submit, clear } = useQuickFilter({
  columns: filterColumns,
  generateAIFilter,
});

// Keyboard shortcuts for Cmd+F and /
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      quickFilterRef.current?.focus();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

---

## Task 4: Add FK preview features

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add embedded FK configuration loading from store
2. Build embeddedFKFieldMap for mapping FK columns to embedded fields
3. Add useCellHoverIcons hook for hover state tracking
4. Render FKPreviewPopover component
5. Update getCellContent to extract embedded FK values

**Code pattern:**
```typescript
const embeddedFKKey = `${connectionId}:${schema ?? 'public'}.${table}`;
const embeddedFKPrefs = useEmbeddedFKPreferencesStore(state => state.preferences[embeddedFKKey]);

const { onItemHovered, drawCell, fkPreviewState, clearFkPreview } = useCellHoverIcons({
  columns: finalColumns,
  rows: displayRows,
  enabled: true,
  enableFKPreview: true,
  gridRef,
  containerRef,
});

// In getCellContent, extract embedded FK value
const embeddedField = embeddedFKFieldMap.get(columnName);
const embeddedValue = embeddedField ? row[embeddedField]?.value : undefined;
```

---

## Task 5: Add UnifiedContextMenu

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Track context menu target (header vs cell)
2. Add column header callbacks (sort, hide, pin, filter)
3. Add row callbacks (pin, insert, delete)
4. Wrap EditableDataGrid with UnifiedContextMenu
5. Load referenced table columns for FK embed submenu

**Code pattern:**
```typescript
const contextMenuTargetRef = useRef<ContextMenuTarget>(null);

const handleItemHovered = (args) => {
  handleCellHovered(args);
  if (args.kind === 'header') {
    contextMenuTargetRef.current = { type: 'header', columnIndex: args.location[0], column };
  }
};

<UnifiedContextMenu
  selectedRows={selectedRows}
  columns={finalColumns}
  onPinRows={handlePinRows}
  onSort={handleColumnSort}
  onHideColumn={handleColumnHide}
  contextMenuTargetRef={contextMenuTargetRef}
  referencedTableColumns={referencedTableColumns}
>
  <EditableDataGrid ... />
</UnifiedContextMenu>
```

---

## Task 6: Add clipboard operations

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add toText callback for text copy
2. Add toJson callback for JSON copy
3. Add useClipboardBridge hook
4. Register Cmd+Shift+C command for copy as JSON

**Code pattern:**
```typescript
const toTextCallback = useCallback((selection: GridSelection) => {
  // Extract selected cells/rows and format as tab-delimited text
}, [finalColumns]);

const toJsonCallback = useCallback((selection: GridSelection) => {
  // Extract selected cells/rows and format as JSON
}, [finalColumns]);

const { copySelection } = useClipboardBridge({
  toText: toTextCallback,
  toJson: toJsonCallback,
});

useCommand('dataGrid.action.copyAsJson', async () => {
  await copySelection(gridSelectionRef.current, 'json');
});
```

---

## Task 7: Add fill operations

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add useFillOperations hook
2. Add Ctrl+D (fill down) keyboard shortcut
3. Add Ctrl+R (fill right) keyboard shortcut
4. Add onBatchEdit callback for CRUD staging

**Code pattern:**
```typescript
const { fillDown, fillRight } = useFillOperations({
  getCellContent,
  onBatchEdit: onBatchEditCallback,
  columnCount: finalColumns.length,
  rowCount: displayRows.length,
});

useEffect(() => {
  const handleFillKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      fillDown(gridSelection);
    }
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      fillRight(gridSelection);
    }
  };
  window.addEventListener('keydown', handleFillKeyDown);
  return () => window.removeEventListener('keydown', handleFillKeyDown);
}, [fillDown, fillRight]);
```

---

## Task 8: Add staged changes highlighting

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add useStagedChangesIndicator hook
2. Update getCellContent to highlight staged cells
3. Add getRowThemeOverride for row-level highlighting
4. Track staged FK embedded values for FK cells

**Code pattern:**
```typescript
const stagedChanges = useStagedChangesIndicator({
  connectionId,
  database,
  schema,
  table,
  rows: displayRows,
  columns: finalColumns,
});

const getRowThemeOverride = useCallback((rowIndex: number) => {
  if (isRowPendingDeletion(stagedChanges, rowIndex)) {
    return { bgCell: 'rgba(239, 68, 68, 0.06)' }; // Red
  }
  if (isRowPendingInsertion(stagedChanges, rowIndex)) {
    return { bgCell: 'rgba(34, 197, 94, 0.06)' }; // Green
  }
  if (stagedChanges.rowChanges.has(rowIndex)) {
    return { bgCell: 'rgba(212, 165, 43, 0.04)' }; // Golden
  }
}, [stagedChanges]);

// In getCellContent:
if (hasStagedCellChange(stagedChanges, rowIndex, columnName)) {
  return { ...cell, themeOverride: { bgCell: 'rgba(251, 146, 60, 0.15)' } };
}
```

---

## Task 9: Add drawHeader with sort indicators

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add useColumnSorting hook
2. Create drawHeader function using createDrawHeader utility
3. Add handleHeaderClicked callback for sort toggling

**Code pattern:**
```typescript
const { sortColumns, getSortIndex, getSortDirection, toggleSort } = useColumnSorting({
  gridId,
  columns: finalColumns,
});

const drawHeader = useMemo(() => createDrawHeader({
  getSortDirection,
  getSortIndex,
  columns: finalColumns,
  sortedColumnCount: sortColumns.length,
}), [getSortDirection, getSortIndex, finalColumns]);

const handleHeaderClicked = useCallback((colIndex: number, event: { shiftKey: boolean }) => {
  toggleSort(finalColumns[colIndex].id, event.shiftKey);
}, [finalColumns, toggleSort]);
```

---

## Task 10: Add row pinning

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add useRowPinning hook
2. Combine pinned + unpinned rows for display
3. Add pin/unpin handlers from context menu
4. Visual indicators in getRowThemeOverride

**Code pattern:**
```typescript
const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } = useRowPinning({
  rows: filteredRows,
  initialPinned: preferences?.pinnedRows ?? [],
  maxPinnedRows: 5,
  getRowId: getRowKey,
  onChange: (ids) => {
    useGridPreferencesStore.getState().updatePinnedRows(gridId, () => ids);
  },
});

const displayRows = useMemo(() => [...pinnedRows, ...unpinnedRows], [pinnedRows, unpinnedRows]);
```

---

## Task 11: Add export to CSV

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Listen to event bus for export command
2. Call exportToCSV utility
3. Check focus state before exporting

**Code pattern:**
```typescript
useEffect(() => {
  const handleExport = () => {
    const hasFocus = wrapperRef.current?.contains(document.activeElement);
    if (hasFocus) {
      void exportToCSV(displayRows, finalColumns, `${table}_export.csv`);
      toast.success('Export started');
    }
  };
  eventBus.on('data-grid:export-csv', handleExport);
  return () => eventBus.off('data-grid:export-csv', handleExport);
}, [displayRows, finalColumns, table]);
```

---

## Task 12: Update getCellContent with full features

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Extract embedded FK values (staged + row data)
2. Apply staged changes highlighting
3. Apply text truncation for long values
4. Use refs for stable performance

**Code pattern:**
```typescript
const getCellContent = useCallback((cell: Item) => {
  const [colIndex, rowIndex] = cell;
  const column = finalColumnsRef.current[colIndex];
  const row = rowsRef.current[rowIndex];

  // Extract embedded FK value
  let embeddedValue;
  if (column.meta?.is_fk) {
    const stagedKey = `${rowIndex}:${column.name}`;
    embeddedValue = stagedFKEmbeddedValuesRef.current.get(stagedKey)
      ?? row[embeddedFKFieldMapRef.current.get(column.name)]?.value;
  }

  const gridCell = buildGridCellV2({
    value: row[column.field],
    column,
    readOnly: readOnly || column.meta?.is_pk,
    embeddedValue,
    connectionContext: { connectionId, database, schema, table },
  });

  // Apply staged changes highlighting
  if (hasStagedCellChange(stagedChangesRef.current, rowIndex, column.name)) {
    return { ...gridCell, themeOverride: { bgCell: 'rgba(251, 146, 60, 0.15)' } };
  }

  return gridCell;
}, [rowsRef.current, finalColumnsRef.current]);
```

---

## Task 13: Add focus/blur handlers and keybindings

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Add focus/blur capture handlers
2. Set up context keys for keybinding system
3. Add container click handler

**Code pattern:**
```typescript
useContextKey('dataGridFocus', isGridFocused, { scopeId, resetOnUnmount: true });
useContextKey('editingCell', isEditingCell, { scopeId, resetOnUnmount: true });

const handleFocusCapture = useCallback(() => setIsGridFocused(true), []);
const handleBlurCapture = useCallback((e: FocusEvent) => {
  const nextTarget = e.relatedTarget as Node;
  if (!containerRef.current?.contains(nextTarget)) {
    setIsGridFocused(false);
  }
}, []);
```

---

## Task 14: Update toolbar and layout

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Implement:**
1. Replace BaseDataGrid with direct EditableDataGrid + wrappers
2. Add QuickFilter to toolbar
3. Wrap EditableDataGrid with UnifiedContextMenu
4. Add FKPreviewPopover
5. Update DataGridStatusBar with all metrics

**Layout:**
```typescript
return (
  <div ref={wrapperRef} className="flex h-full flex-col">
    {/* QuickFilter toolbar */}
    <QuickFilter ... />

    {/* Main grid */}
    <div ref={containerRef} onFocusCapture={handleFocusCapture} onBlurCapture={handleBlurCapture}>
      <UnifiedContextMenu ...>
        <EditableDataGrid
          ref={gridRef}
          drawHeader={drawHeader}
          onItemHovered={handleItemHovered}
          drawCell={drawCellWithHoverIcons}
          getRowThemeOverride={getRowThemeOverride}
          ...
        />
      </UnifiedContextMenu>
    </div>

    {/* FK Preview Popover */}
    {fkPreviewState && <FKPreviewPopover ... />}

    {/* Status Bar */}
    <DataGridStatusBar ... />
  </div>
);
```

---

## Task 15: Test complete feature parity

**Files:**
- Test: All SqlDataGrid features

**Verify:**
1. ✓ Cell rendering with all custom renderers (UuidCell, JSONCell, etc.)
2. ✓ Hover icons appear on FK cells
3. ✓ FK preview popover shows on hover
4. ✓ Right-click context menu on cells and headers
5. ✓ Quick filter works (search, SQL, AI modes)
6. ✓ Cmd+F and / focus quick filter
7. ✓ Cmd+C copies as text
8. ✓ Cmd+Shift+C copies as JSON
9. ✓ Ctrl+D fills down
10. ✓ Ctrl+R fills right
11. ✓ Staged changes highlighted (orange cells, colored rows)
12. ✓ Column sorting with shift-click for multi-sort
13. ✓ Column pinning, hiding, reordering
14. ✓ Column resizing with persistence
15. ✓ Row pinning with visual indicators
16. ✓ Export to CSV
17. ✓ Embedded FK values display
18. ✓ All CRUD operations (edit, insert, delete) stage correctly

**Checklist:**
- [ ] Compare SqlDataGrid side-by-side with TableDataGrid
- [ ] Open a PostgreSQL table - all features work
- [ ] Edit cells - staged changes show
- [ ] Hover over FK cell - preview popover appears
- [ ] Right-click header - see column menu
- [ ] Right-click cell - see row menu
- [ ] Press Cmd+F - filter focused
- [ ] Press Ctrl+D - fill down works
- [ ] Click sort header - data sorts
- [ ] Pin column - stays left
- [ ] Resize column - width persists
- [ ] Pin row - stays top
- [ ] Select cells and copy - JSON and text work

---

## Notes

- Keep BaseDataGrid as is - it's the foundation
- SqlDataGrid becomes feature-rich like TableDataGrid was
- DocumentDataGrid and KeyValueDataGrid can follow the same pattern later
- All features tested against TableDataGrid for parity
