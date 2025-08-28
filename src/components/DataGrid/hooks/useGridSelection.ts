import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useDebouncedCallback } from "use-debounce";

export interface CellPosition {
  rowIndex: number;
  columnIndex: number;
}

export interface SelectionRange {
  start: CellPosition;
  end: CellPosition;
}

interface UseGridSelectionProps {
  totalRows: number;
  totalColumns: number;
  visibleRange?: { start: number; end: number };
  onSelectionChange?: (selectedRows: Set<number>) => void;
}

/**
 * Selection hook with virtualization and async updates
 */
export function useGridSelection({
  visibleRange,
  onSelectionChange,
}: UseGridSelectionProps) {
  const [focusedCell, setFocusedCell] = useState<CellPosition | null>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(
    null,
  );
  const [isSelecting, setIsSelecting] = useState(false);

  // Use Map for O(1) lookups instead of Set
  const selectionMapRef = useRef<Map<number, boolean>>(new Map());
  const dragStartRef = useRef<CellPosition | null>(null);

  // Debounced selection change callback
  const debouncedOnChange = useDebouncedCallback((selection: Set<number>) => {
    onSelectionChange?.(selection);
  }, 100);

  // Only track visible selections for performance
  const visibleSelections = useMemo(() => {
    if (!visibleRange) return new Set<number>();

    const visible = new Set<number>();
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      if (selectionMapRef.current.has(i)) {
        visible.add(i);
      }
    }
    return visible;
  }, [visibleRange, selectionMapRef.current.size]);

  // Optimized selection calculation for rectangular selection
  useEffect(() => {
    if (!selectionRange) {
      selectionMapRef.current.clear();
      debouncedOnChange(new Set());
      return;
    }

    const newSelection = new Map<number, boolean>();

    if (selectionRange) {
      const { start, end } = selectionRange;
      const minRow = Math.min(start.rowIndex, end.rowIndex);
      const maxRow = Math.max(start.rowIndex, end.rowIndex);

      // Track all rows in the rectangular selection
      for (let i = minRow; i <= maxRow; i++) {
        newSelection.set(i, true);
      }
    }

    selectionMapRef.current = newSelection;
    debouncedOnChange(new Set(newSelection.keys()));
  }, [selectionRange, debouncedOnChange]);

  // Cleanup selections outside visible range periodically
  useEffect(() => {
    const cleanup = () => {
      if (!visibleRange) return;

      const buffer = 100;
      const keepStart = visibleRange.start - buffer;
      const keepEnd = visibleRange.end + buffer;

      for (const [index] of selectionMapRef.current) {
        if (index < keepStart || index > keepEnd) {
          selectionMapRef.current.delete(index);
        }
      }
    };

    const interval = setInterval(cleanup, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [visibleRange]);

  // Stable event handlers using refs
  const handleCellClick = useCallback(
    (rowIndex: number, columnIndex: number, event: React.MouseEvent) => {
      const position: CellPosition = { rowIndex, columnIndex };

      if (event.shiftKey && focusedCell) {
        // Shift+click for rectangular selection
        setSelectionRange({
          start: focusedCell,
          end: position,
        });
      } else if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd+click for adding to selection
        if (selectionMapRef.current.has(rowIndex)) {
          selectionMapRef.current.delete(rowIndex);
        } else {
          selectionMapRef.current.set(rowIndex, true);
        }
        setFocusedCell(position);
        setSelectionRange(null);
        debouncedOnChange(new Set(selectionMapRef.current.keys()));
      } else {
        // Regular click - always update focused cell and clear selection
        setFocusedCell(position);
        setSelectionRange({
          start: position,
          end: position,
        });
        selectionMapRef.current.clear();
        selectionMapRef.current.set(rowIndex, true);
        debouncedOnChange(new Set(selectionMapRef.current.keys()));
      }
    },
    [focusedCell, debouncedOnChange],
  );

  const handleCellMouseDown = useCallback(
    (rowIndex: number, columnIndex: number, event: React.MouseEvent) => {
      if (
        event.button === 0 &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const position: CellPosition = { rowIndex, columnIndex };
        dragStartRef.current = position;
        setIsSelecting(true);
        setFocusedCell(position);
        setSelectionRange({
          start: position,
          end: position,
        });
        event.preventDefault();
      }
    },
    [],
  );

  const handleCellMouseEnter = useCallback(
    (rowIndex: number, columnIndex: number) => {
      if (isSelecting && dragStartRef.current) {
        requestAnimationFrame(() => {
          setSelectionRange({
            start: dragStartRef.current!,
            end: { rowIndex, columnIndex },
          });
        });
      }
    },
    [isSelecting],
  );

  const handleMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      dragStartRef.current = null;
    }
  }, [isSelecting]);

  // Set up global listeners
  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp, { passive: true });
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseUp]);

  const clearSelection = useCallback(() => {
    selectionMapRef.current.clear();
    setFocusedCell(null);
    setSelectionRange(null);
    debouncedOnChange(new Set());
  }, [debouncedOnChange]);

  const isRowSelected = useCallback((rowIndex: number) => {
    // Don't show row selection, only cell selection
    return false;
  }, []);

  const isCellSelected = useCallback(
    (rowIndex: number, columnIndex: number) => {
      if (!selectionRange) {
        return false;
      }

      const { start, end } = selectionRange;
      const minRow = Math.min(start.rowIndex, end.rowIndex);
      const maxRow = Math.max(start.rowIndex, end.rowIndex);
      const minCol = Math.min(start.columnIndex, end.columnIndex);
      const maxCol = Math.max(start.columnIndex, end.columnIndex);

      return (
        rowIndex >= minRow &&
        rowIndex <= maxRow &&
        columnIndex >= minCol &&
        columnIndex <= maxCol
      );
    },
    [selectionRange],
  );

  const isCellFocused = useCallback(
    (rowIndex: number, columnIndex: number) => {
      return (
        focusedCell?.rowIndex === rowIndex &&
        focusedCell?.columnIndex === columnIndex
      );
    },
    [focusedCell],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, totalRows: number, totalColumns: number) => {
      if (!focusedCell) return;

      let newRow = focusedCell.rowIndex;
      let newCol = focusedCell.columnIndex;

      switch (event.key) {
        case "Tab":
          event.preventDefault();
          if (event.shiftKey) {
            // Move backward
            newCol--;
            if (newCol < 0) {
              newCol = totalColumns - 1;
              newRow = Math.max(0, newRow - 1);
            }
          } else {
            // Move forward
            newCol++;
            if (newCol >= totalColumns) {
              newCol = 0;
              newRow = Math.min(totalRows - 1, newRow + 1);
            }
          }
          break;

        case "ArrowUp":
          event.preventDefault();
          newRow = Math.max(0, newRow - 1);
          break;

        case "ArrowDown":
          event.preventDefault();
          newRow = Math.min(totalRows - 1, newRow + 1);
          break;

        case "ArrowLeft":
          event.preventDefault();
          newCol = Math.max(0, newCol - 1);
          break;

        case "ArrowRight":
          event.preventDefault();
          newCol = Math.min(totalColumns - 1, newCol + 1);
          break;

        default:
          return;
      }

      const newPosition = { rowIndex: newRow, columnIndex: newCol };
      setFocusedCell(newPosition);
      setSelectionRange({ start: newPosition, end: newPosition });
    },
    [focusedCell],
  );

  return {
    focusedCell,
    selectedRows: visibleSelections,
    selectionRange,
    isSelecting,
    handleCellClick,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleKeyDown,
    clearSelection,
    isCellSelected,
    isRowSelected,
    isCellFocused,
    selectedRowCount: selectionMapRef.current.size,
    setFocusedCell,
  };
}
