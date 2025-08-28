import { memo, useMemo, useState, useCallback } from "react";
import type { Row } from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";
import type {
  CellPosition,
  SelectionRange,
} from "../hooks/useGridSelection";
import { CellValueRenderer } from "../cells/CellValueRenderer";
import { CellWithCopy } from "./CellWithCopy";
import { InlineCellEditor } from "./InlineCellEditor";
import { cn } from "@/lib/utils";

interface DataGridRowProps {
  virtualItem: VirtualItem;
  row: Row<TableDataRow> | undefined;
  tableWidth: number;
  columns: ColumnMeta[];
  getAdjustedColumnWidth: (
    column: { getSize: () => number },
    columnIndex?: number,
  ) => number;
  isLastRow?: boolean;
  isRowSelected?: boolean;
  isCellSelected?: (rowIndex: number, columnIndex: number) => boolean;
  isCellFocused?: (rowIndex: number, columnIndex: number) => boolean;
  handlers: {
    onClick?: (
      rowIndex: number,
      columnIndex: number,
      event: React.MouseEvent,
    ) => void;
    onMouseDown?: (
      rowIndex: number,
      columnIndex: number,
      event: React.MouseEvent,
    ) => void;
    onMouseEnter?: (rowIndex: number, columnIndex: number) => void;
    onContextMenu?: (
      rowIndex: number,
      columnIndex: number,
      event: React.MouseEvent,
      cellValue: any,
    ) => void;
    onCellUpdate?: (
      rowIndex: number,
      columnIndex: number,
      newValue: any,
    ) => void;
  };
  selectionRange?: SelectionRange | null;
  focusedCell?: CellPosition | null;
}

/**
 * DataGridRow with proper memoization
 * Only re-renders when selection state or data changes
 */
