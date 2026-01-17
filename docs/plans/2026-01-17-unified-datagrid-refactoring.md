# Unified DataGrid Refactoring - Full Feature Parity

**Date**: 2026-01-17
**Status**: Design Complete - Ready for Implementation
**Goal**: Bring MongoDB and Redis DataGrids to 100% feature parity with SQL using a shared BaseDataGrid component

---

## Problem Statement

**Current State:**
- **SQL (TableDataGrid)**: 2706 lines, 35+ feature categories, production-ready
- **MongoDB (DocumentDataGrid)**: 255 lines, basic drill-down only
- **Redis**: No unified grid implementation

**Gap Analysis:**
MongoDB and Redis are missing **91% of features** (35 out of 38 categories):
- ❌ No context menu (copy/paste/delete)
- ❌ No column sorting/pinning/hiding/resizing
- ❌ No filtering (search/SQL/AI modes)
- ❌ No keyboard shortcuts (Cmd+F, Ctrl+D/R, Delete)
- ❌ No CRUD visual feedback (staging indicators)
- ❌ No row pinning/management
- ❌ No status bar/metrics
- ❌ No state persistence
- ❌ No export to CSV
- ❌ No performance optimizations

**Verdict**: MongoDB and Redis grids are essentially read-only viewers. Not production-ready.

---

## Solution: Shared BaseDataGrid Architecture

### Architecture Strategy

**Three-Layer Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                  Layer 3: Paradigm Wrappers                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │SqlDataGrid   │  │DocumentData  │  │KeyValueData  │      │
│  │              │  │Grid          │  │Grid          │      │
│  │~300 lines    │  │~300 lines    │  │~300 lines    │      │
│  │              │  │              │  │              │      │
│  │• SQL toolbar │  │• Breadcrumbs │  │• Key header  │      │
│  │• FK preview  │  │• Drill-down  │  │• Type cols   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
┌─────────────────────────────▼───────────────────────────────┐
│                  Layer 2: BaseDataGrid                      │
│                    (~1800 lines)                            │
│                                                             │
│  Uses: useDataGridFeatures() mega hook                     │
│  Renders: EditableDataGrid + Slots                         │
│  Features: All 35 categories (context menu, sorting, etc.) │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│              Layer 1: Shared Infrastructure                 │
│                                                             │
│  • useDataGridFeatures (mega hook - 15 feature hooks)      │
│  • Data hooks (useTableData, useDocumentData, useKV)       │
│  • Components (QuickFilter, ContextMenu, StatusBar, etc.)  │
│  • Utilities (cell factories, export, clipboard)           │
└─────────────────────────────────────────────────────────────┘
```

**Key Decisions:**
- ✅ **Approach A**: Shared base component + paradigm wrappers (vs composition or hybrid)
- ✅ **Extensibility**: Slots + capability handlers (vs paradigm mode prop or inheritance)
- ✅ **Refactoring**: Extract-then-apply (vs build-fresh or incremental)
- ✅ **Hooks**: Unified mega hook (vs granular or tiered)
- ✅ **Data Integration**: Separate data + features hooks (vs integrated)
- ✅ **File Structure**: Feature-based organization (vs flat or paradigm-based)
- ✅ **Backward Compat**: Clean cut + backup (vs feature flag or parallel implementations)
- ✅ **Testing**: Comprehensive test suite (vs essential only or test-in-production)

---

## BaseDataGrid Component Design

### Responsibilities
- Render EditableDataGrid with all advanced features enabled
- Manage all UI interactions (context menu, keyboard, clipboard, selection)
- Handle column operations (sort, pin, hide, resize, reorder)
- Manage row operations (pin, insert, delete, batch edit)
- Visual feedback for staged changes
- State persistence (scroll, selection, preferences)
- Performance optimizations (deferred rendering, batching)

### Props Interface

```tsx
interface BaseDataGridProps {
  // Core data (from data hooks)
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // Loading & errors
  isLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;

  // Pagination
  hasMore?: boolean;
  onLoadMore?: () => void;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;

  // CRUD operations (from data hooks)
  onCellEditCommit?: (event: GridEditCommitEvent) => void;
  onRowInsert?: (event: GridRowInsertEvent) => void;
  onRowDelete?: (event: GridRowDeleteEvent) => void;

  // Optional capabilities (paradigm-specific)
  onCellActivated?: (cell: Item) => boolean; // MongoDB drill-down
  enableFKPreview?: boolean; // SQL only

