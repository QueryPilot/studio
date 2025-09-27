import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from "react";
import type {
  DataEditorProps,
  DataEditorRef,
  GridCell,
  GridSelection,
  Item,
} from "@glideapps/glide-data-grid";
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
  typeof value === "object" && value !== null && "then" in (value as any);

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
  }, {} as GridRowModel);
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
  ) => GridHistoryEntry | void | Promise<GridHistoryEntry | void>;
  onCellEditCancel?: (event: GridEditCoordinates) => void;
  onRowAppend?: (
    event: GridRowAppendEvent,
  ) => GridHistoryEntry | void | Promise<GridHistoryEntry | void>;
  onRowInsert?: (event: GridRowInsertEvent) => GridHistoryEntry | void;
  onRowDelete?: (event: GridRowDeleteEvent) => GridHistoryEntry | void;
  onPaste?: (event: GridPasteEvent) =>
    | GridRowInsertEvent
    | GridHistoryEntry
    | boolean
    | void
    | Promise<GridRowInsertEvent | GridHistoryEntry | boolean | void>;
  createDraftRow?: (position: "top" | "bottom" | number) => GridRowModel;
  coercePasteValue?: (value: string) => string | number | boolean | null;
  onSelectionChange?: (selection: GridSelection) => void;
  onActiveCellChange?: (cell: Item | null) => void;
}

export interface EditableDataGridRef extends DataEditorRef {
  appendRow: () => void;
}

export const EditableDataGrid = forwardRef<EditableDataGridRef, EditableDataGridProps>(
  (props, ref) => {
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
      coercePasteValue,
      customRenderers: customRenderersProp,
      onSelectionChange,
      onActiveCellChange,
      onGridSelectionChange,
      gridSelection,
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
      (newValue: GridCell | undefined, _movement: Item) => {
        if (newValue !== undefined) {
          editingCellRef.current = null;
          return;
        }
        const cell = editingCellRef.current;
        editingCellRef.current = null;
        if (!cell || !onCellEditCancel) return;
        const coords = getCoordinates(cell);
        if (!coords) return;
        onCellEditCancel(coords);
      },
      [getCoordinates, onCellEditCancel],
    );

    // Row append handler - exposed via ref for external button
    const appendRow = useCallback(
      () => {
        if (!onRowAppend) return;
        const position: GridRowAppendEvent["position"] = "top";
        const baseRow = createDraftRow?.(position) ?? createDefaultDraftRow(columns);
        const result = onRowAppend?.({ position, draftRow: baseRow });
        processResult(result);
      },
      [columns, createDraftRow, onRowAppend, processResult],
    );

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
      coerceValue: coercePasteValue,
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
    useImperativeHandle(ref, () => ({
      ...gridRef.current!,
      appendRow,
    }), [appendRow]);

    return (
      <DataGridBase
        {...rest}
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
        onGridSelectionChange={(selection) => {
          onSelectionChange?.(selection);
          onGridSelectionChange?.(selection);
        }}
        drawFocusRing={true}
        rangeSelect="rect"
        columnSelect="single"
        rowSelect="multi"
        scaleToRem={false}
      />
    );
  },
);

EditableDataGrid.displayName = "EditableDataGrid";
