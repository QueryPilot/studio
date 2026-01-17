import { useMemo } from "react";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { GridColumnV2, GridRowModel, Item } from "../types";
import type { CrudCommand } from "@/types/crud";

// Import all feature hooks
import { useColumnSorting } from "./useColumnSorting";
import { useColumnPinning } from "./useColumnPinning";
import { useColumnVisibility } from "./useColumnVisibility";
import { useColumnSizing } from "./useColumnSizing";
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

  // Context menu (placeholder)
  contextMenu: {
    // TODO: Add context menu state and handlers
  };

  // Filtering (placeholder)
  filtering: {
    // TODO: Add filtering state and handlers
  };

  // Foreign key preview (placeholder)
  fkPreview?: {
    // TODO: Add FK preview state and handlers
  };

  // Status bar (placeholder)
  statusBar: {
    // TODO: Add status bar data
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
    paradigm,
    enableSorting = false,
    enablePinning = false,
    // enableVisibility is not used yet but reserved for future features
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    enableVisibility = false,
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
    onChange: () => {
      // TODO: Persist pinned columns
    },
  });

  // Column visibility
  const columnVisibility = useColumnVisibility({
    columns,
    initialHidden: [],
    onChange: () => {
      // TODO: Persist column visibility
    },
  });

  // Column sizing
  const columnSizing = useColumnSizing({
    columns: columnVisibility.visibleColumns,
    initialWidths: {},
    onChange: () => {
      // TODO: Persist column widths
    },
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

  const getRowKey = (_row: GridRowModel | undefined, index: number): string => {
    // TODO: Implement proper row key generation based on primary keys
    return `row-${index}`;
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
    onChange: () => {
      // TODO: Persist pinned rows
    },
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

    // TODO: Implement proper cell rendering based on cell type
    // For now, return simple text cell
    const displayValue =
      cellValue && typeof cellValue === "object" && "value" in cellValue
        ? String(cellValue.value ?? "")
        : String(cellValue ?? "");

    return {
      kind: GridCellKind.Text,
      data: displayValue,
      displayData: displayValue,
      allowOverlay: true,
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
      // TODO: Add context menu implementation
    },
    filtering: {
      // TODO: Add filtering implementation
    },
    fkPreview: {
      // TODO: Add FK preview implementation
    },
    statusBar: {
      // TODO: Add status bar implementation
    },
  };
}