  // Slots for paradigm UI
  topToolbar?: React.ReactNode; // BreadcrumbNav | KeyHeader | null
  bottomToolbar?: React.ReactNode; // Custom pagination/actions

  // Metadata (for context menu, filtering, etc.)
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: 'sql' | 'document' | 'keyvalue';

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableExport?: boolean;
  enableRowPinning?: boolean;
  readOnly?: boolean;
}
```

### Internal Structure

```tsx
export const BaseDataGrid = (props: BaseDataGridProps) => {
  // 1. Unified features hook (does the heavy lifting)
  const features = useDataGridFeatures({
    gridId: props.gridId,
    rows: props.rows,
    columns: props.columns,
    connectionId: props.connectionId,
    paradigm: props.paradigm,
    enableFiltering: props.enableFiltering,
    enableSorting: props.enableSorting,
    enableRowPinning: props.enableRowPinning,
    readOnly: props.readOnly,
    onCellEditCommit: props.onCellEditCommit,
    onRowInsert: props.onRowInsert,
    onRowDelete: props.onRowDelete,
  });

  // 2. Render structure
  return (
    <div className="flex flex-col h-full">
      {/* Top slot - paradigm-specific toolbar */}
      {props.topToolbar}

      {/* Quick filter (if enabled) */}
      {props.enableFiltering && features.filtering.component}

      {/* Main grid with context menu */}
      <UnifiedContextMenu {...features.contextMenu}>
        <EditableDataGrid
          {...features.grid}
          onCellActivated={props.onCellActivated}
        />
      </UnifiedContextMenu>

      {/* FK Preview popover (SQL only) */}
      {props.enableFKPreview && features.fkPreview.component}

      {/* Bottom slot - paradigm-specific */}
      {props.bottomToolbar}

      {/* Status bar */}
      <DataGridStatusBar {...features.statusBar} />
    </div>
  );
};
```

---

## useDataGridFeatures Mega Hook

### Purpose
Bundle all 15+ feature hooks into a single cohesive API. Used internally by BaseDataGrid.

### Hook Signature

```tsx
interface UseDataGridFeaturesParams {
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: 'sql' | 'document' | 'keyvalue';

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableRowPinning?: boolean;
  enableExport?: boolean;
  readOnly?: boolean;

  // CRUD callbacks
  onCellEditCommit?: (event: GridEditCommitEvent) => void;
  onRowInsert?: (event: GridRowInsertEvent) => void;
  onRowDelete?: (event: GridRowDeleteEvent) => void;
}

interface UseDataGridFeaturesResult {
  // Grid props (pass to EditableDataGrid)
  grid: {
    rows: GridRowModel[];
    columns: GridColumnV2[];
    getCellContent: (cell: Item) => GridCell;
    onCellEditStart: (...) => void;
    onCellEditCommit: (...) => void;
    onSelectionChange: (...) => void;
    onColumnResize: (...) => void;
    onColumnMoved: (...) => void;
    onHeaderClicked: (...) => void;
    drawHeader: DrawHeaderCallback;
    drawCell: DrawCellCallback;
    getRowThemeOverride: (...) => ThemeOverride;
    // ... all EditableDataGrid props
  };

  // Context menu props
  contextMenu: {
    selectedRows: GridRowModel[];
    selectedRowKeys: string[];
    columns: GridColumnV2[];
    onPinRows: (keys: string[]) => void;
    onDeleteRows: () => void;
    onSort: (col: string, dir: 'asc' | 'desc') => void;
    // ... all UnifiedContextMenu props
  };

  // Filtering component
  filtering: {
    component: React.ReactNode; // QuickFilter component
    activeFilter?: string;
    clear: () => void;
  };

  // FK preview (SQL only)
  fkPreview: {
    component: React.ReactNode | null;
    state: FKPreviewState | null;
  };

