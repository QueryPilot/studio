import { useMemo } from "react";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { GridColumnV2, GridRowModel, Item } from "../types";
import type { CrudCommand } from "@/types/crud";

// Import all feature hooks
import { useColumnSorting } from "./useColumnSorting";
import { useColumnPinning } from "./useColumnPinning";
import { useColumnVisibility } from "./useColumnVisibility";
import { useColumnSizing, EMPTY_INITIAL_WIDTHS } from "./useColumnSizing";
import { useRowPinning } from "./useRowPinning";
import { useOptimisticRows } from "./useOptimisticRows";
import { usePersistentViewState } from "./usePersistentViewState";

// --- Params Interface ---
export interface UseDataGridFeaturesParams {
  // Core data
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];
  paradigm: "sql" | "document" | "keyvalue";

  // Feature toggles
  enableSorting?: boolean;
  enablePinning?: boolean;
  enableVisibility?: boolean;
  enableResizing?: boolean;
  enableRowPinning?: boolean;
  enableOptimisticUpdates?: boolean;
  enableFiltering?: boolean;

  // CRUD-related
  stagedCommands?: CrudCommand[];
  primaryKeyColumns?: string[];
  onCrudOperation?: (command: CrudCommand) => void;

  // Callbacks
  onColumnsChange?: (columns: GridColumnV2[]) => void;
  onSelectionChange?: (selection: unknown) => void;

  // Options
  maxPinnedColumns?: number;
  maxPinnedRows?: number;
}

// --- Result Interface ---
export interface UseDataGridFeaturesResult {
  // Grid state
  grid: {
    columns: GridColumnV2[];
    rows: GridRowModel[];
    getCellContent: (cell: Item) => GridCell;
  };

  // Context menu (placeholder for future implementation)
  contextMenu: {
    isOpen: boolean;
    position: { x: number; y: number } | null;
    items: unknown[];
  };

  // Filtering (placeholder for future implementation)
  filtering: {
    isActive: boolean;
    filters: unknown[];
    component: React.ReactNode | null;
  };

  // Foreign key preview (placeholder for SQL-specific implementation)
  fkPreview?: {
    isOpen: boolean;
    position: { x: number; y: number } | null;
    data: unknown | null;
    component: React.ReactNode | null;
  };

  // Status bar data
  statusBar: {
    totalRows: number;
    pinnedRowsCount: number;
    visibleColumnsCount: number;
    totalColumnsCount: number;
    hiddenColumnsCount: number;
    pinnedColumnsCount: number;
    sortedColumns: unknown[];
    stagedCommandsCount: number;
  };
}

/**
 * Mega hook that composes all DataGrid feature hooks into a unified API.
 * This is the core hook used by BaseDataGrid to orchestrate all features.
 */
