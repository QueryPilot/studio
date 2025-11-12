import { forwardRef, useCallback, useRef, useImperativeHandle } from "react";
import type {
  DataEditorProps,
  DataEditorRef,
  GridCell,
  GridSelection,
  Item,
} from "@glideapps/glide-data-grid";
import { CompactSelection } from "@glideapps/glide-data-grid";
import { DataGridBase, type DataGridBaseProps } from "./DataGridBase";
import type {
  GridColumnV2,
  GridEditCommitEvent,
  GridEditCoordinates,
  GridHistoryEntry,
  GridPasteEvent,
  GridRowAppendEvent,
  GridRowDeleteEvent,
  GridRowInsertEvent,
  GridRowModel,
} from "../types";
import { usePasteHandler } from "../hooks/usePasteHandler";
import type { UseGridHistoryResult } from "../hooks/useGridHistory";
import type { CellValue } from "@/types/cellValue";
import { useDataGridV2Renderers } from "../renderers";
import { inferValueType } from "../utils/valueHelpers";

const isPromise = <T,>(value: unknown): value is Promise<T> =>
  typeof value === "object" &&
  value !== null &&
  "then" in (value as { then?: unknown });

const isHistoryEntry = (value: unknown): value is GridHistoryEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as GridHistoryEntry).undo === "function" &&
  typeof (value as GridHistoryEntry).redo === "function";

const isRowInsertEvent = (value: unknown): value is GridRowInsertEvent =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as GridRowInsertEvent).rows) &&
  typeof (value as GridRowInsertEvent).index === "number";

const createDefaultDraftRow = (columns: GridColumnV2[]): GridRowModel => {
  return columns.reduce<GridRowModel>((acc, column) => {
    const cell: CellValue = {
      value: null,
      db_type: column.meta?.db_type ?? column.type ?? "text",
      value_type: "Null",
      is_truncated: false,
    };
    acc[column.field] = cell;
    return acc;
  }, {});
};

const applyValuesToRow = (
  baseRow: GridRowModel,
  columns: GridColumnV2[],
  values: (string | number | boolean | null)[],
): GridRowModel => {
  const nextRow: GridRowModel = { ...baseRow };
  columns.forEach((column, index) => {
    const current = nextRow[column.field];
    const coerced = values[index] ?? null;
    if (current) {
      nextRow[column.field] = {
        ...current,
        value: coerced,
        value_type: inferValueType(coerced),
      };
    } else {
      nextRow[column.field] = {
        value: coerced,
        db_type: column.meta?.db_type ?? column.type ?? "text",
        value_type: inferValueType(coerced),
        is_truncated: false,
      };
    }
  });
  return nextRow;
};

export interface EditableDataGridProps
  extends Omit<
    DataGridBaseProps,
    | "rowCount"
    | "onCellEdited"
    | "onFinishedEditing"
    | "onCellActivated"
    | "onDelete"
    | "onRowAppended"
    | "onPaste"
  > {
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: DataEditorProps["getCellContent"];
  history?: UseGridHistoryResult | null;
  onCellEditStart?: (event: GridEditCoordinates) => void;
  onCellEditCommit?: (
    event: GridEditCommitEvent,
  ) => GridHistoryEntry | undefined | Promise<GridHistoryEntry | undefined>;
  onCellEditCancel?: (event: GridEditCoordinates) => void;
  onRowAppend?: (
    event: GridRowAppendEvent,
  ) => GridHistoryEntry | undefined | Promise<GridHistoryEntry | undefined>;
  onRowInsert?: (event: GridRowInsertEvent) => GridHistoryEntry | undefined;
  onRowDelete?: (event: GridRowDeleteEvent) => GridHistoryEntry | undefined;
  onPaste?: (
    event: GridPasteEvent,
  ) =>
    | GridRowInsertEvent
    | GridHistoryEntry
    | boolean
    | undefined
    | Promise<GridRowInsertEvent | GridHistoryEntry | boolean | undefined>;
  createDraftRow?: (position: "top" | "bottom" | number) => GridRowModel;
  coerceValue?: (value: string) => string | number | boolean | null;
  onSelectionChange?: (selection: GridSelection) => void;
  onActiveCellChange?: (cell: Item | null) => void;
  getRowThemeOverride?: DataEditorProps["getRowThemeOverride"];
}

export interface EditableDataGridRef extends DataEditorRef {
  appendRow: () => Promise<void>;
}

export const EditableDataGrid = forwardRef<
  EditableDataGridRef,
  EditableDataGridProps