export const DataGridRow = memo(function DataGridRow({
  virtualItem,
  row,
  columns,
  getAdjustedColumnWidth,
  isCellSelected,
  isCellFocused,
  handlers,
  selectionRange,
}: DataGridRowProps) {
  // Check if any cell in this row is selected
  const hasSelectedCells = useMemo(() => {
    if (!selectionRange) return false;
    const { start, end } = selectionRange;
    const minRow = Math.min(start.rowIndex, end.rowIndex);
    const maxRow = Math.max(start.rowIndex, end.rowIndex);
    return virtualItem.index >= minRow && virtualItem.index <= maxRow;
  }, [selectionRange, virtualItem.index]);

  // Memoize row class name
  const rowClassName = useMemo(() => {
    return cn(
      "transition-colors border-b",
      virtualItem.index % 2 === 0 && "bg-muted/10",
      hasSelectedCells && "bg-primary/10",
      !hasSelectedCells && "hover:bg-primary/5",
    );
  }, [virtualItem.index, hasSelectedCells]);

  // Memoize row style
  const rowStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: virtualItem.start + 32,
      left: 0,
      right: 0,
      width: "100%",
      height: `${virtualItem.size}px`,
    }),
    [virtualItem.start, virtualItem.size],
  );

  if (!row) return null;

  return (
    <div data-index={virtualItem.index} style={rowStyle}>
      <table className="table-fixed w-full">
        <tbody>
          <tr className={rowClassName} style={{ height: "28px" }}>
            {row.getVisibleCells().map((cell, columnIndex) => (
              <OptimizedCell
                key={cell.id}
                cell={cell}
                columnIndex={columnIndex}
                virtualItemIndex={virtualItem.index}
                columns={columns}
                getAdjustedColumnWidth={getAdjustedColumnWidth}
                isCellSelected={isCellSelected}
                isCellFocused={isCellFocused}
                handlers={handlers}
              />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
},
arePropsEqual);

/**
 * Optimized cell component
 */
const OptimizedCell = memo(function OptimizedCell({
  cell,
  columnIndex,
  virtualItemIndex,
  columns,
  getAdjustedColumnWidth,
  isCellSelected,
  isCellFocused,
  handlers,
}: any) {
  const [isEditing, setIsEditing] = useState(false);
  const cellValue = cell.getValue() as CellValue | undefined;
  const column = columns.find((col: ColumnMeta) => col.name === cell.column.id);
  const adjustedCellWidth = getAdjustedColumnWidth(cell.column, columnIndex);

  // Memoize cell selection state
  const cellSelected = useMemo(
    () => isCellSelected?.(virtualItemIndex, columnIndex) || false,
    [isCellSelected, virtualItemIndex, columnIndex],
  );

  const cellFocused = useMemo(
    () => isCellFocused?.(virtualItemIndex, columnIndex) || false,
    [isCellFocused, virtualItemIndex, columnIndex],
  );

  // Memoize cell class name
  const cellClassName = useMemo(
    () =>
      cn(
        "px-1.5 py-0.5 text-xs text-foreground/80 dark:text-foreground/70 border-r last:border-r-0",
        "cursor-pointer select-none relative",
        cellSelected && "bg-primary/20",
        cellFocused && "ring-1 ring-primary ring-inset z-10",
        "focus:outline-none focus:ring-2 focus:ring-primary",
      ),
    [cellSelected, cellFocused],
  );

  // Handle double click to enter edit mode
  const handleDoubleClick = useCallback(() => {
    if (!column?.is_pk) {
      // Don't allow editing primary keys
      setIsEditing(true);
    }
  }, [column]);

  // Handle key press for entering edit mode
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (cellFocused && !isEditing) {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          if (!column?.is_pk) {
            setIsEditing(true);
          }
        } else if (e.key === "Delete" || e.key === "Backspace") {
          // Clear cell value on Delete/Backspace
          e.preventDefault();
          if (!column?.is_pk) {
            handlers.onCellUpdate?.(virtualItemIndex, columnIndex, null);
          }
        } else if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          // Start editing with the typed character
          if (!column?.is_pk) {
            setIsEditing(true);
            // The character will be captured by the editor when it opens
          }
        }
      }
    },
    [cellFocused, isEditing, column, virtualItemIndex, columnIndex, handlers],
  );

  // Handle save from editor
  const handleSave = useCallback(
    (newValue: any) => {
      // Call the parent handler to update the cell value
      handlers.onCellUpdate?.(virtualItemIndex, columnIndex, newValue);
      setIsEditing(false);
    },
    [virtualItemIndex, columnIndex, handlers],
  );

  // Handle cancel from editor
  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  // Check if cell is NULL
  const isNull =
    !cellValue || cellValue.value === null || cellValue.value === undefined;

  // Get text value for copy
  const getCopyText = (): string => {
    if (isNull) return "NULL";
    if (typeof cellValue.value === "string") return cellValue.value;
    return JSON.stringify(cellValue.value);
  };

  let cellContent: React.ReactNode;
  if (cellValue && column) {
    cellContent = <CellValueRenderer cell={cellValue} column={column} />;
  } else if (cellValue) {
    cellContent = (
      <span className="text-xs truncate block">
        {JSON.stringify(cellValue)}
      </span>
    );
  } else {
    cellContent = (
      <span className="text-muted-foreground italic text-xs">-</span>
    );
  }

  // Determine cell value type for editor
  const getCellType = useCallback(() => {
    if (!cellValue) return "text";
    const valueType = cellValue.value_type || typeof cellValue.value;

    if (valueType === "Boolean" || typeof cellValue.value === "boolean")
      return "boolean";
    if (
      valueType === "Integer" ||
      valueType === "Decimal" ||
      typeof cellValue.value === "number"
    )
      return "number";
    if (valueType === "Json" || typeof cellValue.value === "object")
      return "json";
    return "text";
  }, [cellValue]);

  return (
    <td
      className={cellClassName}
      style={{
        width: adjustedCellWidth,
        minWidth: adjustedCellWidth,
        maxWidth: adjustedCellWidth,
        overflow: "hidden",
      }}
      tabIndex={cellFocused ? 0 : -1}
      onClick={(e) => handlers.onClick?.(virtualItemIndex, columnIndex, e)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) =>
        handlers.onMouseDown?.(virtualItemIndex, columnIndex, e)
      }
      onMouseEnter={() =>
        handlers.onMouseEnter?.(virtualItemIndex, columnIndex)
      }
      onContextMenu={(e) =>
        handlers.onContextMenu?.(virtualItemIndex, columnIndex, e, cellValue)
      }
    >
      {isEditing ? (
        <InlineCellEditor
          value={cellValue?.value ?? cellValue}
          type={getCellType()}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : isNull ? (
        <div
          className={cn("h-full", {
            "text-right":
              cellValue?.value_type === "Integer" ||
              cellValue?.value_type === "Decimal",
          })}
        >
          {cellContent}
        </div>
      ) : (
        <CellWithCopy
          value={getCopyText()}
          className={cn("h-full", {
            "justify-end":
              cellValue.value_type === "Integer" ||
              cellValue.value_type === "Decimal",
          })}
        >
          {cellContent}
        </CellWithCopy>
      )}
    </td>
  );
});

