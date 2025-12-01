import { describe, it, expect, beforeEach } from 'vitest';
import { useTabStateStore, type QueryResult } from '../tabStateStore';

describe('tabStateStore', () => {
  beforeEach(() => {
    // Reset store
    useTabStateStore.setState({
      queryStates: new Map(),
    });
  });

  describe('Initial State', () => {
    it('should start with empty query states', () => {
      const state = useTabStateStore.getState();
      expect(state.queryStates.size).toBe(0);
    });

    it('should return undefined for non-existent tab', () => {
      const store = useTabStateStore.getState();
      const state = store.getQueryState('non-existent-tab');
      expect(state).toBeUndefined();
    });
  });

  describe('Query State Management', () => {
    it('should create new query state for tab', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', {
        query: 'SELECT * FROM users',
        isExecuting: false,
      });

      const state = store.getQueryState('tab-1');
      expect(state).toBeDefined();
      expect(state?.query).toBe('SELECT * FROM users');
      expect(state?.isExecuting).toBe(false);
    });

    it('should initialize with default values', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { query: 'SELECT 1' });

      const state = store.getQueryState('tab-1');
      expect(state?.query).toBe('SELECT 1');
      expect(state?.result).toBe(null);
      expect(state?.isExecuting).toBe(false);
      expect(state?.isStreaming).toBe(false);
      expect(state?.viewMode).toBe('table');
      expect(state?.appliedLimit).toBe(null);
    });

    it('should update existing query state', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { query: 'SELECT * FROM users' });
      store.setQueryState('tab-1', { isExecuting: true });

      const state = store.getQueryState('tab-1');
      expect(state?.query).toBe('SELECT * FROM users');
      expect(state?.isExecuting).toBe(true);
    });

    it('should handle query execution lifecycle', () => {
      const store = useTabStateStore.getState();

      // Start execution
      store.setQueryState('tab-1', {
        query: 'SELECT * FROM users',
        isExecuting: true,
      });

      let state = store.getQueryState('tab-1');
      expect(state?.isExecuting).toBe(true);

      // Complete execution with results
      const result: QueryResult = {
        columns: ['id', 'name', 'email'],
        rows: [
          [1, 'Alice', 'alice@example.com'],
          [2, 'Bob', 'bob@example.com'],
        ],
        rowCount: 2,
        executionTime: 125,
      };

      store.setQueryState('tab-1', {
        result,
        isExecuting: false,
      });

      state = store.getQueryState('tab-1');
      expect(state?.isExecuting).toBe(false);
      expect(state?.result).toEqual(result);
    });

    it('should handle streaming state', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', {
        query: 'SELECT * FROM large_table',
        isStreaming: true,
      });

      const state = store.getQueryState('tab-1');
      expect(state?.isStreaming).toBe(true);
    });

    it('should handle view mode changes', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { viewMode: 'json' });

      let state = store.getQueryState('tab-1');
      expect(state?.viewMode).toBe('json');

      store.setQueryState('tab-1', { viewMode: 'table' });

      state = store.getQueryState('tab-1');
      expect(state?.viewMode).toBe('table');
    });

    it('should handle applied limit', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', {
        appliedLimit: {
          originalSql: 'SELECT * FROM users',
          limit: 1000,
        },
      });

      const state = store.getQueryState('tab-1');
      expect(state?.appliedLimit).toEqual({
        originalSql: 'SELECT * FROM users',
        limit: 1000,
      });
    });
  });

  describe('Query Results', () => {
    it('should store complete query result', () => {
      const store = useTabStateStore.getState();

      const result: QueryResult = {
        columns: ['id', 'name'],
        columnMeta: [
          {
            name: 'id',
            db_type: 'integer',
            nullable: false,
            is_pk: true,
            is_fk: false,
            ordinal: 1,
            default: null,
          },
          {
            name: 'name',
            db_type: 'varchar',
            nullable: false,
            is_pk: false,
            is_fk: false,
            ordinal: 2,
            default: null,
          },
        ],
        rows: [[1, 'Alice'], [2, 'Bob']],
        rowCount: 2,
        executionTime: 125,
      };

      store.setQueryState('tab-1', { result });

      const state = store.getQueryState('tab-1');
      expect(state?.result).toEqual(result);
    });

    it('should store streaming performance metrics', () => {
      const store = useTabStateStore.getState();

      const result: QueryResult = {
        columns: ['id'],
        rows: [[1], [2]],
        rowCount: 2,
        cursorSetupMs: 50,
        totalStreamingMs: 500,
        fetchCount: 10,
        networkMs: 200,
        conversionMs: 100,
        ipcSendMs: 150,
      };

      store.setQueryState('tab-1', { result });

      const state = store.getQueryState('tab-1');
      expect(state?.result?.cursorSetupMs).toBe(50);
      expect(state?.result?.totalStreamingMs).toBe(500);
      expect(state?.result?.fetchCount).toBe(10);
      expect(state?.result?.networkMs).toBe(200);
      expect(state?.result?.conversionMs).toBe(100);
      expect(state?.result?.ipcSendMs).toBe(150);
    });

    it('should handle query errors', () => {
      const store = useTabStateStore.getState();

      const result: QueryResult = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: 'Syntax error at line 1',
      };

      store.setQueryState('tab-1', {
        result,
        isExecuting: false,
      });

      const state = store.getQueryState('tab-1');
      expect(state?.result?.error).toBe('Syntax error at line 1');
    });

    it('should handle empty result set', () => {
      const store = useTabStateStore.getState();

      const result: QueryResult = {
        columns: ['id', 'name'],
        rows: [],
        rowCount: 0,
        executionTime: 25,
      };

      store.setQueryState('tab-1', { result });

      const state = store.getQueryState('tab-1');
      expect(state?.result?.rows).toEqual([]);
      expect(state?.result?.rowCount).toBe(0);
    });
  });

  describe('Multiple Tabs', () => {
    it('should manage state for multiple tabs independently', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', {
        query: 'SELECT * FROM users',
        isExecuting: false,
      });

      store.setQueryState('tab-2', {
        query: 'SELECT * FROM posts',
        isExecuting: true,
      });

      const state1 = store.getQueryState('tab-1');
      const state2 = store.getQueryState('tab-2');

      expect(state1?.query).toBe('SELECT * FROM users');
      expect(state1?.isExecuting).toBe(false);

      expect(state2?.query).toBe('SELECT * FROM posts');
      expect(state2?.isExecuting).toBe(true);
    });

    it('should not affect other tabs when updating one', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { query: 'SELECT 1' });
      store.setQueryState('tab-2', { query: 'SELECT 2' });
      store.setQueryState('tab-3', { query: 'SELECT 3' });

      store.setQueryState('tab-2', { isExecuting: true });

      expect(store.getQueryState('tab-1')?.isExecuting).toBe(false);
      expect(store.getQueryState('tab-2')?.isExecuting).toBe(true);
      expect(store.getQueryState('tab-3')?.isExecuting).toBe(false);
    });

    it('should handle many tabs', () => {
      const store = useTabStateStore.getState();

      for (let i = 0; i < 20; i++) {
        store.setQueryState(`tab-${i}`, {
          query: `SELECT ${i}`,
        });
      }

      expect(useTabStateStore.getState().queryStates.size).toBe(20);

      for (let i = 0; i < 20; i++) {
        const state = store.getQueryState(`tab-${i}`);
        expect(state?.query).toBe(`SELECT ${i}`);
      }
    });
  });

  describe('Clear Query State', () => {
    it('should clear query state for specific tab', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { query: 'SELECT 1' });
      store.setQueryState('tab-2', { query: 'SELECT 2' });

      store.clearQueryState('tab-1');

      expect(store.getQueryState('tab-1')).toBeUndefined();
      expect(store.getQueryState('tab-2')).toBeDefined();
    });

    it('should not error when clearing non-existent tab', () => {
      const store = useTabStateStore.getState();

      expect(() => {
        store.clearQueryState('non-existent');
      }).not.toThrow();
    });

    it('should remove tab from query states map', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', { query: 'SELECT 1' });
      expect(useTabStateStore.getState().queryStates.size).toBe(1);

      store.clearQueryState('tab-1');
      expect(useTabStateStore.getState().queryStates.size).toBe(0);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete query execution workflow', () => {
      const store = useTabStateStore.getState();

      // 1. User types query
      store.setQueryState('query-tab-1', {
        query: 'SELECT * FROM users WHERE active = true',
      });

      // 2. Start execution
      store.setQueryState('query-tab-1', {
        isExecuting: true,
      });

      expect(store.getQueryState('query-tab-1')?.isExecuting).toBe(true);

      // 3. Receive results
      const result: QueryResult = {
        columns: ['id', 'name', 'active'],
        rows: [[1, 'Alice', true], [2, 'Bob', true]],
        rowCount: 2,
        executionTime: 75,
      };

      store.setQueryState('query-tab-1', {
        result,
        isExecuting: false,
      });

      const finalState = store.getQueryState('query-tab-1');
      expect(finalState?.isExecuting).toBe(false);
      expect(finalState?.result).toEqual(result);
    });

    it('should handle streaming query workflow', () => {
      const store = useTabStateStore.getState();

      // Start streaming query
      store.setQueryState('stream-tab', {
        query: 'SELECT * FROM large_table',
        isExecuting: true,
        isStreaming: true,
      });

      // Partial results during streaming
      store.setQueryState('stream-tab', {
        result: {
          columns: ['id'],
          rows: [[1], [2], [3]],
          rowCount: 3,
        },
      });

      // Final result after streaming completes
      store.setQueryState('stream-tab', {
        result: {
          columns: ['id'],
          rows: [[1], [2], [3], [4], [5]],
          rowCount: 5,
          totalStreamingMs: 1500,
        },
        isExecuting: false,
        isStreaming: false,
      });

      const finalState = store.getQueryState('stream-tab');
      expect(finalState?.isExecuting).toBe(false);
      expect(finalState?.isStreaming).toBe(false);
      expect(finalState?.result?.rowCount).toBe(5);
    });

    it('should handle tab closure workflow', () => {
      const store = useTabStateStore.getState();

      // Create multiple tabs
      store.setQueryState('tab-1', { query: 'SELECT 1' });
      store.setQueryState('tab-2', { query: 'SELECT 2' });
      store.setQueryState('tab-3', { query: 'SELECT 3' });

      expect(useTabStateStore.getState().queryStates.size).toBe(3);

      // User closes tab-2
      store.clearQueryState('tab-2');

      expect(useTabStateStore.getState().queryStates.size).toBe(2);
      expect(store.getQueryState('tab-1')).toBeDefined();
      expect(store.getQueryState('tab-2')).toBeUndefined();
      expect(store.getQueryState('tab-3')).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long queries', () => {
      const store = useTabStateStore.getState();

      const longQuery = 'SELECT * FROM table WHERE ' + 'condition AND '.repeat(100) + 'final = true';

      store.setQueryState('tab-1', { query: longQuery });

      expect(store.getQueryState('tab-1')?.query).toBe(longQuery);
    });

    it('should handle large result sets', () => {
      const store = useTabStateStore.getState();

      const largeRows = Array.from({ length: 10000 }, (_, i) => [i, `row-${i}`]);

      const result: QueryResult = {
        columns: ['id', 'data'],
        rows: largeRows,
        rowCount: 10000,
      };

      store.setQueryState('tab-1', { result });

      const state = store.getQueryState('tab-1');
      expect(state?.result?.rowCount).toBe(10000);
    });

    it('should handle special characters in tab IDs', () => {
      const store = useTabStateStore.getState();

      const tabId = 'tab-with-special-chars-!@#$%^&*()';

      store.setQueryState(tabId, { query: 'SELECT 1' });

      expect(store.getQueryState(tabId)?.query).toBe('SELECT 1');
    });

    it('should handle null result', () => {
      const store = useTabStateStore.getState();

      store.setQueryState('tab-1', {
        query: 'SELECT 1',
        result: null,
      });

      expect(store.getQueryState('tab-1')?.result).toBe(null);
    });

    it('should handle rapid state updates', () => {
      const store = useTabStateStore.getState();

      for (let i = 0; i < 100; i++) {
        store.setQueryState('rapid-tab', {
          query: `SELECT ${i}`,
        });
      }

      expect(store.getQueryState('rapid-tab')?.query).toBe('SELECT 99');
    });
  });
});
