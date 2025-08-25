/**
 * Hook for managing table selection state (rows and cells)
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { DataTableRow } from '../types';

export type SelectionMode = 'row' | 'cell' | 'range';
export type SelectAction = 'single' | 'toggle' | 'range' | 'all' | 'none';

interface UseSelectionProps {
  data: DataTableRow[];
  rowIdField: string;
  onSelectionChange?: (selectedRows: Set<string>, selectedCells: Set<string>) => void;
}

interface SelectionState {
  selectedRows: Set<string>;
  selectedCells: Set<string>; // "rowId:columnId" format
  anchorRow: string | null;
  anchorCell: string | null;
  focusedCell: string | null;
  selectionMode: SelectionMode;
  isSelecting: boolean; // For drag selection
}

export function useSelection({ 
  data, 
  rowIdField,
  onSelectionChange 
}: UseSelectionProps) {
  const [state, setState] = useState<SelectionState>({
    selectedRows: new Set(),
    selectedCells: new Set(),
    anchorRow: null,
    anchorCell: null,
    focusedCell: null,
    selectionMode: 'row',
    isSelecting: false,
  });

  // Get row ID from row data
  const getRowId = useCallback((row: DataTableRow): string => {
    const idValue = row[rowIdField];
    return idValue ? String(idValue.value) : '';
  }, [rowIdField]);

  // Get row index from row ID
  const getRowIndex = useCallback((rowId: string): number => {
    return data.findIndex(row => getRowId(row) === rowId);
  }, [data, getRowId]);

  // Select single row
  const selectSingleRow = useCallback((rowId: string) => {
    setState(prev => ({
      ...prev,
      selectedRows: new Set([rowId]),
      selectedCells: new Set(),
      anchorRow: rowId,
      selectionMode: 'row',
    }));
  }, []);

  // Toggle row selection
  const toggleRowSelection = useCallback((rowId: string) => {
    setState(prev => {
      const newSelectedRows = new Set(prev.selectedRows);
      if (newSelectedRows.has(rowId)) {
        newSelectedRows.delete(rowId);
      } else {
        newSelectedRows.add(rowId);
      }
      return {
        ...prev,
        selectedRows: newSelectedRows,
        anchorRow: rowId,
      };
    });
  }, []);

  // Select range of rows
  const selectRowRange = useCallback((fromRowId: string, toRowId: string) => {
    const fromIndex = getRowIndex(fromRowId);
    const toIndex = getRowIndex(toRowId);
    
    if (fromIndex === -1 || toIndex === -1) return;
    
    const startIndex = Math.min(fromIndex, toIndex);
    const endIndex = Math.max(fromIndex, toIndex);
    
    const newSelectedRows = new Set<string>();
    for (let i = startIndex; i <= endIndex; i++) {
      const row = data[i];
      if (row) {
        const rowId = getRowId(row);
        if (rowId) newSelectedRows.add(rowId);
      }
    }
    
    setState(prev => ({
      ...prev,
      selectedRows: newSelectedRows,
      selectedCells: new Set(),
      selectionMode: 'row',
    }));
  }, [data, getRowId, getRowIndex]);

  // Select all rows
  const selectAllRows = useCallback(() => {
    const allRowIds = new Set<string>();
    data.forEach(row => {
      const rowId = getRowId(row);
      if (rowId) allRowIds.add(rowId);
    });
    
    setState(prev => ({
      ...prev,
      selectedRows: allRowIds,
      selectedCells: new Set(),
      selectionMode: 'row',
    }));
  }, [data, getRowId]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedRows: new Set(),
      selectedCells: new Set(),
      anchorRow: null,
      anchorCell: null,
      focusedCell: null,
    }));
  }, []);

  // Handle row click with modifiers
  const handleRowClick = useCallback((rowId: string, event: React.MouseEvent) => {
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Toggle selection
      toggleRowSelection(rowId);
    } else if (event.shiftKey && state.anchorRow) {
      // Range selection
      selectRowRange(state.anchorRow, rowId);
    } else {
      // Single selection
      selectSingleRow(rowId);
    }
  }, [state.anchorRow, toggleRowSelection, selectRowRange, selectSingleRow]);

  // Cell selection methods
  const selectCell = useCallback((cellId: string) => {
    setState(prev => ({
      ...prev,
      selectedCells: new Set([cellId]),
      selectedRows: new Set(),
      focusedCell: cellId,
      anchorCell: cellId,
      selectionMode: 'cell',
    }));
  }, []);

  const toggleCellSelection = useCallback((cellId: string) => {
    setState(prev => {
      const newSelectedCells = new Set(prev.selectedCells);
      if (newSelectedCells.has(cellId)) {
        newSelectedCells.delete(cellId);
      } else {
        newSelectedCells.add(cellId);
      }
      return {
        ...prev,
        selectedCells: newSelectedCells,
        focusedCell: cellId,
        anchorCell: cellId,
        selectionMode: 'cell',
      };
    });
  }, []);

  // Select cell range
  const selectCellRange = useCallback((fromCellId: string, toCellId: string) => {
    const parts1 = fromCellId.split(':');
    const parts2 = toCellId.split(':');
    if (parts1.length < 2 || parts2.length < 2) return;
    
    const [fromRowId, fromColId] = parts1;
    const [toRowId, toColId] = parts2;
    
    const fromRowIndex = getRowIndex(fromRowId || '');
    const toRowIndex = getRowIndex(toRowId || '');
    
    if (fromRowIndex === -1 || toRowIndex === -1) return;
    
    const startRowIndex = Math.min(fromRowIndex, toRowIndex);
    const endRowIndex = Math.max(fromRowIndex, toRowIndex);
    
    // For simplicity, we'll select all cells in the row range for the same column
    // This can be extended to support column ranges as well
    const newSelectedCells = new Set<string>();
    for (let i = startRowIndex; i <= endRowIndex; i++) {
      const row = data[i];
      if (row) {
        const rowId = getRowId(row);
        if (rowId) {
          // Select cells for both columns if different
          newSelectedCells.add(`${rowId}:${fromColId}`);
          if (fromColId !== toColId) {
            newSelectedCells.add(`${rowId}:${toColId}`);
          }
        }
      }
    }
    
    setState(prev => ({
      ...prev,
      selectedCells: newSelectedCells,
      selectedRows: new Set(),
      selectionMode: 'cell',
    }));
  }, [data, getRowId, getRowIndex]);

  // Handle cell click with modifiers
  const handleCellClick = useCallback((cellId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent row selection
    
    if (event.ctrlKey || event.metaKey) {
      // Toggle cell selection
      toggleCellSelection(cellId);
    } else if (event.shiftKey && state.anchorCell) {
      // Range selection
      selectCellRange(state.anchorCell, cellId);
    } else {
      // Single cell selection
      selectCell(cellId);
    }
  }, [state.anchorCell, toggleCellSelection, selectCellRange, selectCell]);

  // Drag selection
  const startDragSelection = useCallback((startId: string, isCell: boolean) => {
    setState(prev => ({
      ...prev,
      isSelecting: true,
      anchorRow: isCell ? null : startId,
      anchorCell: isCell ? startId : null,
      selectionMode: isCell ? 'cell' : 'row',
    }));
  }, []);

  const updateDragSelection = useCallback((currentId: string) => {
    if (!state.isSelecting) return;
    
    if (state.selectionMode === 'row' && state.anchorRow) {
      selectRowRange(state.anchorRow, currentId);
    } else if (state.selectionMode === 'cell' && state.anchorCell) {
      selectCellRange(state.anchorCell, currentId);
    }
  }, [state.isSelecting, state.selectionMode, state.anchorRow, state.anchorCell, selectRowRange, selectCellRange]);

  const endDragSelection = useCallback(() => {
    setState(prev => ({
      ...prev,
      isSelecting: false,
    }));
  }, []);

  // Keyboard navigation
  const navigateCell = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!state.focusedCell) return;
    
    const parts = state.focusedCell.split(':');
    if (parts.length < 2) return;
    
    const [rowId, colId] = parts;
    const rowIndex = getRowIndex(rowId || '');
    
    if (rowIndex === -1) return;
    
    let newRowIndex = rowIndex;
    let newColId = colId;
    
    switch (direction) {
      case 'up':
        newRowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'down':
        newRowIndex = Math.min(data.length - 1, rowIndex + 1);
        break;
      case 'left':
        // TODO: Implement column navigation when column order is available
        break;
      case 'right':
        // TODO: Implement column navigation when column order is available
        break;
    }
    
    const newRow = data[newRowIndex];
    if (newRow) {
      const newRowId = getRowId(newRow);
      const newCellId = `${newRowId}:${newColId}`;
      selectCell(newCellId);
    }
  }, [state.focusedCell, data, getRowId, getRowIndex, selectCell]);

  // Get selected rows data
  const selectedRowsData = useMemo(() => {
    return data.filter(row => {
      const rowId = getRowId(row);
      return rowId && state.selectedRows.has(rowId);
    });
  }, [data, state.selectedRows, getRowId]);

  // Notify selection changes
  useEffect(() => {
    onSelectionChange?.(state.selectedRows, state.selectedCells);
  }, [state.selectedRows, state.selectedCells, onSelectionChange]);

  // Check if row is selected
  const isRowSelected = useCallback((rowId: string): boolean => {
    return state.selectedRows.has(rowId);
  }, [state.selectedRows]);

  // Check if cell is selected
  const isCellSelected = useCallback((cellId: string): boolean => {
    return state.selectedCells.has(cellId);
  }, [state.selectedCells]);

  // Check if cell is focused
  const isCellFocused = useCallback((cellId: string): boolean => {
    return state.focusedCell === cellId;
  }, [state.focusedCell]);

  return {
    // State
    selectedRows: state.selectedRows,
    selectedCells: state.selectedCells,
    selectedRowsData,
    selectionMode: state.selectionMode,
    isSelecting: state.isSelecting,
    focusedCell: state.focusedCell,
    
    // Row selection methods
    selectSingleRow,
    toggleRowSelection,
    selectRowRange,
    selectAllRows,
    handleRowClick,
    
    // Cell selection methods
    selectCell,
    toggleCellSelection,
    selectCellRange,
    handleCellClick,
    
    // General methods
    clearSelection,
    startDragSelection,
    updateDragSelection,
    endDragSelection,
    navigateCell,
    
    // Check methods
    isRowSelected,
    isCellSelected,
    isCellFocused,
  };
}