/**
 * Custom equality check for memo
 * Only re-render if critical props change
 */
function arePropsEqual(
  prevProps: DataGridRowProps,
  nextProps: DataGridRowProps,
): boolean {
  // Always re-render if row data changes
  if (prevProps.row !== nextProps.row) return false;

  // Re-render if virtual item changes
  if (prevProps.virtualItem.index !== nextProps.virtualItem.index) return false;
  if (prevProps.virtualItem.start !== nextProps.virtualItem.start) return false;

  // Re-render if selection state changes for this row
  const prevRange = prevProps.selectionRange;
  const nextRange = nextProps.selectionRange;

  // Check if selection range changed
  if (!prevRange && nextRange) return false;
  if (prevRange && !nextRange) return false;
  if (prevRange && nextRange) {
    // Check if this row is affected by the selection change
    const rowIndex = prevProps.virtualItem.index;
    const prevInRange =
      rowIndex >= Math.min(prevRange.start.rowIndex, prevRange.end.rowIndex) &&
      rowIndex <= Math.max(prevRange.start.rowIndex, prevRange.end.rowIndex);
    const nextInRange =
      rowIndex >= Math.min(nextRange.start.rowIndex, nextRange.end.rowIndex) &&
      rowIndex <= Math.max(nextRange.start.rowIndex, nextRange.end.rowIndex);

    if (prevInRange !== nextInRange) return false;
    if (prevInRange && nextInRange) {
      // Both in range, check if the range itself changed
      if (
        prevRange.start.rowIndex !== nextRange.start.rowIndex ||
        prevRange.start.columnIndex !== nextRange.start.columnIndex ||
        prevRange.end.rowIndex !== nextRange.end.rowIndex ||
        prevRange.end.columnIndex !== nextRange.end.columnIndex
      ) {
        return false;
      }
    }
  }

  // Check if focused cell changed for this row
  const prevFocus = prevProps.focusedCell;
  const nextFocus = nextProps.focusedCell;
  if (
    !prevFocus &&
    nextFocus &&
    nextFocus.rowIndex === prevProps.virtualItem.index
  )
    return false;
  if (
    prevFocus &&
    !nextFocus &&
    prevFocus.rowIndex === prevProps.virtualItem.index
  )
    return false;
  if (
    prevFocus &&
    nextFocus &&
    (prevFocus.rowIndex === prevProps.virtualItem.index ||
      nextFocus.rowIndex === prevProps.virtualItem.index) &&
    (prevFocus.rowIndex !== nextFocus.rowIndex ||
      prevFocus.columnIndex !== nextFocus.columnIndex)
  ) {
    return false;
  }

  // Don't re-render for handler changes (they should be stable)
  return true;
}
