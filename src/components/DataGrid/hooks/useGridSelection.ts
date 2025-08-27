import { useState, useCallback, useRef, useEffect } from 'react';

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
  onSelectionChange?: (selectedRows: Set<number>) => void;
}

export function useGridSelection({ totalRows, totalColumns, onSelectionChange }: UseGridSelectionProps) {
  const [focusedCell, setFocusedCell] = useState<CellPosition | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  
  const dragStartRef = useRef<CellPosition | null>(null);
  const lastSelectedRef = useRef<Set<number>>(new Set());

  // Calculate selected rows from selection range
  useEffect(() => {
    if (selectionRange) {
      const { start, end } = selectionRange;
      const minRow = Math.min(start.rowIndex, end.rowIndex);
      const maxRow = Math.max(start.rowIndex, end.rowIndex);
      
      const newSelectedRows = new Set<number>();
      for (let i = minRow; i <= maxRow; i++) {
        newSelectedRows.add(i);
      }
      
      setSelectedRows(newSelectedRows);
      lastSelectedRef.current = newSelectedRows;
      onSelectionChange?.(newSelectedRows);
    } else if (focusedCell) {
      const newSelectedRows = new Set([focusedCell.rowIndex]);
      setSelectedRows(newSelectedRows);
      lastSelectedRef.current = newSelectedRows;
      onSelectionChange?.(newSelectedRows);
    } else {
      setSelectedRows(new Set());
      lastSelectedRef.current = new Set();
      onSelectionChange?.(new Set());
    }
  }, [selectionRange, focusedCell, onSelectionChange]);

  const handleCellClick = useCallback((rowIndex: number, columnIndex: number, event: React.MouseEvent) => {
    const position: CellPosition = { rowIndex, columnIndex };
    
    if (event.shiftKey && focusedCell) {
      // Shift+click: create range selection
      setSelectionRange({
        start: focusedCell,
        end: position
      });
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: toggle row selection
      const newSelectedRows = new Set(selectedRows);
      if (newSelectedRows.has(rowIndex)) {
        newSelectedRows.delete(rowIndex);
      } else {
        newSelectedRows.add(rowIndex);
      }
      setSelectedRows(newSelectedRows);
      setFocusedCell(position);
      setSelectionRange(null);
    } else {
      // Regular click: single selection
      setFocusedCell(position);
      setSelectionRange(null);
    }
  }, [focusedCell, selectedRows]);

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
      
      // Prevent text selection during drag
      event.preventDefault();
    }
  }, []);

  const handleCellMouseEnter = useCallback((rowIndex: number, columnIndex: number) => {
    if (isSelecting && dragStartRef.current) {
      const position: CellPosition = { rowIndex, columnIndex };
      setSelectionRange({
        start: dragStartRef.current,
        end: position
      });
    }
  }, [isSelecting]);

  const handleMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      dragStartRef.current = null;
    }
  }, [isSelecting]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!focusedCell) return;
    
    let newPosition: CellPosition | null = null;
    const { rowIndex, columnIndex } = focusedCell;
    
    switch (event.key) {
      case 'ArrowUp':
        if (rowIndex > 0) {
          newPosition = { rowIndex: rowIndex - 1, columnIndex };
        }
        break;
      case 'ArrowDown':
        if (rowIndex < totalRows - 1) {
          newPosition = { rowIndex: rowIndex + 1, columnIndex };
        }
        break;
      case 'ArrowLeft':
        if (columnIndex > 0) {
          newPosition = { rowIndex, columnIndex: columnIndex - 1 };
        }
        break;
      case 'ArrowRight':
        if (columnIndex < totalColumns - 1) {
          newPosition = { rowIndex, columnIndex: columnIndex + 1 };
        }
        break;
      case 'a':
        if (event.ctrlKey || event.metaKey) {
          // Select all
          event.preventDefault();
          const allRows = new Set<number>();
          for (let i = 0; i < totalRows; i++) {
            allRows.add(i);
          }
          setSelectedRows(allRows);
          setSelectionRange({
            start: { rowIndex: 0, columnIndex: 0 },
            end: { rowIndex: totalRows - 1, columnIndex: totalColumns - 1 }
          });
        }
        break;
      case 'Escape':
        // Clear selection
        setFocusedCell(null);
        setSelectionRange(null);
        setSelectedRows(new Set());
        break;
    }
    
    if (newPosition) {
      event.preventDefault();
      
      if (event.shiftKey) {
        // Extend selection
        const start = selectionRange?.start || focusedCell;
        setSelectionRange({
          start,
          end: newPosition
        });
      } else {
        // Move focus
        setFocusedCell(newPosition);
        setSelectionRange(null);
      }
    }
  }, [focusedCell, selectionRange, totalRows, totalColumns]);

  // Set up global mouse up listener
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleMouseUp, handleKeyDown]);

  const clearSelection = useCallback(() => {
    setFocusedCell(null);
    setSelectionRange(null);
    setSelectedRows(new Set());
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

  const isRowSelected = useCallback((rowIndex: number) => {
    return selectedRows.has(rowIndex);
  }, [selectedRows]);

  const isCellFocused = useCallback((rowIndex: number, columnIndex: number) => {
    return focusedCell?.rowIndex === rowIndex && focusedCell?.columnIndex === columnIndex;
  }, [focusedCell]);

  return {
    focusedCell,
    selectedRows,
    selectionRange,
    isSelecting,
    handleCellClick,
    handleCellMouseDown,
    handleCellMouseEnter,
    clearSelection,
    isCellSelected,
    isRowSelected,
    isCellFocused,
    selectedRowCount: selectedRows.size,
  };
}