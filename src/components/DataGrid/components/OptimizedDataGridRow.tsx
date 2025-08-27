import { memo, useMemo } from "react";
import type { Row } from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";
import { CellValueRenderer } from "../cells/CellValueRenderer";
import { CellWithCopy } from "./CellWithCopy";
import { cn } from "@/lib/utils";

interface OptimizedDataGridRowProps {
  virtualItem: VirtualItem;
  row: Row<TableDataRow> | undefined;
  tableWidth: number;
  columns: ColumnMeta[];
  getAdjustedColumnWidth: (column: { getSize: () => number }, columnIndex?: number) => number;
  isLastRow?: boolean;
  isRowSelected?: boolean;
  isCellSelected?: (rowIndex: number, columnIndex: number) => boolean;
  isCellFocused?: (rowIndex: number, columnIndex: number) => boolean;
  handlers: {
    onClick?: (rowIndex: number, columnIndex: number, event: React.MouseEvent) => void;
    onMouseDown?: (rowIndex: number, columnIndex: number, event: React.MouseEvent) => void;
    onMouseEnter?: (rowIndex: number, columnIndex: number) => void;
    onContextMenu?: (rowIndex: number, columnIndex: number, event: React.MouseEvent, cellValue: any) => void;
  };
}

/**
 * Optimized DataGridRow with proper memoization
 * Only re-renders when selection state or data changes
 */
export const OptimizedDataGridRow = memo(function OptimizedDataGridRow({
  virtualItem,
  row,
  tableWidth,
  columns,
  getAdjustedColumnWidth,
  isLastRow = false,
  isRowSelected = false,
  isCellSelected,
  isCellFocused,
  handlers,
}: OptimizedDataGridRowProps) {
  if (!row) return null;

  // Memoize row class name
  const rowClassName = useMemo(() => {
    return cn(
      "transition-colors border-b",
      virtualItem.index % 2 === 0 && "bg-muted/10",
      isRowSelected && "bg-primary/20 hover:bg-primary/25",
      !isRowSelected && "hover:bg-primary/10",
    );
  }, [virtualItem.index, isRowSelected]);

  // Memoize row style
  const rowStyle = useMemo(() => ({
    position: "absolute" as const,
    top: virtualItem.start + 32,
    left: 0,
    right: 0,
    width: '100%',
    height: `${virtualItem.size}px`,
  }), [virtualItem.start, virtualItem.size]);

  return (
    <div
      data-index={virtualItem.index}
      style={rowStyle}
    >
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
}, arePropsEqual);

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
  const cellValue = cell.getValue() as CellValue | undefined;
  const column = columns.find((col: ColumnMeta) => col.name === cell.column.id);
  const adjustedCellWidth = getAdjustedColumnWidth(cell.column, columnIndex);

  // Memoize cell selection state
  const cellSelected = useMemo(() => 
    isCellSelected?.(virtualItemIndex, columnIndex) || false,
    [isCellSelected, virtualItemIndex, columnIndex]
  );
  
  const cellFocused = useMemo(() =>
    isCellFocused?.(virtualItemIndex, columnIndex) || false,
    [isCellFocused, virtualItemIndex, columnIndex]
  );

  // Memoize cell class name
  const cellClassName = useMemo(() => cn(
    "px-1.5 py-0.5 text-xs text-foreground/80 dark:text-foreground/70 border-r last:border-r-0",
    "cursor-pointer select-none",
    cellSelected && "bg-primary/30",
    cellFocused && "ring-2 ring-primary ring-inset",
  ), [cellSelected, cellFocused]);

  // Check if cell is NULL
  const isNull = !cellValue || cellValue.value === null || cellValue.value === undefined;

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

  return (
    <td
      className={cellClassName}
      style={{
        width: adjustedCellWidth,
        minWidth: adjustedCellWidth,
        maxWidth: adjustedCellWidth,
        overflow: "hidden",
      }}
      onClick={(e) => handlers.onClick?.(virtualItemIndex, columnIndex, e)}
      onMouseDown={(e) => handlers.onMouseDown?.(virtualItemIndex, columnIndex, e)}
      onMouseEnter={() => handlers.onMouseEnter?.(virtualItemIndex, columnIndex)}
      onContextMenu={(e) => handlers.onContextMenu?.(virtualItemIndex, columnIndex, e, cellValue)}
    >
      {isNull ? (
        <div
          className={cn("h-full", {
            "text-right": cellValue?.value_type === "Integer" || cellValue?.value_type === "Decimal",
          })}
        >
          {cellContent}
        </div>
      ) : (
        <CellWithCopy
          value={getCopyText()}
          className={cn("h-full", {
            "justify-end": cellValue.value_type === "Integer" || cellValue.value_type === "Decimal",
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
  prevProps: OptimizedDataGridRowProps,
  nextProps: OptimizedDataGridRowProps
): boolean {
  // Always re-render if row data changes
  if (prevProps.row !== nextProps.row) return false;
  
  // Re-render if selection state changes
  if (prevProps.isRowSelected !== nextProps.isRowSelected) return false;
  
  // Re-render if virtual item changes
  if (prevProps.virtualItem.index !== nextProps.virtualItem.index) return false;
  if (prevProps.virtualItem.start !== nextProps.virtualItem.start) return false;
  
  // Don't re-render for handler changes (they should be stable)
  return true;
}