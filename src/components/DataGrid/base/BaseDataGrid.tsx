import React, {
  memo,
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
  useDeferredValue,
} from "react";
import {
  GridCellKind,
  type GridSelection,
  type Item,
  type GridCell,
  type Rectangle,
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { toast } from "sonner";
import type {
  GridRowModel,
  GridColumnV2,
  GridEditCommitEvent,
  CrudCommandFactory,
} from "../types";
import type { ContextMenuTarget } from "../components/UnifiedContextMenu";
import type { QuickFilterRef } from "../components/QuickFilter";
import type { EditableDataGridRef } from "./EditableDataGrid";

import { EditableDataGrid } from "./EditableDataGrid";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { DataGridErrorState } from "../components/DataGridStates";
import { QuickFilter } from "../components/QuickFilter";
import { UnifiedContextMenu } from "../components/UnifiedContextMenu";
import { FKPreviewPopover } from "../components/FKPreviewPopover";
import { buildGridCellV2 } from "../utils/cellFactory";
import { cn } from "@/lib/utils";
import { useCommand } from "@/hooks/useCommand";
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import { openTableObject } from "@/utils/workbench/openers";

// Hooks
import { useQuickFilter } from "../hooks/useQuickFilter";
import { useAIFilter } from "../hooks/useAIFilter";
import { useColumnSizing } from "../hooks/useColumnSizing";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useRowPinning } from "../hooks/useRowPinning";
import { useColumnSorting } from "../hooks/useColumnSorting";
import { useClipboardBridge } from "../hooks/useClipboardBridge";
import { useFillOperations } from "../hooks/useFillOperations";
import {
  useStagedChangesIndicator,
  hasStagedCellChange,
} from "../hooks/useStagedChangesIndicator";
import { useCellHoverIcons } from "../hooks/useCellHoverIcons";
import { useOptimisticRows } from "../hooks/useOptimisticRows";
import { useGridPreferencesStore, upsertGridColumnsState } from "../stores";
import { useCrudStore } from "@/stores/crudStore";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";

// Utils
import { createDrawHeader } from "../utils/headerUtils";
import { coerceToColumnType, type ColumnTypeHint } from "../utils/pasteUtils";
import { parseClipboardText } from "../hooks/usePasteHandler";

export interface BaseDataGridProps {
  // Core data (from data hooks)
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];

  // Loading & errors
  isLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;

  // Pagination
  hasMore?: boolean;
  onLoadMore?: () => void;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;

  /**
   * Command factory for CRUD operations.
   * BaseDataGrid owns all CRUD UI and uses this to create paradigm-specific commands.
   * If not provided, CRUD operations are disabled.
   */
  commandFactory?: CrudCommandFactory;

  /**
   * Callback after a cell edit command is staged (for paradigm-specific post-processing)
   */
  onCellEditCommit?: (event: GridEditCommitEvent) => void;

  // Optional capabilities (paradigm-specific)
  onCellActivated?: (cell: Item) => boolean; // MongoDB drill-down

  // Slots for paradigm-specific UI
  topToolbar?: React.ReactNode; // BreadcrumbNav | KeyHeader | null
  bottomToolbar?: React.ReactNode; // Custom pagination/actions

  /**
   * Actions to render in the toolbar area (e.g., Add Row, Export buttons)
   * Rendered in the top-right of the filter toolbar area
   */
  toolbarActions?: React.ReactNode;

  // Paradigm-specific components (rendered by BaseDataGrid)
  fkPreviewComponent?: React.ReactNode; // SQL only
  hoverIconsDrawCell?: (
    cell: Item,
    ctx: CanvasRenderingContext2D,
    rect: Rectangle,
  ) => void;
  customGetCellContent?: (cell: Item, baseCell: GridCell) => GridCell; // For paradigm-specific overrides
  getCellContent?: (cell: Item) => GridCell; // Complete override of cell content (Document/KeyValue paradigms)

  // Metadata (for context menu, filtering, etc.)
  connectionId: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: "sql" | "document" | "keyvalue";

  // Entity type for views/materialized views
  entityType?: "table" | "view" | "materialized_view";
  readOnlyReason?: string;
  onRefreshMaterializedView?: () => void;
  isRefreshingMatView?: boolean;

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableExport?: boolean;
  enableRowPinning?: boolean;
  enableColumnManagement?: boolean;
  enableClipboard?: boolean;
  enableFillOperations?: boolean;
  enableStagedChanges?: boolean;
  readOnly?: boolean;

  // Styling
  className?: string;

  // Dialect for SQL filtering
  dialect?: string;

  // FK data (for context menu embed feature)
  referencedTableColumns?: Record<
    string,
    Array<{ name: string; db_type: string }>
  >;
  databaseType?: string;

  /**
   * Callback to refetch data after invalidation (provided by adapter)
   * Used by data invalidation subscription to refresh data after CRUD commits
   */
  onRefetch?: () => void;

  /**
   * Callback to attempt reconnection after connection error
   * If provided, shows a Reconnect button in error state
   */
  onReconnect?: () => Promise<void>;

  // --- Query Performance Metrics ---
  /**
   * Total query execution time in milliseconds
   */
  executionTime?: number;

  /**
   * Network/database round-trip time in milliseconds
   */
  networkMs?: number;

  /**
   * Data conversion/serialization time in milliseconds
   */
  conversionMs?: number;

  /**
   * Number of fetch batches for streaming queries
   */
  fetchCount?: number;

  /**
   * Cursor setup time in milliseconds (streaming queries)
   */
  cursorSetupMs?: number;

  /**
   * Total streaming time in milliseconds
   */
  totalStreamingMs?: number;
}

