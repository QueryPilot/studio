import { describe, it, expect } from 'vitest';
import { tableDataQueryKey } from '../queryKeys';
import type { EmbeddedFKConfig } from '@/adapters/types';

describe('queryKeys', () => {
  describe('tableDataQueryKey', () => {
    it('should generate consistent key without embeddedFKs', () => {
      const key1 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'users',
      });

      const key2 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'users',
      });

      expect(key1).toEqual(key2);
    });

    it('should include null for embeddedFKs when not provided', () => {
      const key = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'users',
      });

      expect(key).toContain(null);
    });

    it('should serialize embeddedFKs to JSON when provided', () => {
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const key = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
        embeddedFKs,
      });

      expect(key).toContain(JSON.stringify(embeddedFKs));
    });

    it('should generate different keys for different embeddedFKs configs', () => {
      const embeddedFKs1: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const embeddedFKs2: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email', 'name'],
        },
      ];

      const key1 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
        embeddedFKs: embeddedFKs1,
      });

      const key2 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
        embeddedFKs: embeddedFKs2,
      });

      expect(key1).not.toEqual(key2);
    });

    it('should treat empty array embeddedFKs as null', () => {
      const keyWithEmpty = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
        embeddedFKs: [],
      });

      const keyWithUndefined = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
      });

      expect(keyWithEmpty).toEqual(keyWithUndefined);
    });

    it('should generate same key for identical embeddedFKs', () => {
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'category_id',
          refSchema: 'public',
          refTable: 'categories',
          refPkColumn: 'id',
          refDisplayColumns: ['name'],
        },
      ];

      const key1 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'products',
        embeddedFKs,
      });

      const key2 = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'products',
        embeddedFKs,
      });

      expect(key1).toEqual(key2);
    });

    it('should handle multiple embeddedFKs', () => {
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
        {
          fkColumn: 'category_id',
          refSchema: 'public',
          refTable: 'categories',
          refPkColumn: 'id',
          refDisplayColumns: ['name'],
        },
      ];

      const key = tableDataQueryKey({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        entityType: 'table',
        entityName: 'orders',
        embeddedFKs,
      });

      expect(key).toContain(JSON.stringify(embeddedFKs));
    });
  });
});