  // Status bar props
  statusBar: {
    loadedRows: number;
    selectedRows: number;
    estimatedTotal?: number;
    executionTime?: number;
    // ... all DataGridStatusBar props
  };
}
```

### Internal Implementation

```tsx
export function useDataGridFeatures(params: UseDataGridFeaturesParams) {
  // 1. State management
  const preferences = useGridPreferences(params.gridId);
  const { persistSelection, persistScrollOffset } = usePersistentViewState(params.gridId);

  // 2. Column features
  const sorting = useColumnSorting({ gridId: params.gridId, columns: params.columns });
  const pinning = useColumnPinning({ columns: params.columns, initialPinned: preferences?.columns.pinned });
  const visibility = useColumnVisibility({ columns: params.columns });
  const sizing = useColumnSizing({ columns: params.columns, initialWidths: preferences?.columns.widths });

  // 3. Row features
  const rowPinning = useRowPinning({ rows: params.rows, enabled: params.enableRowPinning });
  const selection = useSelection({ onChange: persistSelection });
  const optimisticUpdates = useOptimisticRows({ rows: params.rows });

  // 4. Interaction features
  const contextMenu = useContextMenu({ rows: params.rows, columns: params.columns });
  const clipboard = useClipboardBridge({ rows: params.rows, columns: params.columns });
  const filtering = useQuickFilter({ columns: params.columns, enabled: params.enableFiltering });
  const keyboard = useKeyboardShortcuts({ gridId: params.gridId });

  // 5. CRUD features
  const crud = useCrudOperations({
    connectionId: params.connectionId,
    onCellEditCommit: params.onCellEditCommit,
    readOnly: params.readOnly
  });
  const stagingIndicators = useStagedChangesIndicator({ rows: params.rows });
  const fillOperations = useFillOperations({ rows: params.rows, columns: params.columns });

  // 6. Advanced features
  const cellHoverIcons = useCellHoverIcons({ columns: params.columns, rows: params.rows });
  const exportCSV = useExportCSV({ rows: params.rows, columns: params.columns });

  // 7. Compose final columns (apply sorting, pinning, visibility, sizing)
  const finalColumns = useMemo(() => {
    let cols = params.columns;
    cols = sorting.applyToColumns(cols);
    cols = pinning.applyToColumns(cols);
    cols = visibility.applyToColumns(cols);
    cols = sizing.applyToColumns(cols);
    return cols;
  }, [params.columns, sorting, pinning, visibility, sizing]);

  // 8. Compose final rows (apply pinning, optimistic updates, filtering)
  const finalRows = useMemo(() => {
    let rows = params.rows;
    rows = filtering.applyToRows(rows);
    rows = rowPinning.applyToRows(rows);
    rows = optimisticUpdates.applyToRows(rows);
    return rows;
  }, [params.rows, filtering, rowPinning, optimisticUpdates]);

  // 9. Return composed interface
  return {
    grid: { /* ... wire all handlers */ },
    contextMenu: { /* ... wire all handlers */ },
    filtering: { /* ... */ },
    fkPreview: { /* ... */ },
    statusBar: { /* ... */ },
  };
}
```

---

## Paradigm Wrapper Components

Each wrapper is ~300 lines and handles:
1. Call paradigm-specific data hook
2. Configure BaseDataGrid with paradigm props
3. Provide paradigm-specific toolbar/navigation UI

### SqlDataGrid (SQL tables/views)

```tsx
export const SqlDataGrid = memo(function SqlDataGrid({
  gridId,
  connectionId,
  database,
  schema,
  table,
  isView = false,
  kind = 'Table',
  onActionsChange,
  initialFilter,
  panelId,
}: SqlDataGridProps) {
  // 1. Data hook
  const data = useTableData({
    connectionId,
    database,
    schema,
    table,
    entityType: kind === 'MaterializedView' ? 'materialized_view' : isView ? 'view' : 'table',
    initialFilter,
  });

  // 2. SQL-specific toolbar
  const topToolbar = (
    <div className="flex items-center gap-2">
      {kind === 'Table' && (
        <Button onClick={data.createInsertCommand}>
          <IconPlus /> Add Row
        </Button>
      )}
      {data.hasStagedChanges && (
        <StagingActionsToolbar
          connectionId={connectionId}
          database={database}
          schema={schema}
          table={table}
          onCommitSuccess={data.refetch}
        />
      )}
    </div>
  );

  // 3. Render BaseDataGrid
  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      onCellEditCommit={data.handleCellEditCommit}
      onRowInsert={data.handleRowInsert}
      onRowDelete={data.handleRowDelete}
      topToolbar={topToolbar}
      paradigm="sql"
      enableFKPreview={true}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={true}
      readOnly={isView}
      {...data.loadingState}
    />
  );
});
```

### DocumentDataGrid (MongoDB collections)

```tsx
export const DocumentDataGrid = memo(function DocumentDataGrid({
  gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
}: DocumentDataGridProps) {
  // 1. Data hook with drill-down
  const data = useDocumentData({
    connectionId,
    database,
    collection,
    pageSize,
  });

  // 2. MongoDB-specific breadcrumb navigation
  const topToolbar = (
    <BreadcrumbNav
      path={data.currentPath}
      collectionName={collection}
      onNavigate={data.navigateToPath}
      onNavigateToRoot={() => data.navigateToPath(-1)}
    />
  );

  // 3. Custom pagination footer
  const bottomToolbar = data.hasMore ? (
    <div className="flex items-center justify-center py-2 border-t">
      <Button onClick={data.fetchNextPage} disabled={data.isLoading}>
        {data.isLoading ? 'Loading...' : 'Load More'}
      </Button>
    </div>
  ) : null;

  // 4. Drill-down handler
  const handleCellActivated = useCallback((cell: Item) => {
    const [col, row] = cell;
    if (data.canStepInto(row, col)) {
      data.stepInto(row, col);
      return true;
    }
    return false;
  }, [data]);

  // 5. Render BaseDataGrid
  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      onCellEditCommit={data.handleCellEditCommit}
      onRowInsert={data.handleRowInsert}
      onRowDelete={data.handleRowDelete}
      onCellActivated={handleCellActivated}
      topToolbar={topToolbar}
      bottomToolbar={bottomToolbar}
      paradigm="document"
      enableFKPreview={false}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={true}
      readOnly={data.currentPath.length > 0}
      {...data.loadingState}
    />
  );
});
```

### KeyValueDataGrid (Redis keys)

```tsx
export const KeyValueDataGrid = memo(function KeyValueDataGrid({
  gridId,
  connectionId,
  database,
  initialKey,
}: KeyValueDataGridProps) {
  // 1. Data hook with key selection
  const data = useKeyValueData({
    connectionId,
    database,
    initialKey,
  });

  // 2. Redis key metadata header
  const topToolbar = data.currentKey ? (
    <KeyHeader
      metadata={data.currentKey}
      onRefresh={data.refetch}
      onSetTTL={data.setKeyTTL}
      onDelete={data.deleteCurrentKey}
    />
  ) : null;

  // 3. Empty state when no key selected
  if (!data.currentKey) {
    return <DataGridEmptyState title="No key selected" />;
  }

  // 4. Render BaseDataGrid
  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      onCellEditCommit={data.handleCellEditCommit}
      onRowInsert={data.handleRowInsert}
      onRowDelete={data.handleRowDelete}
      topToolbar={topToolbar}
      paradigm="keyvalue"
      enableFKPreview={false}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={false}
      readOnly={false}
      {...data.loadingState}
    />
  );
});
```

---

## Data Hooks Design

### useTableData (refactored from useTableDataQuery)

```tsx
interface UseTableDataParams {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  entityType: 'table' | 'view' | 'materialized_view';
  pageSize?: number;
  initialFilter?: string;
  sorts?: SortConfig[];
  embeddedFKs?: EmbeddedFKConfig[];
}

