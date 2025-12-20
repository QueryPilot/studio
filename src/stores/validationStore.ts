import { create } from 'zustand';
import type { CellKey } from '@/components/DataGrid/types/cellState';

export type ValidationErrorType = 'format' | 'type' | 'constraint' | 'backend';

export interface ValidationError {
  message: string;
  type: ValidationErrorType;
  hint?: string;
  severity?: 'error' | 'warning';
}

interface ValidationEntry extends ValidationError {
  cellKey: CellKey;
  timestamp: number;
}

interface ValidationStore {
  // State
  errors: Map<CellKey, ValidationEntry>;
  validating: Set<CellKey>;

  // Actions
  setError: (cellKey: CellKey, error: Omit<ValidationError, 'severity'> & { severity?: 'error' | 'warning' }) => void;
  clearError: (cellKey: CellKey) => void;
  clearTable: (tableKey: string) => void;
  setValidating: (cellKey: CellKey, isValidating: boolean) => void;
  reset: () => void;

  // Selectors
  getError: (cellKey: CellKey) => ValidationError | undefined;
  hasErrors: (tableKey: string) => boolean;
  getErrorCount: (tableKey: string) => number;
  getTableErrors: (tableKey: string) => ValidationEntry[];
  isValidating: (cellKey: CellKey) => boolean;
  canCommit: (tableKey: string) => { allowed: boolean; errorCount: number };
}

export const useValidationStore = create<ValidationStore>()((set, get) => ({
  errors: new Map(),
  validating: new Set(),

  setError: (cellKey, error) => {
    set((state) => {
      const errors = new Map(state.errors);
      errors.set(cellKey, {
        ...error,
        severity: error.severity ?? 'error',
        cellKey,
        timestamp: Date.now(),
      });
      return { errors };
    });
  },

  clearError: (cellKey) => {
    set((state) => {
      const errors = new Map(state.errors);
      errors.delete(cellKey);
      return { errors };
    });
  },

  clearTable: (tableKey) => {
    set((state) => {
      const errors = new Map(state.errors);
      const validating = new Set(state.validating);
      const prefix = `${tableKey}:`;

      for (const key of errors.keys()) {
        if (key.startsWith(prefix)) {
          errors.delete(key);
        }
      }

      for (const key of validating) {
        if (key.startsWith(prefix)) {
          validating.delete(key);
        }
      }

      return { errors, validating };
    });
  },

  setValidating: (cellKey, isValidating) => {
    set((state) => {
      const validating = new Set(state.validating);
      if (isValidating) {
        validating.add(cellKey);
      } else {
        validating.delete(cellKey);
      }
      return { validating };
    });
  },

  reset: () => {
    set({ errors: new Map(), validating: new Set() });
  },

  getError: (cellKey) => {
    const entry = get().errors.get(cellKey);
    if (!entry) return undefined;
    const { cellKey: _, timestamp: __, ...error } = entry;
    return error;
  },

  hasErrors: (tableKey) => {
    return get().getErrorCount(tableKey) > 0;
  },

  getErrorCount: (tableKey) => {
    const prefix = `${tableKey}:`;
    let count = 0;

    for (const [key, entry] of get().errors) {
      if (key.startsWith(prefix) && entry.severity === 'error') {
        count++;
      }
    }

    return count;
  },

  getTableErrors: (tableKey) => {
    const prefix = `${tableKey}:`;
    const result: ValidationEntry[] = [];

    for (const [key, entry] of get().errors) {
      if (key.startsWith(prefix)) {
        result.push(entry);
      }
    }

    return result;
  },

  isValidating: (cellKey) => {
    return get().validating.has(cellKey);
  },

  canCommit: (tableKey) => {
    const errorCount = get().getErrorCount(tableKey);
    return {
      allowed: errorCount === 0,
      errorCount,
    };
  },
}));

// Selectors
export const validationSelectors = {
  hasErrors: (tableKey: string) => (state: ValidationStore) => state.hasErrors(tableKey),
  errorCount: (tableKey: string) => (state: ValidationStore) => state.getErrorCount(tableKey),
  canCommit: (tableKey: string) => (state: ValidationStore) => state.canCommit(tableKey),
};
