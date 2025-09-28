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

  const [rows, setRows] = useState<GridRowModel[]>([]);

  // Sync rows from data source
  useEffect(() => {
    if (dataRows.length > 0) {
      setRows(dataRows);
    }
  }, [dataRows]);

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
        return {
          id,
          field: meta.name,
          title: meta.name,
          name: meta.name,
          width: computeBaseWidth(meta.name, meta.db_type),
          type: meta.db_type,
          meta,
        } as GridColumnV2;
      }),
    [columnMeta],
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
      upsertGridColumnsState(gridId, (draft) => {
        draft.widths = widths;
      });
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
      upsertGridColumnsState(gridId, (draft) => {
        draft.visibility = visibility;
      });
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
      upsertGridColumnsState(gridId, (draft) => {
        draft.pinned = pinned;
      });
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

  const handleGetCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumns[colIndex];
      const row = rows[rowIndex];
      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        } as const;
      }
      const value = row[column.field] as CellValue | null | undefined;
      const gridCell = buildGridCellV2({ value, column });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finalColumns], // Remove rows from deps to prevent infinite loop
  );

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
      persistSelection(selection);
    },
    [persistSelection],
  );

  const handleEditCommit = useCallback(
    (event: GridEditCommitEvent): GridHistoryEntry => {
      const { rowIndex, column, newValue, previousValue } = event;
      const currentRow = rows[rowIndex];
      if (!currentRow) {
        return {
          undo: () => {},
          redo: () => {},
        };
      }

      // Create updated row with new value
      const updatedRow = { ...currentRow };

      // Convert grid cell value back to CellValue format
      if ("data" in newValue && column.field) {
        type GridCellWithData = GridCell & { data?: unknown };
        type GridCellWithActualValue = GridCell & { actualValue?: unknown };

        let cellValue: unknown = (newValue as GridCellWithData).data;

        if (newValue.kind === GridCellKind.Custom) {
          const customData = (newValue as GridCellWithData).data;
          if (isBooleanCellPayload(customData)) {
            cellValue = customData.value;
          }
        } else if (newValue.kind === GridCellKind.Boolean) {
          const actualValue = (newValue as GridCellWithActualValue).actualValue;
          cellValue = actualValue ?? (newValue as GridCellWithData).data;
        }

        updatedRow[column.field] = {
          value: cellValue,
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

      // Optimistic update
      const newRows = [...rows];
      newRows[rowIndex] = updatedRow;
      setRows(newRows);

      // TODO: Send mutation to backend
      // For now, just log the change
      type GridCellForLog = GridCell & { data?: unknown };

      console.log("Cell edit:", {
        table,
        row: rowIndex,
        column: column.field,
        newValue: (newValue as GridCellForLog).data,
        previousValue: previousValue?.value,
      });

      // Return history entry for undo/redo
      return {
        undo: () => {
          const revertedRows = [...rows];
          revertedRows[rowIndex] = currentRow;
          setRows(revertedRows);
        },
        redo: () => {
          setRows(newRows);
        },
      };
    },
    [rows, table],
  );

  const handleRowAppend = useCallback(
    (event: GridRowAppendEvent): GridHistoryEntry => {
      const { draftRow } = event;
      const newRows = [draftRow, ...rows];
      setRows(newRows);

      toast({
        description: "New row added. Edit cells to set values.",
      });

      // TODO: Create row in backend when saved

      return {
        undo: () => {
          setRows(rows);
        },
        redo: () => {
          setRows(newRows);
        },
      };
    },
    [rows, toast],
  );

  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent): GridHistoryEntry => {
      const { rowIndexes } = event;
      const newRows = rows.filter((_, idx) => !rowIndexes.includes(idx));

      setRows(newRows);

      toast({
        description: `Deleted ${rowIndexes.length} row(s)`,
        variant: "destructive",
      });

      // TODO: Delete rows from backend

      return {
        undo: () => {
          setRows(rows);
        },
        redo: () => {
          setRows(newRows);
        },
      };
    },
    [rows, toast],
  );

  const handlePaste = useCallback(
    (event: GridPasteEvent): boolean => {
      const { target, values } = event;
      const [colStart, rowStart] = target;

      // Update cells with pasted values
      const newRows = [...rows];
      values.forEach((rowValues, rowOffset) => {
        const targetRowIdx = rowStart + rowOffset;
        if (targetRowIdx >= rows.length) return; // Skip if beyond existing rows

        const targetRow = { ...rows[targetRowIdx] };
        rowValues.forEach((value, colOffset) => {
          const targetColIdx = colStart + colOffset;
          const column = finalColumns[targetColIdx];
          if (!column) return;

          targetRow[column.field] = {
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
        });
        newRows[targetRowIdx] = targetRow;
      });

      setRows(newRows);

      history.push({
        undo: () => {
          setRows(rows);
        },
        redo: () => {
          setRows(newRows);
        },
      });

      toast({
        description: "Pasted content successfully",
      });

      return true;
    },
    [rows, finalColumns, history, toast],
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
      upsertGridColumnsState(gridId, (draft) => {
        const order = draft.order.length
          ? [...draft.order]
          : finalColumns.map((column) => column.id);
        const [moved] = order.splice(startIndex, 1);
        if (moved === undefined) return;
        order.splice(endIndex, 0, moved);
        draft.order = order;
      });
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

  const selectedRowCount = gridSelection?.rows.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1">
        <EditableDataGrid
          className={className}
          rows={rows}
          columns={finalColumns}
          getCellContent={handleGetCellContent}
          history={history}
          onCellEditCommit={handleEditCommit}
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
        />
        {isLoadingMore ? <DataGridLoadingIndicator /> : null}
      </div>

      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal ?? undefined}
        hasMore={hasNextPage}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});

// Keep memo wrapper for backward compatibility
export const MemoizedTableDataGridV2 = memo(TableDataGridV2);
