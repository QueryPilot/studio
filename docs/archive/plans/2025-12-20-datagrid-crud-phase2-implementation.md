# DataGrid CRUD Phase 2: Excel-like Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Excel-like keyboard navigation and editing behavior, building on the Phase 1 cell state foundation.

**Architecture:** Add a navigation state layer that intercepts keyboard events at the grid level, distinguishes between SELECTED and EDITING modes, and coordinates with the existing cellStateStore.

**Tech Stack:** React 19, TypeScript, Zustand, Glide Data Grid, Vitest

**Design Reference:** `docs/plans/2025-12-20-datagrid-crud-redesign.md`

**Phase 1 Reference:** `docs/plans/2025-12-20-datagrid-crud-phase1-implementation.md`

---

## Overview

Phase 2 transforms the DataGrid from a click-to-edit model to an Excel-like navigation model with three distinct modes:

```
BROWSING --> (click) --> SELECTED --> (dblclick/F2/type) --> EDITING
    ^                       |                                   |
    |                       v                                   v
    +<---- (Escape) <-------+<------ (Enter/Tab) ---------------+
```

**Key Behavioral Changes:**
- Single-click focuses cell (SELECTED) without opening editor
- Double-click or F2 opens editor (EDITING)
- Typing A-Z/0-9 enters edit mode and replaces content (type-to-edit)
- Arrow keys navigate between cells when in SELECTED mode
- Enter commits and moves down, Tab commits and moves right
- Delete/Backspace clears cell when in SELECTED mode

**Target Keyboard Behavior:**

| Action | Current | Target |
|--------|---------|--------|
| Click cell | Focus + edit mode | Focus only (selection) |
| Double-click | Edit mode | Edit mode |
| Type A-Z/0-9 | Nothing | Enter edit + replace value |
| Enter | Commit + exit | Commit + move down |
| Tab | Move right (in edit) | Commit + move right |
| Shift+Tab | - | Commit + move left |
| Escape | Cancel edit | Cancel edit / clear selection |
| Arrow keys | Trapped in input | Move selection (when focused) |
| F2 | - | Enter edit mode (keep value) |
| Delete/Backspace | Delete char | Clear cell (when focused) |
| Ctrl+Enter | - | Commit + stay in cell |

---

## Task 1: Navigation State Types

**Files:**
- Create: `src/components/DataGrid/types/navigationState.ts`
- Modify: `src/components/DataGrid/types/index.ts`

**Step 1: Write the navigation state type definitions**

```typescript
// src/components/DataGrid/types/navigationState.ts

import type { Item } from "@glideapps/glide-data-grid";

/**
 * Navigation modes for Excel-like behavior
 */
export type NavigationMode = 'browsing' | 'selected' | 'editing';

/**
 * Edit trigger - how editing was initiated
 */
export type EditTrigger =
  | 'double-click'  // User double-clicked the cell
  | 'f2'            // User pressed F2
  | 'type-replace'  // User started typing (replaces content)
  | 'type-append'   // Future: User started typing after F2 (appends)
  | 'enter';        // User pressed Enter on selected cell

/**
 * Navigation state for tracking current mode and context
 */
export interface NavigationState {
  mode: NavigationMode;
  selectedCell: Item | null;
  editTrigger: EditTrigger | null;
  /** Initial character typed when entering edit via type-replace */
  initialChar: string | null;
}

/**
 * Navigation actions
 */
export type NavigationAction =
  | { type: 'SELECT_CELL'; cell: Item }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'ENTER_EDIT'; trigger: EditTrigger; initialChar?: string }
  | { type: 'EXIT_EDIT'; commit: boolean }
  | { type: 'MOVE_SELECTION'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'RESET' };

/**
 * Keys that trigger type-to-edit mode (replace content)
 */
export function isPrintableKey(key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean): boolean {
  // Ignore if modifier keys are pressed (except Shift)
  if (ctrlKey || metaKey || altKey) return false;

  // Single character keys (letters, numbers, symbols)
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    // Printable ASCII range: space (32) to tilde (126)
    return code >= 32 && code <= 126;
  }

  return false;
}

/**
 * Keys that should navigate when in selected mode
 */
export function isNavigationKey(key: string): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key);
}

/**
 * Map navigation key to direction
 */
export function keyToDirection(key: string): 'up' | 'down' | 'left' | 'right' | null {
  switch (key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    default: return null;
  }
}

/**
 * Keys that clear cell content when in selected mode
 */
export function isClearKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace';
}
```

