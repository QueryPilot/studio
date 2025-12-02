import { logger } from "@/lib/logger";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import type { FocusEvent } from "react";
import type {
  GridSelection,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";
import { GridCellKind, CompactSelection } from "@glideapps/glide-data-grid";
import { EditableDataGrid, type EditableDataGridRef } from "../base";
import type { GridColumnV2, GridRowModel } from "../types";
import { useTableDataQuery } from "@/hooks/useTableDataQuery";
import { buildGridCellV2 } from "../utils/cellFactory";
import { truncateTextToWidth } from "../utils/textUtils";
import {
  DataGridEmptyState,
  DataGridErrorState,
} from "../components/DataGridStates";
import { DataGridSkeleton } from "../components/DataGridSkeleton";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { StagingActionsToolbar } from "../components/StagingActionsToolbar";
import { QuickFilter, type QuickFilterRef } from "../components/QuickFilter";
import { useAIFilter } from "../hooks/useAIFilter";
import { type FilterColumnInfo } from "@/utils/filterParser";
import { openTableObject } from "@/utils/workbench/openers";
import { DbType, type SortConfig, type CellValue as FrontCellValue, type ColumnMeta, type JsonValue } from "@/types";
import {
  usePersistentViewState,
  useClipboardBridge,
  useStagedChangesIndicator,
  hasStagedCellChange,
  isRowPendingDeletion,
  isRowPendingInsertion,
  useCellHoverIcons,
  useTableCrud,
  useQuickFilter,
} from "../hooks";
import {
  useGridPreferences,
  useGridPreferencesHydrated,
  upsertGridColumnsState,
  useGridPreferencesStore,
} from "../stores";
import { perfMonitor } from "../utils/performanceMonitor";
import {
  useColumnPinning,
  useColumnSizing,
  useColumnVisibility,
  useRowPinning,
  useColumnSorting,
} from "../hooks";
import { createDrawHeader } from "../utils/headerUtils";
import {
  ColumnHeaderContextMenu,
  useColumnHeaderContextMenu,
} from "../components/ColumnHeaderContextMenu";
import {
  applyPinnedOrdering,
  computeBaseWidth,
  filterVisibleColumns,
  reorderColumns,
} from "./columnUtils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
import type { CellValue as BackendCellValue } from "@/services/backend";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { cn } from "@/lib/utils";
import { GridContextMenu } from "../components/GridContextMenu";
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import { useCommand } from "@/hooks/useCommand";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  createInsertCommand,
  createCrudTarget,
} from "../utils/crudHelpers";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { deriveValueType, normalizeBackendValue } from "@/services/tableDataTransform";

interface BaseTableDataGridV2Props {
  gridId: string;
  className?: string;
}

interface TableModeProps extends BaseTableDataGridV2Props {
  mode: "table";
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  onActionsChange?: (actions: React.ReactNode) => void;
  /** Initial WHERE clause filter to apply (e.g., from FK reference navigation) */
  initialFilter?: string;
  /** Panel ID for FK reference navigation (to reuse tabs in the same panel) */
  panelId?: string;
}

interface QueryModeProps extends BaseTableDataGridV2Props {
  mode: "query";
  data?: {
    columns: string[];
    columnMeta?: ColumnMeta[];
    rows: unknown[][];
  };
  isLoading?: boolean;
  error?: string | null;
  executionTime?: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
  isStreaming?: boolean;
}

export type TableDataGridV2Props = TableModeProps | QueryModeProps;

const DEFAULT_COLUMN_STATE = {
  order: [] as string[],
  widths: {} as Record<string, number>,
  visibility: {} as Record<string, boolean>,
  pinned: [] as string[],
};

