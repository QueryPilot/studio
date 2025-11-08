import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceSelectionStore } from '../workspaceSelectionStore';

describe('workspaceSelectionStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useWorkspaceSelectionStore.setState({
      connectionId: null,
      database: null,
      schema: null,
    });
  });

  describe('Initial State', () => {
    it('should start with null values', () => {
      const state = useWorkspaceSelectionStore.getState();

      expect(state.connectionId).toBe(null);
      expect(state.database).toBe(null);
      expect(state.schema).toBe(null);
    });
  });

  describe('Connection Management', () => {
    it('should set active connection', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-123');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-123');
    });

    it('should clear active connection when set to null', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-123');
      store.setActiveConnection(null);

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe(null);
    });

    it('should handle connection switching', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-1');
      expect(useWorkspaceSelectionStore.getState().connectionId).toBe('conn-1');

      store.setActiveConnection('conn-2');
      expect(useWorkspaceSelectionStore.getState().connectionId).toBe('conn-2');
    });

    it('should handle UUID connection IDs', () => {
      const store = useWorkspaceSelectionStore.getState();
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      store.setActiveConnection(uuid);

      expect(useWorkspaceSelectionStore.getState().connectionId).toBe(uuid);
    });

    it('should handle special characters in connection ID', () => {
      const store = useWorkspaceSelectionStore.getState();
      const connId = 'conn-with-special-chars-!@#$%';

      store.setActiveConnection(connId);

      expect(useWorkspaceSelectionStore.getState().connectionId).toBe(connId);
    });
  });

  describe('Database Selection', () => {
    it('should set selected database', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('production');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.database).toBe('production');
    });

    it('should update database selection', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('dev');
      store.setSelectedDatabase('staging');

      expect(useWorkspaceSelectionStore.getState().database).toBe('staging');
    });

    it('should handle database names with spaces', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('My Database Name');

      expect(useWorkspaceSelectionStore.getState().database).toBe('My Database Name');
    });

    it('should handle database names with special characters', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('db-2025_prod.backup');

      expect(useWorkspaceSelectionStore.getState().database).toBe('db-2025_prod.backup');
    });

    it('should handle unicode database names', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('数据库');

      expect(useWorkspaceSelectionStore.getState().database).toBe('数据库');
    });
  });

  describe('Schema Selection', () => {
    it('should set schema', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSchema('public');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.schema).toBe('public');
    });

    it('should update schema selection', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSchema('auth');
      store.setSchema('api');

      expect(useWorkspaceSelectionStore.getState().schema).toBe('api');
    });

    it('should handle common PostgreSQL schemas', () => {
      const store = useWorkspaceSelectionStore.getState();
      const schemas = ['public', 'information_schema', 'pg_catalog', 'auth', 'extensions'];

      schemas.forEach(schema => {
        store.setSchema(schema);
        expect(useWorkspaceSelectionStore.getState().schema).toBe(schema);
      });
    });

    it('should handle schema names with underscores', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSchema('my_custom_schema');

      expect(useWorkspaceSelectionStore.getState().schema).toBe('my_custom_schema');
    });

    it('should handle quoted schema names', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSchema('"special-schema"');

      expect(useWorkspaceSelectionStore.getState().schema).toBe('"special-schema"');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete workspace navigation flow', () => {
      const store = useWorkspaceSelectionStore.getState();

      // User connects to database
      store.setActiveConnection('conn-prod-1');
      expect(useWorkspaceSelectionStore.getState().connectionId).toBe('conn-prod-1');

      // User selects database
      store.setSelectedDatabase('sales_db');
      expect(useWorkspaceSelectionStore.getState().database).toBe('sales_db');

      // User selects schema
      store.setSchema('public');
      expect(useWorkspaceSelectionStore.getState().schema).toBe('public');

      // Verify all selections are preserved
      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-prod-1');
      expect(state.database).toBe('sales_db');
      expect(state.schema).toBe('public');
    });

    it('should handle switching between multiple workspaces', () => {
      const store = useWorkspaceSelectionStore.getState();

      // First workspace
      store.setActiveConnection('conn-1');
      store.setSelectedDatabase('db1');
      store.setSchema('schema1');

      let state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-1');
      expect(state.database).toBe('db1');
      expect(state.schema).toBe('schema1');

      // Switch to second workspace
      store.setActiveConnection('conn-2');
      store.setSelectedDatabase('db2');
      store.setSchema('schema2');

      state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-2');
      expect(state.database).toBe('db2');
      expect(state.schema).toBe('schema2');
    });

    it('should handle disconnection workflow', () => {
      const store = useWorkspaceSelectionStore.getState();

      // Setup workspace
      store.setActiveConnection('conn-1');
      store.setSelectedDatabase('mydb');
      store.setSchema('public');

      // Disconnect
      store.setActiveConnection(null);

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe(null);
      // Note: database and schema persist after disconnect
      expect(state.database).toBe('mydb');
      expect(state.schema).toBe('public');
    });

    it('should handle schema navigation within same database', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-1');
      store.setSelectedDatabase('analytics');

      // Navigate through schemas
      const schemas = ['public', 'staging', 'production', 'archive'];
      schemas.forEach(schema => {
        store.setSchema(schema);
        const state = useWorkspaceSelectionStore.getState();
        expect(state.schema).toBe(schema);
        expect(state.database).toBe('analytics'); // Database remains constant
        expect(state.connectionId).toBe('conn-1'); // Connection remains constant
      });
    });

    it('should handle database switching within same connection', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('postgres-main');

      const databases = ['dev_db', 'staging_db', 'prod_db'];
      databases.forEach(db => {
        store.setSelectedDatabase(db);
        const state = useWorkspaceSelectionStore.getState();
        expect(state.database).toBe(db);
        expect(state.connectionId).toBe('postgres-main'); // Connection remains constant
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string as connection ID', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('');

      // Empty string is preserved (not converted to null)
      expect(useWorkspaceSelectionStore.getState().connectionId).toBe('');
    });

    it('should handle very long connection IDs', () => {
      const store = useWorkspaceSelectionStore.getState();
      const longId = 'conn-' + 'a'.repeat(500);

      store.setActiveConnection(longId);

      expect(useWorkspaceSelectionStore.getState().connectionId).toBe(longId);
    });

    it('should handle very long database names', () => {
      const store = useWorkspaceSelectionStore.getState();
      const longName = 'database_' + 'x'.repeat(200);

      store.setSelectedDatabase(longName);

      expect(useWorkspaceSelectionStore.getState().database).toBe(longName);
    });

    it('should handle very long schema names', () => {
      const store = useWorkspaceSelectionStore.getState();
      const longName = 'schema_' + 'y'.repeat(150);

      store.setSchema(longName);

      expect(useWorkspaceSelectionStore.getState().schema).toBe(longName);
    });

    it('should handle rapid selection changes', () => {
      const store = useWorkspaceSelectionStore.getState();

      // Rapid connection changes
      for (let i = 0; i < 100; i++) {
        store.setActiveConnection(`conn-${i}`);
      }

      expect(useWorkspaceSelectionStore.getState().connectionId).toBe('conn-99');
    });

    it('should handle rapid database changes', () => {
      const store = useWorkspaceSelectionStore.getState();

      for (let i = 0; i < 50; i++) {
        store.setSelectedDatabase(`db_${i}`);
      }

      expect(useWorkspaceSelectionStore.getState().database).toBe('db_49');
    });

    it('should handle mixed operations in rapid succession', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-1');
      store.setSelectedDatabase('db1');
      store.setSchema('schema1');
      store.setActiveConnection('conn-2');
      store.setSchema('schema2');
      store.setSelectedDatabase('db2');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-2');
      expect(state.database).toBe('db2');
      expect(state.schema).toBe('schema2');
    });
  });

  describe('State Independence', () => {
    it('should not affect other state when updating connection', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setSelectedDatabase('mydb');
      store.setSchema('myschema');

      store.setActiveConnection('new-conn');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.database).toBe('mydb');
      expect(state.schema).toBe('myschema');
    });

    it('should not affect other state when updating database', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-1');
      store.setSchema('schema1');

      store.setSelectedDatabase('newdb');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-1');
      expect(state.schema).toBe('schema1');
    });

    it('should not affect other state when updating schema', () => {
      const store = useWorkspaceSelectionStore.getState();

      store.setActiveConnection('conn-1');
      store.setSelectedDatabase('db1');

      store.setSchema('newschema');

      const state = useWorkspaceSelectionStore.getState();
      expect(state.connectionId).toBe('conn-1');
      expect(state.database).toBe('db1');
    });
  });
});