**Step 2: Export from types index**

Modify: `src/components/DataGrid/types/index.ts`

Add at the end:
```typescript
export * from './navigationState';
```

**Step 3: Commit**

```bash
git add src/components/DataGrid/types/navigationState.ts src/components/DataGrid/types/index.ts
git commit -m "feat(datagrid): add navigation state types for Excel-like editing"
```

---

## Task 2: Navigation State Store

**Files:**
- Create: `src/components/DataGrid/stores/navigationStore.ts`
- Test: `src/components/DataGrid/stores/navigationStore.test.ts`
- Modify: `src/components/DataGrid/stores/index.ts`

**Step 1: Write the failing test**

```typescript
// src/components/DataGrid/stores/navigationStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from './navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.getState().reset();
  });

  describe('selectCell', () => {
    it('transitions from browsing to selected', () => {
      const { selectCell, getMode, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      expect(getMode()).toBe('selected');
      expect(getSelectedCell()).toEqual([0, 1]);
    });

    it('updates selected cell when already in selected mode', () => {
      const { selectCell, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      selectCell([2, 3]);
      expect(getSelectedCell()).toEqual([2, 3]);
    });
  });

  describe('enterEdit', () => {
    it('transitions from selected to editing', () => {
      const { selectCell, enterEdit, getMode, getEditTrigger } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      expect(getMode()).toBe('editing');
      expect(getEditTrigger()).toBe('f2');
    });

    it('stores initial character for type-replace', () => {
      const { selectCell, enterEdit, getInitialChar } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('type-replace', 'a');
      expect(getInitialChar()).toBe('a');
    });

    it('does nothing when in browsing mode', () => {
      const { enterEdit, getMode } = useNavigationStore.getState();
      enterEdit('f2');
      expect(getMode()).toBe('browsing');
    });
  });

  describe('exitEdit', () => {
    it('transitions from editing to selected on commit', () => {
      const { selectCell, enterEdit, exitEdit, getMode } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      exitEdit(true);
      expect(getMode()).toBe('selected');
    });

    it('transitions from editing to selected on cancel', () => {
      const { selectCell, enterEdit, exitEdit, getMode } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      exitEdit(false);
      expect(getMode()).toBe('selected');
    });

    it('clears edit trigger and initial char', () => {
      const { selectCell, enterEdit, exitEdit, getEditTrigger, getInitialChar } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('type-replace', 'x');
      exitEdit(true);
      expect(getEditTrigger()).toBeNull();
      expect(getInitialChar()).toBeNull();
    });
  });

  describe('clearSelection', () => {
    it('transitions to browsing mode', () => {
      const { selectCell, clearSelection, getMode, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      clearSelection();
      expect(getMode()).toBe('browsing');
      expect(getSelectedCell()).toBeNull();
    });
  });

  describe('moveSelection', () => {
    it('moves selection in the specified direction', () => {
      const store = useNavigationStore.getState();
      store.selectCell([1, 1]);

      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 0]);

      store.moveSelection('down', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);

      store.moveSelection('left', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 1]);

      store.moveSelection('right', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);
    });

    it('respects bounds and does not move past edges', () => {
      const store = useNavigationStore.getState();
      store.selectCell([0, 0]);

      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 0]);

      store.moveSelection('left', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 0]);
    });

    it('does nothing when in editing mode', () => {
      const store = useNavigationStore.getState();
      store.selectCell([1, 1]);
      store.enterEdit('f2');
      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);
    });
  });
});
```

**Step 2: Write the store implementation**

```typescript
// src/components/DataGrid/stores/navigationStore.ts
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
```

**Step 3: Run tests**

```bash
pnpm test:unit src/components/DataGrid/stores/navigationStore.test.ts
```

Expected: PASS

**Step 4: Export from stores index**

Modify: `src/components/DataGrid/stores/index.ts`

Add:
```typescript
export { useNavigationStore, navigationSelectors } from './navigationStore';
export type { NavigationBounds } from './navigationStore';
```

**Step 5: Commit**

```bash
git add src/components/DataGrid/stores/navigationStore.ts src/components/DataGrid/stores/navigationStore.test.ts src/components/DataGrid/stores/index.ts
git commit -m "feat(datagrid): add navigation store for Excel-like mode tracking"
```

---

## Task 3: useKeyboardNavigation Hook

**Files:**
- Create: `src/components/DataGrid/hooks/useKeyboardNavigation.ts`
- Test: `src/components/DataGrid/hooks/useKeyboardNavigation.test.ts`
- Modify: `src/components/DataGrid/hooks/index.ts`

