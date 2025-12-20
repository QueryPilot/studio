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