export const BaseDataGrid = memo(function BaseDataGrid(
  props: BaseDataGridProps,
) {
  const {
    gridId,
    rows,
    columns,
    connectionId,
    database,
    schema,
    tableName,
    paradigm,
    dialect,
    enableFiltering = true,
    enableSorting = true,
    enableExport: _enableExport = true,
    enableRowPinning = true,
    enableColumnManagement = true,
    enableClipboard = true,
    enableFillOperations = true,
    enableStagedChanges = true,
    readOnly = false,
    // Command factory for CRUD
    commandFactory,
    onCellEditCommit: onCellEditCommitCallback,
    // Entity type
    entityType: _entityType,
    readOnlyReason,
    onRefreshMaterializedView,
    isRefreshingMatView,
    // Paradigm-specific
    onCellActivated,
    topToolbar,
    bottomToolbar,
    toolbarActions,
    fkPreviewComponent,
    hoverIconsDrawCell,
    customGetCellContent,
    className,
    // FK data
    referencedTableColumns,
    databaseType,
    // Data invalidation
    onRefetch,
    // Error handling
    error,
    onReconnect,
  } = props;

  // --- CRUD Store Integration ---
  const { stageCommand, getTableKey, stagedCommands } = useCrudStore();
  const tableKey = commandFactory
    ? getTableKey({
        connectionId: commandFactory.connectionId,
        database: commandFactory.database ?? "",
        schema: commandFactory.schema,
        table: commandFactory.table,
      })
    : "";
  const pendingChanges = stagedCommands.get(tableKey) ?? [];

  // --- Data Invalidation Subscription ---
  // When data is invalidated (e.g., after CRUD commit), refetch data and clear committed changes
  useEffect(() => {
    if (!commandFactory) return;

    const unsubscribe = useDataInvalidationStore
      .getState()
      .subscribe(
        commandFactory.connectionId,
        commandFactory.database ?? "",
        commandFactory.schema,
        commandFactory.table,
        async () => {
          // Refetch data from the adapter
          onRefetch?.();
          // Clear committed changes since data is now fresh
          const { clearCommittedChanges, getTableKey: getKey } =
            useCrudStore.getState();
          const key = getKey({
            connectionId: commandFactory.connectionId,
            database: commandFactory.database ?? "",
            schema: commandFactory.schema,
            table: commandFactory.table,
          });
          clearCommittedChanges(key);
        },
      );

    return unsubscribe;
  }, [commandFactory, onRefetch]);

  // --- Refs ---
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<EditableDataGridRef>(null);
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const loadingMoreRef = useRef(false); // Ref-based guard to prevent duplicate fetches

  // Store refs for callbacks
  const onCellEditCommitRef = useRef(onCellEditCommitCallback);
  const commandFactoryRef = useRef(commandFactory);

  useEffect(() => {
    onCellEditCommitRef.current = onCellEditCommitCallback;
    commandFactoryRef.current = commandFactory;
  });

  // --- State ---
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [isEditingCell, setIsEditingCell] = useState(false);

  // Scoped keybindings for this grid instance
  const scopeId = useScopedKeybindings(gridId);

  // Track focus state for context keys
  useContextKey("dataGridFocus", isGridFocused, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridEditable", !readOnly, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("editingCell", isEditingCell, {
    scopeId,
    resetOnUnmount: true,
  });
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);

  // Grid selection - managed internally
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    undefined,
  );

  const gridSelectionRef = useRef<GridSelection | undefined>(undefined);
  const contextMenuTargetRef = useRef<ContextMenuTarget | null>(null);

  // --- Column State from Store ---
  const preferences = useGridPreferencesStore((s: any) =>
    s.getPreferences?.(gridId),
  );
  const hydrated = useGridPreferencesStore((s: any) => s.hydrated);
  const columnState = preferences?.columns ?? {
    order: [],
    widths: {},
    visibility: {},
    pinned: [],
  };

  // --- Filter Columns ---
  // Convert GridColumnV2 to FilterColumnInfo for filter hooks
  const filterColumns = useMemo(() => {
    return columns
      .filter(
        (col) =>
          !["_rowIndex", "_rowSelection"].includes(col.id) &&
          col.meta?.db_type !== "BYTEA" &&
          col.meta?.db_type !== "bytea" &&
          col.meta?.db_type !== "BLOB" &&
          col.meta?.db_type !== "blob",
      )
      .map((col) => ({
        name: col.name,
        dataType: col.meta?.db_type ?? col.type ?? "text",
        nullable: col.meta?.nullable,
        enumValues: col.meta?.enum_values,
        isPrimaryKey: col.meta?.is_pk,
        isForeignKey: col.meta?.is_fk,
      }));
  }, [columns]);

  // --- Quick Filter with AI Support ---
  const { generateFilter: generateAIFilter, isLoading: isAIFilterLoading } =
    useAIFilter(
      filterColumns,
      tableName ?? "",
      (dialect ?? "postgresql") as "postgresql" | "mysql" | "sqlite" | "mssql",
      {
        connectionId,
        schema,
        enableCrossTable: paradigm === "sql",
      },
    );

  const {
    value: quickFilterValue,
    mode: quickFilterMode,
    error: quickFilterError,
    aiExplanation,
    activeFilter: _activeFilter,
    setValue: setQuickFilterValue,
    setMode: setQuickFilterMode,
    submit: handleFilterSubmit,
    clear: _handleFilterClear,
  } = useQuickFilter({
    columns: filterColumns,
    initialFilter: undefined,
    generateAIFilter,
    clientSideFiltering: false,
  });

  // --- Focus/Blur Handlers ---
  const handleFocusCapture = useCallback(() => {
    setIsGridFocused(true);
  }, []);

  const handleBlurCapture = useCallback((e: React.FocusEvent) => {
    const currentTarget = e.currentTarget as HTMLElement;
    setTimeout(() => {
      if (!currentTarget.contains(document.activeElement)) {
        setIsGridFocused(false);
        setIsEditingCell(false);
      }
    }, 0);
  }, []);

  // --- Keyboard Shortcuts for Quick Filter ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        quickFilterRef.current?.focus();
        return;
      }

      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !document.activeElement?.hasAttribute("contenteditable")
      ) {
        e.preventDefault();
        quickFilterRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // --- Column Management ---
  const reorderColumns = useCallback(
    (cols: GridColumnV2[], order: string[]): GridColumnV2[] => {
      if (!order || order.length === 0) return cols;
      const orderMap = new Map(order.map((id, index) => [id, index]));
      return [...cols].sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? 9999;
        const bIdx = orderMap.get(b.id) ?? 9999;
        return aIdx - bIdx;
      });
    },
    [],
  );

  const baseColumns = useMemo(() => columns, [columns]);

  // Initialize column order and visibility on first load
  useEffect(() => {
    if (!hydrated || !enableColumnManagement || baseColumns.length === 0)
      return;

    const expectedOrder = baseColumns.map((column) => column.id);
    const isInitialLoad = columnState.order.length === 0;

    if (isInitialLoad) {
      upsertGridColumnsState(gridId, (draft) => {
        draft.order = expectedOrder;
        expectedOrder.forEach((id) => {
          if (!id) return;
          draft.visibility[id] = true;
        });
      });
    }
  }, [
    baseColumns,
    columnState.order.length,
    gridId,
    hydrated,
    enableColumnManagement,
  ]);

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order, reorderColumns],
  );

  // Memoized persistence callbacks to prevent infinite loops
  const handleColumnVisibilityChange = useCallback(
    (visibility: Record<string, boolean>) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(gridId, (draft) => {
        draft.visibility = visibility;
      });
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const {
    sizedColumns: _sizedColumns,
    columnWidths,
    handleColumnResize,
    handleColumnResizeEnd,
    isDragging: _isResizingColumns,
  } = useColumnSizing({
    columns: reorderedColumns,
    initialWidths: columnState.widths,
    // Don't persist during resize - only on resize end for better performance
    onChange: undefined,
  });

  // Batch width persistence - only persist on resize end, not during drag
  const flushWidths = useCallback(
    (widths: Record<string, number>) => {
      if (!hydrated || !enableColumnManagement) return;
      const state = useGridPreferencesStore.getState();
      const current = state.preferences[gridId]?.columns?.widths ?? {};
      const changed = Object.keys(widths).some(
        (key) => current[key] !== widths[key],
      );
      if (changed) {
        // Use requestIdleCallback to defer persistence until browser is idle
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => {
            upsertGridColumnsState(gridId, (draft) => {
              draft.widths = widths;
            });
          });
        } else {
          // Fallback for browsers without requestIdleCallback
          setTimeout(() => {
            upsertGridColumnsState(gridId, (draft) => {
              draft.widths = widths;
            });
          }, 0);
        }
      }
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const { visibleColumns } = useColumnVisibility({
    columns: reorderedColumns,
    initialHidden: Object.entries(columnState.visibility)
      .filter(([, visible]) => !visible)
      .map(([id]) => id),
    onChange: enableColumnManagement ? handleColumnVisibilityChange : undefined,
  });

  const filterVisibleColumns = useCallback(
    (
      cols: GridColumnV2[],
      visibilityMap: Record<string, boolean>,
    ): GridColumnV2[] => {
      return cols.filter((col) => visibilityMap[col.id] !== false);
    },
    [],
  );

  const applyPinnedOrdering = useCallback(
    (
      cols: GridColumnV2[],
      pinnedIds: string[],
    ): { columns: GridColumnV2[]; freezeColumns: number } => {
      if (!pinnedIds || pinnedIds.length === 0) {
        return { columns: cols, freezeColumns: 0 };
      }
      const pinnedSet = new Set(pinnedIds);
      const pinned = cols.filter((col) => pinnedSet.has(col.id));
      const unpinned = cols.filter((col) => !pinnedSet.has(col.id));
      return {
        columns: [...pinned, ...unpinned],
        freezeColumns: pinned.length,
      };
    },
    [],
  );

  const { columns: computedColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(
      visibleColumns,
      columnState.visibility,
    );
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [
    columnState.pinned,
    columnState.visibility,
    visibleColumns,
    filterVisibleColumns,
    applyPinnedOrdering,
  ]);

  // Keep stable columns during transitions to prevent flashing
  const columnsRef = useRef(computedColumns);
  if (computedColumns.length > 0) {
    columnsRef.current = computedColumns;
  }
  const stableComputedColumns =
    computedColumns.length > 0 ? computedColumns : columnsRef.current;

  // Apply widths at the END - cache column objects to avoid recreating unchanged ones
  const finalColumnsCache = useRef<Map<string, GridColumnV2>>(new Map());

  const finalColumns = useMemo(() => {
    if (!enableColumnManagement) return columns;

    const cache = finalColumnsCache.current;
    const result = stableComputedColumns.map((column) => {
      const width = columnWidths[column.id] ?? column.width;
      const cached = cache.get(column.id);

      // Reuse cached if width unchanged - this prevents object churn
      if (cached && cached.width === width && cached.id === column.id) {
        return cached;
      }

      const withWidth = width !== column.width ? { ...column, width } : column;
      cache.set(column.id, withWidth);
      return withWidth;
    });

    return result;
  }, [enableColumnManagement, columns, stableComputedColumns, columnWidths]);

  const finalColumnsRef = useRef(finalColumns);
  // Update synchronously during render (not in useEffect) to avoid delay
  finalColumnsRef.current = finalColumns;

  // --- Row Pinning ---
  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) return `row-${index}`;
      const pkColumns = columns.filter((col) => col.meta?.is_pk);
      if (pkColumns.length === 0) return `row-${index}`;
      const pkParts: string[] = [];
      for (const pkCol of pkColumns) {
        const cellValue = row[pkCol.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : cellValue;
        pkParts.push(value != null ? String(value) : "null");
      }
      return `pk-${pkParts.join("-")}`;
    },
    [columns],
  );

  const handlePinnedRowsChange = useCallback(
    (ids: string[]) => {
      if (!hydrated || !enableRowPinning) return;
      useGridPreferencesStore.getState().updatePinnedRows(gridId, () => ids);
    },
    [gridId, hydrated, enableRowPinning],
  );

  const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } =
    useRowPinning({
      rows,
      initialPinned: enableRowPinning ? (preferences?.pinnedRows ?? []) : [],
      maxPinnedRows: 5,
      getRowId: getRowKey,
      onChange: enableRowPinning ? handlePinnedRowsChange : undefined,
    });

  const displayRows = useMemo(() => {
    if (!enableRowPinning) return rows;
    return [...pinnedRows, ...unpinnedRows];
  }, [enableRowPinning, rows, pinnedRows, unpinnedRows]);

  // --- Optimistic Updates ---
  // Apply staged changes to display rows for immediate visual feedback
  const displayRowsWithOptimistic = useOptimisticRows({
    displayRows,
    stagedCommands: pendingChanges,
    primaryKeyColumns: commandFactory?.primaryKeyColumns ?? [],
    columnNameToFieldMap: commandFactory?.columnNameToFieldMap ?? new Map(),
    columnByFieldMap: commandFactory?.columnByFieldMap ?? new Map(),
    columns,
    getRowKey: commandFactory?.getRowKey ?? getRowKey,
  });

  const deferredDisplayRows = useDeferredValue(
    enableStagedChanges && commandFactory
      ? displayRowsWithOptimistic
      : displayRows,
  );
  const rowsRef = useRef(deferredDisplayRows);
  // Update synchronously during render (not in useEffect) to avoid delay
  rowsRef.current = deferredDisplayRows;

  // --- Infinite Loading ---
  // Update ref when isLoadingMore changes
  useEffect(() => {
    loadingMoreRef.current = props.isLoadingMore ?? false;
  }, [props.isLoadingMore]);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        // Scroll position persistence could be added here if needed
      }, 150);

      // Trigger loading when within 20 rows of the end (or immediately if fewer rows)
      const threshold = Math.max(0, rowsRef.current.length - 20);
      const nearEnd = region.y + region.height >= threshold;
      const hasFirstPage = rowsRef.current.length >= 100; // DEFAULT_PAGE_SIZE equivalent

      // Use both state and ref guards to prevent duplicate fetches
      if (
        nearEnd &&
        hasFirstPage && // avoid prefetching before the first page finishes streaming
        props.hasMore &&
        !props.isLoadingMore &&
        !loadingMoreRef.current &&
        props.onLoadMore
      ) {
        loadingMoreRef.current = true; // Set immediately to prevent duplicates

        void Promise.resolve(props.onLoadMore()).finally(() => {
          loadingMoreRef.current = false;
        });
      }
    },
    [props.hasMore, props.isLoadingMore, props.onLoadMore],
  );

  // Cleanup scroll debounce on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  // --- Staged Changes Highlighting ---
  const stagedChanges = enableStagedChanges
    ? useStagedChangesIndicator({
        connectionId,
        database: database ?? "",
        schema: schema ?? "",
        table: tableName ?? "",
        rows: deferredDisplayRows,
        columns: finalColumns,
      })
    : {
        rowChanges: new Map<number, Set<string>>(),
        insertedRows: new Set<number>(),
        deletedRows: new Set<number>(),
      };

  const stagedChangesRef = useRef(stagedChanges);
  // Update synchronously during render (not in useEffect) to avoid delay
  stagedChangesRef.current = stagedChanges;

  // --- Staged Values Map (for Document/KeyValue paradigms) ---
  // Build a map of staged new values to override cell display
  // This is needed because Document/KeyValue grids provide their own getCellContent
  // and don't use useOptimisticRows to transform row data
  const stagedValuesMap = useMemo(() => {
    const map = new Map<string, unknown>();
    if (!enableStagedChanges || pendingChanges.length === 0) {
      return map;
    }

    // Build PK to row index map (same logic as useStagedChangesIndicator)
    const pkColumns = finalColumns.filter((col) => col.meta?.is_pk);
    // Fallback for document/keyvalue paradigms
    let effectivePkColumns = pkColumns;
    if (pkColumns.length === 0 && finalColumns.length > 0) {
      const idColumn = finalColumns.find(
        (col) => col.field === "_id" || col.name === "_id",
      );
      if (idColumn) effectivePkColumns = [idColumn];
      const keyColumn = finalColumns.find(
        (col) => col.field === "key" || col.name === "key",
      );
      if (keyColumn && effectivePkColumns.length === 0)
        effectivePkColumns = [keyColumn];
    }

    // Build PK string for each row
    const rowPkToIndex = new Map<string, number>();
    deferredDisplayRows.forEach((row, index) => {
      const sortedPkColumns = [...effectivePkColumns].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const pkValues = sortedPkColumns.map((col) => {
        const cellValue = row[col.field];
        if (
          cellValue &&
          typeof cellValue === "object" &&
          "value" in cellValue
        ) {
          const value = (cellValue as { value: unknown }).value;
          if (value === null || value === undefined) return "null";
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        }
        return "null";
      });
      const pkKey = pkValues.join("|");
      rowPkToIndex.set(pkKey, index);
    });

    // For each update command, find the row index via PK matching
    for (const command of pendingChanges) {
      if (command.type !== "data.update") continue;

      const payload = command.payload as {
        column?: string;
        newValue?: unknown;
        primaryKeys?: Record<string, unknown>;
      };
      if (!payload.column || !payload.primaryKeys) continue;

      // Build PK string from command payload (same logic as createPrimaryKeyStringFromRecord)
      const pkKey = Object.entries(payload.primaryKeys)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_key, value]) => {
          if (value === null || value === undefined) return "null";
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        })
        .join("|");

      const rowIndex = rowPkToIndex.get(pkKey);
      if (rowIndex !== undefined) {
        const key = `${rowIndex}:${payload.column}`;
        map.set(key, payload.newValue);
      }
    }

    return map;
  }, [enableStagedChanges, pendingChanges, finalColumns, deferredDisplayRows]);

  const stagedValuesMapRef = useRef(stagedValuesMap);
  stagedValuesMapRef.current = stagedValuesMap;

  // --- Cell Hover Icons (Copy button, FK preview) ---
  // Only use internal hook if no external hoverIconsDrawCell is provided
  const isLargeDataset = deferredDisplayRows.length > 5000;
  const {
    onItemHovered: handleCellHovered,
    drawCell: internalDrawCellWithHoverIcons,
    fkPreviewState,
    clearFkPreview,
  } = useCellHoverIcons({
    columns: finalColumns,
    rows: deferredDisplayRows,
    enabled: !hoverIconsDrawCell && !isLargeDataset, // Only enabled if no external drawCell
    containerRef: containerRef,
    enableFKPreview: paradigm === "sql",
    gridRef: gridRef,
  });

  // Use external drawCell if provided, otherwise use internal
  // Note: Type assertion needed because external hoverIconsDrawCell may have different signature
  const effectiveDrawCell = (hoverIconsDrawCell ??
    internalDrawCellWithHoverIcons) as typeof internalDrawCellWithHoverIcons;

  // Combined item hover handler - merges hover icons with context menu target tracking
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      // Call hover icons handler
      handleCellHovered(args);

      // Update context menu target based on what's being hovered
      if (args.kind === "header") {
        const [colIndex] = args.location;
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          contextMenuTargetRef.current = {
            type: "header",
            columnIndex: colIndex,
            column,
          };
        }
      } else if (args.kind === "cell") {
        const [colIndex, rowIndex] = args.location;
        contextMenuTargetRef.current = {
          type: "cell",
          columnIndex: colIndex,
          rowIndex,
        };
      } else if (args.kind === "out-of-bounds") {
        contextMenuTargetRef.current = { type: "out-of-bounds" };
      }
    },
    [handleCellHovered],
  );

  // --- Column Sorting ---
  const { sortColumns, getSortIndex, getSortDirection, toggleSort } =
    useColumnSorting({
      gridId,
      columns: finalColumns,
    });

  const drawHeader = useMemo(
    () =>
      enableSorting
        ? createDrawHeader({
            getSortDirection,
            getSortIndex,
            columns: finalColumns,
            sortedColumnCount: sortColumns.length,
          })
        : undefined,
    [
      enableSorting,
      getSortDirection,
      getSortIndex,
      finalColumns,
      sortColumns.length,
    ],
  );

  // --- Header Click Handler (for sorting) ---
  const handleHeaderClicked = useCallback(
    (
      colIndex: number,
      event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ) => {
      if (enableSorting) {
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          toggleSort(column.id, event.shiftKey || false);
        }
      }
    },
    [enableSorting, toggleSort],
  );

  // --- Clipboard Operations ---
  const toTextCallback = useCallback((selection: GridSelection) => {
    // Handle full row selections
    if (selection.rows.length > 0) {
      const selected = selection.rows
        .toArray()
        .map((idx) => rowsRef.current[idx])
        .filter(Boolean);
      if (selected.length === 0) return "";
      const body = selected.map((row) =>
        finalColumnsRef.current
          .map((col) => {
            const value = row?.[col.field];
            if (!value || typeof value !== "object") return "";
            return String((value as any).value ?? "");
          })
          .join("\t"),
      );
      return body.join("\n");
    }

    // Handle cell-level selections (rectangular ranges)
    if (selection.current?.range) {
      const { range } = selection.current;
      const { x: startCol, y: startRow, width, height } = range;

      const selectedCols = finalColumnsRef.current.slice(
        startCol,
        startCol + width,
      );

      // Build data rows (no headers)
      const body: string[] = [];
      for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
        const row = rowsRef.current[rowIdx];
        if (!row) continue;

        const rowData = selectedCols
          .map((col) => {
            const value = row[col.field];
            if (!value || typeof value !== "object") return "";
            return String((value as any).value ?? "");
          })
          .join("\t");
        body.push(rowData);
      }

      return body.join("\n");
    }

    return "";
  }, []);

  const toJsonCallback = useCallback((selection: GridSelection) => {
    // Handle full row selections
    if (selection.rows.length > 0) {
      return selection.rows
        .toArray()
        .map((idx) => rowsRef.current[idx])
        .filter(Boolean)
        .map((row) => {
          const jsonRow: Record<string, unknown> = {};
          finalColumnsRef.current.forEach((col) => {
            const value = row?.[col.field];
            if (value && typeof value === "object" && "value" in value) {
              const cellValue = (value as any).value;
              // Use column name for JSON key, not internal field identifier
              jsonRow[col.name] =
                typeof cellValue === "bigint"
                  ? cellValue.toString()
                  : cellValue;
            }
          });
          return jsonRow;
        });
    }

    // Handle cell-level selections (rectangular ranges)
    if (selection.current?.range) {
      const { range } = selection.current;
      const { x: startCol, y: startRow, width, height } = range;

      const selectedCols = finalColumnsRef.current.slice(
        startCol,
        startCol + width,
      );
      const result: Record<string, unknown>[] = [];

      for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
        const row = rowsRef.current[rowIdx];
        if (!row) continue;

        const jsonRow: Record<string, unknown> = {};
        selectedCols.forEach((col) => {
          const value = row[col.field];
          if (value && typeof value === "object" && "value" in value) {
            const cellValue = (value as any).value;
            // Use column name for JSON key, not internal field identifier
            jsonRow[col.name] =
              typeof cellValue === "bigint" ? cellValue.toString() : cellValue;
          }
        });
        result.push(jsonRow);
      }

      return result;
    }

    return [];
  }, []);

  const { copySelection, handleKeyboardCopy } = useClipboardBridge({
    toText: toTextCallback,
    toJson: toJsonCallback,
    onCopySuccess: () => {},
    onCopyError: () => {},
  });

  // --- Keyboard Copy Handler (Cmd+C, Cmd+Shift+C) ---
  useEffect(() => {
    if (!enableClipboard) return;

    const handleCopyKeyDown = async (e: KeyboardEvent) => {
      // Only handle copy shortcuts
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c")) return;

      // Check if our grid is focused
      if (!wrapperRef.current?.contains(document.activeElement)) return;

      // Don't intercept if editing a cell
      if (isEditingCell) return;

      // Get current selection
      const selection = gridSelectionRef.current;
      if (!selection) return;

      // Handle the copy
      await handleKeyboardCopy(e, selection);
    };

    window.addEventListener("keydown", handleCopyKeyDown);
    return () => {
      window.removeEventListener("keydown", handleCopyKeyDown);
    };
  }, [enableClipboard, isEditingCell, handleKeyboardCopy]);

  useCommand(
    "dataGrid.action.copyAsJson",
    enableClipboard
      ? async () => {
          if (gridSelectionRef.current) {
            await copySelection(gridSelectionRef.current, "json");
          }
        }
      : async () => {},
    {
      label: "Copy as JSON",
      category: "DataGrid",
    },
  );

  // --- Export to CSV ---
  // TODO: Implement export to CSV
  // useEffect(() => {
  //   if (!enableExport) return;
  //   const handleExport = () => {
  //     if (isGridFocused) {
  //       void exportToCSV(deferredDisplayRows, finalColumns, `${tableName ?? 'export'}.csv`);
  //       toast.success('Export started');
  //     }
  //   };
  //   eventBus.on('data-grid:export-csv', handleExport);
  //   return () => eventBus.off('data-grid:export-csv', handleExport);
  // }, [enableExport, deferredDisplayRows, finalColumns, tableName, isGridFocused]);

  // --- getCellContent ---
  // Internal cell content builder (used when props.getCellContent is not provided)
  const internalGetCellContent = useCallback(
    (cell: Item): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
        };
      }

      const cellValue = row[column.field];
      const isReadOnly = readOnly || column.meta?.is_pk || false;

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
        connectionContext: {
          connectionId,
          database,
          schema: schema ?? "",
          table: tableName ?? "",
        },
      });

      // Apply custom getCellContent from paradigm-specific adapter
      return customGetCellContent
        ? customGetCellContent(cell, gridCell)
        : gridCell;
    },
    [readOnly, connectionId, database, schema, tableName, customGetCellContent],
  );

  // Use prop getCellContent if provided, otherwise use internal
  const propGetCellContentRef = React.useRef(props.getCellContent);
  React.useEffect(() => {
    propGetCellContentRef.current = props.getCellContent;
  });

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      // Use prop getCellContent if provided (Document/KeyValue paradigms)
      const baseCell = propGetCellContentRef.current
        ? propGetCellContentRef.current(cell)
        : internalGetCellContent(cell);

      // Apply staged changes highlighting and value override
      // Use column.name for checking staged changes (not column.field)
      // because CRUD commands store changes by actual column name
      if (enableStagedChanges) {
        const [colIndex, rowIndex] = cell;
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          const hasPendingChange = hasStagedCellChange(
            stagedChangesRef.current,
            rowIndex,
            column.name,
          );
          if (hasPendingChange) {
            // Build the cell with staged value override and highlighting
            let updatedCell = baseCell;

            // Override display value if we have a staged value
            // ONLY for Document/KeyValue paradigms that don't use useOptimisticRows to transform row data.
            // SQL paradigm uses useOptimisticRows, so row data is already updated and
            // buildGridCellV2 builds the correct cell type (boolean dropdown, number, etc.).
            if (paradigm === "document" || paradigm === "keyvalue") {
              const stagedValueKey = `${rowIndex}:${column.name}`;
              const stagedValue =
                stagedValuesMapRef.current.get(stagedValueKey);
              if (stagedValue !== undefined) {
                const isCustomCellWithKind =
                  baseCell.kind === GridCellKind.Custom &&
                  typeof baseCell.data === "object" &&
                  baseCell.data !== null &&
                  "kind" in baseCell.data;

                if (isCustomCellWithKind) {
                  updatedCell = {
                    ...baseCell,
                    data: {
                      ...(baseCell.data as Record<string, unknown>),
                      value: stagedValue,
                    },
                    copyData:
                      stagedValue === null ? "NULL" : String(stagedValue),
                  };
                } else if (baseCell.kind === GridCellKind.Text) {
                  const displayValue =
                    stagedValue === null ? "NULL" : String(stagedValue);
                  updatedCell = {
                    ...baseCell,
                    data: displayValue,
                    displayData: displayValue,
                  };
                }
              }
            }

            // Apply orange highlighting
            return {
              ...updatedCell,
              themeOverride: {
                ...updatedCell.themeOverride,
                bgCell: "rgba(251, 146, 60, 0.15)", // Orange for staged cell changes
                accentColor: "#fb923c",
                accentLight: "rgba(251, 146, 60, 0.2)",
              },
            };
          }
        }
      }

      return baseCell;
    },
    // Include deferredDisplayRows in deps to invalidate Glide's cell cache when data changes
    // Include stagedChanges and stagedValuesMap to refresh cells when staged changes update
    // The actual data access uses refs for performance, but the dependency array change
    // forces Glide Data Grid to re-query getCellContent for all cells
    [
      internalGetCellContent,
      enableStagedChanges,
      deferredDisplayRows,
      stagedChanges,
      stagedValuesMap,
    ],
  );

  // --- getRowThemeOverride ---
  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Pinned row (check first, higher priority)
      if (enableRowPinning && rowIndex < pinnedRows.length) {
        return { bgCell: "rgba(59, 130, 246, 0.08)" }; // Blue
      }

      if (!enableStagedChanges) return undefined;

      const changes = stagedChangesRef.current;

      // Deletion pending
      if (changes.deletedRows.has(rowIndex)) {
        return { bgCell: "rgba(239, 68, 68, 0.06)" }; // Red
      }

      // Insertion pending
      if (changes.insertedRows.has(rowIndex)) {
        return { bgCell: "rgba(34, 197, 94, 0.06)" }; // Green
      }

      // Staged changes (cell updates)
      if (changes.rowChanges.has(rowIndex)) {
        return { bgCell: "rgba(212, 165, 43, 0.04)" }; // Golden
      }

      return undefined;
    },
    [enableStagedChanges, enableRowPinning, pinnedRows.length],
  );

  // --- CRUD Handlers (using commandFactory) ---
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      if (readOnly) return undefined;

      const factory = commandFactoryRef.current;

      // If commandFactory exists (SQL paradigm), use it to create and stage commands
      if (factory) {
        const command = factory.createEditCommand(event);
        if (command) {
          stageCommand(command);
        }
        // Call optional callback for paradigm-specific post-processing
        onCellEditCommitRef.current?.(event);
      } else {
        // No commandFactory - let the paradigm adapter handle staging directly
        // (Document and KeyValue paradigms provide their own onCellEditCommit)
        onCellEditCommitRef.current?.(event);
      }

      return undefined;
    },
    [stageCommand, readOnly],
  );

  const handleAddRow = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly) return;

    const command = factory.createInsertCommand();
    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly]);

  const handleInsertRowBelow = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly || !gridSelection?.current?.cell) return;

    const [, rowIndex] = gridSelection.current.cell;
    const selectedRow = rowsRef.current[rowIndex];
    const rowKey = selectedRow
      ? factory.getRowKey(selectedRow, rowIndex)
      : undefined;

    const command = factory.createInsertCommand();
    // Add metadata for position if we have a selected row
    if (rowKey) {
      (command.metadata as any).insertAfterRowKey = rowKey;
    }
    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly, gridSelection]);

  const handleInsertRowAbove = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly || !gridSelection?.current?.cell) return;

    const [, rowIndex] = gridSelection.current.cell;
    const command = factory.createInsertCommand();

    if (rowIndex === 0) {
      // Insert at top - mark with special metadata
      (command.metadata as any).insertAtTop = true;
    } else {
      // Insert after the row ABOVE the selected row (effectively inserting before)
      const prevRow = rowsRef.current[rowIndex - 1];
      if (prevRow) {
        const rowKey = factory.getRowKey(prevRow, rowIndex - 1);
        (command.metadata as any).insertAfterRowKey = rowKey;
      }
    }

    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly, gridSelection]);

  const handleDeleteRows = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly) return;

    const selectedIndices = gridSelection?.rows?.toArray() ?? [];
    if (selectedIndices.length === 0) {
      // Single cell selection - delete that row
      if (gridSelection?.current?.cell) {
        const [, rowIndex] = gridSelection.current.cell;
        const row = rowsRef.current[rowIndex];
        if (row) {
          const rowKey = factory.getRowKey(row, rowIndex);
          const command = factory.createDeleteCommand(row, rowKey);
          stageCommand(command);
          toast.success("Row deletion staged");
        }
      }
      return;
    }

    // Multiple rows selected
    for (const rowIndex of selectedIndices) {
      const row = rowsRef.current[rowIndex];
      if (row) {
        const rowKey = factory.getRowKey(row, rowIndex);
        const command = factory.createDeleteCommand(row, rowKey);
        stageCommand(command);
      }
    }
    toast.success(`${selectedIndices.length} row deletion(s) staged`);
  }, [stageCommand, readOnly, gridSelection]);

  const handleBatchEdit = useCallback(
    (edits: Array<{ cell: Item; value: unknown }>, _rows: GridRowModel[]) => {
      const factory = commandFactoryRef.current;
      if (!factory || readOnly) return;

      for (const edit of edits) {
        const [colIndex, rowIndex] = edit.cell;
        const column = finalColumnsRef.current[colIndex];
        const row = rowsRef.current[rowIndex];
        if (!column || !row) continue;

        const event: GridEditCommitEvent = {
          cell: edit.cell,
          rowIndex,
          columnIndex: colIndex,
          column,
          row,
          newValue: {
            kind: GridCellKind.Text,
            data: String(edit.value ?? ""),
            displayData: String(edit.value ?? ""),
            allowOverlay: true,
          },
          previousValue: null,
        };

        const command = factory.createEditCommand(event);
        if (command) {
          stageCommand(command);
        }
      }
    },
    [stageCommand, readOnly],
  );

  const handleBatchClear = useCallback(
    (cells: Item[]) => {
      if (readOnly || cells.length === 0 || !commandFactory) return;
      const edits = cells.map((cell) => ({ cell, value: null }));
      handleBatchEdit(edits, rowsRef.current);
    },
    [readOnly, commandFactory, handleBatchEdit],
  );

  // Paste handler for clipboard data (called from context menu)
  const handlePaste = useCallback(async () => {
    if (readOnly || !commandFactory) return;

    try {
      // Focus the grid first to ensure clipboard permission works
      // Context menu clicks steal focus, so we need to restore it
      if (gridRef.current) {
        gridRef.current.focus();
        // Small delay to allow focus to settle
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.info("Clipboard is empty");
        return;
      }

      // Parse clipboard text using shared utility (handles trailing empty lines correctly)
      const lines = parseClipboardText(text);
      if (lines.length === 0) return;

      // Use the hovered cell from context menu target if no explicit selection
      const selection = gridSelectionRef.current;
      let startCol: number;
      let startRow: number;

      if (selection?.current?.cell) {
        [startCol, startRow] = selection.current.cell;
      } else if (contextMenuTargetRef.current?.type === "cell") {
        // Use the cell that was right-clicked
        startCol = contextMenuTargetRef.current.columnIndex;
        startRow = contextMenuTargetRef.current.rowIndex;
      } else {
        toast.error("Select a cell to paste into");
        return;
      }

      const edits: Array<{ cell: Item; value: unknown }> = [];

      lines.forEach((values, lineIndex) => {
        values.forEach((value, colIndex) => {
          const targetCol = startCol + colIndex;
          const targetRow = startRow + lineIndex;

          // Skip if out of bounds
          if (targetCol >= finalColumnsRef.current.length) return;
          if (targetRow >= rowsRef.current.length) return;

          // Skip PK columns
          const column = finalColumnsRef.current[targetCol];
          if (column?.meta?.is_pk) return;

          // Coerce value to appropriate type based on column metadata
          const columnTypeHint: ColumnTypeHint = {
            dbType: column?.meta?.db_type ?? column?.type ?? "text",
            nullable: column?.meta?.nullable ?? true,
          };
          const coercedValue = coerceToColumnType(value.trim(), columnTypeHint);

          edits.push({
            cell: [targetCol, targetRow],
            value: coercedValue,
          });
        });
      });

      if (edits.length > 0) {
        handleBatchEdit(edits, rowsRef.current);
        toast.success(`Pasted ${edits.length} cell(s)`);
      }
    } catch (err) {
      console.error("Paste failed:", err);
      // Differentiate clipboard permission errors
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.error(
          "Clipboard access denied. Please grant clipboard permission in your browser settings.",
        );
      } else {
        toast.error("Failed to paste from clipboard");
      }
    }
  }, [readOnly, commandFactory, handleBatchEdit]);

  // --- Cell Edit State Tracking ---
  const handleCellEditStart = useCallback(() => {
    setIsEditingCell(true);
  }, []);

  const handleCellEditCancel = useCallback(() => {
    setIsEditingCell(false);
  }, []);

  const handleCellEditCommitWrapper = useCallback(
    (event: GridEditCommitEvent) => {
      setIsEditingCell(false);
      handleCellEditCommit(event);
    },
    [handleCellEditCommit],
  );

  // --- Fill Operations ---
  const { fillDown, fillRight } = useFillOperations({
    getCellContent,
    onBatchEdit:
      enableFillOperations && commandFactory && !readOnly
        ? (edits) => {
            handleBatchEdit(edits, deferredDisplayRows);
          }
        : undefined,
    columnCount: finalColumns.length,
    rowCount: deferredDisplayRows.length,
  });

  useEffect(() => {
    if (!enableFillOperations) return;
    const handleFillKeyDown = (e: KeyboardEvent) => {
      if (!isGridFocused || isEditingCell) return;
      if (e.ctrlKey && !e.metaKey && e.key === "d") {
        e.preventDefault();
        fillDown(gridSelection);
      }
      if (e.ctrlKey && !e.metaKey && e.key === "r") {
        e.preventDefault();
        fillRight(gridSelection);
      }
    };
    window.addEventListener("keydown", handleFillKeyDown);
    return () => {
      window.removeEventListener("keydown", handleFillKeyDown);
    };
  }, [
    enableFillOperations,
    isGridFocused,
    isEditingCell,
    fillDown,
    fillRight,
    gridSelection,
  ]);

  // Delete key handler for batch clear
  useEffect(() => {
    if (readOnly || !commandFactory) return;

    const handleDeleteKeyDown = (e: KeyboardEvent) => {
      // Only Delete or Backspace key
      if (e.key !== "Delete" && e.key !== "Backspace") return;

      // Check if our grid is focused
      if (!wrapperRef.current?.contains(document.activeElement)) return;

      // Don't intercept if editing a cell
      if (isEditingCell) return;

      // Get current selection and build cell list
      const selection = gridSelectionRef.current;
      if (!selection?.current?.range) return;

      e.preventDefault();

      const { range } = selection.current;
      const { x: startCol, y: startRow, width, height } = range;

      const cells: Item[] = [];
      for (let row = startRow; row < startRow + height; row++) {
        for (let col = startCol; col < startCol + width; col++) {
          // Skip read-only columns (e.g., PK columns)
          const column = finalColumnsRef.current[col];
          if (column?.meta?.is_pk) continue;
          cells.push([col, row]);
        }
      }

      if (cells.length > 0) {
        handleBatchClear(cells);
        toast.success(`${cells.length} cell(s) staged for clearing`);
      } else {
        toast.info("Cannot clear read-only columns");
      }
    };

    window.addEventListener("keydown", handleDeleteKeyDown);
    return () => {
      window.removeEventListener("keydown", handleDeleteKeyDown);
    };
  }, [readOnly, commandFactory, isEditingCell, handleBatchClear]);

  // --- Filter by Column (from context menu) ---
  const handleFilterByColumn = useCallback(
    (columnId: string) => {
      if (!enableFiltering) return;

      const column = finalColumnsRef.current.find((c) => c.id === columnId);
      if (!column) return;

      // Focus QuickFilter and set initial filter expression
      quickFilterRef.current?.focus();
      const columnName = column.name ?? column.id;
      setQuickFilterValue(`"${columnName}" IS NOT NULL`);
    },
    [enableFiltering, setQuickFilterValue],
  );

  // --- Selection Management ---
  const handleGridSelectionChange = useCallback(
    (newSelection: GridSelection) => {
      setGridSelection(newSelection);
      gridSelectionRef.current = newSelection;
    },
    [],
  );

  // Compute selected rows from gridSelection
  const selectedRowsSet = useMemo(() => {
    if (!gridSelection?.rows) return new Set<number>();
    return new Set(gridSelection.rows.toArray());
  }, [gridSelection?.rows]);

  const selectedRowCount = selectedRowsSet.size;

  const selectedRowsData = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => rowsRef.current[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }, [selectedRowsSet]);

  const selectedRowKeys = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => getRowKey(rowsRef.current[idx], idx))
      .filter((key): key is string => Boolean(key));
  }, [selectedRowsSet, getRowKey]);

  // --- Column Reordering ---
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!hydrated || !enableColumnManagement) return;
      const newOrder = [...finalColumns.map((c) => c.id)];
      const [movedId] = newOrder.splice(startIndex, 1);
      newOrder.splice(endIndex, 0, movedId!);
      upsertGridColumnsState(gridId, (draft) => {
        draft.order = newOrder;
      });
    },
    [gridId, finalColumns, hydrated, enableColumnManagement],
  );

  // --- Context Menu Actions ---
  const handleColumnSort = useCallback(
    (columnId: string) => {
      if (enableSorting) {
        toggleSort(columnId, false);
      }
      contextMenuTargetRef.current = null;
    },
    [enableSorting, toggleSort],
  );

  const handleColumnHide = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(gridId, (draft) => {
        draft.visibility[columnId] = false;
      });
      contextMenuTargetRef.current = null;
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const handlePinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      if (!enableRowPinning) return;
      for (const key of rowKeys) {
        pinRow(key);
      }
      contextMenuTargetRef.current = null;
    },
    [enableRowPinning, pinRow],
  );

  const handleUnpinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      if (!enableRowPinning) return;
      for (const key of rowKeys) {
        unpinRow(key);
      }
      contextMenuTargetRef.current = null;
    },
    [enableRowPinning, unpinRow],
  );

  const handleClearSort = useCallback(
    (columnId: string) => {
      if (!enableSorting) return;
      // Toggle sort clears if already sorted, so we toggle twice to clear
      toggleSort(columnId, false);
      toggleSort(columnId, false);
      contextMenuTargetRef.current = null;
    },
    [enableSorting, toggleSort],
  );

  const handlePinColumn = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(gridId, (draft) => {
        if (!draft.pinned.includes(columnId)) {
          draft.pinned.push(columnId);
        }
      });
      contextMenuTargetRef.current = null;
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const handleUnpinColumn = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(gridId, (draft) => {
        draft.pinned = draft.pinned.filter((id: string) => id !== columnId);
      });
      contextMenuTargetRef.current = null;
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const handleToggleColumnVisibility = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(gridId, (draft) => {
        const currentVisible = draft.visibility[columnId] !== false;
        draft.visibility[columnId] = !currentVisible;
      });
      contextMenuTargetRef.current = null;
    },
    [gridId, hydrated, enableColumnManagement],
  );

  const handleShowAllColumns = useCallback(() => {
    if (!hydrated || !enableColumnManagement) return;
    upsertGridColumnsState(gridId, (draft) => {
      // Clear all visibility settings (everything visible by default)
      draft.visibility = {};
    });
    contextMenuTargetRef.current = null;
  }, [gridId, hydrated, enableColumnManagement]);

  // --- Render ---
  return (
    <div
      ref={wrapperRef}
      className={cn("flex flex-col h-full outline-none", className)}
      data-testid="base-datagrid"
    >
      {/* Top slot - paradigm-specific toolbar */}
      {topToolbar}

      {/* Quick Filter + Toolbar Actions */}
      {((enableFiltering && filterColumns.length > 0) || toolbarActions) && (
        <div className="flex items-center gap-2 py-1.5">
          {enableFiltering && filterColumns.length > 0 && (
            <div className="flex-1 min-w-0">
              <QuickFilter
                ref={quickFilterRef}
                columns={filterColumns}
                value={quickFilterValue}
                mode={quickFilterMode}
                onValueChange={setQuickFilterValue}
                onModeChange={setQuickFilterMode}
                onSubmit={handleFilterSubmit}
                isLoading={isAIFilterLoading}
                error={quickFilterError}
                explanation={aiExplanation}
                clientSideFiltering={false}
              />
            </div>
          )}
          {toolbarActions && (
            <div className="shrink-0 flex items-center gap-1.5">
              {toolbarActions}
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {error ? (
        <div className="flex-1 min-h-0">
          <DataGridErrorState
            error={error}
            onReload={onRefetch}
            onReconnect={onReconnect}
          />
        </div>
      ) : (
        /* Main grid with context menu */
        <div
          ref={containerRef}
          className="flex-1 px-1 min-h-0"
          onFocusCapture={handleFocusCapture}
          onBlurCapture={handleBlurCapture}
        >
          <UnifiedContextMenu
            selectedRows={selectedRowsData}
            selectedRowKeys={selectedRowKeys}
            allRows={deferredDisplayRows}
            columns={finalColumns}
            pinnedRowKeys={pinnedRowIds}
            tableName={tableName}
            schema={schema}
            databaseType={databaseType as any}
            onPinRows={handlePinRowsFromMenu}
            onUnpinRows={handleUnpinRowsFromMenu}
            // CRUD operations (internally managed)
            onAddRow={commandFactory && !readOnly ? handleAddRow : undefined}
            onInsertRowAbove={
              commandFactory && !readOnly ? handleInsertRowAbove : undefined
            }
            onInsertRowBelow={
              commandFactory && !readOnly ? handleInsertRowBelow : undefined
            }
            onDeleteRows={
              commandFactory && !readOnly ? handleDeleteRows : undefined
            }
            onPaste={commandFactory && !readOnly ? handlePaste : undefined}
            // Filter by column
            onFilterByColumn={
              enableFiltering ? handleFilterByColumn : undefined
            }
            // Details sheet
            showDetailsSheet={showDetailsSheet}
            onShowDetailsSheetChange={setShowDetailsSheet}
            // Column operations
            allColumnsForVisibility={finalColumns}
            pinnedColumns={columnState.pinned}
            columnVisibility={columnState.visibility}
            getSortDirection={getSortDirection}
            onSort={handleColumnSort}
            onClearSort={handleClearSort}
            onHideColumn={handleColumnHide}
            onPinColumn={handlePinColumn}
            onUnpinColumn={handleUnpinColumn}
            onToggleColumnVisibility={handleToggleColumnVisibility}
            onShowAllColumns={handleShowAllColumns}
            contextMenuTargetRef={contextMenuTargetRef}
            connectionId={connectionId}
            referencedTableColumns={referencedTableColumns ?? {}}
          >
            <EditableDataGrid
              ref={gridRef}
              tableKey={gridId}
              rows={deferredDisplayRows}
              columns={finalColumns}
              getCellContent={getCellContent}
              drawHeader={drawHeader}
              drawCell={effectiveDrawCell}
              getRowThemeOverride={getRowThemeOverride}
              freezeColumns={enableColumnManagement ? freezeColumns : 0}
              gridSelection={gridSelection}
              onSelectionChange={handleGridSelectionChange}
              onCellActivated={onCellActivated}
              onCellEditStart={handleCellEditStart}
              onCellEditCancel={handleCellEditCancel}
              onCellEditCommit={
                (commandFactory || onCellEditCommitCallback) && !readOnly
                  ? handleCellEditCommitWrapper
                  : undefined
              }
              onColumnResize={
                enableColumnManagement ? handleColumnResize : undefined
              }
              onColumnResizeEnd={
                enableColumnManagement
                  ? (column, size) => {
                      handleColumnResizeEnd(column, size);
                      flushWidths(columnWidths);
                    }
                  : undefined
              }
              onColumnMoved={
                enableColumnManagement ? handleColumnMoved : undefined
              }
              onHeaderClicked={handleHeaderClicked}
              onItemHovered={handleItemHovered}
              onVisibleRegionChanged={handleVisibleRegionChanged}
              maxColumnWidth={1000}
            />
          </UnifiedContextMenu>
        </div>
      )}

      {/* FK Preview - either external or internal */}
      {fkPreviewComponent}
      {/* Internal FK preview when no external is provided and we have a preview state */}
      {!fkPreviewComponent &&
        paradigm === "sql" &&
        fkPreviewState &&
        !isEditingCell && (
          <FKPreviewPopover
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                clearFkPreview();
              }
            }}
            fkReference={fkPreviewState.fkReference}
            fkValue={fkPreviewState.fkValue}
            connectionId={connectionId}
            database={database ?? ""}
            cellBounds={fkPreviewState.cellBounds}
            sourceColumnName={finalColumns[fkPreviewState.col]?.name}
            sourceTable={tableName ?? ""}
            sourceSchema={schema ?? "public"}
            onOpenReference={() => {
              const { fkReference, fkValue } = fkPreviewState;
              let filterValue: string;
              if (fkValue === null) {
                filterValue = `"${fkReference.referenced_column}" IS NULL`;
              } else if (typeof fkValue === "string") {
                const escaped = String(fkValue).replace(/'/g, "''");
                filterValue = `"${fkReference.referenced_column}" = '${escaped}'`;
              } else if (
                typeof fkValue === "number" ||
                typeof fkValue === "boolean"
              ) {
                filterValue = `"${fkReference.referenced_column}" = ${fkValue}`;
              } else {
                const escaped = String(fkValue).replace(/'/g, "''");
                filterValue = `"${fkReference.referenced_column}" = '${escaped}'`;
              }

              openTableObject({
                table: {
                  name: fkReference.referenced_table,
                  schema: fkReference.referenced_schema,
                  kind: "Table",
                },
                connectionId,
                database: database ?? "",
                viewType: "data",
                initialFilter: filterValue,
              });
              clearFkPreview();
            }}
          />
        )}

      {/* Bottom slot - paradigm-specific */}
      {bottomToolbar}

      {/* Status bar */}
      <DataGridStatusBar
        loadedRows={deferredDisplayRows.length}
        estimatedTotal={props.estimatedTotal}
        isEstimatedCount={props.isEstimatedCount}
        hasMore={props.hasMore}
        isStreaming={props.isLoadingMore}
        selectedRows={selectedRowCount}
        selectedRowsData={selectedRowsData}
        selectedRowIndices={selectedRowsSet}
        allRows={deferredDisplayRows}
        columns={finalColumns}
        gridSelection={gridSelection as any}
        readOnlyReason={readOnlyReason}
        onRefreshMaterializedView={onRefreshMaterializedView}
        isRefreshingMatView={isRefreshingMatView}
        // Query performance metrics
        executionTime={props.executionTime}
        networkMs={props.networkMs}
        conversionMs={props.conversionMs}
        fetchCount={props.fetchCount}
        cursorSetupMs={props.cursorSetupMs}
        totalStreamingMs={props.totalStreamingMs}
      />
    </div>
  );
});
