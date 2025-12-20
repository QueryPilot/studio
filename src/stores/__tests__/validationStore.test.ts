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

  describe('canCommit', () => {
    it('returns allowed false when errors exist', () => {
      const { setError, canCommit } = useValidationStore.getState();
      setError('table:0:name', { message: 'E', type: 'format' });

      expect(canCommit('table')).toEqual({ allowed: false, errorCount: 1 });
    });

    it('returns allowed true when no errors', () => {
      const { canCommit } = useValidationStore.getState();
      expect(canCommit('table')).toEqual({ allowed: true, errorCount: 0 });
    });
  });
});
