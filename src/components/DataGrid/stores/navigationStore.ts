import { create } from 'zustand';
import type { Item } from '@glideapps/glide-data-grid';
import type { NavigationMode, EditTrigger } from '../types/navigationState';

export interface NavigationBounds {
  maxCol: number;
  maxRow: number;
}

interface NavigationStore {
  // State
  mode: NavigationMode;
  selectedCell: Item | null;
  editTrigger: EditTrigger | null;
  initialChar: string | null;

  // Actions
  selectCell: (cell: Item) => void;
  clearSelection: () => void;
  enterEdit: (trigger: EditTrigger, initialChar?: string) => void;
  exitEdit: (commit: boolean) => void;
  moveSelection: (direction: 'up' | 'down' | 'left' | 'right', bounds: NavigationBounds) => void;
  reset: () => void;

  // Selectors
  getMode: () => NavigationMode;
  getSelectedCell: () => Item | null;
  getEditTrigger: () => EditTrigger | null;
  getInitialChar: () => string | null;
  isEditing: () => boolean;
  isSelected: () => boolean;
}

const initialState = {
  mode: 'browsing' as NavigationMode,
  selectedCell: null as Item | null,
  editTrigger: null as EditTrigger | null,
  initialChar: null as string | null,
};

export const useNavigationStore = create<NavigationStore>()((set, get) => ({
  ...initialState,

  selectCell: (cell) => {
    set({
      mode: 'selected',
      selectedCell: cell,
      editTrigger: null,
      initialChar: null,
    });
  },

  clearSelection: () => {
    set({
      mode: 'browsing',
      selectedCell: null,
      editTrigger: null,
      initialChar: null,
    });
  },

  enterEdit: (trigger, initialChar) => {
    const { mode } = get();
    // Can only enter edit from selected mode
    if (mode !== 'selected') return;

    set({
      mode: 'editing',
      editTrigger: trigger,
      initialChar: initialChar ?? null,
    });
  },

  exitEdit: (_commit) => {
    const { mode, selectedCell } = get();
    // Can only exit edit from editing mode
    if (mode !== 'editing') return;

    set({
      mode: 'selected',
      selectedCell, // Keep selection
      editTrigger: null,
      initialChar: null,
    });
  },

  moveSelection: (direction, bounds) => {
    const { mode, selectedCell } = get();
    // Can only move in selected mode (not editing)
    if (mode !== 'selected' || !selectedCell) return;

    const [col, row] = selectedCell;
    let nextCol = col;
    let nextRow = row;

    switch (direction) {
      case 'up':
        nextRow = Math.max(0, row - 1);
        break;
      case 'down':
        nextRow = Math.min(bounds.maxRow - 1, row + 1);
        break;
      case 'left':
        nextCol = Math.max(0, col - 1);
        break;
      case 'right':
        nextCol = Math.min(bounds.maxCol - 1, col + 1);
        break;
    }

    if (nextCol !== col || nextRow !== row) {
      set({ selectedCell: [nextCol, nextRow] });
    }
  },

  reset: () => {
    set(initialState);
  },

  getMode: () => get().mode,
  getSelectedCell: () => get().selectedCell,
  getEditTrigger: () => get().editTrigger,
  getInitialChar: () => get().initialChar,
  isEditing: () => get().mode === 'editing',
  isSelected: () => get().mode === 'selected',
}));

// Selectors for use with shallow comparison
export const navigationSelectors = {
  mode: (state: NavigationStore) => state.mode,
  selectedCell: (state: NavigationStore) => state.selectedCell,
  isEditing: (state: NavigationStore) => state.mode === 'editing',
  isSelected: (state: NavigationStore) => state.mode === 'selected',
  editTrigger: (state: NavigationStore) => state.editTrigger,
  initialChar: (state: NavigationStore) => state.initialChar,
};
