import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useInfiniteTableData } from "../hooks/useInfiniteTableData";
import { buildGridCellV2 } from "../utils/cellFactory";
import { truncateTextToWidth } from "../utils/textUtils";
import {
  DataGridEmptyState,
  DataGridErrorState,
  DataGridLoadingIndicator,
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
} from "../stores";
import {
  useColumnPinning,
  useColumnSizing,
  useColumnVisibility,
} from "../hooks";
import {
  applyPinnedOrdering,
  computeBaseWidth,
  filterVisibleColumns,
  reorderColumns,
} from "./columnUtils";
import { useToast } from "@/hooks/use-toast";
import type { CellValue } from "@/types/cellValue";
import type { Theme } from "@glideapps/glide-data-grid";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";

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

type RowEditAction = "insert" | "update" | "delete";

interface EditingCellDraft {
  columnId: string;
  originalValue: CellValue | null;
  draftValue: CellValue | null;
  hasChanged: boolean;
}

interface RowEditDraft {
  rowKey: string;
  rowIndex: number;
  action: RowEditAction;
  createdAt: number;
  updatedAt: number;
  originalRow: GridRowModel | null;
  draftRow: GridRowModel | null;
  cells: Map<string, EditingCellDraft>;
}

interface UpsertCellEditParams {
  rowKey: string;
  rowIndex: number;
  columnId: string;
  originalCell: CellValue | null | undefined;
  draftCell: CellValue | null | undefined;
  originalRowSnapshot: GridRowModel | null;
  draftRowSnapshot: GridRowModel | null;
  actionHint?: RowEditAction;
}

interface RowMutationParams {
  rowKey: string;
  rowIndex: number;
  row: GridRowModel | null;
}