**Step 1: Write the hook implementation**

```typescript
// src/components/DataGrid/hooks/useKeyboardNavigation.ts
import { useCallback, useRef } from 'react';
import type { DataEditorRef, Item, GridSelection } from '@glideapps/glide-data-grid';
import { useNavigationStore, type NavigationBounds } from '../stores/navigationStore';
import { useCellStateStore } from '../stores/cellStateStore';
import { createCellKey } from '../types/cellState';
import {
  isPrintableKey,
  isNavigationKey,
  keyToDirection,
  isClearKey,
} from '../types/navigationState';

export interface UseKeyboardNavigationOptions {
  tableKey: string;
  gridRef: React.RefObject<DataEditorRef | null>;
  bounds: NavigationBounds;
  columns: { field: string }[];
  onClearCell?: (cell: Item, columnField: string) => void;
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

export function useKeyboardNavigation(
  options: UseKeyboardNavigationOptions
): UseKeyboardNavigationResult {
  const {
    tableKey,
    gridRef,
    bounds,
    columns,
    onClearCell,
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

      const cellKey = createCellKey(tableKey, cell[1], getColumnField(cell[0]));
      startEdit(null);
    },
    [enabled, selectCell, enterEdit, startEdit, tableKey, getColumnField]
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

        // Delete/Backspace - clear cell
        if (isClearKey(e.key)) {
          e.preventDefault();
          const columnField = getColumnField(selectedCell[0]);
          onClearCell?.(selectedCell, columnField);
          return true;
        }

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
```

**Step 2: Write tests**

```typescript
// src/components/DataGrid/hooks/useKeyboardNavigation.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardNavigation } from './useKeyboardNavigation';
import { useNavigationStore } from '../stores/navigationStore';
import { useCellStateStore } from '../stores/cellStateStore';

describe('useKeyboardNavigation', () => {
  const mockGridRef = { current: null };
  const defaultOptions = {
    tableKey: 'test-table',
    gridRef: mockGridRef as React.RefObject<null>,
    bounds: { maxCol: 10, maxRow: 100 },
    columns: [{ field: 'name' }, { field: 'email' }, { field: 'age' }],
    onClearCell: vi.fn(),
    enabled: true,
  };

  beforeEach(() => {
    useNavigationStore.getState().reset();
    useCellStateStore.getState().reset();
    vi.clearAllMocks();
  });

  describe('handleCellClick', () => {
    it('selects cell on single click', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
      });

      expect(useNavigationStore.getState().getMode()).toBe('selected');
      expect(useNavigationStore.getState().getSelectedCell()).toEqual([2, 5]);
    });
  });

  describe('handleCellDoubleClick', () => {
    it('enters edit mode on double click', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellDoubleClick([2, 5]);
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('double-click');
    });
  });

  describe('handleEditComplete', () => {
    it('exits edit mode and moves selection on commit', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
        useNavigationStore.getState().enterEdit('f2');
      });

      act(() => {
        result.current.handleEditComplete(true, 'down');
      });

      expect(useNavigationStore.getState().getMode()).toBe('selected');
      expect(useNavigationStore.getState().getSelectedCell()).toEqual([2, 6]);
    });
  });

  describe('keyboard navigation', () => {
    const createKeyEvent = (key: string, opts: Partial<React.KeyboardEvent> = {}) => ({
      key,
      preventDefault: vi.fn(),
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...opts,
    } as unknown as React.KeyboardEvent);

    it('moves selection with arrow keys in selected mode', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('ArrowUp'));
      });

      expect(useNavigationStore.getState().getSelectedCell()).toEqual([5, 4]);
    });

    it('enters edit mode on F2', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('F2'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('f2');
    });

    it('enters edit mode with initial char on printable key', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('a'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('type-replace');
      expect(useNavigationStore.getState().getInitialChar()).toBe('a');
    });

    it('clears selection on Escape', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Escape'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('browsing');
      expect(useNavigationStore.getState().getSelectedCell()).toBeNull();
    });

    it('calls onClearCell on Delete key', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([1, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Delete'));
      });

      expect(defaultOptions.onClearCell).toHaveBeenCalledWith([1, 5], 'email');
    });
  });
});
```

**Step 3: Run tests**

```bash
pnpm test:unit src/components/DataGrid/hooks/useKeyboardNavigation.test.ts
```

Expected: PASS

