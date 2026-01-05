import { describe, it, expect, beforeEach } from 'vitest';
import { useEmbeddedFKPreferencesStore } from '../embeddedFKPreferencesStore';

describe('embeddedFKPreferencesStore', () => {
  beforeEach(() => {
    useEmbeddedFKPreferencesStore.setState({ preferences: {} });
  });

  describe('Initial State', () => {
    it('should start with empty preferences', () => {
      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences).toEqual({});
    });

    it('should return empty array for getEmbeddedColumns when no preferences exist', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const columns = store.getEmbeddedColumns('conn-1:public.users', 'category_id');
      expect(columns).toEqual([]);
    });
  });

  describe('setEmbeddedColumns', () => {
    it('should add embedded columns for a new FK column', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toEqual(['email']);
    });

    it('should update existing embedded columns for an FK column', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);
      store.setEmbeddedColumns(key, 'user_id', ['name', 'email']);

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toEqual(['name', 'email']);
    });

    it('should handle multiple FK columns for same table', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);
      store.setEmbeddedColumns(key, 'category_id', ['name']);

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toEqual(['email']);
      expect(state.preferences[key]?.embeddedColumns['category_id']).toEqual(['name']);
    });

    it('should handle multiple tables independently', () => {
      const store = useEmbeddedFKPreferencesStore.getState();

      store.setEmbeddedColumns('conn-1:public.orders', 'user_id', ['email']);
      store.setEmbeddedColumns('conn-1:public.products', 'category_id', ['name']);

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences['conn-1:public.orders']?.embeddedColumns['user_id']).toEqual(['email']);
      expect(state.preferences['conn-1:public.products']?.embeddedColumns['category_id']).toEqual(['name']);
    });
  });

  describe('clearEmbeddedColumn', () => {
    it('should remove FK column preference', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);
      store.clearEmbeddedColumn(key, 'user_id');

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toBeUndefined();
    });

    it('should not affect other FK columns when clearing one', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);
      store.setEmbeddedColumns(key, 'category_id', ['name']);
      store.clearEmbeddedColumn(key, 'user_id');

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toBeUndefined();
      expect(state.preferences[key]?.embeddedColumns['category_id']).toEqual(['name']);
    });

    it('should handle clearing non-existent FK column gracefully', () => {
      const store = useEmbeddedFKPreferencesStore.getState();

      expect(() => {
        store.clearEmbeddedColumn('conn-1:public.orders', 'nonexistent_id');
      }).not.toThrow();
    });

    it('should handle clearing from non-existent table gracefully', () => {
      const store = useEmbeddedFKPreferencesStore.getState();

      expect(() => {
        store.clearEmbeddedColumn('conn-1:public.nonexistent', 'user_id');
      }).not.toThrow();
    });
  });

  describe('getEmbeddedColumns', () => {
    it('should return embedded columns for existing FK column', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email', 'name']);

      const columns = store.getEmbeddedColumns(key, 'user_id');
      expect(columns).toEqual(['email', 'name']);
    });

    it('should return empty array for missing table key', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const columns = store.getEmbeddedColumns('conn-1:public.nonexistent', 'user_id');
      expect(columns).toEqual([]);
    });

    it('should return empty array for missing FK column', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);

      const columns = store.getEmbeddedColumns(key, 'nonexistent_id');
      expect(columns).toEqual([]);
    });
  });

  describe('Key Format Handling', () => {
    it('should handle standard key format connectionId:schema.table', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'abc-123:public.orders';

      store.setEmbeddedColumns(key, 'user_id', ['email']);
      const columns = store.getEmbeddedColumns(key, 'user_id');

      expect(columns).toEqual(['email']);
    });

    it('should handle keys with special characters in schema/table names', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:my_schema.order_items';

      store.setEmbeddedColumns(key, 'product_id', ['name']);
      const columns = store.getEmbeddedColumns(key, 'product_id');

      expect(columns).toEqual(['name']);
    });

    it('should handle keys with dots in database identifiers', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn.with.dots:schema.table';

      store.setEmbeddedColumns(key, 'fk_id', ['col']);
      const columns = store.getEmbeddedColumns(key, 'fk_id');

      expect(columns).toEqual(['col']);
    });

    it('should treat keys with different connections as separate', () => {
      const store = useEmbeddedFKPreferencesStore.getState();

      store.setEmbeddedColumns('conn-1:public.orders', 'user_id', ['email']);
      store.setEmbeddedColumns('conn-2:public.orders', 'user_id', ['name']);

      expect(store.getEmbeddedColumns('conn-1:public.orders', 'user_id')).toEqual(['email']);
      expect(store.getEmbeddedColumns('conn-2:public.orders', 'user_id')).toEqual(['name']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty refColumns array', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';

      store.setEmbeddedColumns(key, 'user_id', []);

      const state = useEmbeddedFKPreferencesStore.getState();
      expect(state.preferences[key]?.embeddedColumns['user_id']).toEqual([]);
    });

    it('should handle many embedded columns', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.orders';
      const columns = ['col1', 'col2', 'col3', 'col4', 'col5'];

      store.setEmbeddedColumns(key, 'user_id', columns);

      const result = store.getEmbeddedColumns(key, 'user_id');
      expect(result).toEqual(columns);
    });

    it('should handle unicode in FK column names', () => {
      const store = useEmbeddedFKPreferencesStore.getState();
      const key = 'conn-1:public.订单';

      store.setEmbeddedColumns(key, '用户_id', ['邮箱']);
      const columns = store.getEmbeddedColumns(key, '用户_id');

      expect(columns).toEqual(['邮箱']);
    });
  });
});