const areCellValuesEqual = (
  left: CellValue | null | undefined,
  right: CellValue | null | undefined,
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

const cloneEditingState = (
  state: Map<string, RowEditDraft>,
): Map<string, RowEditDraft> => {
  const clone = new Map<string, RowEditDraft>();
  state.forEach((entry, key) => {
    clone.set(key, {
      ...entry,
      cells: new Map(entry.cells),
    });
  });
  return clone;
};

const upsertCellEditState = (
  prevState: Map<string, RowEditDraft>,
  params: UpsertCellEditParams,
): { state: Map<string, RowEditDraft>; changed: boolean } => {
  const {
    rowKey,
    rowIndex,
    columnId,
    originalCell,
    draftCell,
    originalRowSnapshot,
    draftRowSnapshot,
    actionHint,
  } = params;

  const previousEntry = prevState.get(rowKey);
  const baselineOriginal =
    previousEntry?.cells.get(columnId)?.originalValue ?? originalCell ?? null;
  const baselineDraft = draftCell ?? null;

  if (areCellValuesEqual(baselineOriginal, baselineDraft)) {
    if (!previousEntry) {
      return { state: prevState, changed: false };
    }

    const nextState = new Map(prevState);
    const updatedEntry: RowEditDraft = {
      ...previousEntry,
      rowIndex,
      updatedAt: Date.now(),
      draftRow: draftRowSnapshot ?? previousEntry.draftRow,
      cells: new Map(previousEntry.cells),
    };

    updatedEntry.cells.delete(columnId);

    if (updatedEntry.cells.size === 0 && updatedEntry.action !== "insert") {
      nextState.delete(rowKey);
    } else {
      nextState.set(rowKey, updatedEntry);
    }

    return { state: nextState, changed: true };
  }

  const nextState = new Map(prevState);
  const now = Date.now();
  const cells = previousEntry
    ? new Map(previousEntry.cells)
    : new Map<string, EditingCellDraft>();

  const entry: RowEditDraft = {
    rowKey,
    rowIndex,
    action: actionHint ?? previousEntry?.action ?? "update",
    createdAt: previousEntry?.createdAt ?? now,
    updatedAt: now,
    originalRow: previousEntry?.originalRow ?? originalRowSnapshot ?? null,
    draftRow: draftRowSnapshot ?? previousEntry?.draftRow ?? null,
    cells,
  };

  entry.cells.set(columnId, {
    columnId,
    originalValue: baselineOriginal,
    draftValue: baselineDraft,
    hasChanged: true,
  });

  nextState.set(rowKey, entry);
  return { state: nextState, changed: true };
};

const markRowInsertedState = (
  prevState: Map<string, RowEditDraft>,
  params: RowMutationParams,
): { state: Map<string, RowEditDraft>; changed: boolean } => {
  const { rowKey, rowIndex, row } = params;
  const previousEntry = prevState.get(rowKey);
  const now = Date.now();

  if (
    previousEntry &&
    previousEntry.action === "insert" &&
    previousEntry.rowIndex === rowIndex &&
    previousEntry.draftRow === row
  ) {
    return { state: prevState, changed: false };
  }

  const nextState = new Map(prevState);
  nextState.set(rowKey, {
    rowKey,
    rowIndex,
    action: "insert",
    createdAt: previousEntry?.createdAt ?? now,
    updatedAt: now,
    originalRow: null,
    draftRow: row,
    cells: previousEntry
      ? new Map(previousEntry.cells)
      : new Map<string, EditingCellDraft>(),
  });

  return { state: nextState, changed: true };
};

const markRowDeletedState = (
  prevState: Map<string, RowEditDraft>,
  params: RowMutationParams,
): { state: Map<string, RowEditDraft>; changed: boolean } => {
  const { rowKey, rowIndex, row } = params;
  const previousEntry = prevState.get(rowKey);
  const now = Date.now();

  const nextState = new Map(prevState);

  if (previousEntry?.action === "insert") {
    nextState.delete(rowKey);
    return { state: nextState, changed: true };
  }

  nextState.set(rowKey, {
    rowKey,
    rowIndex,
    action: "delete",
    createdAt: previousEntry?.createdAt ?? now,
    updatedAt: now,
    originalRow: previousEntry?.originalRow ?? row,
    draftRow: null,
    cells: new Map<string, EditingCellDraft>(),
  });

  return { state: nextState, changed: true };
};

export interface TableDataGridV2Props {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  gridId: string;
  className?: string;
}

const DEFAULT_COLUMN_STATE = {
  order: [] as string[],
  widths: {} as Record<string, number>,
  visibility: {} as Record<string, boolean>,
  pinned: [] as string[],
};

export const TableDataGridV2 = memo(function TableDataGridV2(
  props: TableDataGridV2Props,
) {
  const { gridId, connectionId, database, table, schema, className } = props;
  const { toast } = useToast();

  const {
    isLoading,
    isLoadingMore,
    error,
    columns: columnMeta,
    rows: dataRows,
    estimatedTotal,
    loadMore,
    hasNextPage,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  // Load full structure (columns only) to enrich metadata such as enum values
  const { structure: tableStructure } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeIndexes: false,
      includeConstraints: false,
      includeTriggers: false,
      includeStatistics: false,
      includeForeignKeys: false,
    },
    enabled: Boolean(connectionId && database && table),
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

  const rowKeyMapRef = useRef(new WeakMap<GridRowModel, string>());
  const draftRowCounterRef = useRef(0);
  const [editingRows, setEditingRows] = useState<Map<string, RowEditDraft>>(
    () => new Map(),
  );
  const editingRowsRef = useRef(editingRows);
  editingRowsRef.current = editingRows;

  const [rows, setRows] = useState<GridRowModel[]>([]);

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
  const {
    persistedView,
    persistSelection,
    persistScrollOffset,
    persistActiveCell,
  } = usePersistentViewState(gridId);

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
              jsonRow[col.field] = value.value;
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

  // Initialize selection from persisted state only once after hydration
  useEffect(() => {
    if (!hydrated) return;
    if (persistedView.selection && !gridSelection) {
      setGridSelection(persistedView.selection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]); // Only depend on hydrated to run once after store loads

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

  const primaryKeyColumns = useMemo(
    () => columnMeta.filter((meta) => meta.is_pk).map((meta) => meta.name),
    [columnMeta],
  );

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

  const handleColumnWidthsChange = useCallback(
    (widths: Record<string, number>) => {
      // Defer store mutation to avoid setState during render
      setTimeout(() => {
        upsertGridColumnsState(gridId, (draft) => {
          draft.widths = widths;
        });
      }, 0);
    },
    [gridId],
  );

  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: reorderedColumns,
      initialWidths: columnState.widths,
      onChange: handleColumnWidthsChange,
    });

  const handleColumnVisibilityChange = useCallback(
    (visibility: Record<string, boolean>) => {
      setTimeout(() => {
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

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (rows.length === 0 && editingRowsRef.current.size === 0) {
      return;
    }

    const indexByKey = new Map<string, number>();
    rows.forEach((row, index) => {
      const key = getRowKey(row, index);
      indexByKey.set(key, index);
    });

    if (editingRowsRef.current.size === 0) {
      return;
    }

    const normalized = new Map(editingRowsRef.current);
    let mutated = false;

    for (const [key, entry] of normalized) {
      const nextIndex = indexByKey.get(key);
      if (nextIndex === undefined) {
        normalized.delete(key);
        mutated = true;
        continue;
      }

      if (entry.rowIndex !== nextIndex) {
        normalized.set(key, { ...entry, rowIndex: nextIndex });
        mutated = true;
      }
    }

    if (!mutated) {
      return;
    }

    setEditingRows(normalized);
    editingRowsRef.current = normalized;
  }, [rows, getRowKey]);

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
          allowOverlay: false,
          readonly: true,
        } as const;
      }

      // Check for pending edits and merge with original row data
      let cellValue = row[column.field] as CellValue | null | undefined;

      // Get row key to check for pending edits
      const rowKey = getRowKey(row, rowIndex);
      const editingRowDraft = editingRowsRef.current.get(rowKey);

      if (editingRowDraft && editingRowDraft.cells.has(column.field)) {
        // Use the edited value if there's a pending edit
        const editedCell = editingRowDraft.cells.get(column.field);
        if (editedCell && editedCell.hasChanged) {
          cellValue = editedCell.draftValue;
        }
      }

      const gridCell = buildGridCellV2({ value: cellValue, column });

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
        return {
          ...gridCell,
          displayData: truncated, // Truncated text for display
        };
      }

      return gridCell;
    },
    [finalColumns, getRowKey],
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
            (customData as { kind?: unknown }).kind &&
            ["date-cell", "time-cell", "datetime-cell"].includes(
              String((customData as { kind: unknown }).kind),
            )
          ) {
            // For date/time kinds we store raw string (or null)
            const v = (customData as { value?: unknown }).value;
            if (v == null) {
              cellValue = null;
            } else if (typeof v === "string") {
              cellValue = v;
            } else if (v instanceof Date) {
              // Persist as ISO date string
              cellValue = v.toISOString();
            } else {
              // Unknown object shape; avoid implicit stringification
              cellValue = null;
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
        } as CellValue;
      }

      const updatedCell = updatedRow[column.field] as
        | CellValue
        | null
        | undefined;

      const previousSnapshot = cloneEditingState(editingRowsRef.current);
      const { state: nextEditingState, changed: editingChanged } =
        upsertCellEditState(editingRowsRef.current, {
          rowKey,
          rowIndex,
          columnId: column.field,
          originalCell: previousValue,
          draftCell: updatedCell,
          originalRowSnapshot: currentRow,
          draftRowSnapshot: updatedRow,
          actionHint: "update",
        });

      const nextEditingSnapshot = editingChanged
        ? cloneEditingState(nextEditingState)
        : previousSnapshot;

      if (editingChanged) {
        setEditingRows(nextEditingState);
        editingRowsRef.current = nextEditingState;
      }

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

      // Return history entry for undo/redo
      return {
        undo: () => {
          setRows((prevRows) => {
            const index = prevRows.findIndex(
              (row, idx) => getRowKey(row, idx) === rowKey,
            );
            if (index === -1) {
              return prevRows;
            }
            const reverted = [...prevRows];
            reverted[index] = currentRow;
            rowKeyMapRef.current.set(currentRow, rowKey);
            return reverted;
          });

          if (editingChanged) {
            const restored = cloneEditingState(previousSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
          // Clear editing highlight after undo restores state
          setEditingCell(null);
        },
        redo: () => {
          setRows((prevRows) => {
            const index = prevRows.findIndex(
              (row, idx) => getRowKey(row, idx) === rowKey,
            );
            const targetIndex = index === -1 ? rowIndex : index;
            if (targetIndex < 0 || targetIndex >= prevRows.length) {
              return prevRows;
            }
            const applied = [...prevRows];
            applied[targetIndex] = updatedRow;
            rowKeyMapRef.current.set(updatedRow, rowKey);
            return applied;
          });

          if (editingChanged) {
            const restored = cloneEditingState(nextEditingSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
          // Clear editing highlight after redo applies change
          setEditingCell(null);
        },
      };
    },
    [getRowKey, rows, table],
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

      const previousSnapshot = cloneEditingState(editingRowsRef.current);
      const { state: nextEditingState, changed: editingChanged } =
        markRowInsertedState(editingRowsRef.current, {
          rowKey,
          rowIndex: insertionIndex,
          row: draftRow,
        });

      const nextEditingSnapshot = editingChanged
        ? cloneEditingState(nextEditingState)
        : previousSnapshot;

      if (editingChanged) {
        setEditingRows(nextEditingState);
        editingRowsRef.current = nextEditingState;
      }

      setRows(newRows);

      toast({
        description: "New row added. Edit cells to set values.",
      });

      // TODO: Create row in backend when saved

      return {
        undo: () => {
          setRows(rows);

          if (editingChanged) {
            const restored = cloneEditingState(previousSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
        redo: () => {
          setRows(newRows);

          if (editingChanged) {
            const restored = cloneEditingState(nextEditingSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
      };
    },
    [getRowKey, rows, toast],
  );

  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent): GridHistoryEntry => {
      const { rowIndexes } = event;
      const removalSet = new Set(rowIndexes);
      const sortedIndexes = [...removalSet].sort((a, b) => b - a);
      // Keep rows visible, mark them as pending deletion in editing state
      const newRows = rows; // do not remove immediately; highlight instead

      let editingState: Map<string, RowEditDraft> = editingRowsRef.current;
      let editingChanged = false;
      const previousSnapshot = cloneEditingState(editingRowsRef.current);

      for (const rowIndex of sortedIndexes) {
        const row = rows[rowIndex];
        if (!row) {
          continue;
        }
        const rowKey = getRowKey(row, rowIndex);
        const result = markRowDeletedState(editingState, {
          rowKey,
          rowIndex,
          row,
        });
        if (result.changed) {
          editingState = result.state;
          editingChanged = true;
        }
      }

      const nextEditingSnapshot = editingChanged
        ? cloneEditingState(editingState)
        : previousSnapshot;

      if (editingChanged) {
        setEditingRows(editingState);
        editingRowsRef.current = editingState;
      }

      toast({
        description: `Deleted ${rowIndexes.length} row(s)`,
        variant: "destructive",
      });

      // TODO: Delete rows from backend

      return {
        undo: () => {
          setRows(rows);

          if (editingChanged) {
            const restored = cloneEditingState(previousSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
        redo: () => {
          setRows(newRows);

          if (editingChanged) {
            const restored = cloneEditingState(nextEditingSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
      };
    },
    [getRowKey, rows, toast],
  );

  const handlePaste = useCallback(
    (event: GridPasteEvent): boolean => {
      const { target, values } = event;
      const [colStart, rowStart] = target;

      // Update cells with pasted values
      const newRows = [...rows];
      let editingState: Map<string, RowEditDraft> = editingRowsRef.current;
      let editingChanged = false;
      const previousSnapshot = cloneEditingState(editingRowsRef.current);

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
          } as CellValue;

          updatedRow[column.field] = newCell;

          const result = upsertCellEditState(editingState, {
            rowKey,
            rowIndex: targetRowIdx,
            columnId: column.field,
            originalCell: currentRow[column.field],
            draftCell: newCell,
            originalRowSnapshot: currentRow,
            draftRowSnapshot: updatedRow,
            actionHint: "update",
          });

          if (result.changed) {
            editingState = result.state;
            editingChanged = true;
          }
        }

        newRows[targetRowIdx] = updatedRow;
      }

      const nextEditingSnapshot = editingChanged
        ? cloneEditingState(editingState)
        : previousSnapshot;

      if (editingChanged) {
        setEditingRows(editingState);
        editingRowsRef.current = editingState;
      }

      setRows(newRows);

      history.push({
        undo: () => {
          setRows(rows);

          if (editingChanged) {
            const restored = cloneEditingState(previousSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
        redo: () => {
          setRows(newRows);

          if (editingChanged) {
            const restored = cloneEditingState(nextEditingSnapshot);
            setEditingRows(restored);
            editingRowsRef.current = restored;
          }
        },
      });

      toast({
        description: "Pasted content successfully",
      });

      return true;
    },
    [finalColumns, getRowKey, history, rows, toast],
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
      if (nearEnd && hasNextPage && !isLoadingMore) {
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

  // Keyboard event handler for clipboard operations
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + C for JSON copy
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        if (gridSelection) {
          await copySelection(gridSelection, "json");
        }
      }
      // Standard Cmd/Ctrl + C for regular copy
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "c") {
        e.preventDefault();
        if (gridSelection) {
          await copySelection(gridSelection, "text");
        }
      }
      // Cmd/Ctrl + Z for undo
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        history.undo();
      }
      // Cmd/Ctrl + Shift + Z for redo
      else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        history.redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [copySelection, gridSelection, history]); // Remove rows and finalColumns

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

  const pendingDeletedRowIndexes = useMemo(() => {
    const result = new Set<number>();
    editingRows.forEach((draft) => {
      if (draft.action === "delete") {
        result.add(draft.rowIndex);
      }
    });
    return result;
  }, [editingRows]);

  const pendingChangedRowIndexes = useMemo(() => {
    const result = new Set<number>();
    editingRows.forEach((draft) => {
      if (draft.action === "delete") return;
      if (draft.action === "insert" || draft.cells.size > 0) {
        result.add(draft.rowIndex);
      }
    });
    return result;
  }, [editingRows]);

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
    if (editingRows.size === 0) return regions;
    editingRows.forEach((draft) => {
      draft.cells.forEach((cellDraft, columnId) => {
        const d = cellDraft as EditingCellDraft | undefined;
        if (!d || !d.hasChanged) return;
        const colIndex = columnIndexById.get(columnId);
        if (colIndex == null) return;
        regions.push({
          color: "rgba(252, 163, 17, 0.22)",
          range: { x: colIndex, y: draft.rowIndex, width: 1, height: 1 },
        });
      });
    });
    return regions;
  }, [columnIndexById, editingRows]);

  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Highest precedence: pending deletion
      if (pendingDeletedRowIndexes.has(rowIndex)) {
        return {
          bgCell: "rgba(239, 68, 68, 0.10)", // red-500 @ 10%
          bgCellMedium: "rgba(239, 68, 68, 0.12)",
          textMedium: undefined,
        } as Partial<Theme>;
      }
      // Pending insert/update highlight (persists across focus changes)
      if (pendingChangedRowIndexes.has(rowIndex)) {
        return {
          bgCell: "rgba(252, 163, 17, 0.10)", // accent @ 10%
          bgCellMedium: "rgba(252, 163, 17, 0.12)",
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
    [pendingChangedRowIndexes, pendingDeletedRowIndexes, selectedRowsSet],
  );

  const selectedRowCount = gridSelection ? gridSelection.rows.length : 0;

  // (rectangular rows merged into selectedRowsSet above)

  // Bright highlight for all edited cells; also include the live editing cell slightly brighter
  const cellHighlightRegions = useMemo(() => {
    const regions = [...editedCellRegions];
    if (editingCell) {
      regions.push({
        color: "rgba(252, 163, 17, 0.28)",
        range: {
          x: editingCell.columnIndex,
          y: editingCell.rowIndex,
          width: 1,
          height: 1,
        },
      });
    }
    return regions;
  }, [editedCellRegions, editingCell]);

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
      <div className="relative flex-1">
        <EditableDataGrid
          className={className}
          rows={rows}
          columns={finalColumns}
          getCellContent={handleGetCellContent}
          history={history}
          onCellEditStart={(coords) => {
            setEditingCell({
              rowIndex: coords.rowIndex,
              columnIndex: coords.columnIndex,
            });
          }}
          onCellEditCommit={handleEditCommit}
          onCellEditCancel={() => {
            setEditingCell(null);
          }}
          onRowAppend={handleRowAppend}
          onRowDelete={handleRowDelete}
          onPaste={handlePaste}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
          onColumnMoved={handleColumnMoved}
          onActiveCellChange={persistActiveCell}
          onVisibleRegionChanged={handleVisibleRegionChanged}
          gridSelection={gridSelection}
          onSelectionChange={handleSelectionChange}
          freezeColumns={freezeColumns}
          getRowThemeOverride={getRowThemeOverride}
          highlightRegions={cellHighlightRegions}
        />
        {isLoadingMore ? <DataGridLoadingIndicator /> : null}
      </div>

      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal ?? undefined}
        hasMore={hasNextPage}
        selectedRows={selectedRowCount}
        pendingEdits={editingRows.size}
      />
    </div>
  );
});

// Keep memo wrapper for backward compatibility
export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
