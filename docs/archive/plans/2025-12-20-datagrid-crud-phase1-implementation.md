# DataGrid CRUD Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the cell state machine and validation store foundation for the DataGrid CRUD redesign.

**Architecture:** Replace current ref-based cell state tracking with an explicit state machine (7 states). Create a Zustand-based validation store for testability. Add visual indicators for cell states.

**Tech Stack:** React 19, TypeScript, Zustand, Glide Data Grid, Vitest

**Design Reference:** `docs/plans/2025-12-20-datagrid-crud-redesign.md`

---

## Task 1: Cell State Types

**Files:**
- Create: `src/components/DataGrid/types/cellState.ts`
- Test: `src/components/DataGrid/types/cellState.test.ts`

**Step 1: Write the type definitions**

```typescript
// src/components/DataGrid/types/cellState.ts

/**
 * Cell states in the editing lifecycle
 */
export type CellState =
  | 'idle'        // No interaction
  | 'focused'     // Selected, not editing (keyboard nav active)
  | 'editing'     // Active input
  | 'validating'  // Checking value (async)
  | 'dirty'       // Valid change staged
  | 'committing'  // Sending to backend
  | 'error';      // Validation or commit failed

/**
 * Transitions between cell states
 */
export type CellStateTransition =
  | { type: 'FOCUS'; cellKey: string }
  | { type: 'BLUR' }
  | { type: 'START_EDIT' }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SUBMIT_VALUE'; value: unknown }
  | { type: 'VALIDATION_START' }
  | { type: 'VALIDATION_SUCCESS' }
  | { type: 'VALIDATION_FAILURE'; error: string }
  | { type: 'STAGE_CHANGE' }
  | { type: 'COMMIT_START' }
  | { type: 'COMMIT_SUCCESS' }
  | { type: 'COMMIT_FAILURE'; error: string }
  | { type: 'DISCARD' }
  | { type: 'RESET' };

/**
 * Cell key format: "tableKey:rowIndex:columnField"
 */
export type CellKey = string;

/**
 * Create a cell key from components
 */
export function createCellKey(
  tableKey: string,
  rowIndex: number,
  columnField: string
): CellKey {
  return `${tableKey}:${rowIndex}:${columnField}`;
}

/**
 * Parse a cell key into components
 */
export function parseCellKey(cellKey: CellKey): {
  tableKey: string;
  rowIndex: number;
  columnField: string;
} | null {
  const parts = cellKey.split(':');
  if (parts.length < 3) return null;

  const columnField = parts.pop()!;
  const rowIndexStr = parts.pop()!;
  const tableKey = parts.join(':');
  const rowIndex = parseInt(rowIndexStr, 10);

  if (isNaN(rowIndex)) return null;

  return { tableKey, rowIndex, columnField };
}

/**
 * Cell state data stored per cell
 */
export interface CellStateData {
  state: CellState;
  originalValue?: unknown;
  currentValue?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<CellState, CellStateTransition['type'][]> = {
  idle: ['FOCUS'],
  focused: ['BLUR', 'START_EDIT', 'FOCUS'],
  editing: ['CANCEL_EDIT', 'SUBMIT_VALUE'],
  validating: ['VALIDATION_SUCCESS', 'VALIDATION_FAILURE', 'CANCEL_EDIT'],
  dirty: ['START_EDIT', 'COMMIT_START', 'DISCARD', 'BLUR'],
  committing: ['COMMIT_SUCCESS', 'COMMIT_FAILURE'],
  error: ['START_EDIT', 'DISCARD', 'RESET'],
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(
  currentState: CellState,
  transition: CellStateTransition['type']
): boolean {
  return VALID_TRANSITIONS[currentState]?.includes(transition) ?? false;
}
```

**Step 2: Write tests for cell key functions**