>((props, ref) => {
  const {
    rows,
    columns,
    getCellContent,
    history,
    onCellEditStart,
    onCellEditCommit,
    onCellEditCancel,
    onRowAppend,
    onRowInsert,
    onRowDelete,
    onPaste,
    createDraftRow,
    coerceValue,
    customRenderers: customRenderersProp,
    onSelectionChange,
    onActiveCellChange,
    onGridSelectionChange,
    gridSelection,
    getRowThemeOverride,
    containerClassName,
    className,
    ...rest
  } = props;

  const { customRenderers: defaultRenderers } = useDataGridV2Renderers();
  const customRenderers = customRenderersProp ?? defaultRenderers;

  const editingCellRef = useRef<Item | null>(null);

  const getCoordinates = useCallback(
    (cell: Item): GridEditCoordinates | null => {
      const [columnIndex, rowIndex] = cell;
      const column = columns[columnIndex];
      if (!column) return null;
      const row = rows[rowIndex];
      return { cell, columnIndex, rowIndex, column, row };
    },
    [columns, rows],
  );

  const processResult = useCallback(
    (result: unknown): boolean | undefined => {
      const apply = (value: unknown): boolean | undefined => {
        if (value == null) return undefined;
        if (isPromise(value)) {
          void value.then((resolved) => {
            apply(resolved);
          });
          return undefined;
        }
        if (isHistoryEntry(value)) {
          history?.push(value);
          return undefined;
        }
        if (isRowInsertEvent(value)) {
          const followUp = onRowInsert?.(value);
          return apply(followUp);
        }
        if (typeof value === "boolean") {
          return value;
        }
        return undefined;
      };
      return apply(result);
    },
    [history, onRowInsert],
  );

  const handleCellActivated = useCallback(
    (cell: Item) => {
      const coords = getCoordinates(cell);
      if (!coords) return;
      console.log("🟠 Cell activated for editing:", {
        cell,
        coords,
        column: coords.column.field,
      });
      editingCellRef.current = cell;
      onCellEditStart?.(coords);
      onActiveCellChange?.(cell);
    },
    [getCoordinates, onActiveCellChange, onCellEditStart],
  );

  const handleCellEdited = useCallback(
    (cell: Item, newValue: GridCell) => {
      if (!onCellEditCommit) {
        editingCellRef.current = null;
        return;
      }
      const coords = getCoordinates(cell);
      if (!coords) {
        editingCellRef.current = null;
        return;
      }
      const previous = coords.row
        ? (coords.row[coords.column.field] as CellValue | null | undefined)
        : undefined;
      const event: GridEditCommitEvent = {
        ...coords,
        newValue,
        previousValue: previous ?? null,
      };
      const action = onCellEditCommit(event);
      processResult(action);
      editingCellRef.current = null;
    },
    [getCoordinates, onCellEditCommit, processResult],
  );

  const handleFinishedEditing = useCallback(
    (newValue: GridCell | undefined, movement: Item) => {
      const cell = editingCellRef.current;
      editingCellRef.current = null;

      console.log("🟡 handleFinishedEditing called:", {
        newValue,
        cell,
        movement,
        hasNewValue: newValue !== undefined,
      });

      if (newValue !== undefined) {
        // If newValue is provided, treat it as a cell edit
        if (cell) {
          console.log("🟢 Calling handleCellEdited with:", { cell, newValue });
          handleCellEdited(cell, newValue);

          // Handle movement (e.g., Tab to next cell with editor open)
          if (Array.isArray(movement)) {
            const [colOffset, rowOffset] = movement;
            if (colOffset !== 0 || rowOffset !== 0) {
              const [currentCol, currentRow] = cell;
              const nextCol = currentCol + colOffset;
              const nextRow = currentRow + rowOffset;

              // Ensure the target cell is within bounds
              if (
                nextCol >= 0 &&
                nextCol < columns.length &&
                nextRow >= 0 &&
                nextRow < rows.length
              ) {
                const nextCell: Item = [nextCol, nextRow];
                console.log("🔵 Moving to next cell and opening editor:", {
                  from: cell,
                  to: nextCell,
                });

                // Schedule the next cell selection and editor activation
                // Use requestAnimationFrame for smoother transition
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    // Update selection to the next cell
                    const newSelection: GridSelection = {
                      columns: CompactSelection.empty(),
                      rows: CompactSelection.empty(),
                      current: {
                        cell: nextCell,
                        range: {
                          x: nextCell[0],
                          y: nextCell[1],
                          width: 1,
                          height: 1,
                        },
                        rangeStack: [],
                      },
                    };

                    onGridSelectionChange?.(newSelection);

                    // Focus the grid and trigger edit mode on the next frame
                    requestAnimationFrame(() => {
                      if (gridRef.current) {
                        gridRef.current.focus();

                        // Dispatch Enter key to the grid canvas to trigger edit mode
                        requestAnimationFrame(() => {
                          const canvas = document.querySelector(
                            ".dvn-scroller canvas",
                          ) as HTMLCanvasElement;
                          if (canvas) {
                            canvas.dispatchEvent(
                              new KeyboardEvent("keydown", {
                                key: "Enter",
                                code: "Enter",
                                keyCode: 13,
                                which: 13,
                                bubbles: true,
                                cancelable: true,
                              }),
                            );
                          }
                        });
                      }
                    });
                  });
                });
              }
            }
          }
        }
        return;
      }

      // If no newValue, treat it as a cancel
      if (!cell || !onCellEditCancel) return;
      const coords = getCoordinates(cell);
      if (!coords) return;
      onCellEditCancel(coords);
    },
    [
      getCoordinates,
      onCellEditCancel,
      handleCellEdited,
      handleCellActivated,
      columns.length,
      rows.length,
    ],
  );

  // Row append handler - exposed via ref for external button
  const appendRow = useCallback(async () => {
    if (!onRowAppend) return;
    const position: GridRowAppendEvent["position"] = "top";
    const baseRow =
      createDraftRow?.(position) ?? createDefaultDraftRow(columns);
    const result = onRowAppend({ position, draftRow: baseRow });
    await Promise.resolve(processResult(result));
  }, [columns, createDraftRow, onRowAppend, processResult]);

  const handleDelete = useCallback<NonNullable<DataEditorProps["onDelete"]>>(
    (selection: GridSelection) => {
      if (!onRowDelete) {
        return selection;
      }
      const rowIndexes = selection.rows.toArray();
      if (rowIndexes.length === 0) {
        return false;
      }
      const rowsToDelete = rowIndexes
        .map((index) => rows[index])
        .filter((row): row is GridRowModel => Boolean(row));
      const result = onRowDelete({ selection, rowIndexes, rows: rowsToDelete });
      processResult(result);
      return false;
    },
    [onRowDelete, processResult, rows],
  );

  const { handleDataEditorPaste } = usePasteHandler({
    coerceValue: coerceValue,
    allowGridFallback: false,
    onPaste: (event) => {
      const result = onPaste?.(event);
      const bool = processResult(result);
      if (typeof bool === "boolean") {
        return bool;
      }
      return false;
    },
    afterPaste: (event, result) => {
      if (typeof result !== "boolean") {
        processResult(result);
      }
      if (!onRowInsert) return;
      const [, rowStart] = event.target;
      const requiredRowCount = rowStart + event.values.length;
      if (requiredRowCount <= rows.length) return;
      const missing = requiredRowCount - rows.length;
      const newRows: GridRowModel[] = [];
      for (let i = 0; i < missing; i++) {
        const baseRow =
          createDraftRow?.(rows.length + i) ?? createDefaultDraftRow(columns);
        const sourceRowValues =
          event.values[event.values.length - missing + i] ?? [];
        newRows.push(applyValuesToRow(baseRow, columns, sourceRowValues));
      }
      const insertEvent: GridRowInsertEvent = {
        index: rows.length,
        rows: newRows,
      };
      const followUp = onRowInsert(insertEvent);
      processResult(followUp);
    },
  });

  // Internal grid ref
  const gridRef = useRef<DataEditorRef>(null);

  // Expose methods via ref
  useImperativeHandle(
    ref,
    () => {
      const gridRefCurrent = gridRef.current;
      if (!gridRefCurrent) {
        return { appendRow } as EditableDataGridRef;
      }
      return {
        ...gridRefCurrent,
        appendRow,
      };
    },
    [appendRow],
  );

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      onSelectionChange?.(selection);
      onGridSelectionChange?.(selection);
    },
    [onSelectionChange, onGridSelectionChange],
  );

  return (
    <DataGridBase
      {...rest}
      containerClassName={containerClassName}
      className={className}
      ref={gridRef}
      columns={columns}
      rowCount={rows.length}
      getCellContent={getCellContent}
      customRenderers={customRenderers}
      onCellActivated={handleCellActivated}
      onCellEdited={handleCellEdited}
      onFinishedEditing={handleFinishedEditing}
      onRowAppended={undefined} // Disabled - use button instead
      onDelete={handleDelete}
      onPaste={handleDataEditorPaste}
      gridSelection={gridSelection}
      onGridSelectionChange={handleSelectionChange}
      getRowThemeOverride={getRowThemeOverride}
      drawFocusRing
      rangeSelect="rect"
      columnSelect="single"
      rowSelect="multi"
      scaleToRem={false}
    />
  );
});

EditableDataGrid.displayName = "EditableDataGrid";