export function useDataGridFeatures(
  params: UseDataGridFeaturesParams
): UseDataGridFeaturesResult {
  const {
    gridId,
    rows,
    columns,
    // paradigm is not used yet but reserved for future features
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    paradigm: _paradigm,
    enableSorting = false,
    enablePinning = false,
    // enableVisibility is not used yet but reserved for future features
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    enableVisibility: _enableVisibility = false,
    enableResizing = false,
    enableRowPinning = false,
    enableOptimisticUpdates = false,
    stagedCommands = [],
    primaryKeyColumns = [],
    maxPinnedColumns = 5,
    maxPinnedRows = 10,
  } = params;

  // --- State Management ---
  const persistentViewState = usePersistentViewState(gridId);

  // --- Column Features ---

  // Column sorting
  const sorting = useColumnSorting({
    gridId,
    columns,
  });

  // Column pinning
  const columnPinning = useColumnPinning({
    columns,
    initialPinned: persistentViewState.persistedView.activeCell
      ? []
      : undefined,
    maxPinned: maxPinnedColumns,
    // TODO: Add persistence with debouncing to prevent infinite loops
    // onChange: (pinnedColumns) => { ... }
  });

  // Column visibility
  const columnVisibility = useColumnVisibility({
    columns,
    initialHidden: [],
    // TODO: Add persistence with debouncing to prevent infinite loops
    // onChange: (hiddenColumns) => { ... }
  });

  // Column sizing
  const columnSizing = useColumnSizing({
    columns: columnVisibility.visibleColumns,
    initialWidths: EMPTY_INITIAL_WIDTHS,
    // TODO: Add persistence with debouncing to prevent infinite loops
    // onChange: (widths) => { ... }
  });

  // --- Compose Final Columns ---
  // Apply transformations in order: visibility → sizing → pinning
  const finalColumns = useMemo(() => {
    let result = columnVisibility.visibleColumns;

    // Apply sizing
    if (enableResizing) {
      result = columnSizing.sizedColumns;
    }

    // Apply pinning (reorder)
    if (enablePinning && columnPinning.pinnedColumns.length > 0) {
      const pinnedSet = new Set(columnPinning.pinnedColumns);
      const pinned = result.filter((col) => pinnedSet.has(col.id));
      const unpinned = result.filter((col) => !pinnedSet.has(col.id));
      result = [...pinned, ...unpinned];
    }

    return result;
  }, [
    columnVisibility.visibleColumns,
    columnSizing.sizedColumns,
    columnPinning.pinnedColumns,
    enableResizing,
    enablePinning,
  ]);

  // --- Row Features ---

  // Build column maps for optimistic updates
  const columnNameToFieldMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      map.set(col.name, col.field);
    }
    return map;
  }, [columns]);

  const columnByFieldMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    for (const col of columns) {
      map.set(col.field, col);
    }
    return map;
  }, [columns]);

  const getRowKey = (row: GridRowModel | undefined, index: number): string => {
    if (!row) {
      return `row-${index}`;
    }

    // Find primary key columns
    const pkColumns = columns.filter((col) => col.meta?.is_pk);

    if (pkColumns.length === 0) {
      // No primary keys, use index
      return `row-${index}`;
    }

    // Build composite key from primary key values
    const pkParts: string[] = [];
    for (const pkCol of pkColumns) {
      const cellValue = row[pkCol.field];
      const value = cellValue && typeof cellValue === 'object' && 'value' in cellValue
        ? cellValue.value
        : cellValue;

      // Convert to string and handle nulls
      pkParts.push(value != null ? String(value) : 'null');
    }

    return `pk-${pkParts.join('-')}`;
  };

  // Optimistic updates
  const optimisticRows = useOptimisticRows({
    displayRows: rows,
    stagedCommands: enableOptimisticUpdates ? stagedCommands : [],
    primaryKeyColumns,
    columnNameToFieldMap,
    columnByFieldMap,
    columns,
    getRowKey,
  });

  // Row pinning
  const rowPinning = useRowPinning({
    rows: optimisticRows,
    initialPinned: [],
    maxPinnedRows,
    getRowId: getRowKey,
    // TODO: Add persistence with debouncing to prevent infinite loops
    // onChange: (pinnedRowIds) => { ... }
  });

  // --- Compose Final Rows ---
  const finalRows = useMemo(() => {
    let result = optimisticRows;

    // Apply row pinning
    if (enableRowPinning && rowPinning.pinnedRows.length > 0) {
      result = [...rowPinning.pinnedRows, ...rowPinning.unpinnedRows];
    }

    // Apply sorting
    if (enableSorting && sorting.sortColumns.length > 0) {
      result = sorting.sortedData(result);
    }

    // TODO: Apply filtering when implemented

    return result;
  }, [
    optimisticRows,
    enableRowPinning,
    rowPinning.pinnedRows,
    rowPinning.unpinnedRows,
    enableSorting,
    sorting,
  ]);

  // --- Build getCellContent Function ---
  const getCellContent = (cell: Item): GridCell => {
    const [col, rowIndex] = cell;

    // Out of bounds check
    if (rowIndex >= finalRows.length || col >= finalColumns.length) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: false,
      };
    }

    const column = finalColumns[col];
    if (!column) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: false,
      };
    }

    const rowData = finalRows[rowIndex];
    if (!rowData) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: false,
      };
    }

    // Get cell value
    const cellValue = rowData[column.field];

    // Extract value from CellValue wrapper if present
    const rawValue = cellValue && typeof cellValue === "object" && "value" in cellValue
      ? cellValue.value
      : cellValue;

    // Handle null/undefined
    if (rawValue === null || rawValue === undefined) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: true,
        readonly: true,
      };
    }

    // Handle arrays and objects
    if (Array.isArray(rawValue)) {
      const displayValue = `[${rawValue.length} items]`;
      return {
        kind: GridCellKind.Text,
        data: JSON.stringify(rawValue),
        displayData: displayValue,
        allowOverlay: true,
        themeOverride: { textDark: "#0066cc" },
      };
    }

    if (typeof rawValue === "object") {
      const displayValue = "{...}";
      return {
        kind: GridCellKind.Text,
        data: JSON.stringify(rawValue),
        displayData: displayValue,
        allowOverlay: true,
        themeOverride: { textDark: "#0066cc" },
      };
    }

    // Handle boolean
    if (typeof rawValue === "boolean") {
      return {
        kind: GridCellKind.Boolean,
        data: rawValue,
        allowOverlay: false,
        readonly: column.meta?.is_pk || false,
      };
    }

    // Handle numbers
    if (typeof rawValue === "number") {
      return {
        kind: GridCellKind.Number,
        data: rawValue,
        displayData: String(rawValue),
        allowOverlay: true,
        readonly: column.meta?.is_pk || false,
      };
    }

    // Default: text
    const displayValue = String(rawValue);
    return {
      kind: GridCellKind.Text,
      data: displayValue,
      displayData: displayValue,
      allowOverlay: true,
      readonly: column.meta?.is_pk || false,
    };
  };

  // --- Return Composed Interface ---
  return {
    grid: {
      columns: finalColumns,
      rows: finalRows,
      getCellContent,
    },
    contextMenu: {
      // Context menu implementation - to be added when needed
      isOpen: false,
      position: null,
      items: [],
    },
    filtering: {
      // Filtering implementation - to be added when needed
      isActive: false,
      filters: [],
      component: null,
    },
    fkPreview: {
      // FK preview implementation - SQL-specific, to be added when needed
      isOpen: false,
      position: null,
      data: null,
      component: null,
    },
    statusBar: {
      totalRows: finalRows.length,
      pinnedRowsCount: enableRowPinning ? rowPinning.pinnedRows.length : 0,
      visibleColumnsCount: finalColumns.length,
      totalColumnsCount: columns.length,
      hiddenColumnsCount: columns.length - columnVisibility.visibleColumns.length,
      pinnedColumnsCount: enablePinning ? columnPinning.pinnedColumns.length : 0,
      sortedColumns: enableSorting ? sorting.sortColumns : [],
      stagedCommandsCount: stagedCommands.length,
    },
  };
}
