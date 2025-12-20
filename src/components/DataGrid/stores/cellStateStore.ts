import { create } from 'zustand';
import type { CellKey, CellState, CellStateData } from '../types/cellState';

interface CellStateStore {
  cells: Map<CellKey, CellStateData>;
  focusedCell: CellKey | null;

  focus: (cellKey: CellKey) => void;
  blur: () => void;
  startEdit: (originalValue: unknown) => void;
  cancelEdit: () => void;
  submitValue: (newValue: unknown) => void;
  setError: (cellKey: CellKey, error: string) => void;
  clearError: (cellKey: CellKey) => void;
  setCommitting: (cellKey: CellKey) => void;
  setCommitSuccess: (cellKey: CellKey) => void;
  setCommitFailure: (cellKey: CellKey, error: string) => void;
  clearCell: (cellKey: CellKey) => void;
  clearTable: (tableKey: string) => void;
  reset: () => void;

  getCellState: (cellKey: CellKey) => CellState;
  getCellData: (cellKey: CellKey) => CellStateData | undefined;
  getFocusedCell: () => CellKey | null;
  getDirtyCells: (tableKey: string) => CellKey[];
  getErrorCells: (tableKey: string) => CellKey[];
  hasDirtyCells: (tableKey: string) => boolean;
  hasErrorCells: (tableKey: string) => boolean;
}

const createDefaultCellData = (state: CellState): CellStateData => ({
  state,
  timestamp: Date.now(),
});

export const useCellStateStore = create<CellStateStore>()((set, get) => ({
  cells: new Map(),
  focusedCell: null,

  focus: (cellKey) => {
    set((state) => {
      const cells = new Map(state.cells);

      if (state.focusedCell && state.focusedCell !== cellKey) {
        const prevData = cells.get(state.focusedCell);
        if (prevData?.state === 'focused') {
          cells.delete(state.focusedCell);
        }
      }

      const currentData = cells.get(cellKey);
      if (!currentData || currentData.state === 'idle') {
        cells.set(cellKey, createDefaultCellData('focused'));
      }

      return { cells, focusedCell: cellKey };
    });
  },

  blur: () => {
    set((state) => {
      if (!state.focusedCell) return state;

      const cells = new Map(state.cells);
      const data = cells.get(state.focusedCell);

      if (data?.state === 'focused') {
        cells.delete(state.focusedCell);
      }

      return { cells, focusedCell: null };
    });
  },

  startEdit: (originalValue) => {
    set((state) => {
      if (!state.focusedCell) return state;

      const cells = new Map(state.cells);
      cells.set(state.focusedCell, {
        state: 'editing',
        originalValue,
        currentValue: originalValue,
        timestamp: Date.now(),
      });

      return { cells };
    });
  },

  cancelEdit: () => {
    set((state) => {
      if (!state.focusedCell) return state;

      const cells = new Map(state.cells);
      const data = cells.get(state.focusedCell);

      if (data?.state === 'editing') {
        cells.set(state.focusedCell, createDefaultCellData('focused'));
      }

      return { cells };
    });
  },

  submitValue: (newValue) => {
    set((state) => {
      if (!state.focusedCell) return state;

      const cells = new Map(state.cells);
      const data = cells.get(state.focusedCell);

      if (!data) return state;

      const valueChanged = data.originalValue !== newValue;

      if (valueChanged) {
        cells.set(state.focusedCell, {
          ...data,
          state: 'dirty',
          currentValue: newValue,
          timestamp: Date.now(),
        });
      } else {
        cells.set(state.focusedCell, createDefaultCellData('focused'));
      }

      return { cells };
    });
  },

  setError: (cellKey, error) => {
    set((state) => {
      const cells = new Map(state.cells);
      const data = cells.get(cellKey) ?? createDefaultCellData('idle');

      cells.set(cellKey, {
        ...data,
        state: 'error',
        error,
        timestamp: Date.now(),
      });

      return { cells };
    });
  },

  clearError: (cellKey) => {
    set((state) => {
      const cells = new Map(state.cells);
      const data = cells.get(cellKey);

      if (data?.state === 'error') {
        const nextState: CellState = data.currentValue !== undefined ? 'dirty' : 'focused';
        cells.set(cellKey, {
          ...data,
          state: nextState,
          error: undefined,
          timestamp: Date.now(),
        });
      }

      return { cells };
    });
  },

  setCommitting: (cellKey) => {
    set((state) => {
      const cells = new Map(state.cells);
      const data = cells.get(cellKey);

      if (data?.state === 'dirty') {
        cells.set(cellKey, {
          ...data,
          state: 'committing',
          timestamp: Date.now(),
        });
      }

      return { cells };
    });
  },

  setCommitSuccess: (cellKey) => {
    set((state) => {
      const cells = new Map(state.cells);
      cells.delete(cellKey);
      return { cells };
    });
  },

  setCommitFailure: (cellKey, error) => {
    set((state) => {
      const cells = new Map(state.cells);
      const data = cells.get(cellKey);

      if (data) {
        cells.set(cellKey, {
          ...data,
          state: 'error',
          error,
          timestamp: Date.now(),
        });
      }

      return { cells };
    });
  },

  clearCell: (cellKey) => {
    set((state) => {
      const cells = new Map(state.cells);
      cells.delete(cellKey);

      const focusedCell = state.focusedCell === cellKey ? null : state.focusedCell;

      return { cells, focusedCell };
    });
  },

  clearTable: (tableKey) => {
    set((state) => {
      const cells = new Map(state.cells);
      const prefix = `${tableKey}:`;

      for (const key of cells.keys()) {
        if (key.startsWith(prefix)) {
          cells.delete(key);
        }
      }

      const focusedCell = state.focusedCell?.startsWith(prefix) ? null : state.focusedCell;

      return { cells, focusedCell };
    });
  },

  reset: () => {
    set({ cells: new Map(), focusedCell: null });
  },

  getCellState: (cellKey) => {
    return get().cells.get(cellKey)?.state ?? 'idle';
  },

  getCellData: (cellKey) => {
    return get().cells.get(cellKey);
  },

  getFocusedCell: () => {
    return get().focusedCell;
  },

  getDirtyCells: (tableKey) => {
    const prefix = `${tableKey}:`;
    const result: CellKey[] = [];

    for (const [key, data] of get().cells) {
      if (key.startsWith(prefix) && data.state === 'dirty') {
        result.push(key);
      }
    }

    return result;
  },

  getErrorCells: (tableKey) => {
    const prefix = `${tableKey}:`;
    const result: CellKey[] = [];

    for (const [key, data] of get().cells) {
      if (key.startsWith(prefix) && data.state === 'error') {
        result.push(key);
      }
    }

    return result;
  },

  hasDirtyCells: (tableKey) => {
    return get().getDirtyCells(tableKey).length > 0;
  },

  hasErrorCells: (tableKey) => {
    return get().getErrorCells(tableKey).length > 0;
  },
}));

export const cellStateSelectors = {
  focusedCell: (state: CellStateStore) => state.focusedCell,
  hasDirtyCells: (tableKey: string) => (state: CellStateStore) => state.hasDirtyCells(tableKey),
  hasErrorCells: (tableKey: string) => (state: CellStateStore) => state.hasErrorCells(tableKey),
};