```typescript
// src/components/DataGrid/types/cellState.test.ts
import { describe, it, expect } from 'vitest';
import {
  createCellKey,
  parseCellKey,
  isValidTransition,
  type CellState,
} from './cellState';

describe('createCellKey', () => {
  it('creates a cell key from components', () => {
    const key = createCellKey('conn:db:schema:table', 5, 'name');
    expect(key).toBe('conn:db:schema:table:5:name');
  });

  it('handles table keys with colons', () => {
    const key = createCellKey('a:b:c:d', 0, 'field');
    expect(key).toBe('a:b:c:d:0:field');
  });
});

describe('parseCellKey', () => {
  it('parses a cell key into components', () => {
    const result = parseCellKey('conn:db:schema:table:5:name');
    expect(result).toEqual({
      tableKey: 'conn:db:schema:table',
      rowIndex: 5,
      columnField: 'name',
    });
  });

  it('returns null for invalid keys', () => {
    expect(parseCellKey('invalid')).toBeNull();
    expect(parseCellKey('a:b')).toBeNull();
    expect(parseCellKey('a:notanumber:c')).toBeNull();
  });
});

describe('isValidTransition', () => {
  it('allows FOCUS from idle', () => {
    expect(isValidTransition('idle', 'FOCUS')).toBe(true);
  });

  it('disallows START_EDIT from idle', () => {
    expect(isValidTransition('idle', 'START_EDIT')).toBe(false);
  });

  it('allows START_EDIT from focused', () => {
    expect(isValidTransition('focused', 'START_EDIT')).toBe(true);
  });

  it('allows CANCEL_EDIT from editing', () => {
    expect(isValidTransition('editing', 'CANCEL_EDIT')).toBe(true);
  });

  it('allows COMMIT_START from dirty', () => {
    expect(isValidTransition('dirty', 'COMMIT_START')).toBe(true);
  });
});
```

**Step 3: Run tests to verify they pass**

```bash
pnpm test:unit src/components/DataGrid/types/cellState.test.ts
```

Expected: PASS

**Step 4: Export from types index**

Modify: `src/components/DataGrid/types/index.ts`

Add at the end:
```typescript
export * from './cellState';
```

**Step 5: Commit**

```bash
git add src/components/DataGrid/types/cellState.ts src/components/DataGrid/types/cellState.test.ts src/components/DataGrid/types/index.ts
git commit -m "feat(datagrid): add cell state types and transitions"
```

---

## Task 2: Cell State Store

**Files:**
- Create: `src/components/DataGrid/stores/cellStateStore.ts`
- Test: `src/components/DataGrid/stores/cellStateStore.test.ts`

**Step 1: Write the failing test**