**Step 4: Export from hooks index**

Modify: `src/components/DataGrid/hooks/index.ts`

Add:
```typescript
export { useKeyboardNavigation } from './useKeyboardNavigation';
export type {
  UseKeyboardNavigationOptions,
  UseKeyboardNavigationResult,
} from './useKeyboardNavigation';
```

**Step 5: Commit**

```bash
git add src/components/DataGrid/hooks/useKeyboardNavigation.ts src/components/DataGrid/hooks/useKeyboardNavigation.test.ts src/components/DataGrid/hooks/index.ts
git commit -m "feat(datagrid): add useKeyboardNavigation hook for Excel-like editing"
```

---

## Task 4: Update Cell Editors for Type-to-Edit Support

**Files:**
- Modify: `src/components/DataGrid/renderers/TextCell/TextSingleLineCellEditor.tsx`
- Modify: `src/components/DataGrid/renderers/TextCell/TextMultiLineCellEditor.tsx`

**Step 1: Update TextSingleLineCellEditor**

Add support for `initialChar` from navigation store to replace content on type-to-edit:

```typescript
// In TextSingleLineCellEditor.tsx - add import
import { useNavigationStore } from '../../stores/navigationStore';

// Inside component, get navigation state:
const initialChar = useNavigationStore((s) => s.initialChar);
const editTrigger = useNavigationStore((s) => s.editTrigger);

// Determine initial input value based on trigger
const isTypeReplace = editTrigger === 'type-replace' && initialChar;
const inputInitialValue = isTypeReplace ? initialChar : (value.data.value ?? "");

// Update the input's defaultValue to use inputInitialValue
// If type-replace, position cursor at end of the initial character
```

**Step 2: Update TextMultiLineCellEditor similarly**

Apply the same pattern for the multiline editor.

**Step 3: Test manually**

- Verify F2 preserves existing value
- Verify typing 'a' on selected cell replaces content with 'a'
- Verify cursor is positioned correctly

**Step 4: Commit**

```bash
git add src/components/DataGrid/renderers/TextCell/TextSingleLineCellEditor.tsx src/components/DataGrid/renderers/TextCell/TextMultiLineCellEditor.tsx
git commit -m "feat(datagrid): add type-to-edit support to text cell editors"
```

---

## Task 5: Integrate with EditableDataGrid

**Files:**
- Modify: `src/components/DataGrid/base/EditableDataGrid.tsx`

**Step 1: Add tableKey prop and wire up keyboard navigation**

```typescript
// In EditableDataGrid.tsx
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { useNavigationStore } from '../stores/navigationStore';

// Add to props interface:
export interface EditableDataGridProps extends ... {
  /** Unique key for this table (used for cell state tracking) */
  tableKey?: string;
}

// Inside component:
const {
  handleKeyDown,
  handleCellClick,
  handleCellDoubleClick,
  handleEditComplete,
  mode,
  selectedCell,
} = useKeyboardNavigation({
  tableKey: tableKey ?? 'datagrid',
  gridRef,
  bounds: { maxCol: columns.length, maxRow: rows.length },
  columns: columns.map((c) => ({ field: c.id ?? String(c) })),
  onClearCell: (cell, columnField) => {
    // Handle cell clearing - stage null value
  },
  enabled: true,
});
```

**Step 2: Update click handlers**

```typescript
// Wrap onCellClicked to use handleCellClick
const handleCellClicked = useCallback(
  (cell: Item, event: CellClickedEventArgs) => {
    handleCellClick(cell);
    onCellClicked?.(cell, event);
  },
  [handleCellClick, onCellClicked]
);
```

**Step 3: Update onCellActivated for double-click**

```typescript
const handleCellActivatedWithNavigation = useCallback(
  (cell: Item) => {
    handleCellDoubleClick(cell);
    // Continue with existing activation logic...
  },
  [handleCellDoubleClick, ...]
);
```

**Step 4: Wire up keyboard handler**

```typescript
// Add onKeyDown to DataEditorBase
<DataEditorBase
  ...
  onKeyDown={handleKeyDown}
/>
```

**Step 5: Update handleFinishedEditing**

```typescript
const handleFinishedEditing = useCallback(
  (newValue: GridCell | undefined, movement: Item) => {
    // Map movement tuple to direction
    const [colOffset, rowOffset] = movement;
    let direction: 'down' | 'right' | 'left' | 'up' | undefined;
    if (rowOffset === 1) direction = 'down';
    else if (rowOffset === -1) direction = 'up';
    else if (colOffset === 1) direction = 'right';
    else if (colOffset === -1) direction = 'left';

    handleEditComplete(newValue !== undefined, direction);

    // Continue with existing logic...
  },
  [handleEditComplete, ...]
);
```

