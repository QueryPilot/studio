/**
 * Hook for managing TanStack Virtual configuration for DataTable
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, type RefObject } from "react";
import { VIRTUALIZATION_CONFIG, type ColumnDefinition } from "../types";

interface UseVirtualizationProps {
  rowCount: number;
  columns: ColumnDefinition[];
  scrollElement: RefObject<HTMLDivElement | null>;
}

export function useVirtualization({
  rowCount,
  columns,
  scrollElement,
}: UseVirtualizationProps) {
  // Row virtualizer for vertical scrolling
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => VIRTUALIZATION_CONFIG.ROW_HEIGHT,
    overscan: 10, // Increased overscan for smoother scrolling
  });

  // Column virtualizer for horizontal scrolling
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: (index) => {
      const column = columns[index];
      return column?.width || VIRTUALIZATION_CONFIG.DEFAULT_COLUMN_WIDTH;
    },
    overscan: 3, // Increased overscan for smoother scrolling
  });

  // Calculate total dimensions for scrollable area
  const totalHeight = rowVirtualizer.getTotalSize();
  const totalWidth = columnVirtualizer.getTotalSize();

  // Get visible items
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();

  // Helper to check if a row is visible
  const isRowVisible = useMemo(() => {
    const visibleRowIndices = new Set(virtualRows.map((row) => row.index));
    return (index: number) => visibleRowIndices.has(index);
  }, [virtualRows]);

  // Helper to check if a column is visible
  const isColumnVisible = useMemo(() => {
    const visibleColumnIndices = new Set(
      virtualColumns.map((col) => col.index),
    );
    return (index: number) => visibleColumnIndices.has(index);
  }, [virtualColumns]);

  // Calculate visible range for optimization
  const visibleRange = useMemo(() => {
    const firstRowIndex = virtualRows[0]?.index ?? 0;
    const lastRowIndex = virtualRows[virtualRows.length - 1]?.index ?? 0;
    const firstColumnIndex = virtualColumns[0]?.index ?? 0;
    const lastColumnIndex =
      virtualColumns[virtualColumns.length - 1]?.index ?? 0;

    return {
      startRowIndex: firstRowIndex,
      endRowIndex: lastRowIndex,
      startColumnIndex: firstColumnIndex,
      endColumnIndex: lastColumnIndex,
    };
  }, [virtualRows, virtualColumns]);

  return {
    rowVirtualizer,
    columnVirtualizer,
    virtualRows,
    virtualColumns,
    totalHeight,
    totalWidth,
    isRowVisible,
    isColumnVisible,
    visibleRange,
  };
}