```typescript
// src/components/DataGrid/stores/cellStateStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCellStateStore } from './cellStateStore';

describe('cellStateStore', () => {
  beforeEach(() => {
    useCellStateStore.getState().reset();
  });

  describe('focus', () => {
    it('sets cell to focused state', () => {
      const { focus, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      expect(getCellState('table:0:name')).toBe('focused');
    });

    it('blurs previously focused cell', () => {
      const { focus, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      focus('table:0:email');
      expect(getCellState('table:0:name')).toBe('idle');
      expect(getCellState('table:0:email')).toBe('focused');
    });
  });

  describe('startEdit', () => {
    it('transitions focused cell to editing', () => {
      const { focus, startEdit, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('original');
      expect(getCellState('table:0:name')).toBe('editing');
    });

    it('stores original value', () => {
      const { focus, startEdit, getCellData } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('John');
      expect(getCellData('table:0:name')?.originalValue).toBe('John');
    });
  });

  describe('submitValue', () => {
    it('transitions to dirty when value changed', () => {
      const { focus, startEdit, submitValue, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('John');
      submitValue('Jane');
      expect(getCellState('table:0:name')).toBe('dirty');
    });

    it('transitions to focused when value unchanged', () => {
      const { focus, startEdit, submitValue, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('John');
      submitValue('John');
      expect(getCellState('table:0:name')).toBe('focused');
    });
  });

  describe('setError', () => {
    it('transitions cell to error state', () => {
      const { focus, startEdit, setError, getCellState, getCellData } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('John');
      setError('table:0:name', 'Invalid format');
      expect(getCellState('table:0:name')).toBe('error');
      expect(getCellData('table:0:name')?.error).toBe('Invalid format');
    });
  });

  describe('clearCell', () => {
    it('removes cell state data', () => {
      const { focus, clearCell, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      clearCell('table:0:name');
      expect(getCellState('table:0:name')).toBe('idle');
    });
  });

  describe('clearTable', () => {
    it('removes all cells for a table', () => {
      const { focus, startEdit, submitValue, clearTable, getCellState } = useCellStateStore.getState();
      focus('table:0:name');
      startEdit('v1');
      submitValue('v2');
      focus('table:1:email');
      clearTable('table');
      expect(getCellState('table:0:name')).toBe('idle');
      expect(getCellState('table:1:email')).toBe('idle');
    });
  });

  describe('getDirtyCells', () => {
    it('returns all cells in dirty state for a table', () => {
      const store = useCellStateStore.getState();
      store.focus('table:0:name');
      store.startEdit('v1');
      store.submitValue('v2');
      store.focus('table:1:email');
      store.startEdit('a@b');
      store.submitValue('c@d');

      const dirty = store.getDirtyCells('table');
      expect(dirty).toHaveLength(2);
      expect(dirty).toContain('table:0:name');
      expect(dirty).toContain('table:1:email');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/components/DataGrid/stores/cellStateStore.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write the store implementation**

```typescript
// src/components/DataGrid/stores/cellStateStore.ts
import { create } from 'zustand';
import type { CellKey, CellState, CellStateData } from '../types/cellState';

interface CellStateStore {
  // State
  cells: Map<CellKey, CellStateData>;
  focusedCell: CellKey | null;

  // Actions
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

  // Selectors
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

      // Blur previous cell if it was just focused (not dirty/error)
      if (state.focusedCell && state.focusedCell !== cellKey) {
        const prevData = cells.get(state.focusedCell);
        if (prevData?.state === 'focused') {
          cells.delete(state.focusedCell);
        }
      }

      // Focus new cell (only if not already in a higher state)
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

      // Only clear if in focused state (preserve dirty/error)
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

      // Check if value actually changed
      const valueChanged = data.originalValue !== newValue;