interface UseTableDataResult {
  // Core data
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // Loading states
  loadingState: {
    isLoading: boolean;
    isLoadingMore: boolean;
    error: Error | null;
    hasMore: boolean;
    estimatedTotal?: number;
    isEstimatedCount?: boolean;
  };

  // Pagination
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
  cancelStream: () => void;

  // CRUD command handlers
  handleCellEditCommit: (event: GridEditCommitEvent) => void;
  handleRowInsert: (event: GridRowInsertEvent) => void;
  handleRowDelete: (event: GridRowDeleteEvent) => void;

  // Staging state
  hasStagedChanges: boolean;
}

// Uses existing queryStreamClient + crudStore
export function useTableData(params: UseTableDataParams): UseTableDataResult;
```

### useDocumentData (MongoDB with drill-down)

```tsx
interface UseDocumentDataParams {
  connectionId: string;
  database: string;
  collection: string;
  pageSize?: number;
  enabled?: boolean;
}

interface UseDocumentDataResult {
  // Core data
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell; // Returns DrillableCell for objects/arrays

  // Loading states
  loadingState: {
    isLoading: boolean;
    error: Error | null;
    hasMore: boolean;
    totalCount?: number;
  };

  // Drill-down navigation
  currentPath: PathSegment[];
  canStepInto: (row: number, col: number) => boolean;
  stepInto: (row: number, col: number) => void;
  stepOut: () => void;
  navigateToPath: (pathIndex: number) => void;

