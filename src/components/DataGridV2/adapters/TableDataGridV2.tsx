import { memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  GridSelection,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { EditableDataGrid } from "../base";
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
import {
  usePersistentViewState,
  useGridHistory,
  useClipboardBridge,
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
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const scopeId = useScopedKeybindings(gridId);
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);

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

  useContextKey("dataGridEditable", false, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridCanUndo", false, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridCanRedo", false, {
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

    return (queryData.rows ?? []).map((row) => {
      const rowObj: GridRowModel = {};
      const backendRow = row as BackendCellValue[];
      (queryData.columns ?? []).forEach((colName, colIndex) => {
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
    ipcSendMs,
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
        ipcSendMs: undefined,
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
        ipcSendMs: props.ipcSendMs,
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

  // Defer grid rendering for large datasets to keep UI responsive
  // Grid updates in background without blocking interactions
  const deferredDisplayRows = useDeferredValue(displayRows);

  const rowsRef = useRef(deferredDisplayRows);
  rowsRef.current = deferredDisplayRows;

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
      toast({
        description:
          mode === "json" ? "Copied selection as JSON" : "Copied to clipboard",
      });
    },
    onCopyError: (_mode, error) => {
      toast({
        description: `Failed to copy: ${error}`,
        variant: "destructive",
      });
    },
  });

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

  useEffect(() => {
    if (!onActionsChange) return;
    onActionsChange(null);
    return () => {
      onActionsChange(null);
    };
  }, [onActionsChange]);

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

  const cellHighlightRegions: Array<{ color: string; range: Rectangle }> = [];

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      if (rowIndex < pinnedRows.length) {
        return {
          bgCell: "rgba(59, 130, 246, 0.08)",
          bgCellMedium: "rgba(59, 130, 246, 0.10)",
        };
      }
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

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: true,
      });

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
        return {
          ...gridCell,
          displayData: truncated,
        };
      }

      return gridCell;
    },
    [finalColumns],
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
          onInsertRowBelow={undefined}
          onDeleteRows={undefined}
          onPaste={undefined}
          showDetailsSheet={showDetailsSheet}
          onShowDetailsSheetChange={setShowDetailsSheet}
        >
          <EditableDataGrid
            containerClassName={cn("h-full", className)}
            rows={rowsRef.current}
            columns={finalColumns}
            getCellContent={getCellContent}
            history={history}
            onCellEditStart={undefined}
            onCellEditCommit={undefined}
            onCellEditCancel={undefined}
            onRowAppend={undefined}
            onRowDelete={undefined}
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
        gridSelection={gridSelection}
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
        ipcSendMs={ipcSendMs}
        onViewDetails={
          hasSelection
            ? () => {
                setShowDetailsSheet(true);
              }
            : undefined
        }
      />
    </div>
  );
});

export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
