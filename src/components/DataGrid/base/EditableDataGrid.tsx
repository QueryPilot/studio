import {
  forwardRef,
  useCallback,
  useRef,
  useImperativeHandle,
  useMemo,
  useEffect,
  useTransition,
} from "react";
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
  GridActivationEvent,
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
import {
  detectHeaderRow,
  type ColumnTypeHint,
  type PasteValidationError,
} from "../utils/pasteUtils";
import type { UseGridHistoryResult } from "../hooks/useGridHistory";
import type { GridCellValue } from "@/types";
import { useDataGridRenderers } from "../renderers";
import { inferValueType } from "../utils/valueHelpers";
import {
  navigateToCell,
  type NavigationBounds,
} from "../utils/keyboardNavigation";
import { dataGridRegistry } from "@/services/dataGridRegistry";
import { contextService } from "@/services/contextService";

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

import { GRID_EDITOR_SELECTOR } from "./editorConstants";

const isTextInputElement = (element: EventTarget | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable
  );
};

const createDefaultDraftRow = (columns: GridColumnV2[]): GridRowModel => {
  return columns.reduce<GridRowModel>((acc, column) => {
    const cell: GridCellValue = {
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
  startColumnIndex: number = 0,
): GridRowModel => {
  const nextRow: GridRowModel = { ...baseRow };
  // Apply values starting from the specified column offset
  values.forEach((value, valueIndex) => {
    const columnIndex = startColumnIndex + valueIndex;
    const column = columns[columnIndex];
    if (!column) return;

    const current = nextRow[column.field];
    const coerced = value ?? null;
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

export interface EditableDataGridProps extends Omit<
  DataGridBaseProps,
  | "rowCount"
  | "onCellEdited"
  | "onFinishedEditing"
  | "onCellActivated"
  | "onCellClicked"
  | "onDelete"
  | "onRowAppended"
  | "onPaste"
> {
  /** Unique key for this table instance (used for navigation state) */
  tableKey: string;
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
  /** Optional cell activation handler (e.g., for drill-down navigation); return true to mark handled */
  onCellActivated?: (event: GridActivationEvent) => boolean | undefined;
  getRowThemeOverride?: DataEditorProps["getRowThemeOverride"];
  highlightRegions?: DataEditorProps["highlightRegions"];
  onHeaderClicked?: DataEditorProps["onHeaderClicked"];
  drawHeader?: DataEditorProps["drawHeader"];
  onHeaderContextMenu?: DataEditorProps["onHeaderContextMenu"];
  onItemHovered?: DataEditorProps["onItemHovered"];
  onColumnMoved?: DataEditorProps["onColumnMoved"]; // NEW: Support column reordering
  drawCell?: DataEditorProps["drawCell"];
  onCellClicked?: (event: GridActivationEvent) => void;
  /** Callback when paste has validation errors */
  onPasteValidationErrors?: (errors: PasteValidationError[]) => void;
  /** Callback for batch clear operations (Delete on range selection) */
  onBatchClear?: (cells: Item[]) => void;
  /** Callback when pending state changes (paste/batch operations in progress) */
  onPendingChange?: (isPending: boolean) => void;
}

export interface EditableDataGridRef extends DataEditorRef {
  appendRow: () => Promise<void>;
}

export const EditableDataGrid = forwardRef<
  EditableDataGridRef,
  EditableDataGridProps
>((props, ref) => {
  const {
    tableKey,
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
    onCellActivated: onCellActivatedProp,
    onGridSelectionChange,
    gridSelection,
    getRowThemeOverride,
    highlightRegions,
    onHeaderClicked,
    drawHeader,
    onHeaderContextMenu,
    onItemHovered,
    onColumnMoved, // NEW: Destructure column moved handler
    drawCell,
    onCellClicked,
    onPasteValidationErrors,
    onBatchClear,
    onPendingChange,
    containerClassName,
    className,
    ...rest
  } = props;

  // Non-blocking paste operations via useTransition
  const [isPastePending, startPasteTransition] = useTransition();

  // Notify parent when pending state changes
  useEffect(() => {
    onPendingChange?.(isPastePending);
  }, [isPastePending, onPendingChange]);

  const { customRenderers: defaultRenderers } = useDataGridRenderers();
  const customRenderers = customRenderersProp ?? defaultRenderers;

  const editingCellRef = useRef<Item | null>(null);

  // Internal grid ref - must be declared early for use in callbacks
  const gridRef = useRef<DataEditorRef>(null);

  // Wrapper div ref for keyboard focus management
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Build column type hints for smart paste
  const columnHints = useMemo<ColumnTypeHint[]>(
    () =>
      columns.map((col) => ({
        dbType: col.meta?.db_type ?? col.type ?? "text",
        nullable: col.meta?.nullable ?? true,
      })),
    [columns],
  );

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

  // Handle clear cell (Delete/Backspace in selected mode)
  const handleClearCell = useCallback(
    (cell: Item, columnField: string) => {
      if (!onCellEditCommit) return;

      const [columnIndex, rowIndex] = cell;
      const column = columns[columnIndex];
      const row = rows[rowIndex];
      if (!column || !row) return;

      const currentCell = getCellContent(cell);
      const cellWithData = currentCell as GridCell & {
        data?: Record<string, unknown>;
      };
      if (!cellWithData.data) return;

      // Create cell with null value
      const newCell: GridCell = {
        ...currentCell,
        data: Object.assign({}, cellWithData.data, { value: null }),
      } as GridCell;

      const previous = row[columnField] as GridCellValue | null | undefined;
      const event: GridEditCommitEvent = {
        cell,
        columnIndex,
        rowIndex,
        column,
        row,
        newValue: newCell,
        previousValue: previous ?? null,
      };

      const action = onCellEditCommit(event);
      processResult(action);
    },
    [columns, rows, getCellContent, onCellEditCommit, processResult],
  );

  // Intercept paste events in capture phase so they reach the cell editor
  // instead of being swallowed by Glide Data Grid's internal paste handler.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handlePasteCapture = (e: ClipboardEvent) => {
      // If a cell editor is open, check whether the paste target is inside
      // the editor overlay. If so, stop propagation so Glide never sees it
      // and the editor input receives the native paste.
      if (!editingCellRef.current) return;

      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(GRID_EDITOR_SELECTOR)
      ) {
        e.stopPropagation();
      }
    };

    wrapper.addEventListener("paste", handlePasteCapture, true); // capture phase
    return () => {
      wrapper.removeEventListener("paste", handlePasteCapture, true);
    };
  }, []);

  // Document-level listener for cmd+delete row deletion
  // Uses gridSelection prop directly to avoid stale navigation store state
  useEffect(() => {
    const handleCmdDelete = (e: KeyboardEvent) => {
      // Only handle cmd+delete or cmd+backspace
      if (!e.metaKey || (e.key !== "Delete" && e.key !== "Backspace")) return;

      // Never intercept keys while command palette is open
      if (contextService.getValue("inQuickOpen")) return;

      const target = e.target;
      const activeElement = document.activeElement;

      // Never intercept while a cell editor (or editor portal content) is active.
      if (
        (target instanceof Element && target.closest(GRID_EDITOR_SELECTOR)) ||
        (activeElement instanceof Element &&
          activeElement.closest(GRID_EDITOR_SELECTOR)) ||
        editingCellRef.current
      ) {
        return;
      }

      // Don't intercept when focus is on a real text input (e.g. inspector search)
      if (isTextInputElement(target)) {
        return;
      }

      // Nothing to do if row deletion isn't supported.
      if (!onRowDelete) return;

      // Primary focus signal: focused-grid registry (works even when canvas focus is transient)
      const focusedGridId = dataGridRegistry.getFocused()?.id;
      const isFocusedByRegistry = focusedGridId === tableKey;

      // Fallback for cases where registry wasn't updated yet
      const isFocusedByDom =
        !!wrapperRef.current?.contains(activeElement) ||
        activeElement === wrapperRef.current;

      if (!isFocusedByRegistry && !isFocusedByDom) {
        return;
      }

      // Get current selection from grid (most reliable source)
      const currentCell = gridSelection?.current?.cell;
      if (!currentCell) return;

      e.preventDefault();
      e.stopPropagation();

      const rowIndex = currentCell[1];

      const row = rows[rowIndex];
      if (!row) return;

      const result = onRowDelete({
        selection: {
          columns: { toArray: () => [] as number[] },
          rows: { toArray: () => [rowIndex] },
        } as GridSelection,
        rowIndexes: [rowIndex],
        rows: [row],
      });
      processResult(result);
    };

    document.addEventListener("keydown", handleCmdDelete);
    return () => {
      document.removeEventListener("keydown", handleCmdDelete);
    };
  }, [gridSelection, onRowDelete, rows, processResult]);

  const handleCellActivated = useCallback(
    (cell: Item) => {
      const coords = getCoordinates(cell);
      if (!coords) return;

      const activationEvent: GridActivationEvent = coords;

      // If custom activation handler provided (e.g., for drill-down), allow it to short-circuit
      if (onCellActivatedProp) {
        const handled = onCellActivatedProp(activationEvent);
        if (handled) {
          return;
        }
      }

      editingCellRef.current = cell;
      onCellEditStart?.(coords);
      onActiveCellChange?.(cell);
    },
    [getCoordinates, onActiveCellChange, onCellActivatedProp, onCellEditStart],
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
        ? (coords.row[coords.column.field] as GridCellValue | null | undefined)
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

      if (newValue !== undefined) {
        // If newValue is provided, treat it as a cell edit
        if (cell) {
          handleCellEdited(cell, newValue);

          // Handle movement (e.g., Tab to next cell with editor open)
          if (Array.isArray(movement)) {
            const [colOffset, rowOffset] = movement;
            if (colOffset !== 0 || rowOffset !== 0) {
              const [currentCol, currentRow] = cell;
              const nextCol = currentCol + colOffset;
              const nextRow = currentRow + rowOffset;

              // Ensure the target cell is within bounds
              const bounds: NavigationBounds = {
                maxCol: columns.length,
                maxRow: rows.length,
              };

              if (
                nextCol >= 0 &&
                nextCol < bounds.maxCol &&
                nextRow >= 0 &&
                nextRow < bounds.maxRow
              ) {
                const nextCell: Item = [nextCol, nextRow];
                // Use unified navigation utility instead of nested RAFs
                navigateToCell(gridRef, nextCell, onGridSelectionChange, {
                  openEditor: true,
                  scrollToCell: true,
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
      columns.length,
      rows.length,
      onGridSelectionChange,
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
      const rowIndexes = selection.rows.toArray();

      // If rows are selected, delete rows
      if (rowIndexes.length > 0) {
        if (!onRowDelete) {
          return selection;
        }
        const rowsToDelete = rowIndexes
          .map((index) => rows[index])
          .filter((row): row is GridRowModel => Boolean(row));
        const result = onRowDelete({
          selection,
          rowIndexes,
          rows: rowsToDelete,
        });
        processResult(result);
        return false;
      }

      // If a rectangular range is selected, batch clear all cells
      if (selection.current?.range) {
        const {
          x: startCol,
          y: startRow,
          width,
          height,
        } = selection.current.range;
        const endCol = Math.min(startCol + width, columns.length);
        const endRow = Math.min(startRow + height, rows.length);

        const cellsToClear: Item[] = [];
        for (let row = startRow; row < endRow; row++) {
          for (let col = startCol; col < endCol; col++) {
            cellsToClear.push([col, row]);
          }
        }

        if (cellsToClear.length > 0) {
          if (onBatchClear) {
            // Use batch clear for single undo
            onBatchClear(cellsToClear);
          } else {
            // Fall back to individual clears
            for (const cell of cellsToClear) {
              const columnField = columns[cell[0]]?.field;
              if (columnField) {
                handleClearCell(cell, columnField);
              }
            }
          }
        }
        return false;
      }

      // If a single cell is selected, clear the cell value
      if (selection.current?.cell) {
        const cell = selection.current.cell;
        const columnField = columns[cell[0]]?.field;
        if (columnField) {
          handleClearCell(cell, columnField);
        }
        return false;
      }

      return false;
    },
    [onRowDelete, processResult, rows, columns, handleClearCell, onBatchClear],
  );

  const { handleDataEditorPaste } = usePasteHandler({
    coerceValue: coerceValue,
    allowGridFallback: false, // We handle paste ourselves
    columnHints,
    onValidationErrors: onPasteValidationErrors,
    onPaste: (event) => {
      // Let custom handler override
      const result = onPaste?.(event);
      const bool = processResult(result);
      if (typeof bool === "boolean") {
        return bool;
      }

      // Apply paste by calling handleCellEdited for each cell
      // Wrap in useTransition for non-blocking UI during large paste operations
      const [colStart, rowStart] = event.target;

      // Detect and skip header row if present
      let pasteValues = event.values;
      const columnNames = columns.map((c) => c.id);
      const firstRow = pasteValues[0];
      if (firstRow && detectHeaderRow(firstRow, columnNames, colStart)) {
        pasteValues = pasteValues.slice(1);
        if (pasteValues.length === 0) {
          return false;
        }
      }

      // Use startPasteTransition for non-blocking paste on large selections
      startPasteTransition(() => {
        for (let rowOffset = 0; rowOffset < pasteValues.length; rowOffset++) {
          const rowIndex = rowStart + rowOffset;
          if (rowIndex >= rows.length) break; // Don't paste beyond existing rows

          const rowValues = pasteValues[rowOffset];
          if (!rowValues) continue;

          for (let colOffset = 0; colOffset < rowValues.length; colOffset++) {
            const colIndex = colStart + colOffset;
            if (colIndex >= columns.length) break; // Don't paste beyond existing columns

            const value = rowValues[colOffset];
            const column = columns[colIndex];
            if (!column) continue;

            const cell: Item = [colIndex, rowIndex];

            // Get the current cell content to preserve cell type
            const currentCell = getCellContent(cell);

            // Create new cell with pasted value (preserve the cell kind/type)
            // Only update if cell has data property (skip loading cells, etc.)
            const cellWithData = currentCell as GridCell & {
              data?: Record<string, unknown>;
            };
            if (!cellWithData.data) continue;

            // Create new cell with updated value using Object.assign to avoid spread type issues
            const existingData = cellWithData.data;
            const newCell = {
              ...currentCell,
              data: Object.assign({}, existingData, { value }),
            } as GridCell;

            handleCellEdited(cell, newCell);
          }
        }
      });

      return false; // Prevent default - we handled it
    },
    afterPaste: (event, result) => {
      if (typeof result !== "boolean") {
        processResult(result);
      }
      if (!onRowInsert) return;
      const [colStart, rowStart] = event.target;

      // Detect and skip header row if present (must match onPaste logic)
      let pasteValues = event.values;
      const columnNames = columns.map((c) => c.id);
      const firstRow = pasteValues[0];
      if (firstRow && detectHeaderRow(firstRow, columnNames, colStart)) {
        pasteValues = pasteValues.slice(1);
        if (pasteValues.length === 0) return;
      }

      const requiredRowCount = rowStart + pasteValues.length;
      if (requiredRowCount <= rows.length) return;
      const missing = requiredRowCount - rows.length;
      const newRows: GridRowModel[] = [];
      for (let i = 0; i < missing; i++) {
        const baseRow =
          createDraftRow?.(rows.length + i) ?? createDefaultDraftRow(columns);
        const sourceRowValues =
          pasteValues[pasteValues.length - missing + i] ?? [];
        // Pass column offset so values are applied to the correct columns
        newRows.push(
          applyValuesToRow(baseRow, columns, sourceRowValues, colStart),
        );
      }
      const insertEvent: GridRowInsertEvent = {
        index: rows.length,
        rows: newRows,
      };
      const followUp = onRowInsert(insertEvent);
      processResult(followUp);
    },
  });

  // Expose methods via ref
  useImperativeHandle(ref, () => {
    const gridRefCurrent = gridRef.current;
    if (!gridRefCurrent) {
      return { appendRow } as EditableDataGridRef;
    }
    return {
      ...gridRefCurrent,
      appendRow,
    };
  }, [appendRow]);

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      onSelectionChange?.(selection);
      onGridSelectionChange?.(selection);
    },
    [onSelectionChange, onGridSelectionChange],
  );

  // Handle cell click - ensure Glide's canvas has focus for keyboard navigation
  const handleCellClickInternal = useCallback<
    NonNullable<DataEditorProps["onCellClicked"]>
  >(
    (cell) => {
      const coords = getCoordinates(cell);
      if (coords) {
        onCellClicked?.(coords);
      }
      // Focus Glide's canvas (not wrapper) to enable native keyboard navigation
      // This is critical for arrow keys, Tab, Delete, etc. to work
      gridRef.current?.focus();
    },
    [getCoordinates, onCellClicked],
  );

  // Keyboard events are now handled by Glide Data Grid natively
  // The custom keyboard handler was disabled because it used a global store
  // that caused conflicts when multiple grids were present.

  return (
    // Wrapper div for layout and focus containment check (used by cmd+delete handler)
    // NO tabIndex - Glide manages focus on its internal canvas element
    // NO onKeyDown - Glide handles keyboard navigation natively
    <div ref={wrapperRef} className="h-full w-full outline-none">
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
        highlightRegions={highlightRegions}
        onHeaderClicked={onHeaderClicked}
        drawHeader={drawHeader}
        onHeaderContextMenu={onHeaderContextMenu}
        onItemHovered={onItemHovered}
        onColumnMoved={onColumnMoved} // NEW: Forward column moved event
        drawCell={drawCell}
        onCellClicked={handleCellClickInternal}
        drawFocusRing
        rangeSelect="rect"
        columnSelect="multi"
        rowSelect="multi"
        scaleToRem={false}
      />
    </div>
  );
});

EditableDataGrid.displayName = "EditableDataGrid";
