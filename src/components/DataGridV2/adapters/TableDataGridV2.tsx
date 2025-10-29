import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  GridSelection,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import { EditableDataGrid } from "../base";
import type {
  GridColumnV2,
  GridEditCommitEvent,
  GridRowModel,
  GridRowAppendEvent,
  GridRowDeleteEvent,
  GridPasteEvent,
  GridHistoryEntry,
} from "../types";
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
import type { Theme } from "@glideapps/glide-data-grid";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GridContextMenu } from "../components/GridContextMenu";
import { useConnectionStore } from "@/stores";
import { useTheme } from "next-themes";
import { useCommand } from "@/hooks/useCommand";
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import {
  useTableEditData,
  useEnsureScope,
} from "@/stores/tableEditStore.selectors";
import { useTableEditStore, createScopeKey } from "@/stores/tableEditStore";
import type {
  EditingScopeKey,
  RowDraft as StoreDraft,
  CellDraft as StoreCellDraft,
} from "@/stores/tableEditStore.types";
import { applyChangesService } from "@/services/applyChangesService";
import {
  deriveValueType,
  normalizeBackendValue,
} from "@/services/tableDataTransform";

interface BooleanCellPayload {
  kind: "boolean-cell";
  value: boolean | null;
}

const isBooleanCellPayload = (value: unknown): value is BooleanCellPayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "boolean-cell" &&
    (record.value === null || typeof record.value === "boolean")
  );
};

interface EnumCellPayload {
  kind: "enum-cell";
  value: string | null;
  allowedValues?: string[];
}

const isEnumCellPayload = (value: unknown): value is EnumCellPayload => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "enum-cell" &&
    (record.value === null || typeof record.value === "string")
  );
};

// Note: Local editing types replaced by centralized store types (StoreDraft, StoreCellDraft)

// Note: Old helper functions removed - editing state is now handled by centralized store

const areCellValuesEqual = (
  left: FrontCellValue | null | undefined,
  right: FrontCellValue | null | undefined,
) => {
  const leftValue = left?.value ?? null;
  const rightValue = right?.value ?? null;

  if (leftValue === rightValue) {
    return true;
  }

  if (leftValue == null || rightValue == null) {
    return leftValue == null && rightValue == null;
  }

  if (
    typeof leftValue === "number" &&
    typeof rightValue === "number" &&
    Number.isNaN(leftValue) &&
    Number.isNaN(rightValue)
  ) {
    return true;
  }

  if (
    typeof leftValue === "object" &&
    typeof rightValue === "object" &&
    leftValue !== null &&
    rightValue !== null
  ) {
    try {
      return JSON.stringify(leftValue) === JSON.stringify(rightValue);
    } catch {
      return false;
    }
  }

  return false;
};

// Base props shared by both modes
interface BaseTableDataGridV2Props {
  gridId: string;
  className?: string;
}

// Table mode - live database connection with editing capabilities
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

// Query mode - static query results, read-only
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
  // Note: estimatedTotal removed - causes UI flashing when it arrives late during streaming
}

