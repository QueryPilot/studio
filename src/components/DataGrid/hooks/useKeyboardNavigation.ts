import { useCallback, useRef } from 'react';
import type { GridSelection, Item } from '@glideapps/glide-data-grid';
import { CompactSelection } from '@glideapps/glide-data-grid';
import { useNavigationStore, type NavigationBounds } from '../stores/navigationStore';
import { useCellStateStore } from '../stores/cellStateStore';
import { createCellKey } from '../types/cellState';
import {
  isPrintableKey,
  isNavigationKey,
  keyToDirection,
} from '../types/navigationState';

export interface UseKeyboardNavigationOptions {
  tableKey: string;
  gridRef: React.RefObject<unknown>;
  bounds: NavigationBounds;
  columns: { field: string }[];
  onClearCell?: (cell: Item, columnField: string) => void;
  onGridSelectionChange?: (selection: GridSelection) => void;
  enabled?: boolean;
}

export interface UseKeyboardNavigationResult {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  handleCellClick: (cell: Item) => void;
  handleCellDoubleClick: (cell: Item) => void;
  handleEditComplete: (commit: boolean, movement?: 'down' | 'right' | 'left' | 'up') => void;
  mode: 'browsing' | 'selected' | 'editing';
  selectedCell: Item | null;
  initialChar: string | null;
  editTrigger: string | null;
}

// Helper to create a GridSelection for a single cell
function createCellSelection(cell: Item): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell,
      range: { x: cell[0], y: cell[1], width: 1, height: 1 },
      rangeStack: [],
    },
  };
}

export function useKeyboardNavigation(
  options: UseKeyboardNavigationOptions
): UseKeyboardNavigationResult {
  const {
    tableKey,
    gridRef: _gridRef, // Reserved for future grid scrolling/activation
    bounds,
    columns,
    onClearCell,
    onGridSelectionChange,
    enabled = true,
  } = options;

  const selectCell = useNavigationStore((s) => s.selectCell);
  const clearSelection = useNavigationStore((s) => s.clearSelection);
  const enterEdit = useNavigationStore((s) => s.enterEdit);
  const exitEdit = useNavigationStore((s) => s.exitEdit);
  const moveSelection = useNavigationStore((s) => s.moveSelection);
  const getMode = useNavigationStore((s) => s.getMode);
  const getSelectedCell = useNavigationStore((s) => s.getSelectedCell);
  const getInitialChar = useNavigationStore((s) => s.getInitialChar);
  const getEditTrigger = useNavigationStore((s) => s.getEditTrigger);

  const focus = useCellStateStore((s) => s.focus);
  const blur = useCellStateStore((s) => s.blur);
  const startEdit = useCellStateStore((s) => s.startEdit);
  const cancelEdit = useCellStateStore((s) => s.cancelEdit);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const getColumnField = useCallback(
    (colIndex: number) => columns[colIndex]?.field ?? String(colIndex),
    [columns]
  );

  const handleCellClick = useCallback(
    (cell: Item) => {
      if (!enabled) return;

      selectCell(cell);
      const cellKey = createCellKey(tableKey, cell[1], getColumnField(cell[0]));
      focus(cellKey);
    },
    [enabled, selectCell, focus, tableKey, getColumnField]
  );

  const handleCellDoubleClick = useCallback(
    (cell: Item) => {
      if (!enabled) return;

      selectCell(cell);
      enterEdit('double-click');
      startEdit(null);
    },
    [enabled, selectCell, enterEdit, startEdit]
  );

  const handleEditComplete = useCallback(
    (commit: boolean, movement?: 'down' | 'right' | 'left' | 'up') => {
      if (!enabled) return;

      exitEdit(commit);

      if (!commit) {
        cancelEdit();
      }

      if (movement) {
        moveSelection(movement, boundsRef.current);

        const newCell = getSelectedCell();
        if (newCell) {
          const cellKey = createCellKey(tableKey, newCell[1], getColumnField(newCell[0]));
          focus(cellKey);
        }
      }
    },
    [enabled, exitEdit, cancelEdit, moveSelection, getSelectedCell, focus, tableKey, getColumnField]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!enabled) return false;

      const mode = getMode();
      const selectedCell = getSelectedCell();

      // BROWSING MODE - no special handling
      if (mode === 'browsing') {
        return false;
      }

      // SELECTED MODE
      if (mode === 'selected' && selectedCell) {
        // Arrow keys - navigate
        if (isNavigationKey(e.key)) {
          e.preventDefault();
          const direction = keyToDirection(e.key);
          if (direction) {
            moveSelection(direction, boundsRef.current);
            const newCell = getSelectedCell();
            if (newCell) {
              const cellKey = createCellKey(tableKey, newCell[1], getColumnField(newCell[0]));
              focus(cellKey);
              // Sync grid selection so Delete/Backspace targets the correct cell
              onGridSelectionChange?.(createCellSelection(newCell));
            }
          }
          return true;
        }

        // F2 - enter edit mode (preserve value)
        if (e.key === 'F2') {
          e.preventDefault();
          enterEdit('f2');
          return true;
        }

        // Enter - enter edit mode
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          enterEdit('enter');
          return true;
        }

        // Delete/Backspace - let Glide handle via onDelete for cell clearing
        // Cmd+Delete is handled at document level in EditableDataGrid

        // Escape - clear selection
        if (e.key === 'Escape') {
          e.preventDefault();
          clearSelection();
          blur();
          return true;
        }

        // Tab - move right (Shift+Tab - move left)
        if (e.key === 'Tab') {
          e.preventDefault();
          const direction = e.shiftKey ? 'left' : 'right';
          moveSelection(direction, boundsRef.current);
          const newCell = getSelectedCell();
          if (newCell) {
            const cellKey = createCellKey(tableKey, newCell[1], getColumnField(newCell[0]));
            focus(cellKey);
            // Sync grid selection so Delete/Backspace targets the correct cell
            onGridSelectionChange?.(createCellSelection(newCell));
          }
          return true;
        }

        // Printable character - type to edit (replace mode)
        if (isPrintableKey(e.key, e.ctrlKey, e.metaKey, e.altKey)) {
          e.preventDefault();
          enterEdit('type-replace', e.key);
          return true;
        }
      }

      // EDITING MODE - let editor handle most keys
      if (mode === 'editing') {
        if (e.key === 'Escape') {
          exitEdit(false);
          cancelEdit();
          return true;
        }
      }

      return false;
    },
    [
      enabled,
      getMode,
      getSelectedCell,
      moveSelection,
      enterEdit,
      exitEdit,
      clearSelection,
      blur,
      cancelEdit,
      focus,
      tableKey,
      getColumnField,
      onClearCell,
      onGridSelectionChange,
    ]
  );

  return {
    handleKeyDown,
    handleCellClick,
    handleCellDoubleClick,
    handleEditComplete,
    mode: getMode(),
    selectedCell: getSelectedCell(),
    initialChar: getInitialChar(),
    editTrigger: getEditTrigger(),
  };
}