**Step 6: Commit**

```bash
git add src/components/DataGrid/base/EditableDataGrid.tsx
git commit -m "feat(datagrid): integrate keyboard navigation with EditableDataGrid"
```

---

## Task 6: Update TableDataGrid Adapter

**Files:**
- Modify: `src/components/DataGrid/adapters/TableDataGrid.tsx`

**Step 1: Pass tableKey to EditableDataGrid**

```typescript
// Create a stable tableKey
const navigationTableKey = useMemo(
  () => `${connectionId}:${database}:${schema ?? 'public'}:${table}`,
  [connectionId, database, schema, table]
);

// Pass to EditableDataGrid
<EditableDataGrid
  // ... existing props
  tableKey={navigationTableKey}
/>
```

**Step 2: Commit**

```bash
git add src/components/DataGrid/adapters/TableDataGrid.tsx
git commit -m "feat(datagrid): integrate Excel-like navigation with TableDataGrid"
```

---

## Task 7: Integration Tests

**Files:**
- Create: `src/components/DataGrid/integration/keyboardNavigation.test.ts`

**Step 1: Write integration tests**

```typescript
// src/components/DataGrid/integration/keyboardNavigation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from '../stores/navigationStore';
import { useCellStateStore } from '../stores/cellStateStore';
import { createCellKey } from '../types/cellState';

describe('Keyboard Navigation Integration', () => {
  beforeEach(() => {
    useNavigationStore.getState().reset();
    useCellStateStore.getState().reset();
  });

  describe('Navigation State Machine', () => {
    it('follows BROWSING -> SELECTED -> EDITING -> SELECTED flow', () => {
      const nav = useNavigationStore.getState();
      const cell = useCellStateStore.getState();
      const cellKey = createCellKey('t', 0, 'name');

      // Start in browsing
      expect(nav.getMode()).toBe('browsing');
      expect(cell.getCellState(cellKey)).toBe('idle');

      // Click -> SELECTED
      nav.selectCell([0, 0]);
      cell.focus(cellKey);
      expect(nav.getMode()).toBe('selected');
      expect(cell.getCellState(cellKey)).toBe('focused');

      // F2 -> EDITING
      nav.enterEdit('f2');
      cell.startEdit('original');
      expect(nav.getMode()).toBe('editing');
      expect(cell.getCellState(cellKey)).toBe('editing');

      // Commit -> SELECTED (with dirty state)
      nav.exitEdit(true);
      cell.submitValue('changed');
      expect(nav.getMode()).toBe('selected');
      expect(cell.getCellState(cellKey)).toBe('dirty');
    });

    it('handles Escape at each state correctly', () => {
      const nav = useNavigationStore.getState();
      const cell = useCellStateStore.getState();
      const cellKey = createCellKey('t', 0, 'name');

      // SELECTED + Escape -> BROWSING
      nav.selectCell([0, 0]);
      cell.focus(cellKey);
      nav.clearSelection();
      cell.blur();
      expect(nav.getMode()).toBe('browsing');
      expect(cell.getCellState(cellKey)).toBe('idle');

      // EDITING + Escape -> SELECTED (cancel)
      nav.selectCell([0, 0]);
      cell.focus(cellKey);
      nav.enterEdit('f2');
      cell.startEdit('original');
      nav.exitEdit(false);
      cell.cancelEdit();
      expect(nav.getMode()).toBe('selected');
      expect(cell.getCellState(cellKey)).toBe('focused');
    });
  });

  describe('Type-to-Edit Mode', () => {
    it('captures initial character for replace mode', () => {
      const nav = useNavigationStore.getState();

      nav.selectCell([0, 0]);
      nav.enterEdit('type-replace', 'x');

      expect(nav.getMode()).toBe('editing');
      expect(nav.getEditTrigger()).toBe('type-replace');
      expect(nav.getInitialChar()).toBe('x');
    });

    it('clears initial character on exit', () => {
      const nav = useNavigationStore.getState();

      nav.selectCell([0, 0]);
      nav.enterEdit('type-replace', 'x');
      nav.exitEdit(true);

      expect(nav.getInitialChar()).toBeNull();
    });
  });

  describe('Movement After Commit', () => {
    it('moves selection after Enter commit (down)', () => {
      const nav = useNavigationStore.getState();
      const bounds = { maxCol: 10, maxRow: 10 };

      nav.selectCell([5, 5]);
      nav.enterEdit('enter');
      nav.exitEdit(true);
      nav.moveSelection('down', bounds);

      expect(nav.getSelectedCell()).toEqual([5, 6]);
    });

    it('moves selection after Tab commit (right)', () => {
      const nav = useNavigationStore.getState();
      const bounds = { maxCol: 10, maxRow: 10 };

      nav.selectCell([5, 5]);
      nav.enterEdit('enter');
      nav.exitEdit(true);
      nav.moveSelection('right', bounds);

      expect(nav.getSelectedCell()).toEqual([6, 5]);
    });

    it('moves selection after Shift+Tab commit (left)', () => {
      const nav = useNavigationStore.getState();
      const bounds = { maxCol: 10, maxRow: 10 };

      nav.selectCell([5, 5]);
      nav.enterEdit('enter');
      nav.exitEdit(true);
      nav.moveSelection('left', bounds);

      expect(nav.getSelectedCell()).toEqual([4, 5]);
    });
  });

  describe('Cell State Synchronization', () => {
    it('syncs navigation and cell state stores', () => {
      const nav = useNavigationStore.getState();
      const cell = useCellStateStore.getState();
      const cellKey = createCellKey('t', 0, 'name');

      // Select and focus
      nav.selectCell([0, 0]);
      cell.focus(cellKey);
      expect(nav.isSelected()).toBe(true);
      expect(cell.getCellState(cellKey)).toBe('focused');

      // Edit
      nav.enterEdit('f2');
      cell.startEdit('original');
      expect(nav.isEditing()).toBe(true);
      expect(cell.getCellState(cellKey)).toBe('editing');

      // Commit with change
      nav.exitEdit(true);
      cell.submitValue('new value');
      expect(nav.isEditing()).toBe(false);
      expect(cell.getCellState(cellKey)).toBe('dirty');
    });
  });
});
```

