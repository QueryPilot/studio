import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
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
import {
  usePersistentViewState,
  useGridHistory,
  useClipboardBridge,
  useStagedChangesIndicator,
  hasStagedCellChange,
  isRowPendingDeletion,
  isRowPendingInsertion,
} from "../hooks";
import {
  useGridPreferences,
  useGridPreferencesHydrated,
  upsertGridColumnsState,
  useGridPreferencesStore,
} from "../stores";
import {
  useColumnPinning,
  useColumnSizing,
  useColumnVisibility,
  useRowPinning,
} from "../hooks";
import {
  applyPinnedOrdering,
  computeBaseWidth,
  filterVisibleColumns,
  reorderColumns,
} from "./columnUtils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Edit } from "lucide-react";
import { BulkEditModal } from "../components/BulkEditModal";
import type { CellValue as FrontCellValue } from "@/types/cellValue";
import type { CellValue as BackendCellValue } from "@/services/backend";
import type { ColumnMeta } from "@/types/database";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { cn } from "@/lib/utils";
import { GridContextMenu } from "../components/GridContextMenu";
import { useCommand } from "@/hooks/useCommand";
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import {
  deriveValueType,
  normalizeBackendValue,
} from "@/services/tableDataTransform";
import { useCrudStore } from "@/stores/crudStore";
import {
  createUpdateCommand,
  createInsertCommand,
  createDeleteCommand,
  createCrudTarget,
} from "../utils/crudHelpers";
import type {
  GridEditCommitEvent,
  GridRowAppendEvent,
  GridRowDeleteEvent,
} from "../types";
import { nanoid } from "nanoid";
import type { JsonValue, CrudCommand, DataUpdatePayload } from "@/types/crud";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<EditableDataGridRef>(null);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const scopeId = useScopedKeybindings(gridId);
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);

  useContextKey("dataGridFocus", isGridFocused, {
    scopeId,
    resetOnUnmount: true,
  });

  const handleFocusCapture = useCallback(() => {
    setIsGridFocused(true);
  }, []);

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!containerRef.current) {
      setIsGridFocused(false);
      return;
    }
    if (!nextTarget || !containerRef.current.contains(nextTarget)) {
      setIsGridFocused(false);
    }
  }, []);

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

  // Get undo/redo state from CRUD store
  const canUndo = useCrudStore((state) => state.historyIndex > 0);
  const canRedo = useCrudStore(
    (state) => state.historyIndex < state.history.length - 1,
  );

  useContextKey("dataGridEditable", isTableMode, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridCanUndo", canUndo, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridCanRedo", canRedo, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("editingCell", false, {
    scopeId,
    resetOnUnmount: true,
  });

  const tableDataQuery = useTableDataQuery({
    connectionId,
    database,
    schema,
    entityName: table,
    entityType,
    enabled: isTableMode,
    pageSize: 300,
  });

  useEffect(() => {
    if (!isTableMode) {
      return;
    }
    const cancelStream = tableDataQuery.cancelStream;
    return () => {
      cancelStream();
    };
  }, [isTableMode, tableDataQuery.cancelStream]);

  const queryData = isQueryMode ? props.data : null;

  // Memoize query data transformation to prevent infinite render loop
  // Use stable primitive dependencies instead of queryData object reference
  const transformedQueryRows = useMemo(() => {
    if (!queryData) return [];

    return queryData.rows.map((row) => {
      const rowObj: GridRowModel = {};
      const backendRow = row as BackendCellValue[];
      queryData.columns.forEach((colName, colIndex) => {
        const rawValue = backendRow[colIndex] as BackendCellValue | undefined;
        const colMeta = queryData.columnMeta?.[colIndex];
        const dbType = colMeta?.db_type ?? "text";
        const normalizedValue =
          rawValue === undefined
            ? null
            : normalizeBackendValue(rawValue) ?? null;
        const valueType =
          rawValue === null || rawValue === undefined
            ? "Null"
            : deriveValueType(rawValue, dbType);
        const metadata =
          typeof rawValue === "bigint"
            ? {
                attributes: {
                  originalBigInt: rawValue.toString(),
                },
              }
            : undefined;

        rowObj[colName] = {
          value: normalizedValue,
          db_type: dbType,
          value_type: valueType,
          is_truncated: false,
          metadata,
        } as FrontCellValue;
      });
      return rowObj;
    });
  }, [queryData?.rows, queryData?.columns, queryData?.columnMeta]);

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
        isLoading: tableDataQuery.status === "loading" && !tableDataQuery.data,
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

  const { structure: tableStructure } = useTableFullStructure({
    connectionId: isTableMode ? props.connectionId : "",
    database: isTableMode ? props.database : "",
    table: isTableMode ? props.table : "",
    schema: isTableMode ? props.schema : undefined,
    options: {
      includeIndexes: false,
      includeConstraints: false,
      includeTriggers: false,
      includeStatistics: false,
      includeForeignKeys: false,
    },
    enabled: isTableMode,
  });

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
        if (typeof value === "object") {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        }
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
    setRows(dataRows);
  }, [dataRows]);

  const preferences = useGridPreferences(gridId);
  const hydrated = useGridPreferencesHydrated();
  const history = useGridHistory();
  const { persistSelection, persistScrollOffset, persistActiveCell } =
    usePersistentViewState(gridId);

  // CRUD Store integration
  const { stageCommand, getTableKey, stagedCommands, undo, redo } =
    useCrudStore();

  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    undefined,
  );

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

  // Apply optimistic updates from staged commands to display rows
  const displayRowsWithOptimisticUpdates = useMemo(() => {
    if (!isTableMode) {
      return displayRows;
    }

    const tableKey = getTableKey({ connectionId, database, schema, table });
    const commands = stagedCommands.get(tableKey) ?? [];

    if (commands.length === 0) {
      return displayRows;
    }

    // First, apply UPDATE commands to existing rows
    const updatedRows = displayRows.map((row) => {
      // Find all UPDATE commands for this row
      const updateCommands = commands.filter((cmd) => {
        if (cmd.type !== "data.update") return false;

        const payload = cmd.payload as {
          primaryKeys?: Record<string, unknown>;
        };

        if (!payload.primaryKeys) return false;

        // Check if this command's PK matches this row's PK
        return Object.entries(payload.primaryKeys).every(([key, value]) => {
          const cellValue = row[key];
          if (
            !cellValue ||
            typeof cellValue !== "object" ||
            !("value" in cellValue)
          ) {
            return false;
          }
          return cellValue.value === value;
        });
      });

      if (updateCommands.length === 0) {
        return row;
      }

      // Apply all updates to create a new row
      const updatedRow = { ...row };
      updateCommands.forEach((cmd) => {
        const payload = cmd.payload as {
          column?: string;
          newValue?: unknown;
        };

        if (payload.column && payload.column in updatedRow) {
          const existingCell = updatedRow[payload.column];
          if (
            existingCell &&
            typeof existingCell === "object" &&
            "value" in existingCell
          ) {
            updatedRow[payload.column] = {
              ...existingCell,
              value: payload.newValue,
            };
          }
        }
      });

      return updatedRow;
    });

    // Then, insert new rows at their specified positions (or at top if no position specified)
    const insertCommands = commands.filter((cmd) => cmd.type === "data.insert");

    // Build result array with inserts at correct positions
    const result = [...updatedRows];

    insertCommands.forEach((cmd) => {
      const payload = cmd.payload as { values?: Record<string, JsonValue> };
      if (!payload.values) return;

      // Convert the plain values object to GridRowModel with CellValue structure
      const row: GridRowModel = {};
      Object.entries(payload.values).forEach(([key, value]) => {
        // Infer the value type
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
          db_type: "unknown",
          is_truncated: false,
        };
      });

      // Check if this insert has a specific position (by row key)
      const insertAfterRowKey = cmd.metadata.insertAfterRowKey;
      if (insertAfterRowKey) {
        // Find the target row in the current result array
        const targetIndex = result.findIndex(
          (r, idx) => getRowKey(r, idx) === insertAfterRowKey,
        );
        if (targetIndex >= 0) {
          // Insert after the target row
          result.splice(targetIndex + 1, 0, row);
        } else {
          // Target not found, insert at top (fallback)
          result.unshift(row);
        }
      } else {
        // No position specified, insert at top (default behavior)
        result.unshift(row);
      }
    });

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
  ]);

  // Defer grid rendering for large datasets to keep UI responsive
  // Grid updates in background without blocking interactions
  const deferredDisplayRows = useDeferredValue(
    displayRowsWithOptimisticUpdates,
  );

  const rowsRef = useRef(deferredDisplayRows);
  rowsRef.current = deferredDisplayRows;

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
        const mergedMeta = structMeta
          ? ({
              ...meta,
              enum_values: structMeta.enum_values ?? meta.enum_values,
              type_category: structMeta.type_category ?? meta.type_category,
            } as typeof meta)
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
    [columnMeta, structureMetaByName],
  );

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order],
  );

  const widthsTimerRef = useRef<number | undefined>(undefined);
  const pendingWidthsRef = useRef<Record<string, number> | null>(null);

  const flushWidths = useCallback(() => {
    if (widthsTimerRef.current) {
      clearTimeout(widthsTimerRef.current);
      widthsTimerRef.current = undefined;
    }
    if (pendingWidthsRef.current) {
      const latest = pendingWidthsRef.current;
      pendingWidthsRef.current = null;
      const state = useGridPreferencesStore.getState();
      const current = state.preferences[gridId]?.columns.widths ?? {};
      const changed = Object.keys(latest).some(
        (key) => current[key] !== latest[key],
      );
      if (changed) {
        upsertGridColumnsState(gridId, (draft) => {
          draft.widths = latest;
        });
      }
    }
  }, [gridId]);

  const throttledWidthsChange = useCallback(
    (widths: Record<string, number>) => {
      pendingWidthsRef.current = widths;
      if (widthsTimerRef.current == null) {
        widthsTimerRef.current = window.setTimeout(() => {
          flushWidths();
        }, 120);
      }
    },
    [flushWidths],
  );

  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: reorderedColumns,
      initialWidths: columnState.widths,
      onChange: throttledWidthsChange,
    });

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

  const { visibleColumns } = useColumnVisibility({
    columns: sizedColumns,
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
    columns: sizedColumns,
    initialPinned: columnState.pinned,
    onChange: handlePinnedColumnsChange,
  });

  const { columns: finalColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(
      visibleColumns,
      columnState.visibility,
    );
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [columnState.pinned, columnState.visibility, visibleColumns]);

  // Track staged changes for visual indicators (must be after finalColumns)
  const stagedChanges = useStagedChangesIndicator({
    connectionId,
    database,
    schema: schema ?? "",
    table,
    rows: deferredDisplayRows,
    columns: finalColumns,
  });

  const { copySelection } = useClipboardBridge({
    toText: (selection) => {
      if (selection.rows.length === 0) {
        return "";
      }
      const selected = selection.rows
        .toArray()
        .map((idx) => rowsRef.current[idx])
        .filter(Boolean);
      if (selected.length === 0) return "";
      const headers = finalColumns.map((col) => col.name).join("\t");
      const body = selected.map((row) =>
        finalColumns
          .map((col) => {
            const value = row?.[col.field];
            if (!value || typeof value !== "object") return "";
            return String(value.value ?? "");
          })
          .join("\t"),
      );
      return [headers, ...body].join("\n");
    },
    toJson: (selection) => {
      if (selection.rows.length === 0) {
        return [];
      }
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
    },
    onCopySuccess: (mode) => {
      toast(
        mode === "json" ? "Copied selection as JSON" : "Copied to clipboard",
      );
    },
    onCopyError: (_mode, error) => {
      toast.error(`Failed to copy: ${error}`);
    },
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

  // Handler: Bulk edit selected rows
  const handleBulkEdit = useCallback(
    (column: string, newValue: unknown, rows: GridRowModel[]) => {
      if (!isTableMode) return;

      const target = createCrudTarget(connectionId, database, schema, table);

      // Create an update command for each selected row
      rows.forEach((row) => {
        // Find the column to get metadata
        const col = finalColumns.find((c) => c.field === column);
        if (!col) return;

        // Extract primary keys from the row
        const pkColumns = finalColumns.filter((c) => c.meta?.is_pk);
        const primaryKeys: Record<string, string | number | boolean | null> =
          {};
        pkColumns.forEach((pkCol) => {
          const cellValue = row[pkCol.field];
          if (
            cellValue &&
            typeof cellValue === "object" &&
            "value" in cellValue
          ) {
            const value = cellValue.value;
            // Ensure value is a CrudPrimitive (string, number, boolean, or null)
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean" ||
              value === null
            ) {
              primaryKeys[pkCol.field] = value;
            } else {
              // Convert other types to string or null
              primaryKeys[pkCol.field] = value != null ? String(value) : null;
            }
          }
        });

        // Create the update command manually
        const command: CrudCommand<DataUpdatePayload> = {
          id: `cmd-${nanoid()}`,
          type: "data.update" as const,
          target,
          payload: {
            column,
            newValue: newValue as JsonValue,
            primaryKeys,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            description: `Update ${column} in ${table}`,
          },
          state: "staged" as const,
        };

        stageCommand(command);
      });
    },
    [
      isTableMode,
      connectionId,
      database,
      schema,
      table,
      finalColumns,
      stageCommand,
    ],
  );

  // Handler: Cell edit commit → Stage update command (or modify INSERT command for new rows)
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      // Only handle in table mode
      if (!isTableMode) {
        return undefined;
      }

      try {
        const target = createCrudTarget(connectionId, database, schema, table);
        const tableKey = getTableKey({ connectionId, database, schema, table });
        const commands = stagedCommands.get(tableKey) ?? [];

        // Check if this row is a pending insertion (first N rows where N = number of INSERT commands)
        const insertCommands = commands.filter(
          (cmd) => cmd.type === "data.insert",
        );
        const isPendingInsert = event.rowIndex < insertCommands.length;

        if (isPendingInsert) {
          // Editing a pending insert row - update the INSERT command payload
          const insertCmd = insertCommands[event.rowIndex];
          if (insertCmd) {
            const payload = insertCmd.payload as {
              values?: Record<string, JsonValue>;
            };
            const updatedValues = { ...payload.values };

            // Extract the new value
            let newValue: JsonValue = null;
            if ("data" in event.newValue) {
              const data = event.newValue.data;
              if (
                typeof data === "object" &&
                data !== null &&
                "value" in data
              ) {
                const extractedValue = data.value;

                // Convert numeric strings to numbers based on column type
                const columnDbType =
                  event.column.meta?.db_type.toLowerCase() || "";
                const isNumericColumn =
                  columnDbType.includes("int") ||
                  columnDbType.includes("numeric") ||
                  columnDbType.includes("decimal") ||
                  columnDbType.includes("float") ||
                  columnDbType.includes("double") ||
                  columnDbType.includes("real") ||
                  columnDbType.includes("money");

                if (
                  isNumericColumn &&
                  typeof extractedValue === "string" &&
                  extractedValue !== ""
                ) {
                  const numValue = Number(extractedValue);
                  newValue = isNaN(numValue) ? extractedValue : numValue;
                } else {
                  newValue = extractedValue as JsonValue;
                }
              } else {
                newValue = data as JsonValue;
              }
            }

            updatedValues[event.column.field] = newValue;

            // Update the command (stageCommand will replace in-place if ID matches)
            const updatedCmd = {
              ...insertCmd,
              payload: { ...payload, values: updatedValues },
            };

            stageCommand(updatedCmd);
          }
        } else {
          // Editing an existing row - create UPDATE command
          const command = createUpdateCommand(event, target, finalColumns);
          stageCommand(command);
        }

        return undefined; // Don't add to grid history (CRUD store handles history)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage change", {
          description: message,
        });
        return undefined;
      }
    },
    [
      isTableMode,
      connectionId,
      database,
      schema,
      table,
      finalColumns,
      stageCommand,
      stagedCommands,
      getTableKey,
    ],
  );

  // Handler: Row append → Stage insert command
  const handleRowAppend = useCallback(
    (event: GridRowAppendEvent) => {
      if (!isTableMode) {
        return undefined;
      }

      try {
        const target = createCrudTarget(connectionId, database, schema, table);
        const command = createInsertCommand(
          event.draftRow,
          target,
          finalColumns,
        );
        stageCommand(command);

        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage row", {
          description: message,
        });
        return undefined;
      }
    },
    [
      isTableMode,
      connectionId,
      database,
      schema,
      table,
      finalColumns,
      stageCommand,
    ],
  );

  // Handler: Row delete → Stage delete command
  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent) => {
      if (!isTableMode) {
        return undefined;
      }

      try {
        const target = createCrudTarget(connectionId, database, schema, table);
        const commands = event.rows.map((row) =>
          createDeleteCommand(row, target, finalColumns),
        );

        commands.forEach((command) => stageCommand(command));

        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage deletion", {
          description: message,
        });
        return undefined;
      }
    },
    [
      isTableMode,
      connectionId,
      database,
      schema,
      table,
      finalColumns,
      stageCommand,
    ],
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!gridSelection) {
        return;
      }
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || key !== "c") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void copySelection(gridSelection, event.shiftKey ? "json" : "text");
    },
    [copySelection, gridSelection],
  );

  useCommand(
    "dataGrid.action.copy",
    async () => {
      if (!gridSelection) {
        return;
      }
      await copySelection(gridSelection, "text");
    },
    {
      label: "Copy Selection",
      category: "Data Grid",
      when: "dataGridFocus && !selectionEmpty",
    },
  );

  useCommand(
    "dataGrid.action.copyAsJson",
    async () => {
      if (!gridSelection) {
        return;
      }
      await copySelection(gridSelection, "json");
    },
    {
      label: "Copy Selection as JSON",
      category: "Data Grid",
      when: "dataGridFocus && !selectionEmpty",
    },
  );

  // Undo/Redo commands
  useCommand(
    "dataGrid.action.undo",
    () => {
      if (isTableMode) {
        undo();
        toast.success("Undone", {
          description: "Reverted last change",
        });
      }
    },
    {
      label: "Undo",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && dataGridCanUndo",
    },
  );

  useCommand(
    "dataGrid.action.redo",
    () => {
      if (isTableMode) {
        redo();
        toast.success("Redone", {
          description: "Reapplied last change",
        });
      }
    },
    {
      label: "Redo",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && dataGridCanRedo",
    },
  );

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      persistSelection(selection);
    },
    [persistSelection],
  );

  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        persistScrollOffset({ x: region.x, y: region.y });
      }, 150);

      const threshold = rowsRef.current.length - 500;
      const nearEnd = region.y + region.height > threshold;
      if (nearEnd && hasNextPage && !isLoadingMore && loadMore) {
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

  const selectedRows = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => rowsRef.current[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }, [selectedRowsSet]);

  const selectedRowKeys = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => getRowKey(rowsRef.current[idx], idx))
      .filter((key): key is string => !key);
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

  // Keyboard shortcuts for insert row below and delete rows
  useCommand(
    "dataGrid.action.insertRowBelow",
    () => {
      if (isTableMode) {
        handleInsertRowBelow();
      }
    },
    {
      label: "Insert Row Below",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty",
    },
  );

  useCommand(
    "dataGrid.action.deleteRows",
    () => {
      if (isTableMode && selectedRowKeys.length > 0) {
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
    },
    {
      label: "Delete Rows",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty",
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
          <Plus className="h-3 w-3 mr-1" />
          Add Row
        </Button>

        {/* Bulk Edit Button - Only when rows are selected */}
        {selectedRows.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => {
              setShowBulkEditModal(true);
            }}
          >
            <Edit className="h-3 w-3 mr-1" />
            Bulk Edit ({selectedRows.length})
          </Button>
        )}

        {/* Staging Actions - Only when there are changes */}
        {pendingChanges.length > 0 && (
          <>
            <div className="h-4 w-px bg-border" />
            <StagingActionsToolbar
              connectionId={connectionId}
              database={database}
              schema={schema}
              table={table}
              onCommitSuccess={() => {
                // Refresh table data from server after successful commit
                void tableDataQuery.refetch();
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
    tableDataQuery,
    handleAddRow,
    handleInsertRowBelow,
    selectedRowsSet,
  ]);

  const cellHighlightRegions: Array<{ color: string; range: Rectangle }> = [];

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Priority 1: Staged deletions (highest priority - red)
      if (isRowPendingDeletion(stagedChanges, rowIndex)) {
        return {
          bgCell: "rgba(239, 68, 68, 0.06)", // red-500 with low opacity
          bgCellMedium: "rgba(239, 68, 68, 0.08)",
          accentColor: "rgba(239, 68, 68, 0.4)",
          accentLight: "rgba(239, 68, 68, 0.15)",
        };
      }

      // Priority 2: Pending insertions (green)
      if (isRowPendingInsertion(stagedChanges, rowIndex)) {
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
      if (stagedChanges.rowChanges.has(rowIndex)) {
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
    [pinnedRows.length, selectedRowsSet, stagedChanges],
  );

  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumns[colIndex];
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
      // Also make primary keys read-only to prevent accidental modification
      const isPrimaryKey = column.meta?.is_pk || false;
      const isReadOnly = isQueryMode || isPrimaryKey;

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
      });

      // Apply cell-level styling for staged changes
      const hasPendingChange = hasStagedCellChange(
        stagedChanges,
        rowIndex,
        column.field,
      );

      let finalCell = gridCell;

      // Apply truncation if needed
      const widthCap =
        typeof (column as { width?: number }).width === "number"
          ? (column as { width?: number }).width
          : undefined;
      if (
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
    [finalColumns, stagedChanges],
  );

  const selectedRowCount = selectedRowsSet.size;
  const hasSelection = selectedRowCount > 0;

  useContextKey("selectionEmpty", !hasSelection, {
    scopeId,
    resetOnUnmount: true,
  });

  if (!hydrated) {
    return null;
  }

  if (errorMessage) {
    return <DataGridErrorState error={errorMessage} />;
  }

  if (!isLoading && rowsRef.current.length === 0) {
    return <DataGridEmptyState />;
  }

  if (isLoading && rowsRef.current.length === 0) {
    return <DataGridSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className="relative flex-1"
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        onPointerDown={handleFocusCapture}
        onKeyDownCapture={handleKeyDownCapture}
      >
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
          onPaste={undefined}
          showDetailsSheet={showDetailsSheet}
          onShowDetailsSheetChange={setShowDetailsSheet}
        >
          <EditableDataGrid
            ref={gridRef}
            containerClassName={cn("h-full", className)}
            rows={rowsRef.current}
            columns={finalColumns}
            getCellContent={getCellContent}
            history={history}
            onCellEditStart={undefined}
            onCellEditCommit={handleCellEditCommit}
            onCellEditCancel={undefined}
            onRowAppend={handleRowAppend}
            onRowDelete={handleRowDelete}
            onPaste={undefined}
            onColumnResize={(col, size) => {
              handleColumnResize(col, size);
            }}
            onColumnResizeEnd={(column, size) => {
              handleColumnResizeEnd(column, size);
              flushWidths();
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
          />
        </GridContextMenu>
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

      {/* Bulk Edit Modal */}
      {isTableMode && (
        <BulkEditModal
          open={showBulkEditModal}
          onOpenChange={setShowBulkEditModal}
          selectedRows={selectedRows}
          columns={finalColumns}
          onBulkEdit={handleBulkEdit}
        />
      )}
    </div>
  );
});

export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