export const TableDataGridV2 = memo(function TableDataGridV2(
  props: TableDataGridV2Props,
) {
  const { gridId, className } = props;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<EditableDataGridRef>(null);
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [isEditingCell, setIsEditingCell] = useState(false);
  const scopeId = useScopedKeybindings(gridId);
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);

  // Get initial filter and panel ID from props (table mode only)
  const initialFilter =
    props.mode === "table" ? props.initialFilter : undefined;
  const panelId = props.mode === "table" ? props.panelId : undefined;

  useContextKey("dataGridFocus", isGridFocused, {
    scopeId,
    resetOnUnmount: true,
  });

  const handleContainerClick = useCallback(() => {
    if (isEditingCell) return;
    if (gridRef.current) {
      gridRef.current.focus();
    }
  }, [isEditingCell]);

  const handleFocusCapture = useCallback(() => {
    setIsGridFocused(true);
  }, []);

  const handleBlurCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!containerRef.current) {
        setIsGridFocused(false);
        return;
      }
      if (!nextTarget || !containerRef.current.contains(nextTarget)) {
        setIsGridFocused(false);
      }
    },
    [],
  );

  const isTableMode = props.mode === "table";
  const isQueryMode = props.mode === "query";

  const connectionId = isTableMode ? props.connectionId : "";
  const database = isTableMode ? props.database : "";
  const table = isTableMode ? props.table : "";
  const schema = isTableMode ? props.schema : undefined;
  const onActionsChange = isTableMode ? props.onActionsChange : undefined;
  const isView = isTableMode ? props.isView || false : false;
  const kind = isTableMode ? props.kind : undefined;

  const entityType: "table" | "view" | "materialized_view" = isTableMode
    ? kind === "MaterializedView"
      ? "materialized_view"
      : kind === "View" || isView
      ? "view"
      : "table"
    : "table";

  useContextKey("dataGridEditable", isTableMode, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("editingCell", isEditingCell, {
    scopeId,
    resetOnUnmount: true,
  });

  // Load table structure to determine default sorting
  const { structure: tableStructure } = useTableFullStructure({
    connectionId: isTableMode ? props.connectionId : "",
    database: isTableMode ? props.database : "",
    table: isTableMode ? props.table : "",
    schema: isTableMode ? props.schema : undefined,
    options: {
      includeIndexes: false,
      includeConstraints: true, // Required for FK data
      includeTriggers: false,
      includeStatistics: false,
      includeForeignKeys: true,
    },
    enabled: isTableMode,
  });

  // Get user-defined sort columns from store
  const userSortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns,
  );

  // Convert user sort columns to SortConfig format for backend query
  const userSorts = useMemo<SortConfig[] | undefined>(() => {
    if (!userSortColumns || userSortColumns.length === 0) return undefined;
    return userSortColumns.map((sc) => ({
      column: sc.columnId,
      direction: sc.direction,
    }));
  }, [userSortColumns]);

  // Determine default sort order: primary key (ASC) > created_at (DESC) > first column (ASC)
  const defaultSorts = useMemo(() => {
    if (
      !isTableMode ||
      !tableStructure?.columns ||
      tableStructure.columns.length === 0
    ) {
      return undefined;
    }

    // Priority 1: Primary key column (ascending)
    const pkColumn = tableStructure.columns.find((col) => col.is_pk);
    if (pkColumn) {
      return [{ column: pkColumn.name, direction: "asc" as const }];
    }

    // Priority 2: created_at column (descending to show newest first)
    const createdAtColumn = tableStructure.columns.find(
      (col) => col.name === "created_at" || col.name === "createdAt",
    );
    if (createdAtColumn) {
      return [{ column: createdAtColumn.name, direction: "desc" as const }];
    }

    // Priority 3: First column (ascending)
    const firstColumn = tableStructure.columns[0];
    if (firstColumn) {
      return [{ column: firstColumn.name, direction: "asc" as const }];
    }

    return undefined;
  }, [isTableMode, tableStructure?.columns]);

  // Get connection info for dialect detection (moved before filter hooks)
  const storedConnection = useConnectionStore(
    (state) => state.connections.find((c) => c.profile.id === connectionId)
  );

  // Map DbType to dialect for AI filter
  const dialect = useMemo((): "postgresql" | "mysql" | "sqlite" | "mssql" => {
    const dbType = storedConnection?.profile.db_type;
    switch (dbType) {
      case DbType.PostgreSQL:
        return "postgresql";
      case DbType.MySQL:
        return "mysql";
      case DbType.SQLite:
        return "sqlite";
      case DbType.SQLServer:
        return "mssql";
      default:
        return "postgresql";
    }
  }, [storedConnection?.profile.db_type]);

  // Build filter columns from tableStructure (available before query)
  // This allows useQuickFilter to be called before tableDataQuery
  const filterColumns = useMemo<FilterColumnInfo[]>(() => {
    if (!tableStructure?.columns) return [];

    // Build FK lookup from tableStructure
    const fkMap = new Map<string, { table: string; column: string }>();
    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        for (let i = 0; i < fk.columns.length; i++) {
          const sourceCol = fk.columns[i];
          const targetCol = fk.foreignColumns[i];
          if (sourceCol && targetCol) {
            fkMap.set(sourceCol, {
              table: fk.foreignTable,
              column: targetCol,
            });
          }
        }
      }
    }

    return tableStructure.columns.map((col) => {
      const fkInfo = fkMap.get(col.name);
      return {
        name: col.name,
        dataType: col.db_type,
        nullable: col.nullable,
        enumValues: col.enum_values,
        isPrimaryKey: col.is_pk,
        isForeignKey: !!fkInfo,
        foreignTable: fkInfo?.table,
        foreignColumn: fkInfo?.column,
      };
    });
  }, [tableStructure?.columns, tableStructure?.foreignKeys]);

  // AI filter hook with proper connection context
  const { generateFilter: generateAIFilter, isLoading: isAIFilterLoading } =
    useAIFilter(filterColumns, table, dialect, {
      connectionId,
      schema,
      enableCrossTable: true,
    });

  // Quick filter hook - manages filter state, parsing, and submission
  // Called before tableDataQuery to provide activeFilter
  const {
    value: quickFilterValue,
    mode: quickFilterMode,
    error: quickFilterError,
    aiExplanation,
    activeFilter,
    setValue: setQuickFilterValue,
    setMode: setQuickFilterMode,
    submit: handleFilterSubmit,
    clear: clearFilter,
  } = useQuickFilter({
    columns: filterColumns,
    initialFilter,
    generateAIFilter,
  });

  const tableDataQuery = useTableDataQuery({
    connectionId,
    database,
    schema,
    entityName: table,
    entityType,
    enabled: isTableMode,
    pageSize: 300,
    sorts: userSorts ?? defaultSorts,
    filters: activeFilter,
  });

  // IconKeyboard shortcuts for focusing quick filter (Cmd+F or /)
  useEffect(() => {
    if (!isTableMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this panel has focus (activeElement is within wrapperRef)
      const hasFocus =
        wrapperRef.current?.contains(document.activeElement) ||
        document.activeElement === wrapperRef.current;
      if (!hasFocus) return;

      // Cmd+F or Ctrl+F
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        quickFilterRef.current?.focus();
        return;
      }
      // / key (when not in input or contenteditable - e.g., CodeMirror)
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !(document.activeElement as HTMLElement)?.isContentEditable &&
        !document.activeElement?.closest(".cm-editor")
      ) {
        e.preventDefault();
        quickFilterRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTableMode]);

  useEffect(() => {
    if (!isTableMode) {
      return;
    }
    const cancelStream = tableDataQuery.cancelStream;
    return () => {
      cancelStream();
    };
  }, [isTableMode, tableDataQuery.cancelStream]);

  // Subscribe to data invalidation events for this table
  // Use refs to avoid recreating subscription on every render
  const tableDataQueryRef = useRef(tableDataQuery);
  tableDataQueryRef.current = tableDataQuery;

  useEffect(() => {
    if (!isTableMode) return;

    const unsubscribe = useDataInvalidationStore
      .getState()
      .subscribe(
        connectionId,
        database,
        schema ?? "public",
        table,
        async () => {
          await tableDataQueryRef.current.refetch();
          const { clearCommittedChanges, getTableKey } =
            useCrudStore.getState();
          const tableKey = getTableKey({
            connectionId,
            database,
            schema: schema ?? "public",
            table,
          });
          clearCommittedChanges(tableKey);
        },
      );

    return unsubscribe;
  }, [isTableMode, connectionId, database, schema, table]);

  const queryData = isQueryMode ? props.data : null;

  // Transform raw CellValue[][] to TableDataRow[] for query mode
  // The streaming worker returns raw arrays; we need to convert to objects keyed by column names
  const transformedQueryRows = useMemo((): GridRowModel[] => {
    if (!queryData?.rows || !queryData?.columnMeta) {
      return [];
    }
    const rows = queryData.rows;
    const columns = queryData.columnMeta;
    // Check if already transformed (first row is an object with column keys)
    const firstRow = rows[0];
    if (firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)) {
      // Already in TableDataRow format
      return rows as unknown as GridRowModel[];
    }
    // Transform raw arrays to objects keyed by column names
    return (rows as unknown as BackendCellValue[][]).map((row) => {
      const tableRow: GridRowModel = {};
      columns.forEach((col, index) => {
        const rawValue = row[index];
        const normalizedValue = normalizeBackendValue(rawValue);
        tableRow[col.name] = {
          value: normalizedValue ?? null,
          db_type: col.db_type,
          value_type: deriveValueType(rawValue, col.db_type),
          is_truncated: false,
          metadata:
            typeof rawValue === "bigint"
              ? { attributes: { originalBigInt: rawValue.toString() } }
              : undefined,
        };
      });
      return tableRow;
    });
  }, [queryData?.rows, queryData?.columnMeta]);

  const {
    isLoading,
    isLoadingMore,
    error,
    columns: columnMeta,
    rows: dataRows,
    estimatedTotal,
    executionTime,
    cursorSetupMs,
    totalStreamingMs,
    fetchCount,
    networkMs,
    conversionMs,
    loadMore,
    hasNextPage,
  } = isTableMode
    ? {
        // Show loading state when fetching initial data (status loading or fetching without any pages yet)
        isLoading:
          tableDataQuery.status === "loading" ||
          (tableDataQuery.isFetching &&
            !tableDataQuery.isFetchingNextPage &&
            tableDataQuery.rows.length === 0),
        isLoadingMore: tableDataQuery.isFetchingNextPage,
        error:
          tableDataQuery.error instanceof Error
            ? tableDataQuery.error.message
            : typeof tableDataQuery.error === "string"
            ? tableDataQuery.error
            : null,
        columns: tableDataQuery.columns,
        rows: tableDataQuery.rows,
        estimatedTotal:
          tableDataQuery.data?.pages.at(-1)?.estimatedTotal ??
          tableDataQuery.data?.pages[0]?.estimatedTotal ??
          tableDataQuery.rows.length,
        executionTime:
          tableDataQuery.data?.pages.at(-1)?.executionTimeMs ??
          tableDataQuery.data?.pages[0]?.executionTimeMs,
        cursorSetupMs: undefined,
        totalStreamingMs: undefined,
        fetchCount: undefined,
        networkMs: undefined,
        conversionMs: undefined,
        loadMore: tableDataQuery.hasNextPage
          ? () => tableDataQuery.fetchNextPage()
          : undefined,
        hasNextPage: tableDataQuery.hasNextPage,
      }
    : {
        isLoading: props.isLoading ?? false,
        isLoadingMore: props.isStreaming ?? false,
        error: props.error ?? null,
        columns: queryData?.columnMeta ?? [],
        rows: transformedQueryRows,
        estimatedTotal: undefined,
        executionTime: props.executionTime,
        cursorSetupMs: props.cursorSetupMs,
        totalStreamingMs: props.totalStreamingMs,
        fetchCount: props.fetchCount,
        networkMs: props.networkMs,
        conversionMs: props.conversionMs,
        loadMore: undefined,
        hasNextPage: false,
      };

  const structureMetaByName = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof tableStructure>["columns"][number]
    >();
    if (tableStructure?.columns) {
      for (const col of tableStructure.columns) {
        map.set(col.name, col);
      }
    }
    return map;
  }, [tableStructure?.columns]);

  // Build FK reference map by column name
  const fkReferenceByColumn = useMemo(() => {
    const map = new Map<
      string,
      {
        referenced_schema: string;
        referenced_table: string;
        referenced_column: string;
      }
    >();

    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        // Map each column in the FK to its reference
        if (fk.columns && fk.foreignColumns) {
          for (let i = 0; i < fk.columns.length; i++) {
            const colName = fk.columns[i];
            const refCol = fk.foreignColumns[i];
            if (colName && refCol) {
              map.set(colName, {
                referenced_schema: fk.foreignSchema ?? "public",
                referenced_table: fk.foreignTable,
                referenced_column: refCol,
              });
            }
          }
        }
      }
    }
    return map;
  }, [tableStructure?.foreignKeys]);

  const primaryKeyColumns = useMemo(() => {
    if (!tableStructure?.columns) {
      return [];
    }
    return tableStructure.columns
      .filter((col) => col.is_pk)
      .map((col) => col.name);
  }, [tableStructure?.columns]);

  const rowKeyMapRef = useRef(new WeakMap<GridRowModel, string>());
  const draftRowCounterRef = useRef(0);

  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number) => {
      if (!row) {
        return `${schema ?? "public"}.${table}:row-${index}`;
      }
      const cached = rowKeyMapRef.current.get(row);
      if (cached) {
        return cached;
      }
      const parts = primaryKeyColumns.map((columnName) => {
        const cell = row[columnName];
        const value = cell?.value;
        if (value === null || value === undefined) return "__null__";
        if (typeof value !== "object") return String(value);
        // Fast object-to-string for common types (avoids JSON.stringify)
        if (Array.isArray(value)) {
          return `[${value.map((v) => (v == null ? "null" : String(v))).join(",")}]`;
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        // For other objects, use a simple key concatenation
        const keys = Object.keys(value as Record<string, unknown>);
        if (keys.length <= 4) {
          const obj = value as Record<string, unknown>;
          return `{${keys.map((k) => `${k}:${obj[k] == null ? "null" : String(obj[k])}`).join(",")}}`;
        }
        // Fallback for complex objects
        return String(value);
      });
      let computed = `${
        schema ?? "public"
      }.${table}:row-${draftRowCounterRef.current++}`;
      if (
        primaryKeyColumns.length > 0 &&
        parts.some((part) => part !== "__null__")
      ) {
        computed = `${schema ?? "public"}.${table}:pk:${parts.join("|")}`;
      }
      rowKeyMapRef.current.set(row, computed);
      return computed;
    },
    [primaryKeyColumns, schema, table],
  );

  const [rows, setRows] = useState<GridRowModel[]>([]);

  useEffect(() => {
    // Only update rows when we have data to prevent flashing during refetch
    if (dataRows.length > 0 || !isLoading) {
      setRows(dataRows);
    }
  }, [dataRows, isLoading]);

  const preferences = useGridPreferences(gridId);
  const hydrated = useGridPreferencesHydrated();
  const { persistSelection, persistScrollOffset, persistActiveCell } =
    usePersistentViewState(gridId);

  // CRUD Store integration
  const { stageCommand, getTableKey, stagedCommands } = useCrudStore();

  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    undefined,
  );

  // Use ref to provide latest gridSelection to command handlers without causing re-registration
  const gridSelectionRef = useRef<GridSelection | undefined>(gridSelection);
  gridSelectionRef.current = gridSelection;

  const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } =
    useRowPinning({
      rows,
      initialPinned: preferences?.pinnedRows ?? [],
      maxPinnedRows: 5,
      getRowId: getRowKey,
      onChange: (ids) => {
        if (!hydrated) return;
        useGridPreferencesStore.getState().updatePinnedRows(gridId, () => ids);
      },
    });

  const displayRows = useMemo(
    () => [...pinnedRows, ...unpinnedRows],
    [pinnedRows, unpinnedRows],
  );

  // Get table key and pending changes for toolbar
  const tableKey = isTableMode
    ? getTableKey({ connectionId, database, schema, table })
    : "";
  const pendingChanges = isTableMode ? stagedCommands.get(tableKey) ?? [] : [];

  const handlePinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      rowKeys.forEach((key) => {
        pinRow(key);
      });
    },
    [pinRow],
  );

  const handleUnpinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      rowKeys.forEach((key) => {
        unpinRow(key);
      });
    },
    [unpinRow],
  );

  const columnState = preferences?.columns ?? DEFAULT_COLUMN_STATE;

  useEffect(() => {
    if (!hydrated || columnMeta.length === 0) return;

    const expectedOrder = columnMeta.map((column) => column.name || "");
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
  }, [columnMeta, columnState.order.length, gridId, hydrated]);

  const baseColumns = useMemo<GridColumnV2[]>(
    () =>
      columnMeta.map((meta, index) => {
        const id = meta.name || `col_${index}`;
        const structMeta = structureMetaByName.get(meta.name);
        const fkRef = fkReferenceByColumn.get(meta.name);
        const mergedMeta = structMeta
          ? ({
              ...meta,
              enum_values: structMeta.enum_values ?? meta.enum_values,
              type_category: structMeta.type_category ?? meta.type_category,
              // Add FK reference if available
              fk_reference: fkRef ?? undefined,
            } as typeof meta & { fk_reference?: typeof fkRef })
          : fkRef
          ? ({ ...meta, fk_reference: fkRef } as typeof meta & {
              fk_reference?: typeof fkRef;
            })
          : meta;
        return {
          id,
          field: meta.name,
          title: meta.name,
          name: meta.name,
          width: computeBaseWidth(meta.name, meta.db_type),
          type: meta.db_type,
          meta: mergedMeta,
        } as GridColumnV2;
      }),
    [columnMeta, structureMetaByName, fkReferenceByColumn],
  );

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order],
  );

  // Batch width persistence - only persist on resize end, not during drag
  const flushWidths = useCallback(
    (widths: Record<string, number>) => {
      const state = useGridPreferencesStore.getState();
      const current = state.preferences[gridId]?.columns.widths ?? {};
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
    [gridId],
  );

  // Get column sizing handlers - widths applied at the end for performance
  const {
    sizedColumns: _sizedColumns,
    columnWidths,
    handleColumnResize,
    handleColumnResizeEnd,
    isDragging: isResizingColumns,
  } = useColumnSizing({
    columns: reorderedColumns,
    initialWidths: columnState.widths,
    // Don't persist during resize - only on resize end
    onChange: undefined,
  });

  // Performance monitoring during resize (development only)
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const isResizing = isResizingColumns();
    if (isResizing) {
      perfMonitor.startFPSMonitoring();
      logger.info("🚀 [DataGrid] Started FPS monitoring during column resize");
      return; // Cleanup not needed when starting monitoring
    }

    if (!perfMonitor) return;

    // Small delay to catch final frames
    const timer = setTimeout(() => {
      const metrics = perfMonitor.stopFPSMonitoring();
      if (metrics.totalFrames > 0) {
        logger.info("📊 [DataGrid] Column resize performance:", {
          fps: `${metrics.fps} fps`,
          avgFrameTime: `${metrics.avgFrameTime}ms`,
          droppedFrames: `${metrics.droppedFrames}/${metrics.totalFrames}`,
          efficiency: `${Math.round(
            (1 - metrics.droppedFrames / metrics.totalFrames) * 100,
          )}%`,
        });
      }
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [isResizingColumns]);

  const handleColumnVisibilityChange = useCallback(
    (visibility: Record<string, boolean>) => {
      setTimeout(() => {
        const state = useGridPreferencesStore.getState();
        const current = state.preferences[gridId]?.columns.visibility ?? {};
        const changed = Object.keys(visibility).some(
          (key) => current[key] !== visibility[key],
        );
        if (!changed) return;
        upsertGridColumnsState(gridId, (draft) => {
          draft.visibility = visibility;
        });
      }, 0);
    },
    [gridId],
  );

  // Use reorderedColumns (without widths) for visibility - stable during resize
  const { visibleColumns } = useColumnVisibility({
    columns: reorderedColumns,
    initialHidden: Object.entries(columnState.visibility)
      .filter(([, visible]) => !visible)
      .map(([id]) => id),
    onChange: handleColumnVisibilityChange,
  });

  const handlePinnedColumnsChange = useCallback(
    (pinned: string[]) => {
      setTimeout(() => {
        const state = useGridPreferencesStore.getState();
        const current = state.preferences[gridId]?.columns.pinned ?? [];
        const changed =
          current.length !== pinned.length ||
          current.some((value, idx) => value !== pinned[idx]);
        if (!changed) return;
        upsertGridColumnsState(gridId, (draft) => {
          draft.pinned = pinned;
        });
      }, 0);
    },
    [gridId],
  );

  useColumnPinning({
    columns: reorderedColumns,
    initialPinned: columnState.pinned,
    onChange: handlePinnedColumnsChange,
  });

  // Compute column order/visibility/pinning - stable during resize
  const { columns: computedColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(
      visibleColumns,
      columnState.visibility,
    );
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [columnState.pinned, columnState.visibility, visibleColumns]);

  // Keep stable columns during transitions to prevent flashing
  const columnsRef = useRef(computedColumns);
  if (computedColumns.length > 0) {
    columnsRef.current = computedColumns;
  }
  const baseColumns2 =
    computedColumns.length > 0 ? computedColumns : columnsRef.current;

  // Apply widths at the END - cache column objects to avoid recreating unchanged ones
  const finalColumnsCache = useRef<Map<string, GridColumnV2>>(new Map());

  const finalColumns = useMemo(() => {
    const cache = finalColumnsCache.current;
    const result = baseColumns2.map((column) => {
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
  }, [baseColumns2, columnWidths]);

  // CRUD operations hook (handles insert, update, delete staging)
  const {
    handleCellEditStart,
    handleCellEditCancel,
    handleCellEditCommit,
    handleRowAppend,
    handleRowDelete,
  } = useTableCrud({
    connectionId,
    database,
    schema,
    table,
    columns: finalColumns,
    gridRef,
    enabled: isTableMode,
    isEditingCell,
    onEditingChange: setIsEditingCell,
  });

  // Column sorting
  const { sortColumns, toggleSort, getSortIndex, getSortDirection } =
    useColumnSorting({
      gridId,
      columns: finalColumns,
    });

  // Header click handler for sorting
  const handleHeaderClicked = useCallback(
    (colIndex: number, event: { shiftKey: boolean }) => {
      const column = finalColumns[colIndex];
      if (!column) return;
      toggleSort(column.id, event.shiftKey);
    },
    [finalColumns, toggleSort],
  );

  // Custom header draw function for sort indicators and column type icons
  const drawHeader = useMemo(
    () =>
      createDrawHeader({
        getSortDirection,
        getSortIndex,
        columns: finalColumns,
        sortedColumnCount: sortColumns.length,
      }),
    [getSortDirection, getSortIndex, finalColumns, sortColumns.length],
  );

  // Column header context menu
  const { handleHeaderContextMenu, menuState, closeMenu, getMenuProps } =
    useColumnHeaderContextMenu({
      columns: finalColumns,
      pinnedColumns: columnState.pinned,
      getSortDirection,
      onSort: (columnId, direction) => {
        // Clear existing sort and set new one
        const store = useGridPreferencesStore.getState();
        store.upsert(gridId, (draft) => {
          draft.sortColumns = [{ columnId, direction }];
        });
      },
      onClearSort: (columnId) => {
        const store = useGridPreferencesStore.getState();
        store.upsert(gridId, (draft) => {
          draft.sortColumns = draft.sortColumns.filter(
            (s) => s.columnId !== columnId,
          );
        });
      },
      onHide: (columnId) => {
        upsertGridColumnsState(gridId, (draft) => {
          draft.visibility[columnId] = false;
        });
      },
      onPin: (columnId) => {
        upsertGridColumnsState(gridId, (draft) => {
          if (!draft.pinned.includes(columnId)) {
            draft.pinned.push(columnId);
          }
        });
      },
      onUnpin: (columnId) => {
        upsertGridColumnsState(gridId, (draft) => {
          draft.pinned = draft.pinned.filter((id) => id !== columnId);
        });
      },
      onFilterByColumn: isTableMode
        ? (columnId) => {
            setQuickFilterValue(`${columnId}:`);
            quickFilterRef.current?.focus();
          }
        : undefined,
    });

  const contextMenuProps = getMenuProps();

  // Pre-build column lookup map for O(1) access (used in INSERT row building)
  const columnByFieldMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    for (const col of finalColumns) {
      map.set(col.field, col);
    }
    return map;
  }, [finalColumns]);

  // Apply optimistic updates from staged commands to display rows
  // Optimized: O(N+M) instead of O(N×M) using index-based lookup
  // Further optimized: Only create new row objects for rows that actually changed
  const displayRowsWithOptimisticUpdates = useMemo(() => {
    if (!isTableMode) {
      return displayRows;
    }

    const tableKey = getTableKey({ connectionId, database, schema, table });
    const commands = stagedCommands.get(tableKey) ?? [];

    if (commands.length === 0) {
      return displayRows;
    }

    // Build index: PK signature → array of UPDATE commands (O(M) where M = commands)
    const updateCommandsByPK = new Map<
      string,
      Array<{ column: string; newValue: unknown }>
    >();

    for (const cmd of commands) {
      if (cmd.type !== "data.update") continue;
      const payload = cmd.payload as {
        primaryKeys?: Record<string, unknown>;
        column?: string;
        newValue?: unknown;
      };
      if (!payload.primaryKeys || !payload.column) continue;

      // Create stable PK signature from sorted keys
      const pkEntries = Object.entries(payload.primaryKeys).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const pkSig = pkEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("|");

      if (!updateCommandsByPK.has(pkSig)) {
        updateCommandsByPK.set(pkSig, []);
      }
      updateCommandsByPK.get(pkSig)!.push({
        column: payload.column,
        newValue: payload.newValue,
      });
    }

    // Apply UPDATE commands - only create new objects for modified rows
    let updatedRows: GridRowModel[];
    if (updateCommandsByPK.size === 0) {
      updatedRows = displayRows;
    } else {
      // Pre-compute PK signatures for ALL rows once (avoids repeated computation)
      const rowPkSignatures = displayRows.map((row) => {
        const pkEntries = primaryKeyColumns
          .map((colName) => {
            const cell = row[colName];
            const value =
              cell && typeof cell === "object" && "value" in cell
                ? cell.value
                : undefined;
            return [colName, value] as [string, unknown];
          })
          .sort(([a], [b]) => a.localeCompare(b));
        return pkEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("|");
      });

      // Check if ANY rows need updates before mapping
      const hasUpdates = rowPkSignatures.some((sig) =>
        updateCommandsByPK.has(sig),
      );

      if (!hasUpdates) {
        updatedRows = displayRows;
      } else {
        updatedRows = displayRows.map((row, idx) => {
          const pkSig = rowPkSignatures[idx] ?? "";
          const updates = updateCommandsByPK.get(pkSig);
          if (!updates || updates.length === 0) {
            return row; // Return original reference - no copy needed
          }

          // Only create new object for rows that actually changed
          const updatedRow = { ...row };
          for (const { column, newValue } of updates) {
            if (column in updatedRow) {
              const existingCell = updatedRow[column];
              if (
                existingCell &&
                typeof existingCell === "object" &&
                "value" in existingCell
              ) {
                updatedRow[column] = {
                  ...existingCell,
                  value: newValue,
                };
              }
            }
          }
          return updatedRow;
        });
      }
    }

    // Collect INSERT commands
    const insertCommands = commands.filter((cmd) => cmd.type === "data.insert");
    if (insertCommands.length === 0) {
      return updatedRows;
    }

    // Build result array with inserts at correct positions
    const result = [...updatedRows];

    // Pre-build row key index for O(1) lookup during insert positioning
    const rowKeyToIndex = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
      rowKeyToIndex.set(getRowKey(result[i], i), i);
    }

    // Track offset as we insert (positions shift)
    let insertOffset = 0;

    for (const cmd of insertCommands) {
      const payload = cmd.payload as {
        values?: Record<string, JsonValue>;
        tempId?: string;
      };

      // Build a complete row with ALL columns from schema
      const row: GridRowModel = {};

      // Populate ALL columns with NULL defaults using pre-built column map
      for (const col of finalColumns) {
        const dbType = col.meta?.db_type ?? col.type ?? "text";
        row[col.field] = {
          value: null,
          value_type: "Null",
          db_type: dbType,
          is_truncated: false,
        };
      }

      // Track the INSERT command's tempId for linking UPDATE commands
      const insertTempId = payload.tempId || cmd.id;
      row["__insert_temp_id__"] = {
        value: insertTempId,
        value_type: "Text",
        db_type: "text",
        is_truncated: false,
      } as FrontCellValue;

      // Overlay the actual values from the INSERT command
      if (payload.values) {
        for (const [key, value] of Object.entries(payload.values)) {
          // O(1) lookup instead of .find()
          const column = columnByFieldMap.get(key);
          const dbType = column?.meta?.db_type ?? column?.type ?? "text";

          let valueType: FrontCellValue["value_type"] = "Text";
          if (value === null) {
            valueType = "Null";
          } else if (typeof value === "number") {
            valueType = Number.isInteger(value) ? "Integer" : "Decimal";
          } else if (typeof value === "boolean") {
            valueType = "Boolean";
          }

          row[key] = {
            value,
            value_type: valueType,
            db_type: dbType,
            is_truncated: false,
          };
        }
      }

      // Insert at specified position or top
      const insertAfterRowKey = cmd.metadata.insertAfterRowKey;
      if (insertAfterRowKey) {
        const targetIndex = rowKeyToIndex.get(insertAfterRowKey);
        if (targetIndex !== undefined) {
          result.splice(targetIndex + 1 + insertOffset, 0, row);
          insertOffset++;
        } else {
          result.unshift(row);
          insertOffset++;
        }
      } else {
        result.unshift(row);
        insertOffset++;
      }
    }

    return result;
  }, [
    displayRows,
    isTableMode,
    getTableKey,
    getRowKey,
    stagedCommands,
    connectionId,
    database,
    schema,
    table,
    finalColumns,
    primaryKeyColumns,
    columnByFieldMap,
  ]);

  // Auto-select first cell when grid gains focus with no existing selection
  // Use a small delay to let click-based selections settle first
  useEffect(() => {
    if (!isGridFocused || !gridRef.current) {
      return;
    }

    // IconCheck current selection state before setting timeout
    // This prevents infinite loops when gridSelection updates
    const hasExistingSelection =
      (gridSelection?.rows && gridSelection.rows.length > 0) ||
      (gridSelection?.columns && gridSelection.columns.length > 0) ||
      gridSelection?.current !== undefined;

    if (
      hasExistingSelection ||
      displayRows.length === 0 ||
      finalColumns.length === 0
    ) {
      return;
    }

    // Delay to allow click-based selection to be set first
    const timeoutId = setTimeout(() => {
      // Use functional setState to get current selection state
      // This avoids stale closure issues
      setGridSelection((currentSelection) => {
        // Double-check there's still no selection
        const stillNoSelection =
          !currentSelection?.current &&
          (!currentSelection?.rows || currentSelection.rows.length === 0) &&
          (!currentSelection?.columns || currentSelection.columns.length === 0);

        if (!stillNoSelection) {
          return currentSelection;
        }

        // Scroll to ensure first cell is visible
        requestAnimationFrame(() => {
          if (gridRef.current) {
            gridRef.current.scrollTo(0, 0);
          }
        });

        // Select the first cell (row 0, column 0)
        return {
          current: {
            cell: [0, 0],
            range: { x: 0, y: 0, width: 1, height: 1 },
            rangeStack: [],
          },
          rows: CompactSelection.empty(),
          columns: CompactSelection.empty(),
        };
      });
    }, 50); // Small delay to let click selection settle

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isGridFocused, gridId, displayRows.length, finalColumns.length]);

  // Defer grid rendering for large datasets to keep UI responsive
  // Grid updates in background without blocking interactions
  const deferredDisplayRows = useDeferredValue(
    displayRowsWithOptimisticUpdates,
  );

  const rowsRef = useRef(deferredDisplayRows);
  rowsRef.current = deferredDisplayRows;

  // Track finalColumns in ref for stable access in getCellContent
  const finalColumnsRef = useRef(finalColumns);
  finalColumnsRef.current = finalColumns;

  // Track staged changes for visual indicators (must be after finalColumns)
  const stagedChanges = useStagedChangesIndicator({
    connectionId,
    database,
    schema: schema ?? "",
    table,
    rows: deferredDisplayRows,
    columns: finalColumns,
  });

  // Track staged changes in ref for stable access in getCellContent
  const stagedChangesRef = useRef(stagedChanges);
  stagedChangesRef.current = stagedChanges;

  // Cell hover icons for quick actions (copy, FK reference)
  const handleOpenReference = useCallback(
    (
      refSchema: string,
      refTable: string,
      refColumn: string,
      value: unknown,
    ) => {
      if (!isTableMode) return;

      // Build the WHERE clause filter
      let filterValue: string;
      if (value === null) {
        filterValue = `"${refColumn}" IS NULL`;
      } else if (typeof value === "string") {
        // Escape single quotes in string values
        const escaped = String(value).replace(/'/g, "''");
        filterValue = `"${refColumn}" = '${escaped}'`;
      } else if (typeof value === "number" || typeof value === "boolean") {
        filterValue = `"${refColumn}" = ${value}`;
      } else {
        // For complex values, convert to string
        const escaped = String(value).replace(/'/g, "''");
        filterValue = `"${refColumn}" = '${escaped}'`;
      }

      // Open the referenced table with the filter
      openTableObject({
        table: {
          name: refTable,
          schema: refSchema,
          kind: "Table",
        },
        connectionId,
        database,
        viewType: "data",
        initialFilter: filterValue,
        sourcePanelId: panelId,
      });
    },
    [isTableMode, connectionId, database, panelId],
  );

  const isLargeDataset = deferredDisplayRows.length > 5000;

  const { onItemHovered: handleItemHovered, drawCell: drawCellWithHoverIcons } =
    useCellHoverIcons({
      columns: finalColumns,
      rows: deferredDisplayRows,
      onOpenReference: isTableMode ? handleOpenReference : undefined,
      enabled: !isLargeDataset,
      containerRef: containerRef,
    });

  // Memoize clipboard callbacks to prevent recreation on every render
  const toTextCallback = useCallback(
    (selection: GridSelection) => {
      // Handle full row selections
      if (selection.rows.length > 0) {
        const selected = selection.rows
          .toArray()
          .map((idx) => rowsRef.current[idx])
          .filter(Boolean);
        if (selected.length === 0) return "";
        const body = selected.map((row) =>
          finalColumns
            .map((col) => {
              const value = row?.[col.field];
              if (!value || typeof value !== "object") return "";
              return String(value.value ?? "");
            })
            .join("\t"),
        );
        return body.join("\n");
      }

      // Handle cell-level selections (rectangular ranges)
      if (selection.current?.range) {
        const { range } = selection.current;
        const { x: startCol, y: startRow, width, height } = range;

        const selectedCols = finalColumns.slice(startCol, startCol + width);

        // Build data rows (no headers)
        const body: string[] = [];
        for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
          const row = rowsRef.current[rowIdx];
          if (!row) continue;

          const rowData = selectedCols
            .map((col) => {
              const value = row[col.field];
              if (!value || typeof value !== "object") return "";
              return String(value.value ?? "");
            })
            .join("\t");
          body.push(rowData);
        }

        return body.join("\n");
      }

      return "";
    },
    [finalColumns],
  );

  const toJsonCallback = useCallback(
    (selection: GridSelection) => {
      // Handle full row selections
      if (selection.rows.length > 0) {
        return selection.rows
          .toArray()
          .map((idx) => rowsRef.current[idx])
          .filter(Boolean)
          .map((row) => {
            const jsonRow: Record<string, unknown> = {};
            finalColumns.forEach((col) => {
              const value = row?.[col.field];
              if (value && typeof value === "object" && "value" in value) {
                const cellValue = value.value;
                jsonRow[col.field] =
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

        const selectedCols = finalColumns.slice(startCol, startCol + width);
        const result: Record<string, unknown>[] = [];

        for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
          const row = rowsRef.current[rowIdx];
          if (!row) continue;

          const jsonRow: Record<string, unknown> = {};
          selectedCols.forEach((col) => {
            const value = row[col.field];
            if (value && typeof value === "object" && "value" in value) {
              const cellValue = value.value;
              jsonRow[col.field] =
                typeof cellValue === "bigint"
                  ? cellValue.toString()
                  : cellValue;
            }
          });
          result.push(jsonRow);
        }

        return result;
      }

      return [];
    },
    [finalColumns],
  );

  const { copySelection } = useClipboardBridge({
    toText: toTextCallback,
    toJson: toJsonCallback,
    onCopySuccess: () => {},
    onCopyError: () => {},
  });

  // CRUD Handlers - Must be after finalColumns is defined

  // Handler: Add new row
  const handleAddRow = useCallback(() => {
    if (!isTableMode) return;

    // Create a new row with default values
    const newRow: GridRowModel = {};
    finalColumns.forEach((col) => {
      // Set default values based on column metadata
      if (col.meta?.default) {
        // Has a default value, leave empty to use DB default
        newRow[col.field] = {
          value: null,
          value_type: "Null",
          db_type: col.meta.db_type,
          is_truncated: false,
        };
      } else if (col.meta?.nullable) {
        // Nullable, default to NULL
        newRow[col.field] = {
          value: null,
          value_type: "Null",
          db_type: col.meta.db_type,
          is_truncated: false,
        };
      } else if (col.meta?.is_pk) {
        // Primary key, will be auto-generated
        newRow[col.field] = {
          value: null,
          value_type: "Null",
          db_type: col.meta.db_type,
          is_truncated: false,
        };
      } else {
        // Non-nullable, set empty value based on type
        newRow[col.field] = {
          value: "",
          value_type: "Text",
          db_type: col.meta?.db_type ?? "text",
          is_truncated: false,
        };
      }
    });

    // Stage the insert command
    const target = createCrudTarget(connectionId, database, schema, table);
    const command = createInsertCommand(newRow, target, finalColumns);
    stageCommand(command);

    toast.success("New row added", {
      description: "Row queued for insert - edit and commit when ready",
    });

    // Auto-scroll and focus on the first cell of the new row
    setTimeout(() => {
      if (gridRef.current) {
        // Scroll to the first row, first editable column
        gridRef.current.scrollTo(0, 0);
        // Focus on the first cell
        const firstEditableCol = finalColumns.findIndex(
          (col) => !col.meta?.is_pk,
        );
        if (firstEditableCol >= 0 && "setFocus" in gridRef.current) {
          (gridRef.current as any).setFocus([firstEditableCol, 0]);
        }
      }
    }, 100); // Small delay to allow the grid to update
  }, [
    isTableMode,
    finalColumns,
    connectionId,
    database,
    schema,
    table,
    stageCommand,
  ]);

  const selectedRowsSet = useMemo(() => {
    const rowsSel = gridSelection ? gridSelection.rows.toArray() : [];
    const set = new Set<number>(rowsSel);
    const sel = gridSelection;
    if (sel) {
      const addRect = (r: Rectangle | undefined) => {
        if (!r) return;
        const start = Math.max(0, r.y);
        const end = Math.max(start, r.y + r.height);
        for (let i = start; i < end; i += 1) set.add(i);
      };
      if (sel.current) {
        addRect(sel.current.range);
        const stack = sel.current.rangeStack as Rectangle[] | undefined;
        (stack || []).forEach(addRect);
      }
    }
    return set;
  }, [gridSelection]);

  const selectedRowCount = selectedRowsSet.size;
  // IconCheck if there's any selection: full rows, columns, or cell ranges
  const hasSelection =
    selectedRowCount > 0 ||
    (gridSelection?.rows && gridSelection.rows.length > 0) ||
    (gridSelection?.columns && gridSelection.columns.length > 0) ||
    gridSelection?.current !== undefined;

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      persistSelection(selection);
    },
    [persistSelection],
  );

  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const loadingMoreRef = useRef(false); // Ref-based guard to prevent duplicate fetches

  // Update ref when isLoadingMore changes
  useEffect(() => {
    loadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        persistScrollOffset({ x: region.x, y: region.y });
      }, 150);

      // Trigger loading when within 100 rows of the end (or immediately if fewer rows)
      const threshold = Math.max(0, rowsRef.current.length - 100);
      const nearEnd = region.y + region.height >= threshold;

      // Use both state and ref guards to prevent duplicate fetches
      if (
        nearEnd &&
        hasNextPage &&
        !isLoadingMore &&
        !loadingMoreRef.current &&
        loadMore
      ) {
        loadingMoreRef.current = true; // Set immediately to prevent duplicates

        void loadMore();
      }
    },
    [persistScrollOffset, hasNextPage, isLoadingMore, loadMore],
  );

  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  const errorMessage = typeof error === "string" ? error : null;

  const selectedRows = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => rowsRef.current[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }, [selectedRowsSet]);

  const selectedRowKeys = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => getRowKey(rowsRef.current[idx], idx))
      .filter((key): key is string => Boolean(key));
  }, [selectedRowsSet, getRowKey]);

  // Handler: Insert row below selected row
  const handleInsertRowBelow = useCallback(() => {
    if (!isTableMode || selectedRowsSet.size === 0) {
      return;
    }

    try {
      // Get the last selected row index
      const selectedIndices = Array.from(selectedRowsSet).sort((a, b) => a - b);
      const lastSelectedIndex =
        selectedIndices[selectedIndices.length - 1] ?? 0;

      // Get the current active cell column (preserve column position)
      const currentColumn = gridSelection?.current?.cell[0] ?? 0;

      // Get the row key for the selected row (stable identifier)
      // Use rowsRef.current instead of displayRowsWithOptimisticUpdates for performance
      const selectedRow = rowsRef.current[lastSelectedIndex];
      const selectedRowKey = selectedRow
        ? getRowKey(selectedRow, lastSelectedIndex)
        : undefined;

      // Create a draft row with default values
      const draftRow = finalColumns.reduce<GridRowModel>((acc, column) => {
        const cell: FrontCellValue = {
          value: null,
          db_type: column.meta?.db_type ?? column.type ?? "text",
          value_type: "Null",
          is_truncated: false,
        };
        acc[column.field] = cell;
        return acc;
      }, {});

      // Stage the insert command with position metadata
      const target = createCrudTarget(connectionId, database, schema, table);
      const baseCommand = createInsertCommand(draftRow, target, finalColumns);

      // Add position metadata so optimistic updates can place it correctly
      const command: typeof baseCommand = {
        ...baseCommand,
        metadata: {
          ...baseCommand.metadata,
          insertAfterRowKey: selectedRowKey,
        },
      };

      stageCommand(command);

      // Auto-focus on the newly inserted row at the same column
      // The new row will be at lastSelectedIndex + 1 after optimistic update
      const newRowIndex = lastSelectedIndex + 1;

      // Determine which column to focus (preserve current column or use first editable)
      let targetColumn = currentColumn;

      // If current column is a primary key, find first non-PK column
      const currentColumnMeta = finalColumns[targetColumn]?.meta;
      if (currentColumnMeta?.is_pk) {
        const firstEditableCol = finalColumns.findIndex(
          (col) => !col.meta?.is_pk,
        );
        if (firstEditableCol >= 0) {
          targetColumn = firstEditableCol;
        }
      }

      // Wait for the grid to update with optimistic changes
      setTimeout(() => {
        if (gridRef.current && "setFocus" in gridRef.current) {
          // Focus on the cell
          (gridRef.current as any).setFocus([targetColumn, newRowIndex]);

          // Trigger edit mode by simulating Enter key press
          setTimeout(() => {
            const gridElement =
              containerRef.current?.querySelector(".dvn-scroller");
            if (gridElement) {
              const enterEvent = new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                bubbles: true,
                cancelable: true,
              });
              gridElement.dispatchEvent(enterEvent);
            }
          }, 10);
        }
      }, 50); // Small delay to allow optimistic update to complete
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to stage row", {
        description: message,
      });
    }
  }, [
    isTableMode,
    selectedRowsSet,
    finalColumns,
    connectionId,
    database,
    schema,
    table,
    stageCommand,
    getRowKey,
    gridSelection,
  ]);

  // Removed useCommand hooks - now using event bus subscriptions below

  // Register copy as JSON command - standard Cmd+C handled by Glide natively
  useCommand(
    "dataGrid.action.copyAsJson",
    async () => {
      const selection = gridSelectionRef.current;
      if (!selection) return;
      await copySelection(selection, "json");
    },
    {
      label: "Copy Selection as JSON",
      category: "Data Grid",
      when: "dataGridFocus && !selectionEmpty && !editingCell",
    },
  );

  // Update toolbar actions when pending changes or selection changes
  useEffect(() => {
    if (!isTableMode || !onActionsChange) {
      return;
    }

    onActionsChange(
      <div className="flex items-center gap-2">
        {/* Add Row Button - Always visible */}
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={() => {
            // If there's a selection, insert below it; otherwise insert at top
            if (selectedRowsSet.size > 0) {
              handleInsertRowBelow();
            } else {
              handleAddRow();
            }
          }}
        >
          <IconPlus className="h-3 w-3" />
          Add Row
        </Button>

        {/* Staging Actions - Only when there are changes */}
        {pendingChanges.length > 0 && (
          <>
            <div className="h-4 w-px bg-border" />
            <StagingActionsToolbar
              connectionId={connectionId}
              database={database}
              schema={schema}
              table={table}
              onCommitSuccess={async () => {
                await tableDataQueryRef.current.refetch();
              }}
            />
          </>
        )}
      </div>,
    );
  }, [
    isTableMode,
    onActionsChange,
    pendingChanges.length,
    selectedRows.length,
    connectionId,
    database,
    schema,
    table,
    handleAddRow,
    handleInsertRowBelow,
    selectedRowsSet,
  ]);

  const cellHighlightRegions: Array<{ color: string; range: Rectangle }> = [];

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Use stable ref during resize for performance
      const changes = stagedChangesRef.current;

      // Priority 1: Staged deletions (highest priority - red)
      if (isRowPendingDeletion(changes, rowIndex)) {
        return {
          bgCell: "rgba(239, 68, 68, 0.06)", // red-500 with low opacity
          bgCellMedium: "rgba(239, 68, 68, 0.08)",
          accentColor: "rgba(239, 68, 68, 0.4)",
          accentLight: "rgba(239, 68, 68, 0.15)",
        };
      }

      // Priority 2: Pending insertions (green)
      if (isRowPendingInsertion(changes, rowIndex)) {
        return {
          bgCell: "rgba(34, 197, 94, 0.06)", // green-500 with low opacity
          bgCellMedium: "rgba(34, 197, 94, 0.08)",
          accentColor: "rgba(34, 197, 94, 0.4)",
          accentLight: "rgba(34, 197, 94, 0.15)",
        };
      }

      // Priority 3: Pinned rows (blue)
      if (rowIndex < pinnedRows.length) {
        return {
          bgCell: "rgba(59, 130, 246, 0.08)",
          bgCellMedium: "rgba(59, 130, 246, 0.10)",
        };
      }

      // Priority 4: Staged changes (subtle orange)
      if (changes.rowChanges.has(rowIndex)) {
        return {
          bgCell: "rgba(252, 163, 17, 0.04)", // Brand orange with very low opacity
          bgCellMedium: "rgba(252, 163, 17, 0.06)",
          accentColor: "#FCA311",
          accentLight: "rgba(252, 163, 17, 0.12)",
        };
      }

      // Priority 4: Selected rows (orange)
      if (selectedRowsSet.has(rowIndex)) {
        return {
          bgCell: "rgba(252, 163, 17, 0.10)",
          bgCellMedium: "rgba(252, 163, 17, 0.12)",
        };
      }

      return undefined;
    },
    [pinnedRows.length, selectedRowsSet],
  );

  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];
      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        } as const;
      }

      const cellValue = row[column.field] as FrontCellValue | null | undefined;

      // Enable editing for table mode, keep read-only for query mode
      // Allow editing all columns including PKs (database will validate on commit)
      const isReadOnly = isQueryMode;

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
      });

      // Apply cell-level styling for staged changes
      const hasPendingChange = hasStagedCellChange(
        stagedChangesRef.current,
        rowIndex,
        column.field,
      );

      let finalCell = gridCell;

      // Apply truncation if needed (but not for query plan columns)
      const isQueryPlanColumn =
        column.title.toLowerCase() === "query plan" ||
        column.title.toLowerCase() === "explain";
      const widthCap =
        typeof (column as { width?: number }).width === "number"
          ? (column as { width?: number }).width
          : undefined;
      if (
        !isQueryPlanColumn && // Skip truncation for query plans
        gridCell.kind === GridCellKind.Text &&
        typeof widthCap === "number" &&
        gridCell.displayData
      ) {
        const text = gridCell.data || "";
        const availableWidth = widthCap - 16;
        const truncated = truncateTextToWidth(text, availableWidth);
        finalCell = {
          ...gridCell,
          displayData: truncated,
        };
      }

      // Apply theme override for staged changes
      if (hasPendingChange) {
        return {
          ...finalCell,
          themeOverride: {
            ...finalCell.themeOverride,
            bgCell: "rgba(251, 146, 60, 0.15)", // Orange highlight
            accentColor: "#fb923c",
            accentLight: "rgba(251, 146, 60, 0.2)",
          },
        };
      }

      return finalCell;
    },
    [isQueryMode],
  );

  useContextKey("selectionEmpty", !hasSelection, {
    scopeId,
    resetOnUnmount: true,
  });

  if (!hydrated) {
    return null;
  }

  // if (errorMessage) {
  //   return (
  //     <div
  //       ref={wrapperRef}
  //       tabIndex={-1}
  //       className="flex h-full flex-col outline-none"
  //     >
  //       {/* Keep the filter toolbar visible on error */}
  //       {isTableMode && filterColumns.length > 0 && (
  //         <div className="flex-none pb-1.5 pt-1 bg-background">
  //           <QuickFilter
  //             ref={quickFilterRef}
  //             columns={filterColumns}
  //             value={quickFilterValue}
  //             mode={quickFilterMode}
  //             onValueChange={(value) => {
  //               setQuickFilterValue(value);
  //               setQuickFilterError(null);
  //               setAiExplanation(null);
  //               const detectedMode = detectFilterMode(value);
  //               if (detectedMode !== quickFilterMode) {
  //                 setQuickFilterMode(detectedMode);
  //               }
  //             }}
  //             onModeChange={setQuickFilterMode}
  //             onSubmit={handleFilterSubmit}
  //             isLoading={isAIFilterLoading}
  //             error={quickFilterError}
  //             explanation={aiExplanation}
  //           />
  //         </div>
  //       )}
  //       <div className="flex-1">
  //         <DataGridErrorState
  //           error={errorMessage}
  //           onRetry={
  //             activeFilter
  //               ? () => {
  //                   // Clear filter and retry
  //                   setActiveFilter(undefined);
  //                   setQuickFilterValue("");
  //                   setQuickFilterMode("search");
  //                   setQuickFilterError(null);
  //                 }
  //               : undefined
  //           }
  //           onReload={() => tableDataQuery.refetch()}
  //         />
  //       </div>
  //     </div>
  //   );
  // }

  if (!isLoading && !isLoadingMore && !errorMessage && dataRows.length === 0) {
    // Show different message when filter is active
    if (isTableMode && activeFilter) {
      return (
        <div
          ref={wrapperRef}
          tabIndex={-1}
          className="flex h-full flex-col outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              wrapperRef.current?.focus();
            }
          }}
        >
          {/* Keep the filter toolbar visible */}
          {filterColumns.length > 0 && (
            <div className="flex-none pb-1.5 pt-1 bg-background">
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
              />
            </div>
          )}
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <p className="text-muted-foreground">
              No results match your filter
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilter}
            >
              Clear IconFilter
            </Button>
          </div>
        </div>
      );
    }
    return <DataGridEmptyState onReload={() => tableDataQuery.refetch()} />;
  }

  if ((isLoading || isLoadingMore) && dataRows.length === 0) {
    return <DataGridSkeleton />;
  }

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className="flex h-full flex-col outline-none"
      onClick={(e) => {
        // Focus wrapper when clicking on panel background (not on interactive elements)
        if (e.target === e.currentTarget) {
          wrapperRef.current?.focus();
        }
      }}
    >
      {/* Quick IconFilter toolbar - only in table mode */}
      {isTableMode && (
        <div className="flex-none pb-1.5 pt-1 bg-background">
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
          />
        </div>
      )}

      <div
        ref={containerRef}
        tabIndex={0}
        className="relative flex-1 outline-none"
        onClick={handleContainerClick}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        onPointerDown={handleFocusCapture}
      >
        {errorMessage ? (
          <DataGridErrorState
            error={errorMessage}
            onReload={() => tableDataQuery.refetch()}
          />
        ) : (
          <GridContextMenu
            selectedRows={selectedRows}
            selectedRowKeys={selectedRowKeys}
            allRows={rowsRef.current}
            columns={finalColumns}
            pinnedRowKeys={pinnedRowIds}
            maxPinnedRows={5}
            tableName={isTableMode ? table : "query"}
            schema={isTableMode ? schema : undefined}
            databaseType={"postgresql"}
            onPinRows={handlePinRowsFromMenu}
            onUnpinRows={handleUnpinRowsFromMenu}
            onAddRow={undefined}
            onInsertRowAbove={undefined}
            onInsertRowBelow={isTableMode ? handleInsertRowBelow : undefined}
            onDeleteRows={
              isTableMode
                ? () => {
                    // Delete selected rows via context menu
                    handleRowDelete({
                      selection:
                        gridSelection ??
                        ({
                          columns: CompactSelection.empty(),
                          rows: CompactSelection.empty(),
                        } as GridSelection),
                      rowIndexes: Array.from(selectedRowsSet),
                      rows: selectedRows,
                    });
                  }
                : undefined
            }
            showDetailsSheet={showDetailsSheet}
            onShowDetailsSheetChange={setShowDetailsSheet}
          >
            <EditableDataGrid
              ref={gridRef}
              containerClassName={cn("h-full", className)}
              rows={deferredDisplayRows}
              columns={finalColumns}
              getCellContent={getCellContent}
              onCellEditStart={handleCellEditStart}
              onCellEditCommit={handleCellEditCommit}
              onCellEditCancel={handleCellEditCancel}
              onRowAppend={handleRowAppend}
              onRowDelete={handleRowDelete}
              overscrollX={0}
              overscrollY={24}
              // Avoid rendering very tall buffers on large datasets
              // This keeps DOM/paint work bounded when streaming big tables
              smoothScrollX={true}
              smoothScrollY={true}
              maxColumnWidth={1000}
              onColumnResize={(col, size) => {
                handleColumnResize(col, size);
              }}
              onColumnResizeEnd={(column, size) => {
                handleColumnResizeEnd(column, size);
                // Persist widths after resize completes
                flushWidths(columnWidths);
              }}
              onColumnMoved={(start, end) => {
                if (start === end) return;
                setTimeout(() => {
                  upsertGridColumnsState(gridId, (draft) => {
                    const order = draft.order.length
                      ? [...draft.order]
                      : finalColumns.map((column) => column.id);
                    const [moved] = order.splice(start, 1);
                    if (!moved) return;
                    order.splice(end, 0, moved);
                    draft.order = order;
                  });
                }, 0);
              }}
              onActiveCellChange={persistActiveCell}
              onVisibleRegionChanged={handleVisibleRegionChanged}
              gridSelection={gridSelection}
              onSelectionChange={handleSelectionChange}
              freezeColumns={freezeColumns}
              getRowThemeOverride={getRowThemeOverride}
              highlightRegions={cellHighlightRegions}
              onHeaderClicked={handleHeaderClicked}
              drawHeader={drawHeader}
              onHeaderContextMenu={handleHeaderContextMenu}
              onItemHovered={handleItemHovered}
              drawCell={drawCellWithHoverIcons}
            />
          </GridContextMenu>
        )}
      </div>

      <DataGridStatusBar
        loadedRows={rowsRef.current.length}
        estimatedTotal={estimatedTotal ?? undefined}
        hasMore={hasNextPage}
        isStreaming={isLoadingMore}
        selectedRows={selectedRowCount}
        selectedRowsData={selectedRows}
        selectedRowIndices={selectedRowsSet}
        allRows={rowsRef.current}
        columns={finalColumns}
        gridSelection={
          gridSelection as unknown as GridSelection & {
            rows: Set<number>;
            columns?: Set<number>;
            current?: {
              range?: {
                x: number;
                y: number;
                width: number;
                height: number;
              };
            };
          }
        }
        executionTime={executionTime}
        cursorSetupMs={cursorSetupMs}
        totalStreamingMs={totalStreamingMs}
        readOnlyReason={
          entityType === "materialized_view"
            ? "Read-only: Materialized View"
            : entityType === "view"
            ? "Read-only: View"
            : undefined
        }
        fetchCount={fetchCount}
        networkMs={networkMs}
        conversionMs={conversionMs}
        onViewDetails={
          hasSelection
            ? () => {
                setShowDetailsSheet(true);
              }
            : undefined
        }
      />

      {/* Column header context menu */}
      {contextMenuProps && (
        <ColumnHeaderContextMenu
          open={menuState.isOpen}
          onOpenChange={(open) => {
            if (!open) closeMenu();
          }}
          position={menuState.position}
          {...contextMenuProps}
        />
      )}
    </div>
  );
});

export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