      if (valueChanged) {
        cells.set(state.focusedCell, {
          ...data,
          state: 'dirty',
          currentValue: newValue,
          timestamp: Date.now(),
        });
      } else {
        // Value unchanged - go back to focused
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
        // Go back to dirty if has current value, otherwise focused
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

// Selectors for use with shallow comparison
export const cellStateSelectors = {
  focusedCell: (state: CellStateStore) => state.focusedCell,
  hasDirtyCells: (tableKey: string) => (state: CellStateStore) => state.hasDirtyCells(tableKey),
  hasErrorCells: (tableKey: string) => (state: CellStateStore) => state.hasErrorCells(tableKey),
};
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test:unit src/components/DataGrid/stores/cellStateStore.test.ts
```

Expected: PASS

**Step 5: Export from stores index**

Create or modify: `src/components/DataGrid/stores/index.ts`

```typescript
export * from './cellStateStore';
```

**Step 6: Commit**

```bash
git add src/components/DataGrid/stores/cellStateStore.ts src/components/DataGrid/stores/cellStateStore.test.ts src/components/DataGrid/stores/index.ts
git commit -m "feat(datagrid): add cell state store with state machine"
```

---

## Task 3: Validation Store

**Files:**
- Create: `src/stores/validationStore.ts`
- Test: `src/stores/validationStore.test.ts`

**Step 1: Write the failing test**

```typescript
// src/stores/validationStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useValidationStore } from './validationStore';

describe('validationStore', () => {
  beforeEach(() => {
    useValidationStore.getState().reset();
  });

  describe('setError', () => {
    it('stores validation error for a cell', () => {
      const { setError, getError } = useValidationStore.getState();
      setError('table:0:name', { message: 'Required field', type: 'constraint' });

      const error = getError('table:0:name');
      expect(error?.message).toBe('Required field');
      expect(error?.type).toBe('constraint');
    });
  });

  describe('clearError', () => {
    it('removes error for a cell', () => {
      const { setError, clearError, getError } = useValidationStore.getState();
      setError('table:0:name', { message: 'Error', type: 'format' });
      clearError('table:0:name');
      expect(getError('table:0:name')).toBeUndefined();
    });
  });

  describe('clearTable', () => {
    it('removes all errors for a table', () => {
      const { setError, clearTable, getError, getErrorCount } = useValidationStore.getState();
      setError('table:0:name', { message: 'E1', type: 'format' });
      setError('table:1:email', { message: 'E2', type: 'format' });
      setError('other:0:id', { message: 'E3', type: 'format' });

      clearTable('table');

      expect(getError('table:0:name')).toBeUndefined();
      expect(getError('table:1:email')).toBeUndefined();
      expect(getError('other:0:id')).toBeDefined();
      expect(getErrorCount('table')).toBe(0);
    });
  });

  describe('getErrorCount', () => {
    it('counts errors for a specific table', () => {
      const { setError, getErrorCount } = useValidationStore.getState();
      setError('table:0:name', { message: 'E1', type: 'format' });
      setError('table:1:email', { message: 'E2', type: 'format' });
      setError('other:0:id', { message: 'E3', type: 'format' });

      expect(getErrorCount('table')).toBe(2);
      expect(getErrorCount('other')).toBe(1);
    });
  });

  describe('hasErrors', () => {
    it('returns true when table has errors', () => {
      const { setError, hasErrors } = useValidationStore.getState();
      expect(hasErrors('table')).toBe(false);

      setError('table:0:name', { message: 'E', type: 'format' });
      expect(hasErrors('table')).toBe(true);
    });
  });

  describe('getTableErrors', () => {
    it('returns all errors for a table', () => {
      const { setError, getTableErrors } = useValidationStore.getState();
      setError('table:0:name', { message: 'E1', type: 'format' });
      setError('table:1:email', { message: 'E2', type: 'type' });

      const errors = getTableErrors('table');
      expect(errors).toHaveLength(2);
      expect(errors.map(e => e.cellKey)).toContain('table:0:name');
      expect(errors.map(e => e.cellKey)).toContain('table:1:email');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/stores/validationStore.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write the store implementation**

```typescript
// src/stores/validationStore.ts
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
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test:unit src/stores/validationStore.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/validationStore.ts src/stores/validationStore.test.ts
git commit -m "feat(datagrid): add validation store for cell error tracking"
```

---

## Task 4: Cell State Visual Styles

**Files:**
- Create: `src/components/DataGrid/styles/cellStateStyles.ts`
- Modify: `src/components/DataGrid/theme/index.ts`

**Step 1: Create cell state style utilities**

```typescript
// src/components/DataGrid/styles/cellStateStyles.ts
import type { Theme } from '@glideapps/glide-data-grid';
import type { CellState } from '../types/cellState';

export interface CellStateColors {
  focused: {
    border: string;
    background: string;
  };
  editing: {
    border: string;
    background: string;
  };
  dirty: {
    border: string;
    background: string;
    indicator: string;
  };
  error: {
    border: string;
    background: string;
    indicator: string;
  };
  inserted: {
    background: string;
  };
  deleted: {
    background: string;
  };
}

export const lightCellStateColors: CellStateColors = {
  focused: {
    border: 'hsl(var(--primary))',
    background: 'transparent',
  },
  editing: {
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--background))',
  },
  dirty: {
    border: 'hsl(45 93% 47%)', // amber
    background: 'hsl(45 93% 47% / 0.1)',
    indicator: 'hsl(45 93% 47%)',
  },
  error: {
    border: 'hsl(0 84% 60%)', // red
    background: 'hsl(0 84% 60% / 0.1)',
    indicator: 'hsl(0 84% 60%)',
  },
  inserted: {
    background: 'hsl(142 76% 36% / 0.15)', // green
  },
  deleted: {
    background: 'hsl(0 84% 60% / 0.15)', // red dimmed
  },
};

export const darkCellStateColors: CellStateColors = {
  focused: {
    border: 'hsl(var(--primary))',
    background: 'transparent',
  },
  editing: {
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--background))',
  },
  dirty: {
    border: 'hsl(45 93% 47%)',
    background: 'hsl(45 93% 47% / 0.15)',
    indicator: 'hsl(45 93% 47%)',
  },
  error: {
    border: 'hsl(0 84% 60%)',
    background: 'hsl(0 84% 60% / 0.15)',
    indicator: 'hsl(0 84% 60%)',
  },
  inserted: {
    background: 'hsl(142 76% 36% / 0.2)',
  },
  deleted: {
    background: 'hsl(0 84% 60% / 0.2)',
  },
};

/**
 * Get cell background color based on state
 */
export function getCellStateBackground(
  state: CellState,
  colors: CellStateColors,
  isInserted = false,
  isDeleted = false
): string | undefined {
  if (isDeleted) return colors.deleted.background;
  if (isInserted) return colors.inserted.background;

  switch (state) {
    case 'dirty':
      return colors.dirty.background;
    case 'error':
      return colors.error.background;
    default:
      return undefined;
  }
}

/**
 * Get left border indicator color for dirty/error cells
 */
export function getCellStateIndicator(
  state: CellState,
  colors: CellStateColors
): string | undefined {
  switch (state) {
    case 'dirty':
      return colors.dirty.indicator;
    case 'error':
      return colors.error.indicator;
    default:
      return undefined;
  }
}
```

**Step 2: Add styles export**

Create or modify: `src/components/DataGrid/styles/index.ts`

```typescript
export * from './cellStateStyles';
```

**Step 3: Commit**

```bash
git add src/components/DataGrid/styles/cellStateStyles.ts src/components/DataGrid/styles/index.ts
git commit -m "feat(datagrid): add cell state visual styles"
```

---

## Task 5: useCellStateIndicator Hook

**Files:**
- Create: `src/components/DataGrid/hooks/useCellStateIndicator.ts`
- Test: `src/components/DataGrid/hooks/useCellStateIndicator.test.ts`

**Step 1: Write the failing test**

```typescript
// src/components/DataGrid/hooks/useCellStateIndicator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCellStateIndicator } from './useCellStateIndicator';
import { useCellStateStore } from '../stores/cellStateStore';
import { useValidationStore } from '@/stores/validationStore';

describe('useCellStateIndicator', () => {
  beforeEach(() => {
    useCellStateStore.getState().reset();
    useValidationStore.getState().reset();
  });

  it('returns idle state for cells with no state', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    expect(result.current.getCellIndicator(0, 'name')).toEqual({
      state: 'idle',
      hasError: false,
      isDirty: false,
    });
  });

  it('returns focused state for focused cell', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useCellStateStore.getState().focus('table:0:name');
    });

    expect(result.current.getCellIndicator(0, 'name').state).toBe('focused');
  });

  it('returns dirty state with indicator', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useCellStateStore.getState().focus('table:0:name');
      useCellStateStore.getState().startEdit('old');
      useCellStateStore.getState().submitValue('new');
    });

    const indicator = result.current.getCellIndicator(0, 'name');
    expect(indicator.state).toBe('dirty');
    expect(indicator.isDirty).toBe(true);
  });

  it('returns error state with validation error', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useValidationStore.getState().setError('table:0:name', {
        message: 'Invalid',
        type: 'format',
      });
    });

    const indicator = result.current.getCellIndicator(0, 'name');
    expect(indicator.hasError).toBe(true);
    expect(indicator.errorMessage).toBe('Invalid');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/components/DataGrid/hooks/useCellStateIndicator.test.ts
```

Expected: FAIL

**Step 3: Write the hook implementation**

```typescript
// src/components/DataGrid/hooks/useCellStateIndicator.ts
import { useCallback, useMemo } from 'react';
import { useCellStateStore } from '../stores/cellStateStore';
import { useValidationStore } from '@/stores/validationStore';
import { createCellKey, type CellState } from '../types/cellState';

interface UseCellStateIndicatorOptions {
  tableKey: string;
}

export interface CellIndicator {
  state: CellState;
  isDirty: boolean;
  hasError: boolean;
  errorMessage?: string;
  errorHint?: string;
}

export interface UseCellStateIndicatorResult {
  getCellIndicator: (rowIndex: number, columnField: string) => CellIndicator;
  hasDirtyCells: boolean;
  hasErrorCells: boolean;
  dirtyCellCount: number;
  errorCellCount: number;
}

const DEFAULT_INDICATOR: CellIndicator = {
  state: 'idle',
  isDirty: false,
  hasError: false,
};

export function useCellStateIndicator({
  tableKey,
}: UseCellStateIndicatorOptions): UseCellStateIndicatorResult {
  const getCellState = useCellStateStore((s) => s.getCellState);
  const getCellData = useCellStateStore((s) => s.getCellData);
  const dirtyCells = useCellStateStore((s) => s.getDirtyCells(tableKey));
  const errorCellsFromState = useCellStateStore((s) => s.getErrorCells(tableKey));

  const getValidationError = useValidationStore((s) => s.getError);
  const validationErrorCount = useValidationStore((s) => s.getErrorCount(tableKey));
  const tableValidationErrors = useValidationStore((s) => s.getTableErrors(tableKey));

  const getCellIndicator = useCallback(
    (rowIndex: number, columnField: string): CellIndicator => {
      const cellKey = createCellKey(tableKey, rowIndex, columnField);
      const state = getCellState(cellKey);
      const cellData = getCellData(cellKey);
      const validationError = getValidationError(cellKey);

      // Validation errors take precedence
      if (validationError) {
        return {
          state: 'error',
          isDirty: state === 'dirty',
          hasError: true,
          errorMessage: validationError.message,
          errorHint: validationError.hint,
        };
      }

      // Cell state error
      if (state === 'error' && cellData?.error) {
        return {
          state: 'error',
          isDirty: false,
          hasError: true,
          errorMessage: cellData.error,
        };
      }

      // Dirty state
      if (state === 'dirty') {
        return {
          state: 'dirty',
          isDirty: true,
          hasError: false,
        };
      }

      // Other states
      return {
        state,
        isDirty: false,
        hasError: false,
      };
    },
    [tableKey, getCellState, getCellData, getValidationError]
  );

  const hasDirtyCells = dirtyCells.length > 0;
  const hasErrorCells = validationErrorCount > 0 || errorCellsFromState.length > 0;
  const dirtyCellCount = dirtyCells.length;
  const errorCellCount = validationErrorCount + errorCellsFromState.length;

  return useMemo(
    () => ({
      getCellIndicator,
      hasDirtyCells,
      hasErrorCells,
      dirtyCellCount,
      errorCellCount,
    }),
    [getCellIndicator, hasDirtyCells, hasErrorCells, dirtyCellCount, errorCellCount]
  );
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test:unit src/components/DataGrid/hooks/useCellStateIndicator.test.ts
```

Expected: PASS

**Step 5: Export from hooks index**

Modify: `src/components/DataGrid/hooks/index.ts`

Add:
```typescript
export * from './useCellStateIndicator';
```

**Step 6: Commit**

```bash
git add src/components/DataGrid/hooks/useCellStateIndicator.ts src/components/DataGrid/hooks/useCellStateIndicator.test.ts src/components/DataGrid/hooks/index.ts
git commit -m "feat(datagrid): add useCellStateIndicator hook"
```

---

## Task 6: Integration Test

**Files:**
- Create: `src/components/DataGrid/integration/cellStateFlow.test.ts`

**Step 1: Write integration test**

```typescript
// src/components/DataGrid/integration/cellStateFlow.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCellStateStore } from '../stores/cellStateStore';
import { useValidationStore } from '@/stores/validationStore';
import { createCellKey } from '../types/cellState';

describe('Cell State Flow Integration', () => {
  beforeEach(() => {
    useCellStateStore.getState().reset();
    useValidationStore.getState().reset();
  });

  it('completes full edit cycle: idle → focused → editing → dirty', () => {
    const store = useCellStateStore.getState();
    const cellKey = createCellKey('conn:db:s:users', 0, 'name');

    // Start: idle
    expect(store.getCellState(cellKey)).toBe('idle');

    // Focus
    store.focus(cellKey);
    expect(store.getCellState(cellKey)).toBe('focused');
    expect(store.getFocusedCell()).toBe(cellKey);

    // Start editing
    store.startEdit('John');
    expect(store.getCellState(cellKey)).toBe('editing');
    expect(store.getCellData(cellKey)?.originalValue).toBe('John');

    // Submit changed value
    store.submitValue('Jane');
    expect(store.getCellState(cellKey)).toBe('dirty');
    expect(store.getCellData(cellKey)?.currentValue).toBe('Jane');

    // Verify dirty cells tracking
    expect(store.getDirtyCells('conn:db:s:users')).toContain(cellKey);
    expect(store.hasDirtyCells('conn:db:s:users')).toBe(true);
  });

  it('handles edit cancel: editing → focused', () => {
    const store = useCellStateStore.getState();
    const cellKey = createCellKey('t', 0, 'name');

    store.focus(cellKey);
    store.startEdit('John');
    expect(store.getCellState(cellKey)).toBe('editing');

    store.cancelEdit();
    expect(store.getCellState(cellKey)).toBe('focused');
  });

  it('handles unchanged value: editing → focused', () => {
    const store = useCellStateStore.getState();
    const cellKey = createCellKey('t', 0, 'name');

    store.focus(cellKey);
    store.startEdit('John');
    store.submitValue('John'); // Same value

    expect(store.getCellState(cellKey)).toBe('focused');
    expect(store.hasDirtyCells('t')).toBe(false);
  });

  it('handles validation error flow', () => {
    const cellStore = useCellStateStore.getState();
    const validationStore = useValidationStore.getState();
    const cellKey = createCellKey('t', 0, 'email');

    // Edit and submit invalid value
    cellStore.focus(cellKey);
    cellStore.startEdit('old@email.com');
    cellStore.submitValue('invalid-email');

    // Set validation error
    validationStore.setError(cellKey, {
      message: 'Invalid email format',
      type: 'format',
      hint: 'Expected: user@domain.com',
    });

    // Verify error tracking
    expect(validationStore.hasErrors('t')).toBe(true);
    expect(validationStore.getErrorCount('t')).toBe(1);
    expect(validationStore.canCommit('t')).toEqual({
      allowed: false,
      errorCount: 1,
    });

    // Clear error
    validationStore.clearError(cellKey);
    expect(validationStore.hasErrors('t')).toBe(false);
    expect(validationStore.canCommit('t')).toEqual({
      allowed: true,
      errorCount: 0,
    });
  });

  it('handles commit flow: dirty → committing → success', () => {
    const store = useCellStateStore.getState();
    const cellKey = createCellKey('t', 0, 'name');

    // Setup dirty cell
    store.focus(cellKey);
    store.startEdit('old');
    store.submitValue('new');
    expect(store.getCellState(cellKey)).toBe('dirty');

    // Start commit
    store.setCommitting(cellKey);
    expect(store.getCellState(cellKey)).toBe('committing');

    // Commit success - cell cleared
    store.setCommitSuccess(cellKey);
    expect(store.getCellState(cellKey)).toBe('idle');
    expect(store.hasDirtyCells('t')).toBe(false);
  });

  it('handles commit failure: committing → error', () => {
    const store = useCellStateStore.getState();
    const cellKey = createCellKey('t', 0, 'name');

    // Setup and commit
    store.focus(cellKey);
    store.startEdit('old');
    store.submitValue('new');
    store.setCommitting(cellKey);

    // Commit failure
    store.setCommitFailure(cellKey, 'Database constraint violation');
    expect(store.getCellState(cellKey)).toBe('error');
    expect(store.getCellData(cellKey)?.error).toBe('Database constraint violation');
  });

  it('handles multi-cell editing with focus changes', () => {
    const store = useCellStateStore.getState();
    const cell1 = createCellKey('t', 0, 'name');
    const cell2 = createCellKey('t', 0, 'email');

    // Edit first cell
    store.focus(cell1);
    store.startEdit('John');
    store.submitValue('Jane');
    expect(store.getCellState(cell1)).toBe('dirty');

    // Focus second cell - first stays dirty
    store.focus(cell2);
    expect(store.getCellState(cell1)).toBe('dirty');
    expect(store.getCellState(cell2)).toBe('focused');

    // Edit second cell
    store.startEdit('old@email.com');
    store.submitValue('new@email.com');
    expect(store.getCellState(cell2)).toBe('dirty');

    // Both cells are dirty
    expect(store.getDirtyCells('t')).toHaveLength(2);
  });

  it('clears table state on clearTable', () => {
    const cellStore = useCellStateStore.getState();
    const validationStore = useValidationStore.getState();

    // Setup multiple cells
    const cell1 = createCellKey('t', 0, 'name');
    const cell2 = createCellKey('t', 1, 'email');
    const otherCell = createCellKey('other', 0, 'id');

    cellStore.focus(cell1);
    cellStore.startEdit('a');
    cellStore.submitValue('b');

    cellStore.focus(cell2);
    cellStore.startEdit('c');
    cellStore.submitValue('d');

    cellStore.focus(otherCell);
    cellStore.startEdit('x');
    cellStore.submitValue('y');

    validationStore.setError(cell1, { message: 'E', type: 'format' });

    // Clear table 't'
    cellStore.clearTable('t');
    validationStore.clearTable('t');

    // Table 't' cleared
    expect(cellStore.getCellState(cell1)).toBe('idle');
    expect(cellStore.getCellState(cell2)).toBe('idle');
    expect(validationStore.hasErrors('t')).toBe(false);

    // Other table unaffected
    expect(cellStore.getCellState(otherCell)).toBe('dirty');
  });
});
```

**Step 2: Run integration test**

```bash
pnpm test:unit src/components/DataGrid/integration/cellStateFlow.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/components/DataGrid/integration/cellStateFlow.test.ts
git commit -m "test(datagrid): add cell state flow integration tests"
```

---

## Task 7: Update DataGrid Index Exports

**Files:**
- Modify: `src/components/DataGrid/index.ts`

**Step 1: Add new exports**

Add to `src/components/DataGrid/index.ts`:

```typescript
// Stores
export * from './stores';

// Cell state types
export type {
  CellState,
  CellStateTransition,
  CellKey,
  CellStateData,
} from './types/cellState';
export { createCellKey, parseCellKey, isValidTransition } from './types/cellState';

// Styles
export * from './styles';
```

**Step 2: Commit**

```bash
git add src/components/DataGrid/index.ts
git commit -m "feat(datagrid): export cell state modules from index"
```

---

## Summary

Phase 1 establishes the foundation:

| Component | Purpose |
|-----------|---------|
| `cellState.ts` | Type definitions for 7-state machine |
| `cellStateStore.ts` | Zustand store managing cell states |
| `validationStore.ts` | Zustand store for validation errors |
| `cellStateStyles.ts` | Visual styling for cell states |
| `useCellStateIndicator.ts` | Hook combining state + validation |
| Integration tests | Verify complete edit flows |

**Next:** Phase 2 will integrate these stores into `EditableDataGrid` and add Excel-like keyboard navigation.
