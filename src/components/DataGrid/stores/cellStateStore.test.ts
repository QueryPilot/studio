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