**Step 2: Run tests**

```bash
pnpm test:unit src/components/DataGrid/integration/keyboardNavigation.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/components/DataGrid/integration/keyboardNavigation.test.ts
git commit -m "test(datagrid): add keyboard navigation integration tests"
```

---

## Task 8: Final Testing and Documentation

**Step 1: Manual Testing Checklist**

Test each behavior against the target:

| Action | Expected | Verified |
|--------|----------|----------|
| Click cell | Focus only (selection) | [ ] |
| Double-click | Edit mode | [ ] |
| Type A-Z/0-9 | Enter edit + replace value | [ ] |
| Enter | Commit + move down | [ ] |
| Tab | Commit + move right | [ ] |
| Shift+Tab | Commit + move left | [ ] |
| Escape (in selected) | Clear selection | [ ] |
| Escape (in editing) | Cancel edit | [ ] |
| Arrow keys (in selected) | Move selection | [ ] |
| F2 | Enter edit mode (keep value) | [ ] |
| Delete/Backspace | Clear cell | [ ] |
| Ctrl+Enter | Commit + stay in cell | [ ] |

**Step 2: Run full test suite**

```bash
pnpm test:unit
pnpm typecheck
pnpm lint
```

**Step 3: Final commit**

```bash
git commit -m "docs: mark Phase 2 Excel-like editing as complete"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `types/navigationState.ts` | Navigation state types and helpers |
| 2 | `stores/navigationStore.ts` | Zustand store for navigation mode tracking |
| 3 | `hooks/useKeyboardNavigation.ts` | Main keyboard handler hook |
| 4 | `renderers/*/CellEditor.tsx` | Type-to-edit support in editors |
| 5 | `base/EditableDataGrid.tsx` | Integration with grid component |
| 6 | `adapters/TableDataGrid.tsx` | Adapter integration |
| 7 | `integration/keyboardNavigation.test.ts` | Integration tests |
| 8 | Manual testing + docs | Verification and documentation |

**Dependencies:**
```
Task 1 (types) -> Task 2 (store) -> Task 3 (hook)
                                        |
                                        v
                          Task 4 (editors) + Task 5 (grid)
                                        |
                                        v
                                   Task 6 (adapter)
                                        |
                                        v
                                   Task 7 (tests)
                                        |
                                        v
                                   Task 8 (docs)
```

**Next Phase:** Phase 3 will add Clipboard & Batch Operations (multi-cell selection, copy formats, paste handling).
