import { useState, useCallback, useRef, useEffect, useMemo, useTransition } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export interface CellPosition {
  rowIndex: number;
  columnIndex: number;
}

export interface SelectionRange {
  start: CellPosition;
  end: CellPosition;
}

interface UseOptimizedGridSelectionProps {
  totalRows: number;
  totalColumns: number;
  visibleRange?: { start: number; end: number };
  onSelectionChange?: (selectedRows: Set<number>) => void;
}

/**
 * Optimized selection hook with virtualization and async updates
 */
export function useOptimizedGridSelection({ 
  totalRows, 
  totalColumns, 
  visibleRange,
  onSelectionChange 
}: UseOptimizedGridSelectionProps) {
  const [focusedCell, setFocusedCell] = useState<CellPosition | null>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isPending, startTransition] = useTransition();
  
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
  
  // Optimized selection calculation
  useEffect(() => {
    if (!selectionRange && !focusedCell) {
      selectionMapRef.current.clear();
      return;
    }
    
    startTransition(() => {
      const newSelection = new Map<number, boolean>();
      
      if (selectionRange) {
        const { start, end } = selectionRange;
        const minRow = Math.min(start.rowIndex, end.rowIndex);
        const maxRow = Math.max(start.rowIndex, end.rowIndex);
        
        // Only process visible range + buffer
        const bufferSize = 50;
        const processStart = Math.max(0, (visibleRange?.start ?? 0) - bufferSize);
        const processEnd = Math.min(totalRows - 1, (visibleRange?.end ?? totalRows) + bufferSize);
        
        for (let i = Math.max(minRow, processStart); i <= Math.min(maxRow, processEnd); i++) {
          newSelection.set(i, true);
        }
      } else if (focusedCell) {
        newSelection.set(focusedCell.rowIndex, true);
      }
      
      selectionMapRef.current = newSelection;
      debouncedOnChange(new Set(newSelection.keys()));
    });
  }, [selectionRange, focusedCell, visibleRange, totalRows]);
  
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
    return () => clearInterval(interval);
  }, [visibleRange]);
  
  // Stable event handlers using refs
  const handleCellClick = useCallback((rowIndex: number, columnIndex: number, event: React.MouseEvent) => {
    const position: CellPosition = { rowIndex, columnIndex };
    
    if (event.shiftKey && focusedCell) {
      setSelectionRange({
        start: focusedCell,
        end: position
      });
    } else if (event.ctrlKey || event.metaKey) {
      if (selectionMapRef.current.has(rowIndex)) {
        selectionMapRef.current.delete(rowIndex);
      } else {
        selectionMapRef.current.set(rowIndex, true);
      }
      setFocusedCell(position);
      setSelectionRange(null);
      debouncedOnChange(new Set(selectionMapRef.current.keys()));
    } else {
      setFocusedCell(position);
      setSelectionRange(null);
    }
  }, [focusedCell, debouncedOnChange]);
  
  const handleCellMouseDown = useCallback((rowIndex: number, columnIndex: number, event: React.MouseEvent) => {
    if (event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const position: CellPosition = { rowIndex, columnIndex };
      dragStartRef.current = position;
      setIsSelecting(true);
      setFocusedCell(position);
      setSelectionRange({
        start: position,
        end: position
      });
      event.preventDefault();
    }
  }, []);
  
  const handleCellMouseEnter = useCallback((rowIndex: number, columnIndex: number) => {
    if (isSelecting && dragStartRef.current) {
      requestAnimationFrame(() => {
        setSelectionRange({
          start: dragStartRef.current!,
          end: { rowIndex, columnIndex }
        });
      });
    }
  }, [isSelecting]);
  
  const handleMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      dragStartRef.current = null;
    }
  }, [isSelecting]);
  
  // Set up global listeners
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp, { passive: true });
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseUp]);
  
  const clearSelection = useCallback(() => {
    selectionMapRef.current.clear();
    setFocusedCell(null);
    setSelectionRange(null);
    debouncedOnChange(new Set());
  }, [debouncedOnChange]);
  
  const isRowSelected = useCallback((rowIndex: number) => {
    return selectionMapRef.current.has(rowIndex);
  }, []);
  
  const isCellSelected = useCallback((rowIndex: number, columnIndex: number) => {
    if (!selectionRange) {
      return focusedCell?.rowIndex === rowIndex && focusedCell?.columnIndex === columnIndex;
    }
    
    const { start, end } = selectionRange;
    const minRow = Math.min(start.rowIndex, end.rowIndex);
    const maxRow = Math.max(start.rowIndex, end.rowIndex);
    const minCol = Math.min(start.columnIndex, end.columnIndex);
    const maxCol = Math.max(start.columnIndex, end.columnIndex);
    
    return rowIndex >= minRow && rowIndex <= maxRow && 
           columnIndex >= minCol && columnIndex <= maxCol;
  }, [focusedCell, selectionRange]);
  
  const isCellFocused = useCallback((rowIndex: number, columnIndex: number) => {
    return focusedCell?.rowIndex === rowIndex && focusedCell?.columnIndex === columnIndex;
  }, [focusedCell]);
  
  return {
    focusedCell,
    selectedRows: visibleSelections,
    selectionRange,
    isSelecting,
    isPending,
    handleCellClick,
    handleCellMouseDown,
    handleCellMouseEnter,
    clearSelection,
    isCellSelected,
    isRowSelected,
    isCellFocused,
    selectedRowCount: selectionMapRef.current.size,
  };
}