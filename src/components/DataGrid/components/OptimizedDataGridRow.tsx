import { memo } from "react";
import type { Row } from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { ColumnMeta } from "@/types/database";
import type { SelectionRange } from "../hooks/useGridSelection";
import { CellValueRenderer } from "../cells/CellValueRenderer";

interface OptimizedDataGridRowProps {
  virtualItem: VirtualItem;
  row: Row<TableDataRow> | undefined;
  columns: ColumnMeta[];
  getAdjustedColumnWidth: (
    column: { getSize: () => number },
    columnIndex?: number,
  ) => number;
  isRowInSelection?: boolean;
  selectedColumns?: Set<number>;
  focusedColumn?: number | null;
}

/**
 * Optimized row component using div + CSS Grid
 * No individual event handlers - uses event delegation from parent
 */
export const OptimizedDataGridRow = memo(function OptimizedDataGridRow({
  virtualItem,
  row,
  columns,
  getAdjustedColumnWidth,
  isRowInSelection = false,
  selectedColumns = new Set(),
  focusedColumn = null,
}: OptimizedDataGridRowProps) {
  if (!row) return null;

  // Calculate grid template columns
  const gridTemplateColumns = row.getVisibleCells()
    .map((_, idx) => `${getAdjustedColumnWidth({ getSize: () => 150 }, idx)}px`)
    .join(' ');

  return (
    <div
      className="grid-row"
      role="row"
      data-row-index={virtualItem.index}
      style={{
        // CSS variables for dynamic styling
        '--row-index': virtualItem.index,
        '--row-top': `${virtualItem.start + 32}px`,
        '--row-selected': isRowInSelection ? 1 : 0,
        '--row-even': virtualItem.index % 2 === 0 ? 1 : 0,
        gridTemplateColumns,
        transform: `translateY(var(--row-top))`,
        position: 'absolute',
        width: '100%',
        height: '28px',
        left: 0,
        right: 0,
      } as React.CSSProperties}
    >
      {row.getVisibleCells().map((cell, columnIndex) => {
        const column = columns.find((col) => col.name === cell.column.id);
        const cellValue = cell.getValue();
        const isSelected = selectedColumns.has(columnIndex);
        const isFocused = focusedColumn === columnIndex;

        return (
          <div
            key={cell.id}
            className="grid-cell"
            role="cell"
            data-col-index={columnIndex}
            data-cell-value={JSON.stringify(cellValue)}
            style={{
              '--cell-selected': isSelected ? 1 : 0,
              '--cell-focused': isFocused ? 1 : 0,
            } as React.CSSProperties}
          >
            {cellValue && column ? (
              <CellValueRenderer cell={cellValue as any} column={column} />
            ) : (
              <span className="text-muted-foreground italic text-xs">-</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

/**
 * Simple props comparison for memoization
 * Only re-render on essential changes
 */
export function areRowPropsEqual(
  prevProps: OptimizedDataGridRowProps,
  nextProps: OptimizedDataGridRowProps,
): boolean {
  // Always re-render if row data changes
  if (prevProps.row !== nextProps.row) return false;
  
  // Re-render if virtual position changes
  if (prevProps.virtualItem.index !== nextProps.virtualItem.index) return false;
  if (prevProps.virtualItem.start !== nextProps.virtualItem.start) return false;
  
  // Re-render if selection state changes
  if (prevProps.isRowInSelection !== nextProps.isRowInSelection) return false;
  if (prevProps.focusedColumn !== nextProps.focusedColumn) return false;
  
  // Check if selected columns changed
  if (prevProps.selectedColumns.size !== nextProps.selectedColumns.size) return false;
  
  return true;
}