// Unified props - discriminated union
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
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const scopeId = useScopedKeybindings(gridId);

  useContextKey("dataGridFocus", isGridFocused, {
    scopeId,
    resetOnUnmount: true,
  });

  const highlightColors = useMemo(
    () =>
      isDarkTheme
        ? {
            primaryText: "#BFDBFE",
            primaryCellHighlight: "rgba(96, 165, 250, 0.18)",
            primaryCellActive: "rgba(147, 197, 253, 0.24)",
            primaryRowBg: "rgba(37, 99, 235, 0.14)",
            primaryRowBgMedium: "rgba(37, 99, 235, 0.18)",
            insertText: "#BBF7D0",
            insertCellHighlight: "rgba(74, 222, 128, 0.20)",
            insertRowBg: "rgba(22, 163, 74, 0.16)",
            insertRowBgMedium: "rgba(22, 163, 74, 0.20)",
          }
        : {
            primaryText: "#1D4ED8",
            primaryCellHighlight: "rgba(59, 130, 246, 0.12)",
            primaryCellActive: "rgba(37, 99, 235, 0.18)",
            primaryRowBg: "rgba(59, 130, 246, 0.05)",
            primaryRowBgMedium: "rgba(59, 130, 246, 0.08)",
            insertText: "#166534",
            insertCellHighlight: "rgba(34, 197, 94, 0.12)",
            insertRowBg: "rgba(34, 197, 94, 0.06)",
            insertRowBgMedium: "rgba(34, 197, 94, 0.09)",
          },
    [isDarkTheme],
  );

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

  // Determine mode and extract mode-specific props
  const isTableMode = props.mode === "table";
  const isQueryMode = props.mode === "query";

  // Extract table mode props for use throughout component
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

  // Table mode: use infinite table data hook
  const tableDataQuery = useTableDataQuery({
    connectionId,
    database,
    schema,
    entityName: table,
    entityType,
    enabled: isTableMode,
    pageSize: 300, // Load 300 rows per page for better initial performance
  });

  const cancelStream = tableDataQuery.cancelStream;

  useEffect(() => {
    if (!isTableMode) {
      return;
    }
    return () => {
      cancelStream();
    };
  }, [isTableMode, cancelStream]);

  // Query mode: use static data from props
  const queryData = isQueryMode ? props.data : null;

  // Unified data interface
  const tableQueryError = tableDataQuery.error;
  const tableQueryErrorMessage =
    tableQueryError instanceof Error
      ? tableQueryError.message
      : typeof tableQueryError === "string"
      ? tableQueryError
      : null;

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
        error: tableQueryErrorMessage,
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
        hasNextPage: tableDataQuery.hasNextPage ? true : false,
      }
    : {
        isLoading: isQueryMode ? props.isLoading ?? false : false,
        isLoadingMore: isQueryMode ? props.isStreaming ?? false : false,
        error: isQueryMode ? props.error ?? null : null,
        columns: queryData?.columnMeta ?? [],
        rows: (queryData?.rows ?? []).map((row) => {
          const rowObj: GridRowModel = {};
          const backendRow = row as BackendCellValue[];
          (queryData?.columns ?? []).forEach((colName, colIndex) => {
            const rawValue = backendRow[colIndex] as
              | BackendCellValue
              | undefined;
            const colMeta = queryData?.columnMeta?.[colIndex];
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
        }),
        // Don't pass estimatedTotal for queries - it arrives late and causes UI flashing
        estimatedTotal: undefined,
        executionTime: isQueryMode ? props.executionTime : undefined,
        cursorSetupMs: isQueryMode ? props.cursorSetupMs : undefined,
        totalStreamingMs: isQueryMode ? props.totalStreamingMs : undefined,
        fetchCount: isQueryMode ? props.fetchCount : undefined,
        networkMs: isQueryMode ? props.networkMs : undefined,
        conversionMs: isQueryMode ? props.conversionMs : undefined,
        ipcSendMs: isQueryMode ? props.ipcSendMs : undefined,
        loadMore: undefined,
        hasNextPage: false,
      };

  // Editing is only enabled in table mode AND not for views/materialized views
  const isEditable = isTableMode && entityType === "table" && !isView;

  useContextKey("dataGridEditable", isEditable, {
    scopeId,
    resetOnUnmount: true,
  });

  // Load full structure (columns only) for table mode to enrich metadata such as enum values
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

  // Define editing scope for centralized store
  const scope: EditingScopeKey = useMemo(() => {
    const result = {
      connectionId: isTableMode ? connectionId : "",
      database: isTableMode ? database : "",
      schema: isTableMode ? schema || "public" : "",
      table: isTableMode ? table : "",
    };
    console.log("🎯 TableDataGridV2 scope created:", result);
    return result;
  }, [isTableMode, connectionId, database, schema, table]);

  // Ensure scope exists in store
  useEnsureScope(scope);

  // Use centralized store for editing state
  const {
    rowDrafts,
    upsertRowDraft,
    removeRowDraft,
    discardAll: discardAllStore,
  } = useTableEditData(scope);
  const setScopeMeta = useTableEditStore((state) => state.setScopeMeta);

  // Track rowDrafts size to force grid re-render when changes are discarded
  const scopeKey = useMemo(() => createScopeKey(scope), [scope]);
  const rowDraftsVersion = useTableEditStore((state) => {
    const scopeState = state.scopes.get(scopeKey);
    return scopeState?.domains.data.rowDrafts.size ?? 0;
  });

  const rowKeyMapRef = useRef(new WeakMap<GridRowModel, string>());
  const draftRowCounterRef = useRef(0);

  const [rows, setRows] = useState<GridRowModel[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Sync rows from data source
  useEffect(() => {
    // Only update rows if the data has actually changed
    if (dataRows.length > 0 && dataRows.length !== rows.length) {
      setRows(dataRows);
    }
  }, [dataRows, rows.length]);

  const preferences = useGridPreferences(gridId);
  const hydrated = useGridPreferencesHydrated();
  const history = useGridHistory();
  useContextKey("dataGridCanUndo", isEditable && history.canUndo, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridCanRedo", isEditable && history.canRedo, {
    scopeId,
    resetOnUnmount: true,
  });
  const { persistSelection, persistScrollOffset, persistActiveCell } =
    usePersistentViewState(gridId);

  // Get connection for database type detection
  const connection = useConnectionStore((state) =>
    isTableMode ? state.getConnection(connectionId) : null,
  );

  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    undefined,
  );

  // Initialize clipboard handler
  const { copySelection } = useClipboardBridge({
    toText: (selection) => {
      if (selection.rows.length === 0) {
        return "";
      }
      // Convert selected rows to TSV format
      const selectedRows = selection.rows
        .toArray()
        .map((idx) => rows[idx])
        .filter(Boolean);

      if (selectedRows.length === 0) return "";

      const headers = finalColumns.map((col) => col.name).join("\t");
      const dataRows = selectedRows.map((row) =>
        finalColumns
          .map((col) => {
            const value = row?.[col.field];
            if (!value || typeof value !== "object") return "";
            return String(value.value ?? "");
          })
          .join("\t"),
      );

      return [headers, ...dataRows].join("\n");
    },
    toJson: (selection) => {
      if (selection.rows.length === 0) {
        return [];
      }
      return selection.rows
        .toArray()
        .map((idx) => rows[idx])
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

      const key = event.key?.toLowerCase();
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
      when: "dataGridFocus && !selectionEmpty && !editingCell",
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
      when: "dataGridFocus && !selectionEmpty && !editingCell",
    },
  );

  useCommand(
    "dataGrid.action.undo",
    () => {
      if (!isEditable || !history.canUndo) {
        return;
      }
      history.undo();
    },
    {
      label: "Undo Last Edit",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell",
      enabledWhen: "dataGridCanUndo",
    },
  );

  useCommand(
    "dataGrid.action.redo",
    () => {
      if (!isEditable || !history.canRedo) {
        return;
      }
      history.redo();
    },
    {
      label: "Redo Last Edit",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell",
      enabledWhen: "dataGridCanRedo",
    },
  );

  // REMOVED: Automatic state restoration disabled for tab isolation
  // With the new gridId scheme (including panelId and tabId), each tab maintains
  // its own state while mounted. Restoring state on mount is no longer needed
  // and can cause confusing "ghost" selections when switching tabs.
  // useEffect(() => {
  //   if (!hydrated) return;
  //   if (persistedView.selection && !gridSelection) {
  //     setGridSelection(persistedView.selection);
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [hydrated]); // Only depend on hydrated to run once after store loads

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

  // Get primary key columns from table structure (NOT from query columnMeta)
  const primaryKeyColumns = useMemo(() => {
    if (!tableStructure?.columns) {
      return [];
    }
    const pkCols = tableStructure.columns
      .filter((col) => col.is_pk)
      .map((col) => col.name);

    if (pkCols.length > 0) {
      console.log("🔑 Primary key columns from structure:", {
        table: `${schema}.${table}`,
        primaryKey: pkCols,
      });
    }
    return pkCols;
  }, [tableStructure?.columns, schema, table]);

  // Update scope metadata with primary key information
  useEffect(() => {
    if (isTableMode && primaryKeyColumns.length > 0) {
      setScopeMeta(scope, { primaryKey: primaryKeyColumns });
    }
  }, [isTableMode, primaryKeyColumns, scope, setScopeMeta]);

  // Pre-compute row keys map to avoid calling getRowKey in getCellContent
  const rowKeysMap = useMemo(() => {
    const map = new Map<number, string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      // Check cache first
      const cached = rowKeyMapRef.current.get(row);
      if (cached) {
        map.set(i, cached);
        continue;
      }

      // Compute key
      let computedKey: string | null = null;
      if (primaryKeyColumns.length > 0) {
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

        const hasNonNull = parts.some((part) => part !== "__null__");
        if (hasNonNull) {
          computedKey = `${schema ?? "public"}.${table}:pk:${parts.join("|")}`;
        }
      }

      if (!computedKey) {
        computedKey = `${
          schema ?? "public"
        }.${table}:draft-${draftRowCounterRef.current++}`;
      }

      rowKeyMapRef.current.set(row, computedKey);
      map.set(i, computedKey);
    }
    return map;
  }, [rows, primaryKeyColumns, schema, table]);

  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) {
        return `${schema ?? "public"}.${table}:row-${index}`;
      }

      const existing = rowKeyMapRef.current.get(row);
      if (existing) {
        return existing;
      }

      let computedKey: string | null = null;

      if (primaryKeyColumns.length > 0) {
        const parts = primaryKeyColumns.map((columnName) => {
          const cell = row[columnName];
          const value = cell?.value;
          if (value === null || value === undefined) {
            return "__null__";
          }
          if (typeof value === "object") {
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          }
          return String(value);
        });

        const hasNonNull = parts.some((part) => part !== "__null__");

        if (hasNonNull) {
          computedKey = `${schema ?? "public"}.${table}:pk:${parts.join("|")}`;
        }
      }

      if (!computedKey) {
        computedKey = `${
          schema ?? "public"
        }.${table}:draft-${draftRowCounterRef.current++}`;
      }

      rowKeyMapRef.current.set(row, computedKey);
      return computedKey;
    },
    [primaryKeyColumns, schema, table],
  );

  // Row pinning - persist to grid preferences
  const handlePinnedRowsChange = useCallback(
    (pinnedRowIds: string[]) => {
      if (!hydrated) return;
      useGridPreferencesStore
        .getState()
        .updatePinnedRows(gridId, () => pinnedRowIds);
    },
    [gridId, hydrated],
  );

  const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } =
    useRowPinning({
      rows,
      initialPinned: preferences?.pinnedRows ?? [],
      maxPinnedRows: 5,
      getRowId: getRowKey,
      onChange: handlePinnedRowsChange,
    });

  // Combine pinned and unpinned rows for display
  const displayRows = useMemo(() => {
    return [...pinnedRows, ...unpinnedRows];
  }, [pinnedRows, unpinnedRows]);

  // Discard all pending edits and revert to last loaded data snapshot
  const discardAllChanges = useCallback(() => {
    discardAllStore();
    // Re-sync to server rows
    setRows(dataRows);
    toast({ description: "Discarded pending edits" });
  }, [dataRows, toast, discardAllStore]);

  // Save pending edits using centralized apply service
  const handleSaveAllChanges = useCallback(async () => {
    console.log("💾 Save button clicked", {
      rowDraftsSize: rowDrafts.size,
      isTableMode,
      scope,
    });

    if (rowDrafts.size === 0) {
      console.warn("⚠️ No changes to save (rowDrafts.size === 0)");
      return;
    }
    if (!isTableMode) {
      console.warn("⚠️ Not in table mode");
      return;
    }

    setIsSaving(true);
    try {
      const pkColumns = primaryKeyColumns;
      console.log("🔑 Primary key columns:", pkColumns);
      console.log(
        "🔍 Column meta:",
        columnMeta.map((c) => ({ name: c.name, is_pk: c.is_pk })),
      );

      if (pkColumns.length === 0) {
        console.error("❌ No primary key columns found in table structure");
        toast({
          description:
            "Cannot save edits — table has no primary key defined. Please add a primary key to this table.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      // Get scope state from store
      const scopeState = useTableEditStore.getState().getScopeState(scope);
      console.log("📦 Scope state:", scopeState?.summary);

      if (!scopeState) {
        console.error("❌ Invalid scope state");
        toast({
          description: "Invalid scope state",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      console.log("🚀 Applying changes...");
      // Apply changes using the centralized service
      const result = await applyChangesService.applyScope(
        scope,
        scopeState,
        connection?.type || "postgresql",
        {
          domains: ["data"],
          continueOnError: false,
        },
      );

      console.log("✅ Apply result:", result);

      if (result.success) {
        const applied = result.applied?.data
          ? result.applied.data.applied || 0
          : 0;
        toast({
          description: `Saved ${applied} change(s)`,
        });
        // Discard changes from store after successful save
        discardAllStore();
        // Optionally refresh data from server
        // await tableDataQuery.refetch();
      } else {
        const appliedData = result.applied ? result.applied.data : undefined;
        const dataErrors = appliedData ? appliedData.errors : undefined;
        const errorMsg =
          (dataErrors && dataErrors[0]) || "Failed to save changes";
        console.error("❌ Save failed:", errorMsg);
        toast({ description: errorMsg, variant: "destructive" });
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Failed to save changes";
      console.error("❌ Save error:", error);
      toast({ description: errorMsg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [
    rowDrafts,
    isTableMode,
    primaryKeyColumns,
    scope,
    connection,
    toast,
    discardAllStore,
    columnMeta,
  ]);

  const columnState = preferences?.columns ?? DEFAULT_COLUMN_STATE;

  // Initialize column order and visibility when columns first load
  useEffect(() => {
    if (!hydrated || baseColumns.length === 0) return;

    const expectedOrder = baseColumns.map((column) => column.id);

    // Only sync if we don't have any saved preferences yet
    const isInitialLoad = columnState.order.length === 0;

    if (isInitialLoad) {
      upsertGridColumnsState(gridId, (draft) => {
        draft.order = expectedOrder;
        // Initialize all columns as visible
        expectedOrder.forEach((id) => {
          draft.visibility[id] = true;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseColumns.length, gridId, hydrated]); // Only depend on column count change, not the state itself

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order],
  );

  // (old immediate persister removed in favor of throttledWidthsChange)

  // Throttle persisting widths to avoid IndexedDB write storms during drag
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
      let changed = false;
      const keys = Object.keys(latest);
      if (keys.length !== Object.keys(current).length) {
        changed = true;
      } else {
        for (const k of keys) {
          if (current[k] !== latest[k]) {
            changed = true;
            break;
          }
        }
      }
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
        const curKeys = Object.keys(current);
        const visKeys = Object.keys(visibility);
        let changed = curKeys.length !== visKeys.length;
        if (!changed) {
          for (const k of visKeys) {
            if (current[k] !== visibility[k]) {
              changed = true;
              break;
            }
          }
        }
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
        let changed = current.length !== pinned.length;
        if (!changed) {
          for (let i = 0; i < pinned.length; i++) {
            if (current[i] !== pinned[i]) {
              changed = true;
              break;
            }
          }
        }
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

  const rowsRef = useRef(displayRows);
  rowsRef.current = displayRows;

  // Note: Row index normalization is now handled by the centralized store
  // The store automatically maintains correct rowIndex values

  const handleGetCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumns[colIndex];
      const row = rowsRef.current[rowIndex];
      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: isEditable,
          readonly: !isEditable,
        } as const;
      }

      // Check for pending edits and merge with original row data
      let cellValue = row[column.field] as FrontCellValue | null | undefined;

      // Get row key to check for pending edits (use pre-computed map)
      const rowKey =
        rowKeysMap.get(rowIndex) ??
        `${schema ?? "public"}.${table}:row-${rowIndex}`;
      const editingRowDraft = rowDrafts.get(rowKey);

      const editedCellDraft =
        editingRowDraft?.cells.get(column.field) ?? undefined;

      if (editedCellDraft && editedCellDraft.hasChanged) {
        cellValue = editedCellDraft.draftValue;
      }

      const gridCellBase = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: !isEditable,
      });
      const gridCell = gridCellBase;

      let cellThemeOverride: Partial<Theme> | undefined;
      if (editingRowDraft) {
        if (editingRowDraft.action === "insert") {
          cellThemeOverride = {
            textDark: highlightColors.insertText,
            textMedium: highlightColors.insertText,
            bgCell: highlightColors.insertRowBg,
            bgCellMedium: highlightColors.insertRowBgMedium,
          };
        } else if (editedCellDraft?.hasChanged) {
          cellThemeOverride = {
            textDark: highlightColors.primaryText,
            textMedium: highlightColors.primaryText,
            bgCell: highlightColors.primaryRowBg,
            bgCellMedium: highlightColors.primaryRowBgMedium,
          };
        }
      }

      // Apply text truncation for text cells
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
        const availableWidth = widthCap - 16; // Account for padding
        const truncated = truncateTextToWidth(text, availableWidth);
        const themedTextCell = {
          ...gridCell,
          displayData: truncated, // Truncated text for display
          themeOverride: cellThemeOverride
            ? { ...gridCell.themeOverride, ...cellThemeOverride }
            : gridCell.themeOverride,
        };
        return themedTextCell;
      }

      if (cellThemeOverride) {
        return {
          ...gridCell,
          themeOverride: {
            ...gridCell.themeOverride,
            ...cellThemeOverride,
          },
        };
      }

      return gridCell;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      finalColumns,
      rowKeysMap,
      highlightColors,
      rowDrafts,
      schema,
      table,
      isEditable,
      rowDraftsVersion, // Force re-render when drafts are discarded
    ],
  );

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      persistSelection(selection);
    },
    [persistSelection],
  );

  // Track currently editing cell (for bright cell highlight)
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    columnIndex: number;
  } | null>(null);

  useEffect(() => {
    if (!isEditable) {
      setEditingCell(null);
    }
  }, [isEditable]);

  useContextKey("editingCell", editingCell != null, {
    scopeId,
    resetOnUnmount: true,
  });

  // Track row details sheet visibility
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);

  const handleEditCommit = useCallback(
    (event: GridEditCommitEvent): GridHistoryEntry => {
      const { rowIndex, column, newValue, previousValue } = event;
      const currentRow = rows[rowIndex];
      if (!currentRow || !column.field) {
        return {
          undo: () => {},
          redo: () => {},
        };
      }

      const rowKey = getRowKey(currentRow, rowIndex);
      console.log("📝 Cell edited:", {
        rowKey,
        column: column.field,
        hasPK: primaryKeyColumns.length > 0,
      });

      // Create updated row with new value
      const updatedRow = { ...currentRow };
      rowKeyMapRef.current.set(updatedRow, rowKey);

      // Convert grid cell value back to CellValue format
      if ("data" in newValue) {
        type GridCellWithData = GridCell & { data?: unknown };
        type GridCellWithActualValue = GridCell & { actualValue?: unknown };

        let cellValue: unknown = (newValue as GridCellWithData).data;

        if (newValue.kind === GridCellKind.Custom) {
          const customData = (newValue as GridCellWithData).data;
          if (isBooleanCellPayload(customData)) {
            cellValue = customData.value;
          } else if (isEnumCellPayload(customData)) {
            cellValue = customData.value;
          } else if (
            typeof customData === "object" &&
            customData !== null &&
            "kind" in customData &&
            (customData as { kind?: unknown }).kind
          ) {
            const cellKind = String((customData as { kind: unknown }).kind);

            // Date/time cells
            if (
              ["date-cell", "time-cell", "datetime-cell"].includes(cellKind)
            ) {
              const v = (customData as { value?: unknown }).value;
              if (v == null) {
                cellValue = null;
              } else if (typeof v === "string") {
                cellValue = v;
              } else if (v instanceof Date) {
                cellValue = v.toISOString();
              } else {
                cellValue = null;
              }
            }
            // Number cells
            else if (cellKind === "number-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // JSON cells
            else if (cellKind === "json-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // UUID cells
            else if (cellKind === "uuid-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // Text cells (single and multi-line)
            else if (
              cellKind === "text-single-cell" ||
              cellKind === "text-multi-cell"
            ) {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // Reference cells (FK)
            else if (cellKind === "reference-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // HStore cells
            else if (cellKind === "hstore-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
            // DateTime range cells
            else if (cellKind === "tstzrange-cell") {
              const v = (customData as { value?: unknown }).value;
              cellValue = v == null ? null : v;
            }
          }
        } else if (newValue.kind === GridCellKind.Boolean) {
          const actualValue = (newValue as GridCellWithActualValue).actualValue;
          cellValue = actualValue ?? (newValue as GridCellWithData).data;
        }

        updatedRow[column.field] = {
          value: ((): unknown => {
            // Ensure we never store a Date instance directly in CellValue.value
            if (cellValue instanceof Date) return cellValue.toISOString();
            return cellValue;
          })(),
          db_type: column.meta?.db_type ?? "text",
          value_type:
            cellValue === null || cellValue === undefined
              ? "Null"
              : typeof cellValue === "string"
              ? "String"
              : typeof cellValue === "number"
              ? "Number"
              : typeof cellValue === "boolean"
              ? "Boolean"
              : "Null",
          is_truncated: false,
        } as FrontCellValue;
      }

      const updatedCell = updatedRow[column.field] as
        | FrontCellValue
        | null
        | undefined;

      if (areCellValuesEqual(previousValue ?? null, updatedCell ?? null)) {
        console.log("ℹ️ Cell edit ignored – no change detected", {
          table,
          row: rowIndex,
          column: column.field,
        });
        setEditingCell(null);
        return {
          undo: () => {},
          redo: () => {},
        };
      }

      // Get existing draft from store or create new one
      const existingDraft = rowDrafts.get(rowKey);
      const cells: Map<string, StoreCellDraft> = existingDraft?.cells
        ? new Map(existingDraft.cells as Map<string, StoreCellDraft>)
        : new Map();

      // Update cell draft
      cells.set(column.field, {
        columnId: column.field,
        originalValue: previousValue || null,
        draftValue: updatedCell || null,
        hasChanged: true,
      });

      // Create row draft for store
      const draft: StoreDraft = {
        rowKey,
        rowIndex,
        action: existingDraft?.action || "update",
        createdAt: existingDraft?.createdAt || Date.now(),
        updatedAt: Date.now(),
        originalRow: existingDraft?.originalRow || currentRow,
        draftRow: updatedRow,
        cells,
      };

      // Write to centralized store
      console.log("💾 upsertRowDraft (handleEditCommit):", {
        rowKey,
        action: draft.action,
        scope,
      });
      upsertRowDraft(rowKey, draft);

      // Optimistic update
      const newRows = [...rows];
      newRows[rowIndex] = updatedRow;
      setRows(newRows);

      // TODO: Send mutation to backend
      // For now, just log the change
      type GridCellForLog = GridCell & { data?: unknown };

      console.log("✅ Cell edit committed:", {
        table,
        row: rowIndex,
        rowKey,
        column: column.field,
        newValue: (newValue as GridCellForLog).data,
        previousValue: previousValue?.value,
        updatedCell: updatedCell,
      });

      // Note: Undo/redo is now handled by centralized store
      // Return empty handlers for compatibility with grid history API
      return {
        undo: () => {
          // Centralized store handles undo
          setEditingCell(null);
        },
        redo: () => {
          // Centralized store handles redo
          setEditingCell(null);
        },
      };
    },
    [
      getRowKey,
      rows,
      table,
      rowDrafts,
      upsertRowDraft,
      scope,
      primaryKeyColumns,
    ],
  );

  const handleRowAppend = useCallback(
    (event: GridRowAppendEvent): GridHistoryEntry => {
      const { draftRow, position } = event;

      const insertionIndex = (() => {
        if (position === "bottom") {
          return rows.length;
        }
        if (position === "top") {
          return 0;
        }
        if (typeof position === "number" && Number.isFinite(position)) {
          return Math.max(0, Math.min(rows.length, Math.trunc(position)));
        }
        return 0;
      })();

      const newRows = [...rows];
      newRows.splice(insertionIndex, 0, draftRow);

      const rowKey = getRowKey(draftRow, insertionIndex);

      // Create insert draft for store
      const draft: StoreDraft = {
        rowKey,
        rowIndex: insertionIndex,
        action: "insert",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalRow: null,
        draftRow: draftRow,
        cells: new Map(),
      };

      // Write to centralized store
      upsertRowDraft(rowKey, draft);

      setRows(newRows);

      toast({
        description: "New row added. Edit cells to set values.",
      });

      // Note: Undo/redo is handled by centralized store
      return {
        undo: () => {},
        redo: () => {},
      };
    },
    [getRowKey, rows, toast, upsertRowDraft],
  );

  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent): GridHistoryEntry => {
      const { rowIndexes } = event;
      const removalSet = new Set(rowIndexes);
      const sortedIndexes = [...removalSet].sort((a, b) => b - a);
      // Keep rows visible, mark them as pending deletion in editing state

      for (const rowIndex of sortedIndexes) {
        const row = rows[rowIndex];
        if (!row) {
          continue;
        }
        const rowKey = getRowKey(row, rowIndex);

        // Check if this was an insert - if so, just remove it from store
        const existingDraft = rowDrafts.get(rowKey);
        if (existingDraft?.action === "insert") {
          removeRowDraft(rowKey);
        } else {
          // Mark as deleted in store
          const draft: StoreDraft = {
            rowKey,
            rowIndex,
            action: "delete",
            createdAt: existingDraft?.createdAt || Date.now(),
            updatedAt: Date.now(),
            originalRow: existingDraft?.originalRow || row,
            draftRow: null,
            cells: new Map(),
          };
          upsertRowDraft(rowKey, draft);
        }
      }

      toast({
        description: `Deleted ${rowIndexes.length} row(s)`,
        variant: "destructive",
      });

      // Note: Undo/redo is handled by centralized store
      return {
        undo: () => {},
        redo: () => {},
      };
    },
    [getRowKey, rows, toast, rowDrafts, removeRowDraft, upsertRowDraft],
  );

  const handlePaste = useCallback(
    (event: GridPasteEvent): boolean => {
      const { target, values } = event;
      const [colStart, rowStart] = target;

      // Update cells with pasted values
      const newRows = [...rows];

      for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
        const rowValues = values[rowOffset];
        if (!rowValues) {
          continue;
        }
        const targetRowIdx = rowStart + rowOffset;
        if (targetRowIdx >= rows.length) {
          continue; // Skip if beyond existing rows
        }

        const currentRow = rows[targetRowIdx];
        if (!currentRow) {
          continue;
        }

        const rowKey = getRowKey(currentRow, targetRowIdx);
        const updatedRow = { ...currentRow };
        rowKeyMapRef.current.set(updatedRow, rowKey);

        // Get existing draft from store or create new one
        const existingDraft = rowDrafts.get(rowKey);
        const cells: Map<string, StoreCellDraft> = existingDraft?.cells
          ? new Map(existingDraft.cells as Map<string, StoreCellDraft>)
          : new Map();

        for (let colOffset = 0; colOffset < rowValues.length; colOffset += 1) {
          const value = rowValues[colOffset];
          const targetColIdx = colStart + colOffset;
          const column = finalColumns[targetColIdx];
          if (!column || !column.field) {
            continue;
          }

          const newCell = {
            value,
            db_type: column.meta?.db_type ?? "text",
            value_type:
              typeof value === "string"
                ? "String"
                : typeof value === "number"
                ? "Number"
                : typeof value === "boolean"
                ? "Boolean"
                : "Null",
            is_truncated: false,
          } as FrontCellValue;

          updatedRow[column.field] = newCell;

          // Update cell draft
          cells.set(column.field, {
            columnId: column.field,
            originalValue: currentRow[column.field] || null,
            draftValue: newCell,
            hasChanged: true,
          });
        }

        // Create row draft for store
        const draft: StoreDraft = {
          rowKey,
          rowIndex: targetRowIdx,
          action: existingDraft?.action || "update",
          createdAt: existingDraft?.createdAt || Date.now(),
          updatedAt: Date.now(),
          originalRow: existingDraft?.originalRow || currentRow,
          draftRow: updatedRow,
          cells,
        };

        // Write to centralized store
        upsertRowDraft(rowKey, draft);

        newRows[targetRowIdx] = updatedRow;
      }

      setRows(newRows);

      // Note: History is tracked by centralized store
      history.push({
        undo: () => {},
        redo: () => {},
      });

      toast({
        description: "Pasted content successfully",
      });

      return true;
    },
    [finalColumns, getRowKey, history, rows, toast, rowDrafts, upsertRowDraft],
  );

  // Debounced scroll persistence to improve performance
  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      // Debounce scroll persistence to avoid too many updates
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        persistScrollOffset({ x: region.x, y: region.y });
      }, 150);

      // Check for infinite scroll trigger
      const threshold = rows.length - 500;
      const nearEnd = region.y + region.height > threshold;
      if (nearEnd && hasNextPage && !isLoadingMore && loadMore) {
        void loadMore();
      }
    },
    [persistScrollOffset, rows.length, hasNextPage, isLoadingMore, loadMore],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex) return;
      setTimeout(() => {
        upsertGridColumnsState(gridId, (draft) => {
          const order = draft.order.length
            ? [...draft.order]
            : finalColumns.map((column) => column.id);
          const [moved] = order.splice(startIndex, 1);
          if (moved === undefined) return;
          order.splice(endIndex, 0, moved);
          draft.order = order;
        });
      }, 0);
    },
    [finalColumns, gridId],
  );

  const errorMessage = typeof error === "string" ? error : null;

  // Build row highlight sets (place hooks before any early returns)
  const selectedRowsSet = useMemo(() => {
    const rowsSel = gridSelection ? gridSelection.rows.toArray() : [];
    const set = new Set<number>(rowsSel);
    // Merge rectangular selection rows
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

  // Get selected rows and their keys for context menu
  const selectedRows = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => displayRows[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }, [selectedRowsSet, displayRows]);

  const selectedRowKeys = useMemo(() => {
    return Array.from(selectedRowsSet)
      .map((idx) => rowKeysMap.get(idx))
      .filter((key): key is string => key !== undefined);
  }, [selectedRowsSet, rowKeysMap]);

  const pendingDeletedRowIndexes = useMemo(() => {
    const result = new Set<number>();
    rowDrafts.forEach((draft: StoreDraft) => {
      if (draft.action === "delete") {
        result.add(draft.rowIndex);
      }
    });
    return result;
  }, [rowDrafts]);

  const pendingInsertedRowIndexes = useMemo(() => {
    const result = new Set<number>();
    rowDrafts.forEach((draft: StoreDraft) => {
      if (draft.action === "insert") {
        result.add(draft.rowIndex);
      }
    });
    return result;
  }, [rowDrafts]);

  const pendingUpdatedRowIndexes = useMemo(() => {
    const result = new Set<number>();
    rowDrafts.forEach((draft: StoreDraft) => {
      if (draft.action === "delete" || draft.action === "insert") return;
      if (draft.cells.size > 0) {
        result.add(draft.rowIndex);
      }
    });
    return result;
  }, [rowDrafts]);

  // Column id -> index map for building cell highlight regions
  const columnIndexById = useMemo(() => {
    const m = new Map<string, number>();
    finalColumns.forEach((c, idx) => {
      m.set(c.id, idx);
    });
    return m;
  }, [finalColumns]);

  // Regions for all edited cells (uncommitted) across the grid
  const editedCellRegions = useMemo(() => {
    const regions: Array<{ color: string; range: Rectangle }> = [];
    if (rowDrafts.size === 0) return regions;
    rowDrafts.forEach((draft) => {
      draft.cells.forEach((cellDraft: StoreCellDraft, columnId: string) => {
        if (!cellDraft.hasChanged) return;
        const colIndex = columnIndexById.get(columnId);
        if (colIndex == null) return;
        regions.push({
          color:
            draft.action === "insert"
              ? highlightColors.insertCellHighlight
              : highlightColors.primaryCellHighlight,
          range: { x: colIndex, y: draft.rowIndex, width: 1, height: 1 },
        });
      });
    });
    return regions;
  }, [columnIndexById, rowDrafts, highlightColors]);

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Highest precedence: pending deletion
      if (pendingDeletedRowIndexes.has(rowIndex)) {
        return {
          bgCell: "rgba(239, 68, 68, 0.10)", // red-500 @ 10%
          bgCellMedium: "rgba(239, 68, 68, 0.12)",
        } as Partial<Theme>;
      }
      if (pendingInsertedRowIndexes.has(rowIndex)) {
        return {
          bgCell: highlightColors.insertRowBg,
          bgCellMedium: highlightColors.insertRowBgMedium,
        } as Partial<Theme>;
      }
      if (pendingUpdatedRowIndexes.has(rowIndex)) {
        return {
          bgCell: highlightColors.primaryRowBg,
          bgCellMedium: highlightColors.primaryRowBgMedium,
        } as Partial<Theme>;
      }
      // Pinned rows (blue tint)
      if (rowIndex < pinnedRows.length) {
        return {
          bgCell: "rgba(59, 130, 246, 0.08)", // blue-500 @ 8%
          bgCellMedium: "rgba(59, 130, 246, 0.10)",
        } as Partial<Theme>;
      }
      // Selected rows subtle highlight
      if (selectedRowsSet.has(rowIndex)) {
        return {
          bgCell: "rgba(252, 163, 17, 0.10)", // accent @ 10%
          bgCellMedium: "rgba(252, 163, 17, 0.12)",
        } as Partial<Theme>;
      }
      return undefined;
    },
    [
      pendingInsertedRowIndexes,
      pendingUpdatedRowIndexes,
      pendingDeletedRowIndexes,
      selectedRowsSet,
      pinnedRows.length,
      highlightColors,
    ],
  );

  // Surface Save/Discard actions in the panel toolbar like other tabs (only in table mode)
  useEffect(() => {
    if (!isTableMode || !isEditable || !onActionsChange) return;
    const hasChanges = rowDrafts.size > 0;
    const actions = hasChanges ? (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={discardAllChanges}
          disabled={isSaving}
          className="h-6 text-xs px-2 py-0"
        >
          <X className="h-3 w-3 mr-1" />
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleSaveAllChanges}
          disabled={isSaving}
          className="h-6 text-xs px-2 py-0"
        >
          {isSaving ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Save className="h-3 w-3 mr-1" />
          )}
          Save All
        </Button>
      </>
    ) : null;
    onActionsChange(actions);
    return () => {
      onActionsChange(null);
    };
  }, [
    isTableMode,
    isEditable,
    onActionsChange,
    rowDrafts.size,
    isSaving,
    discardAllChanges,
    handleSaveAllChanges,
  ]);

  // Calculate selected row count from the set
  const selectedRowCount = selectedRowsSet.size;
  const hasSelection = selectedRowCount > 0;

  useContextKey("selectionEmpty", !hasSelection, {
    scopeId,
    resetOnUnmount: true,
  });

  // (rectangular rows merged into selectedRowsSet above)

  // Bright highlight for all edited cells; also include the live editing cell slightly brighter
  const cellHighlightRegions = useMemo(() => {
    const regions = [...editedCellRegions];
    if (editingCell) {
      regions.push({
        color: highlightColors.primaryCellActive,
        range: {
          x: editingCell.columnIndex,
          y: editingCell.rowIndex,
          width: 1,
          height: 1,
        },
      });
    }
    return regions;
  }, [editedCellRegions, editingCell, highlightColors]);

  // Context menu handlers (defined before early returns)
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

  const handleDeleteFromMenu = useCallback(() => {
    const rowIndexes = Array.from(selectedRowsSet);
    if (rowIndexes.length === 0 || !isEditable || !gridSelection) return;
    const rowsToDelete = rowIndexes
      .map((index) => displayRows[index])
      .filter((row): row is GridRowModel => Boolean(row));
    const result = handleRowDelete({
      selection: gridSelection,
      rowIndexes,
      rows: rowsToDelete,
    });
    history.push(result);
  }, [
    selectedRowsSet,
    isEditable,
    displayRows,
    handleRowDelete,
    gridSelection,
    history,
  ]);

  useCommand(
    "dataGrid.action.deleteRows",
    () => {
      if (!isEditable) {
        return;
      }
      handleDeleteFromMenu();
    },
    {
      label: "Delete Selected Rows",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty",
    },
  );

  const handlePasteFromMenu = useCallback(() => {
    if (!isEditable) return;
    void navigator.clipboard
      .readText()
      .then((text) => {
        // Trigger paste at current active cell or (0,0)
        const target: Item = [0, displayRows.length];
        const values = text
          .trim()
          .split("\n")
          .map((line) => line.split("\t"));
        const event: GridPasteEvent = { target, values };
        handlePaste(event);
      })
      .catch(() => {
        toast({
          description: "Failed to read clipboard",
          variant: "destructive",
        });
      });
  }, [isEditable, displayRows.length, handlePaste, toast]);

  const handleAddRowFromMenu = useCallback(() => {
    if (!isEditable) return;
    const position: GridRowAppendEvent["position"] = "top";
    const baseRow: GridRowModel = {};
    finalColumns.forEach((col) => {
      baseRow[col.field] = {
        value: null,
        db_type: col.meta?.db_type ?? "text",
        value_type: "Null",
        is_truncated: false,
      };
    });
    const result = handleRowAppend({ position, draftRow: baseRow });
    history.push(result);
  }, [isEditable, handleRowAppend, finalColumns, history]);

  // Insert row above selected row
  const handleInsertRowAbove = useCallback(() => {
    if (!isEditable) return;

    // Get the first selected row index (default to 0 if no selection)
    const firstSelectedIdx = selectedRows.length > 0 ? selectedRows[0] : 0;

    const baseRow: GridRowModel = {};
    finalColumns.forEach((col) => {
      baseRow[col.field] = {
        value: null,
        db_type: col.meta?.db_type ?? "text",
        value_type: "Null",
        is_truncated: false,
      };
    });

    // Use numeric position to insert at specific index
    const result = handleRowAppend({
      position: firstSelectedIdx || ("top" as any),
      draftRow: baseRow,
    });
    history.push(result);
  }, [isEditable, handleRowAppend, finalColumns, history, selectedRows]);

  // Insert row below selected row
  const handleInsertRowBelow = useCallback(() => {
    if (!isEditable) return;

    // Get the first selected row index (default to 0 if no selection)
    const firstSelectedIdx = selectedRows.length > 0 ? selectedRows[0] : 0;

    const baseRow: GridRowModel = {};
    finalColumns.forEach((col) => {
      baseRow[col.field] = {
        value: null,
        db_type: col.meta?.db_type ?? "text",
        value_type: "Null",
        is_truncated: false,
      };
    });

    // Use numeric position to insert at specific index
    const result = handleRowAppend({
      position: ((firstSelectedIdx || 0) as number) + 1,
      draftRow: baseRow,
    });
    history.push(result);
  }, [isEditable, handleRowAppend, finalColumns, history, selectedRows]);

  useCommand(
    "dataGrid.action.insertRowAbove",
    () => {
      if (!isEditable) {
        return;
      }
      handleInsertRowAbove();
    },
    {
      label: "Insert Row Above Selection",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty",
    },
  );

  useCommand(
    "dataGrid.action.insertRowBelow",
    () => {
      if (!isEditable) {
        return;
      }
      handleInsertRowBelow();
    },
    {
      label: "Insert Row Below Selection",
      category: "Data Grid",
      when: "dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty",
    },
  );

  // Early returns for loading/error states
  if (!hydrated) {
    return null;
  }

  if (errorMessage) {
    return <DataGridErrorState error={errorMessage} />;
  }

  if (!isLoading && rows.length === 0) {
    return <DataGridEmptyState />;
  }

  if (isLoading && rows.length === 0) {
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
          allRows={displayRows}
          columns={finalColumns}
          pinnedRowKeys={pinnedRowIds}
          maxPinnedRows={5}
          tableName={isTableMode ? table : "query"}
          schema={isTableMode ? schema : undefined}
          databaseType={connection?.type ?? "postgresql"}
          onPinRows={isEditable ? handlePinRowsFromMenu : undefined}
          onUnpinRows={isEditable ? handleUnpinRowsFromMenu : undefined}
          onAddRow={isEditable ? handleAddRowFromMenu : undefined}
          onInsertRowAbove={isEditable ? handleInsertRowAbove : undefined}
          onInsertRowBelow={isEditable ? handleInsertRowBelow : undefined}
          onDeleteRows={isEditable ? handleDeleteFromMenu : undefined}
          onPaste={isEditable ? handlePasteFromMenu : undefined}
          showDetailsSheet={showDetailsSheet}
          onShowDetailsSheetChange={setShowDetailsSheet}
        >
          <EditableDataGrid
            containerClassName={cn("h-full", className)}
            rows={displayRows}
            columns={finalColumns}
            getCellContent={handleGetCellContent}
            history={history}
            onCellEditStart={
              isEditable
                ? (coords) => {
                    setEditingCell({
                      rowIndex: coords.rowIndex,
                      columnIndex: coords.columnIndex,
                    });
                  }
                : undefined
            }
            onCellEditCommit={isEditable ? handleEditCommit : undefined}
            onCellEditCancel={
              isEditable
                ? () => {
                    setEditingCell(null);
                  }
                : undefined
            }
            onRowAppend={isEditable ? handleRowAppend : undefined}
            onRowDelete={isEditable ? handleRowDelete : undefined}
            onPaste={isEditable ? handlePaste : undefined}
            // Avoid work during drag by not updating overlays when resizing
            onColumnResize={(col, size) => {
              handleColumnResize(col, size);
            }}
            onColumnResizeEnd={(column, size) => {
              handleColumnResizeEnd(column, size);
              flushWidths();
            }}
            onColumnMoved={handleColumnMoved}
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
        loadedRows={displayRows.length}
        estimatedTotal={estimatedTotal ?? undefined}
        hasMore={hasNextPage}
        isStreaming={isLoadingMore}
        selectedRows={selectedRowCount}
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

// Keep memo wrapper for backward compatibility
export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
