import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    // Reset to initial state
    useUIStore.setState({
      selectedRowCount: 0,
      totalRowCount: 0,
      estimatedRowCount: null,
      isLoadingData: false,
      currentTableName: null,
      selectedSchema: 'public',
      availableSchemas: [],
      queryTime: null,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useUIStore.getState();

      expect(state.selectedRowCount).toBe(0);
      expect(state.totalRowCount).toBe(0);
      expect(state.estimatedRowCount).toBe(null);
      expect(state.isLoadingData).toBe(false);
      expect(state.currentTableName).toBe(null);
      expect(state.selectedSchema).toBe('public');
      expect(state.availableSchemas).toEqual([]);
      expect(state.queryTime).toBe(null);
    });
  });

  describe('Row Count Management', () => {
    it('should set selected row count', () => {
      const store = useUIStore.getState();

      store.setSelectedRowCount(5);
      expect(useUIStore.getState().selectedRowCount).toBe(5);
    });

    it('should set total row count', () => {
      const store = useUIStore.getState();

      store.setTotalRowCount(1000);
      expect(useUIStore.getState().totalRowCount).toBe(1000);
    });

    it('should handle zero selected rows', () => {
      const store = useUIStore.getState();

      store.setSelectedRowCount(10);
      store.setSelectedRowCount(0);

      expect(useUIStore.getState().selectedRowCount).toBe(0);
    });

    it('should handle large row counts', () => {
      const store = useUIStore.getState();

      store.setTotalRowCount(1000000);
      expect(useUIStore.getState().totalRowCount).toBe(1000000);
    });

    it('should update selected count multiple times', () => {
      const store = useUIStore.getState();

      store.setSelectedRowCount(5);
      expect(useUIStore.getState().selectedRowCount).toBe(5);

      store.setSelectedRowCount(10);
      expect(useUIStore.getState().selectedRowCount).toBe(10);

      store.setSelectedRowCount(3);
      expect(useUIStore.getState().selectedRowCount).toBe(3);
    });

    it('should track selection vs total independently', () => {
      const store = useUIStore.getState();

      store.setTotalRowCount(100);
      store.setSelectedRowCount(25);

      const state = useUIStore.getState();
      expect(state.totalRowCount).toBe(100);
      expect(state.selectedRowCount).toBe(25);
    });
  });

  describe('Estimated Row Count', () => {
    it('should set estimated row count', () => {
      const store = useUIStore.getState();

      store.setEstimatedRowCount(5000);
      expect(useUIStore.getState().estimatedRowCount).toBe(5000);
    });

    it('should clear estimated row count', () => {
      const store = useUIStore.getState();

      store.setEstimatedRowCount(5000);
      store.setEstimatedRowCount(null);

      expect(useUIStore.getState().estimatedRowCount).toBe(null);
    });

    it('should handle estimate vs actual counts', () => {
      const store = useUIStore.getState();

      store.setEstimatedRowCount(5000);
      store.setTotalRowCount(5127);

      const state = useUIStore.getState();
      expect(state.estimatedRowCount).toBe(5000);
      expect(state.totalRowCount).toBe(5127);
    });
  });

  describe('Loading State', () => {
    it('should set loading state', () => {
      const store = useUIStore.getState();

      store.setIsLoadingData(true);
      expect(useUIStore.getState().isLoadingData).toBe(true);
    });

    it('should clear loading state', () => {
      const store = useUIStore.getState();

      store.setIsLoadingData(true);
      store.setIsLoadingData(false);

      expect(useUIStore.getState().isLoadingData).toBe(false);
    });

    it('should toggle loading state', () => {
      const store = useUIStore.getState();

      store.setIsLoadingData(true);
      expect(useUIStore.getState().isLoadingData).toBe(true);

      store.setIsLoadingData(false);
      expect(useUIStore.getState().isLoadingData).toBe(false);

      store.setIsLoadingData(true);
      expect(useUIStore.getState().isLoadingData).toBe(true);
    });
  });

  describe('Table Name Management', () => {
    it('should set current table name', () => {
      const store = useUIStore.getState();

      store.setCurrentTableName('users');
      expect(useUIStore.getState().currentTableName).toBe('users');
    });

    it('should change table name', () => {
      const store = useUIStore.getState();

      store.setCurrentTableName('users');
      store.setCurrentTableName('posts');

      expect(useUIStore.getState().currentTableName).toBe('posts');
    });

    it('should clear table name', () => {
      const store = useUIStore.getState();

      store.setCurrentTableName('users');
      store.setCurrentTableName(null);

      expect(useUIStore.getState().currentTableName).toBe(null);
    });

    it('should handle table names with special characters', () => {
      const store = useUIStore.getState();

      store.setCurrentTableName('user_profiles_v2');
      expect(useUIStore.getState().currentTableName).toBe('user_profiles_v2');
    });
  });

  describe('Schema Management', () => {
    it('should set selected schema', () => {
      const store = useUIStore.getState();

      store.setSelectedSchema('private');
      expect(useUIStore.getState().selectedSchema).toBe('private');
    });

    it('should change schema multiple times', () => {
      const store = useUIStore.getState();

      store.setSelectedSchema('staging');
      expect(useUIStore.getState().selectedSchema).toBe('staging');

      store.setSelectedSchema('production');
      expect(useUIStore.getState().selectedSchema).toBe('production');
    });

    it('should set available schemas', () => {
      const store = useUIStore.getState();

      const schemas = ['public', 'private', 'staging'];
      store.setAvailableSchemas(schemas);

      expect(useUIStore.getState().availableSchemas).toEqual(schemas);
    });

    it('should replace available schemas', () => {
      const store = useUIStore.getState();

      store.setAvailableSchemas(['public', 'private']);
      store.setAvailableSchemas(['public', 'staging', 'production']);

      expect(useUIStore.getState().availableSchemas).toEqual([
        'public',
        'staging',
        'production',
      ]);
    });

    it('should handle empty schemas list', () => {
      const store = useUIStore.getState();

      store.setAvailableSchemas(['public', 'private']);
      store.setAvailableSchemas([]);

      expect(useUIStore.getState().availableSchemas).toEqual([]);
    });

    it('should handle many schemas', () => {
      const store = useUIStore.getState();

      const schemas = Array.from({ length: 20 }, (_, i) => `schema_${i}`);
      store.setAvailableSchemas(schemas);

      expect(useUIStore.getState().availableSchemas).toHaveLength(20);
    });
  });

  describe('Query Time Tracking', () => {
    it('should set query time', () => {
      const store = useUIStore.getState();

      store.setQueryTime(125);
      expect(useUIStore.getState().queryTime).toBe(125);
    });

    it('should update query time', () => {
      const store = useUIStore.getState();

      store.setQueryTime(100);
      store.setQueryTime(250);

      expect(useUIStore.getState().queryTime).toBe(250);
    });

    it('should clear query time', () => {
      const store = useUIStore.getState();

      store.setQueryTime(125);
      store.setQueryTime(null);

      expect(useUIStore.getState().queryTime).toBe(null);
    });

    it('should handle very fast queries', () => {
      const store = useUIStore.getState();

      store.setQueryTime(5);
      expect(useUIStore.getState().queryTime).toBe(5);
    });

    it('should handle slow queries', () => {
      const store = useUIStore.getState();

      store.setQueryTime(5000);
      expect(useUIStore.getState().queryTime).toBe(5000);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle table data loading workflow', () => {
      const store = useUIStore.getState();

      // Start loading
      store.setIsLoadingData(true);
      store.setCurrentTableName('users');
      store.setEstimatedRowCount(5000);

      expect(useUIStore.getState().isLoadingData).toBe(true);

      // Data loaded
      store.setTotalRowCount(5127);
      store.setIsLoadingData(false);
      store.setQueryTime(250);

      const state = useUIStore.getState();
      expect(state.isLoadingData).toBe(false);
      expect(state.currentTableName).toBe('users');
      expect(state.estimatedRowCount).toBe(5000);
      expect(state.totalRowCount).toBe(5127);
      expect(state.queryTime).toBe(250);
    });

    it('should handle row selection workflow', () => {
      const store = useUIStore.getState();

      // Load data
      store.setTotalRowCount(100);
      store.setSelectedRowCount(0);

      // Select some rows
      store.setSelectedRowCount(5);
      expect(useUIStore.getState().selectedRowCount).toBe(5);

      // Select more
      store.setSelectedRowCount(10);
      expect(useUIStore.getState().selectedRowCount).toBe(10);

      // Clear selection
      store.setSelectedRowCount(0);
      expect(useUIStore.getState().selectedRowCount).toBe(0);
    });

    it('should handle schema switching workflow', () => {
      const store = useUIStore.getState();

      // Set available schemas
      store.setAvailableSchemas(['public', 'private', 'staging']);

      // Switch to different schema
      store.setSelectedSchema('private');
      store.setCurrentTableName(null); // Clear current table
      store.setTotalRowCount(0);
      store.setSelectedRowCount(0);

      const state = useUIStore.getState();
      expect(state.selectedSchema).toBe('private');
      expect(state.currentTableName).toBe(null);
      expect(state.totalRowCount).toBe(0);
    });

    it('should handle table switching', () => {
      const store = useUIStore.getState();

      // Current table state
      store.setCurrentTableName('users');
      store.setTotalRowCount(1000);
      store.setSelectedRowCount(10);

      // Switch to different table
      store.setCurrentTableName('posts');
      store.setTotalRowCount(5000);
      store.setSelectedRowCount(0);

      const state = useUIStore.getState();
      expect(state.currentTableName).toBe('posts');
      expect(state.totalRowCount).toBe(5000);
      expect(state.selectedRowCount).toBe(0);
    });

    it('should handle query execution lifecycle', () => {
      const store = useUIStore.getState();

      // Before query
      store.setIsLoadingData(false);
      store.setQueryTime(null);

      // Query starts
      store.setIsLoadingData(true);

      // Query completes
      store.setIsLoadingData(false);
      store.setQueryTime(175);
      store.setTotalRowCount(250);

      const state = useUIStore.getState();
      expect(state.isLoadingData).toBe(false);
      expect(state.queryTime).toBe(175);
      expect(state.totalRowCount).toBe(250);
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative row counts', () => {
      const store = useUIStore.getState();

      store.setTotalRowCount(-1);
      expect(useUIStore.getState().totalRowCount).toBe(-1);
    });

    it('should handle zero query time', () => {
      const store = useUIStore.getState();

      store.setQueryTime(0);
      expect(useUIStore.getState().queryTime).toBe(0);
    });

    it('should handle empty table name', () => {
      const store = useUIStore.getState();

      store.setCurrentTableName('');
      expect(useUIStore.getState().currentTableName).toBe('');
    });

    it('should handle empty schema name', () => {
      const store = useUIStore.getState();

      store.setSelectedSchema('');
      expect(useUIStore.getState().selectedSchema).toBe('');
    });

    it('should maintain state during rapid updates', () => {
      const store = useUIStore.getState();

      for (let i = 0; i < 100; i++) {
        store.setSelectedRowCount(i);
      }

      expect(useUIStore.getState().selectedRowCount).toBe(99);
    });
  });
});