  // Pagination
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;

  // CRUD command handlers
  handleCellEditCommit: (event: GridEditCommitEvent) => void;
  handleRowInsert: (event: GridRowInsertEvent) => void;
  handleRowDelete: (event: GridRowDeleteEvent) => void;
}

// Implementation uses MongoDBAdapter.findDocuments()
// Generates columns from document keys at current path
// Returns DrillableCell for nested objects/arrays
export function useDocumentData(params: UseDocumentDataParams): UseDocumentDataResult;
```

### useKeyValueData (Redis with type-aware columns)

```tsx
interface UseKeyValueDataParams {
  connectionId: string;
  database: number; // Redis DB index
  initialKey?: string;
}

interface UseKeyValueDataResult {
  // Core data
  rows: GridRowModel[];
  columns: GridColumnV2[]; // Type-specific: string → [value], hash → [field, value], etc.
  getCellContent: (cell: Item) => GridCell;

  // Key metadata
  currentKey: KeyMetadata | null;
  selectKey: (key: string) => Promise<void>;
  clearSelection: () => void;

  // Key operations
  setKeyTTL: (seconds: number) => Promise<void>;
  deleteCurrentKey: () => Promise<void>;

  // Loading states
  loadingState: {
    isLoading: boolean;
    error: Error | null;
  };

  // Refetch
  refetch: () => Promise<void>;

  // CRUD command handlers
  handleCellEditCommit: (event: GridEditCommitEvent) => void;
  handleRowInsert: (event: GridRowInsertEvent) => void;
  handleRowDelete: (event: GridRowDeleteEvent) => void;
}

// Type-aware column mapping:
// - string: [value]
// - hash: [field, value]
// - list: [index, value]
// - set: [member]
// - zset: [score, member]
// - stream: [id, fields]
export function useKeyValueData(params: UseKeyValueDataParams): UseKeyValueDataResult;
```

---

## File Structure

```
src/components/DataGrid/
├── base/
│   ├── BaseDataGrid.tsx                    # 📝 NEW - Core unified grid (1800 lines)
│   ├── EditableDataGrid.tsx                # ✅ KEEP - Existing editing layer
│   └── DataGridBase.tsx                     # ✅ KEEP - Existing Glide wrapper
│
├── hooks/
│   ├── useDataGridFeatures.ts              # 📝 NEW - Mega hook bundling all features
│   │
│   ├── features/                           # Feature-specific hooks
│   │   ├── useColumnSorting.ts             # 🔧 EXTRACT from TableDataGrid
│   │   ├── useColumnPinning.ts             # 🔧 EXTRACT from TableDataGrid
│   │   ├── useColumnVisibility.ts          # 🔧 EXTRACT from TableDataGrid
│   │   ├── useColumnSizing.ts              # 🔧 EXTRACT from TableDataGrid
│   │   ├── useRowPinning.ts                # 🔧 EXTRACT from TableDataGrid
│   │   ├── useQuickFilter.ts               # 🔧 EXTRACT from TableDataGrid
│   │   ├── useAIFilter.ts                  # ✅ KEEP - Already exists
│   │   ├── useContextMenu.ts               # 📝 NEW - Extract context menu logic
│   │   ├── useClipboardBridge.ts           # 🔧 EXTRACT from TableDataGrid
│   │   ├── useCrudOperations.ts            # 🔧 EXTRACT (useTableCrud)
│   │   ├── useStagedChangesIndicator.ts    # 🔧 EXTRACT from TableDataGrid
│   │   ├── useFillOperations.ts            # 🔧 EXTRACT from TableDataGrid
│   │   ├── useCellHoverIcons.ts            # 🔧 EXTRACT from TableDataGrid
│   │   ├── useKeyboardShortcuts.ts         # 📝 NEW - Extract keyboard logic
│   │   ├── useOptimisticRows.ts            # 🔧 EXTRACT from TableDataGrid
│   │   └── usePersistentViewState.ts       # 🔧 EXTRACT from TableDataGrid
│   │
│   ├── useDocumentData.ts                  # ✅ KEEP - Already exists
│   ├── useKeyValueData.ts                  # 📝 NEW - Redis data hook
│   └── useTableData.ts                     # 🔧 REFACTOR from useTableDataQuery
│
├── adapters/
│   ├── SqlDataGrid.tsx                     # 📝 NEW - SQL wrapper using BaseDataGrid
│   ├── DocumentDataGrid.tsx                # 🔧 REBUILD - Replace existing with BaseDataGrid
│   ├── KeyValueDataGrid.tsx                # 📝 NEW - Redis wrapper using BaseDataGrid
│   └── TableDataGrid.tsx                   # 🔧 REPLACE - Becomes alias to SqlDataGrid
│
├── components/                             # Shared UI components
│   ├── QuickFilter.tsx                     # ✅ KEEP
│   ├── UnifiedContextMenu.tsx              # ✅ KEEP
│   ├── DataGridStatusBar.tsx               # ✅ KEEP
│   ├── StagingActionsToolbar.tsx           # ✅ KEEP
│   ├── BreadcrumbNav.tsx                   # ✅ KEEP
│   ├── KeyHeader.tsx                       # ✅ KEEP
│   ├── FKPreviewPopover.tsx                # ✅ KEEP
│   ├── DataGridSkeleton.tsx                # ✅ KEEP
│   └── DataGridStates.tsx                  # ✅ KEEP (EmptyState, ErrorState)
│
├── renderers/
│   ├── index.ts                            # ✅ KEEP - All existing renderers
│   ├── DrillableCell/                      # 📝 NEW - For MongoDB nested objects/arrays
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── DrillableCellRenderer.tsx
│   └── ... (20+ existing renderers)        # ✅ KEEP
│
├── utils/
│   ├── cellFactory.ts                      # 🔧 EXTEND - Add paradigm support
│   ├── documentCellFactory.ts              # 📝 NEW - MongoDB cell builder
│   ├── keyvalueCellFactory.ts              # 📝 NEW - Redis cell builder
│   ├── exportUtils.ts                      # ✅ KEEP
│   ├── clipboardUtils.ts                   # ✅ KEEP
│   ├── columnUtils.ts                      # ✅ KEEP
│   └── ... (other utils)                   # ✅ KEEP
│
├── stores/
│   ├── gridPreferencesStore.ts             # ✅ KEEP
│   └── embeddedFKPreferencesStore.ts       # ✅ KEEP
│
└── backup/
    └── LegacyTableDataGrid.tsx             # 🔄 MOVE - Original TableDataGrid (safety backup)
