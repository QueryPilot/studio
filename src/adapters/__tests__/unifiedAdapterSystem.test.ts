import { describe, it, expect, vi } from 'vitest';
import { DbType, getParadigm } from '@/types/connection';
import type { BaseAdapter } from '../types';
import { isSqlAdapter, isDocumentAdapter, isKeyValueAdapter } from '../types';

// Mock the invoke module
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock queryStreamClient
vi.mock('@/services/queryStreamClient', () => ({
  queryStreamClient: {
    streamWithCallbacks: vi.fn(),
  },
}));

// Mock connection store
vi.mock('@/stores/connectionStoreNew', () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [],
    }),
  },
}));

describe('Unified Adapter System', () => {
  describe('Type Guards', () => {
    it('isSqlAdapter returns true for sql paradigm', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.PostgreSQL,
        paradigm: 'sql',
      };
      expect(isSqlAdapter(adapter)).toBe(true);
    });

    it('isSqlAdapter returns false for document paradigm', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.MongoDB,
        paradigm: 'document',
      };
      expect(isSqlAdapter(adapter)).toBe(false);
    });

    it('isSqlAdapter returns false for keyvalue paradigm', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.Redis,
        paradigm: 'keyvalue',
      };
      expect(isSqlAdapter(adapter)).toBe(false);
    });

    it('isDocumentAdapter returns true for MongoDB', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.MongoDB,
        paradigm: 'document',
      };
      expect(isDocumentAdapter(adapter)).toBe(true);
    });

    it('isDocumentAdapter returns false for PostgreSQL', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.PostgreSQL,
        paradigm: 'sql',
      };
      expect(isDocumentAdapter(adapter)).toBe(false);
    });

    it('isKeyValueAdapter returns true for Redis', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.Redis,
        paradigm: 'keyvalue',
      };
      expect(isKeyValueAdapter(adapter)).toBe(true);
    });

    it('isKeyValueAdapter returns false for MongoDB', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-conn',
        dbType: DbType.MongoDB,
        paradigm: 'document',
      };
      expect(isKeyValueAdapter(adapter)).toBe(false);
    });
  });

  describe('Paradigm Mapping', () => {
    it('PostgreSQL maps to sql paradigm', () => {
      expect(getParadigm(DbType.PostgreSQL)).toBe('sql');
    });

    it('MySQL maps to sql paradigm', () => {
      expect(getParadigm(DbType.MySQL)).toBe('sql');
    });

    it('MariaDB maps to sql paradigm', () => {
      expect(getParadigm(DbType.MariaDB)).toBe('sql');
    });

    it('SQLite maps to sql paradigm', () => {
      expect(getParadigm(DbType.SQLite)).toBe('sql');
    });

    it('SQLServer maps to sql paradigm', () => {
      expect(getParadigm(DbType.SQLServer)).toBe('sql');
    });

    it('Oracle maps to sql paradigm', () => {
      expect(getParadigm(DbType.Oracle)).toBe('sql');
    });

    it('MongoDB maps to document paradigm', () => {
      expect(getParadigm(DbType.MongoDB)).toBe('document');
    });

    it('Redis maps to keyvalue paradigm', () => {
      expect(getParadigm(DbType.Redis)).toBe('keyvalue');
    });
  });

  describe('BaseAdapter Interface', () => {
    it('has required connectionId property', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-123',
        dbType: DbType.PostgreSQL,
        paradigm: 'sql',
      };
      expect(adapter.connectionId).toBe('test-123');
    });

    it('has required dbType property', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-123',
        dbType: DbType.MongoDB,
        paradigm: 'document',
      };
      expect(adapter.dbType).toBe(DbType.MongoDB);
    });

    it('has required paradigm property', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test-123',
        dbType: DbType.Redis,
        paradigm: 'keyvalue',
      };
      expect(adapter.paradigm).toBe('keyvalue');
    });
  });

  describe('SQL Database Types', () => {
    const sqlDbTypes = [
      DbType.PostgreSQL,
      DbType.MySQL,
      DbType.MariaDB,
      DbType.SQLite,
      DbType.SQLServer,
      DbType.Oracle,
    ];

    it.each(sqlDbTypes)('%s should have sql paradigm', (dbType) => {
      expect(getParadigm(dbType)).toBe('sql');
    });

    it.each(sqlDbTypes)('adapter for %s should pass isSqlAdapter check', (dbType) => {
      const adapter: BaseAdapter = {
        connectionId: 'test',
        dbType,
        paradigm: 'sql',
      };
      expect(isSqlAdapter(adapter)).toBe(true);
      expect(isDocumentAdapter(adapter)).toBe(false);
      expect(isKeyValueAdapter(adapter)).toBe(false);
    });
  });

  describe('Document Database Types', () => {
    it('MongoDB should pass isDocumentAdapter check', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test',
        dbType: DbType.MongoDB,
        paradigm: 'document',
      };
      expect(isDocumentAdapter(adapter)).toBe(true);
      expect(isSqlAdapter(adapter)).toBe(false);
      expect(isKeyValueAdapter(adapter)).toBe(false);
    });
  });

  describe('KeyValue Database Types', () => {
    it('Redis should pass isKeyValueAdapter check', () => {
      const adapter: BaseAdapter = {
        connectionId: 'test',
        dbType: DbType.Redis,
        paradigm: 'keyvalue',
      };
      expect(isKeyValueAdapter(adapter)).toBe(true);
      expect(isSqlAdapter(adapter)).toBe(false);
      expect(isDocumentAdapter(adapter)).toBe(false);
    });
  });
});
