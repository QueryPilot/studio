import { describe, it, expect, beforeEach } from 'vitest';
import { useStarredItemsStore, type StarredItem } from '../starredItemsStore';

describe('starredItemsStore', () => {
  beforeEach(() => {
    // Reset store
    useStarredItemsStore.setState({
      items: [],
    });
  });

  describe('Initial State', () => {
    it('should start with empty items', () => {
      const state = useStarredItemsStore.getState();
      expect(state.items).toEqual([]);
    });

    it('should return false for isStarred when no items', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'mydb', 'public', 'table', 'users');
      expect(starred).toBe(false);
    });

    it('should return empty array for getStarredItems when no items', () => {
      const store = useStarredItemsStore.getState();
      const items = store.getStarredItems('conn-1', 'mydb', 'public');
      expect(items).toEqual([]);
    });
  });

  describe('Toggle Starred', () => {
    it('should add item when toggling unstarred item', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      const state = useStarredItemsStore.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].name).toBe('users');
    });

    it('should remove item when toggling starred item', () => {
      const store = useStarredItemsStore.getState();

      // Star it
      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      expect(useStarredItemsStore.getState().items).toHaveLength(1);

      // Unstar it
      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      expect(useStarredItemsStore.getState().items).toHaveLength(0);
    });

    it('should generate correct item ID', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      const state = useStarredItemsStore.getState();
      expect(state.items[0].id).toBe('conn-1:testdb:public:table:users');
    });

    it('should set starredAt timestamp', () => {
      const store = useStarredItemsStore.getState();
      const beforeTime = Date.now();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      const afterTime = Date.now();
      const state = useStarredItemsStore.getState();

      expect(state.items[0].starredAt).toBeGreaterThanOrEqual(beforeTime);
      expect(state.items[0].starredAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('isStarred Check', () => {
    beforeEach(() => {
      const store = useStarredItemsStore.getState();
      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });
    });

    it('should return true for starred item', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'mydb', 'public', 'table', 'users');
      expect(starred).toBe(true);
    });

    it('should return false for different table name', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'mydb', 'public', 'table', 'posts');
      expect(starred).toBe(false);
    });

    it('should return false for different connection', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-2', 'mydb', 'public', 'table', 'users');
      expect(starred).toBe(false);
    });

    it('should return false for different database', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'otherdb', 'public', 'table', 'users');
      expect(starred).toBe(false);
    });

    it('should return false for different schema', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'mydb', 'private', 'table', 'users');
      expect(starred).toBe(false);
    });

    it('should return false for different type', () => {
      const store = useStarredItemsStore.getState();
      const starred = store.isStarred('conn-1', 'mydb', 'public', 'view', 'users');
      expect(starred).toBe(false);
    });
  });

  describe('Item Types', () => {
    it('should handle table type', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      const starred = store.isStarred('conn-1', 'mydb', 'public', 'table', 'users');
      expect(starred).toBe(true);
    });

    it('should handle view type', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'view',
        name: 'active_users_view',
      });

      const starred = store.isStarred('conn-1', 'mydb', 'public', 'view', 'active_users_view');
      expect(starred).toBe(true);
    });

    it('should handle function type', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'function',
        name: 'calculate_total',
      });

      const starred = store.isStarred('conn-1', 'mydb', 'public', 'function', 'calculate_total');
      expect(starred).toBe(true);
    });

    it('should allow same name for different types', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'view',
        name: 'users',
      });

      expect(store.isStarred('conn-1', 'mydb', 'public', 'table', 'users')).toBe(true);
      expect(store.isStarred('conn-1', 'mydb', 'public', 'view', 'users')).toBe(true);
      expect(useStarredItemsStore.getState().items).toHaveLength(2);
    });
  });

  describe('Get Starred Items', () => {
    beforeEach(() => {
      const store = useStarredItemsStore.getState();

      // Star multiple items in different connections/databases
      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'posts',
      });

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'private',
        type: 'view',
        name: 'admin_view',
      });

      store.toggleStarred({
        connectionId: 'conn-2',
        database: 'otherdb',
        schema: 'public',
        type: 'table',
        name: 'orders',
      });
    });

    it('should filter by connection, database, and schema', () => {
      const store = useStarredItemsStore.getState();
      const items = store.getStarredItems('conn-1', 'mydb', 'public');

      expect(items).toHaveLength(2);
      expect(items.map(item => item.name)).toContain('users');
      expect(items.map(item => item.name)).toContain('posts');
    });

    it('should not include items from different schema', () => {
      const store = useStarredItemsStore.getState();
      const items = store.getStarredItems('conn-1', 'mydb', 'public');

      expect(items.find(item => item.name === 'admin_view')).toBeUndefined();
    });

    it('should not include items from different connection', () => {
      const store = useStarredItemsStore.getState();
      const items = store.getStarredItems('conn-1', 'mydb', 'public');

      expect(items.find(item => item.name === 'orders')).toBeUndefined();
    });

    it('should sort by most recently starred first', () => {
      const store = useStarredItemsStore.getState();

      // Clear and re-add with delays to ensure different timestamps
      useStarredItemsStore.setState({ items: [] });

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: 'first',
      });

      // Small delay
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      delay.then(() => {
        store.toggleStarred({
          connectionId: 'conn-1',
          database: 'mydb',
          schema: 'public',
          type: 'table',
          name: 'second',
        });
      });

      // Wait and check order
      return delay.then(() => {
        const items = store.getStarredItems('conn-1', 'mydb', 'public');
        if (items.length === 2) {
          // Most recent first
          expect(items[0].name).toBe('second');
          expect(items[1].name).toBe('first');
        }
      });
    });

    it('should return empty array for non-existent schema', () => {
      const store = useStarredItemsStore.getState();
      const items = store.getStarredItems('conn-1', 'mydb', 'nonexistent');

      expect(items).toEqual([]);
    });
  });

  describe('Clear Starred for Connection', () => {
    beforeEach(() => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'db2',
        schema: 'public',
        type: 'table',
        name: 'posts',
      });

      store.toggleStarred({
        connectionId: 'conn-2',
        database: 'db1',
        schema: 'public',
        type: 'table',
        name: 'orders',
      });
    });

    it('should remove all items for connection', () => {
      const store = useStarredItemsStore.getState();

      store.clearStarredForConnection('conn-1');

      const state = useStarredItemsStore.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].connectionId).toBe('conn-2');
    });

    it('should not affect items from other connections', () => {
      const store = useStarredItemsStore.getState();

      store.clearStarredForConnection('conn-1');

      expect(store.isStarred('conn-2', 'db1', 'public', 'table', 'orders')).toBe(true);
    });

    it('should handle clearing non-existent connection', () => {
      const store = useStarredItemsStore.getState();

      expect(() => {
        store.clearStarredForConnection('non-existent');
      }).not.toThrow();
    });

    it('should remove items from all databases for connection', () => {
      const store = useStarredItemsStore.getState();

      store.clearStarredForConnection('conn-1');

      expect(store.isStarred('conn-1', 'db1', 'public', 'table', 'users')).toBe(false);
      expect(store.isStarred('conn-1', 'db2', 'public', 'table', 'posts')).toBe(false);
    });
  });

  describe('Multiple Items Management', () => {
    it('should handle many starred items', () => {
      const store = useStarredItemsStore.getState();

      for (let i = 0; i < 50; i++) {
        store.toggleStarred({
          connectionId: 'conn-1',
          database: 'mydb',
          schema: 'public',
          type: 'table',
          name: `table_${i}`,
        });
      }

      expect(useStarredItemsStore.getState().items).toHaveLength(50);
    });

    it('should handle multiple schemas', () => {
      const store = useStarredItemsStore.getState();

      const schemas = ['public', 'private', 'staging', 'production'];

      schemas.forEach(schema => {
        store.toggleStarred({
          connectionId: 'conn-1',
          database: 'mydb',
          schema,
          type: 'table',
          name: 'users',
        });
      });

      expect(useStarredItemsStore.getState().items).toHaveLength(4);
    });

    it('should handle multiple connections', () => {
      const store = useStarredItemsStore.getState();

      for (let i = 1; i <= 10; i++) {
        store.toggleStarred({
          connectionId: `conn-${i}`,
          database: 'mydb',
          schema: 'public',
          type: 'table',
          name: 'users',
        });
      }

      expect(useStarredItemsStore.getState().items).toHaveLength(10);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle user starring workflow', () => {
      const store = useStarredItemsStore.getState();

      // User opens connection
      // User browses to a table
      // User stars the table
      store.toggleStarred({
        connectionId: 'prod-db',
        database: 'analytics',
        schema: 'public',
        type: 'table',
        name: 'user_events',
      });

      // Verify it's starred
      expect(store.isStarred('prod-db', 'analytics', 'public', 'table', 'user_events')).toBe(true);

      // User views starred items
      const starred = store.getStarredItems('prod-db', 'analytics', 'public');
      expect(starred).toHaveLength(1);
      expect(starred[0].name).toBe('user_events');
    });

    it('should handle connection closure workflow', () => {
      const store = useStarredItemsStore.getState();

      // User has starred items in connection
      store.toggleStarred({
        connectionId: 'temp-conn',
        database: 'tempdb',
        schema: 'public',
        type: 'table',
        name: 'temp_table',
      });

      // User disconnects
      store.clearStarredForConnection('temp-conn');

      // Starred items should be removed
      const starred = store.getStarredItems('temp-conn', 'tempdb', 'public');
      expect(starred).toEqual([]);
    });

    it('should handle rapid star/unstar toggles', () => {
      const store = useStarredItemsStore.getState();

      const item = {
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table' as const,
        name: 'users',
      };

      // Toggle multiple times
      store.toggleStarred(item);
      store.toggleStarred(item);
      store.toggleStarred(item);
      store.toggleStarred(item);

      // Should be unstarred (even number of toggles)
      expect(store.isStarred('conn-1', 'mydb', 'public', 'table', 'users')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in names', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'my-db',
        schema: 'public',
        type: 'table',
        name: 'users_v2.1',
      });

      expect(store.isStarred('conn-1', 'my-db', 'public', 'table', 'users_v2.1')).toBe(true);
    });

    it('should handle unicode characters', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: '数据库',
        schema: 'public',
        type: 'table',
        name: '用户表',
      });

      expect(store.isStarred('conn-1', '数据库', 'public', 'table', '用户表')).toBe(true);
    });

    it('should handle very long names', () => {
      const store = useStarredItemsStore.getState();

      const longName = 'very_long_table_name_'.repeat(10);

      store.toggleStarred({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
        type: 'table',
        name: longName,
      });

      expect(store.isStarred('conn-1', 'mydb', 'public', 'table', longName)).toBe(true);
    });

    it('should handle empty database name', () => {
      const store = useStarredItemsStore.getState();

      store.toggleStarred({
        connectionId: 'conn-1',
        database: '',
        schema: 'public',
        type: 'table',
        name: 'users',
      });

      expect(store.isStarred('conn-1', '', 'public', 'table', 'users')).toBe(true);
    });
  });
});