```

---

## Migration Plan (Extract-Then-Apply)

### Phase 1: Extract BaseDataGrid (Days 1-2)

**Step 1.1: Create Backup**
```bash
cp src/components/DataGrid/adapters/TableDataGrid.tsx \
   src/components/DataGrid/backup/LegacyTableDataGrid.tsx
```

**Step 1.2: Extract Feature Hooks** (one by one)
- Extract `useColumnSorting` from TableDataGrid
- Extract `useColumnPinning`
- Extract `useColumnVisibility`
- Extract `useColumnSizing`
- Extract `useRowPinning`
- Extract `useQuickFilter` logic
- Extract `useClipboardBridge`
- Extract `useCrudOperations` (from useTableCrud)
- Extract `useStagedChangesIndicator`
- Extract `useFillOperations`
- Extract `useCellHoverIcons`
- Extract `useOptimisticRows`
- Extract `usePersistentViewState`
- Create `useContextMenu` (extract context menu logic)
- Create `useKeyboardShortcuts` (extract keyboard logic)

**Step 1.3: Create useDataGridFeatures Mega Hook**
- Bundle all 15 feature hooks
- Compose columns and rows
- Return unified interface

**Step 1.4: Create BaseDataGrid Component**
- Accept props interface from design
- Use `useDataGridFeatures` internally
- Render EditableDataGrid with slots
- Add QuickFilter, UnifiedContextMenu, StatusBar

**Step 1.5: Validate with SQL**
- Create `SqlDataGrid` wrapper using BaseDataGrid
- Test all 35 features work identically
- Run full test suite
- Visual comparison with LegacyTableDataGrid

### Phase 2: Apply to MongoDB (Day 3)

**Step 2.1: Create DrillableCellRenderer**
- Render `{N fields}` for objects
- Render `[N items]` for arrays
- Add chevron icon for drillable cells

**Step 2.2: Enhance useDocumentData Hook**
- Add drill-down state management
- Implement `canStepInto`, `stepInto`, `stepOut`
- Generate columns from document keys
- Return `getCellContent` with DrillableCell support

**Step 2.3: Rebuild DocumentDataGrid**
- Replace existing implementation
- Use BaseDataGrid with drill-down config
- Add BreadcrumbNav in topToolbar slot
- Test drill-down navigation

**Step 2.4: Test MongoDB Features**
- Context menu (copy/paste/delete)
- Column sorting
- Quick filter
- Keyboard shortcuts (Cmd+F, Delete, etc.)
- Export to CSV
- CRUD visual feedback

### Phase 3: Build Redis Support (Day 4)

**Step 3.1: Create useKeyValueData Hook**
- Implement type-aware column mapping
- Handle all 6 Redis types (string, hash, list, set, zset, stream)
- Build rows from Redis data structures
- Return `getCellContent`

**Step 3.2: Create KeyValueDataGrid**
- Use BaseDataGrid
- Add KeyHeader in topToolbar slot
- Handle empty state (no key selected)
- Wire up TTL/delete operations

**Step 3.3: Test All Redis Types**
- String: single value cell
- Hash: field|value columns
- List: index|value columns
- Set: member column
- ZSet: score|member columns
- Stream: id|fields columns

### Phase 4: Replace TableDataGrid (Day 5)

**Step 4.1: Update TableDataGrid.tsx**
```tsx
// Replace implementation with SqlDataGrid
export const TableDataGrid = SqlDataGrid;
```

**Step 4.2: Update PanelContentRenderer**
- Route 'table' type → SqlDataGrid
- Route 'mongo-collection' type → DocumentDataGrid
- Route 'redis-key' type → KeyValueDataGrid

**Step 4.3: Clean Up Unused Files**
- Remove old MongoDB components (if any legacy ones exist)
- Remove old Redis editors (if scattered editors exist)
- Keep LegacyTableDataGrid.tsx as backup

### Phase 5: Testing & Polish (Day 6)

**Step 5.1: Unit Tests**
- Test each feature hook independently
- Test `useDataGridFeatures` composition
- Test BaseDataGrid rendering

**Step 5.2: Integration Tests**
- Test all three paradigms with BaseDataGrid
- Test feature interactions (sort + filter, etc.)

**Step 5.3: Visual Regression Tests**
- Screenshot SqlDataGrid vs LegacyTableDataGrid
- Verify pixel-perfect match

**Step 5.4: Manual QA**
- Test all 35 features across SQL/MongoDB/Redis
- Performance testing (10K+ rows)
- Edge cases (empty states, errors, etc.)

**Step 5.5: Documentation**
- Update component docs
- Add migration guide
- Document paradigm-specific props

---

## Testing Strategy

### Unit Tests (15 feature hooks + mega hook)

```typescript
// Example: hooks/features/__tests__/useColumnSorting.test.ts
describe('useColumnSorting', () => {
  it('should toggle sort direction on header click', () => {
    const { result } = renderHook(() => useColumnSorting({
      gridId: 'test',
      columns: mockColumns,
    }));

    act(() => result.current.handleHeaderClick(0, { shiftKey: false }));
    expect(result.current.getSortDirection('col_0')).toBe('asc');

    act(() => result.current.handleHeaderClick(0, { shiftKey: false }));
    expect(result.current.getSortDirection('col_0')).toBe('desc');

    act(() => result.current.handleHeaderClick(0, { shiftKey: false }));
    expect(result.current.getSortDirection('col_0')).toBeUndefined();
  });

  it('should support multi-column sorting with Shift+click', () => {
    const { result } = renderHook(() => useColumnSorting({
      gridId: 'test',
      columns: mockColumns,
    }));

    act(() => result.current.handleHeaderClick(0, { shiftKey: false }));
    expect(result.current.sortColumns).toHaveLength(1);

    act(() => result.current.handleHeaderClick(1, { shiftKey: true }));
    expect(result.current.sortColumns).toHaveLength(2);
  });
});
```

**Test all 15 feature hooks:** useColumnPinning, useColumnVisibility, useColumnSizing, useRowPinning, useQuickFilter, useContextMenu, useClipboardBridge, useCrudOperations, useStagedChangesIndicator, useFillOperations, useCellHoverIcons, useKeyboardShortcuts, useOptimisticRows, usePersistentViewState, useDataGridFeatures

### Integration Tests (BaseDataGrid)

```typescript
describe('BaseDataGrid', () => {
  it('should render with SQL paradigm config', () => {
    const { container } = render(
      <BaseDataGrid
        gridId="test-sql"
        rows={mockSqlRows}
        columns={mockSqlColumns}
        getCellContent={mockGetCellContent}
        paradigm="sql"
        enableFKPreview={true}
        enableFiltering={true}
      />
    );

    expect(container.querySelector('.quick-filter')).toBeInTheDocument();
    expect(container.querySelector('.data-grid-status-bar')).toBeInTheDocument();
  });

  it('should handle context menu interactions', async () => {
    // Test right-click → context menu → copy
  });

  it('should handle keyboard shortcuts', () => {
    // Test Cmd+F → focus filter
  });
});
```

### Visual Regression Tests

```typescript
describe('Visual Regression', () => {
  it('SqlDataGrid should match LegacyTableDataGrid', async () => {
    const legacySnapshot = await render(<LegacyTableDataGrid {...mockProps} />);
    const newSnapshot = await render(<SqlDataGrid {...mockProps} />);

    const diff = await compareSnapshots(legacySnapshot, newSnapshot);
    expect(diff.percentageDifference).toBeLessThan(1);
  });
});
```

### Manual QA Checklist

**SQL DataGrid:**
- [ ] Context menu: Copy, Copy as JSON, Paste, Clear
- [ ] Row operations: Pin, Insert Above/Below, Delete
- [ ] Column operations: Sort, Pin, Hide, Resize, Reorder
- [ ] Quick Filter: Search, SQL, AI modes
- [ ] Keyboard shortcuts: Cmd+F, /, Ctrl+D, Ctrl+R, Delete, Enter
- [ ] Export to CSV
- [ ] FK preview popover
- [ ] CRUD staging: Visual indicators (red/green/orange)
- [ ] Staging toolbar: Commit, Revert, Preview
- [ ] State persistence: Scroll, selection, column state
- [ ] Performance: 10K rows smooth scrolling
- [ ] Status bar: Metrics, selection count

**MongoDB DataGrid:**
- [ ] All SQL features (except FK preview)
- [ ] BreadcrumbNav navigation
- [ ] Drill-down: Click nested object/array
- [ ] DrillableCell: Shows {N fields} / [N items]
- [ ] Navigate back via breadcrumbs
- [ ] CRUD at root level only
- [ ] Load More pagination

**Redis DataGrid:**
- [ ] All SQL features (except FK preview, row pinning)
- [ ] KeyHeader: Shows type, TTL, size
- [ ] String type: Single value cell
- [ ] Hash type: field|value columns
- [ ] List type: index|value columns
- [ ] Set type: member column
- [ ] ZSet type: score|member columns
- [ ] Stream type: id|fields columns
- [ ] Empty state when no key selected

---

## Success Criteria

- [x] Design approved
- [ ] All three paradigms render through BaseDataGrid
- [ ] 35+ features work across SQL/MongoDB/Redis
- [ ] `useDataGridFeatures` bundles all feature hooks correctly
- [ ] `useDocumentData` provides drill-down navigation
- [ ] `useKeyValueData` provides type-aware columns
- [ ] DrillableCell renders nested objects/arrays with click-to-drill
- [ ] BreadcrumbNav works for MongoDB path navigation
- [ ] KeyHeader works for Redis key metadata
- [ ] All 6 Redis types render with correct columns
- [ ] SqlDataGrid pixel-perfect match with LegacyTableDataGrid
- [ ] Comprehensive test suite (unit + integration + visual)
- [ ] Manual QA passed for all paradigms
- [ ] LegacyTableDataGrid.tsx backed up
- [ ] Performance: 10K+ rows smooth scrolling
- [ ] No regression in SQL DataGrid functionality

---

## Timeline Estimate

- **Phase 1** (Extract BaseDataGrid): 2 days
- **Phase 2** (Apply to MongoDB): 1 day
- **Phase 3** (Build Redis Support): 1 day
- **Phase 4** (Replace TableDataGrid): 0.5 days
- **Phase 5** (Testing & Polish): 1.5 days

**Total: 6 days** for full feature parity across all paradigms.

---

## Notes

- This refactoring eliminates 91% feature gap between SQL and NoSQL paradigms
- Single BaseDataGrid = single source of truth = easier maintenance
- Extract-then-apply strategy minimizes risk (validate with SQL first)
- Comprehensive test suite prevents regressions
- LegacyTableDataGrid.tsx backup provides safety net
- Clean architecture enables future paradigm additions (e.g., Cassandra, DynamoDB)
