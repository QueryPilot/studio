import { describe, it, expect } from 'vitest';
import { SqlDataSourceImpl } from '../index';
import { isSqlDataSource, isDocumentDataSource, isKeyValueDataSource } from '../types';

describe('SqlDataSource', () => {
  describe('instantiation', () => {
    it('should create instance with correct paradigm and identifier', () => {
      const dataSource = new SqlDataSourceImpl({
        connectionId: 'conn-123',
        database: 'testdb',
        schema: 'public',
        table: 'users',
      });

      expect(dataSource.paradigm).toBe('sql');
      expect(dataSource.connectionId).toBe('conn-123');
      expect(dataSource.identifier).toEqual({
        type: 'table',
        database: 'testdb',
        schema: 'public',
        table: 'users',
      });
      expect(dataSource.editable).toBe(true);
    });

    it('should work without schema', () => {
      const dataSource = new SqlDataSourceImpl({
        connectionId: 'conn-456',
        database: 'testdb',
        table: 'posts',
      });

      expect(dataSource.identifier).toEqual({
        type: 'table',
        database: 'testdb',
        schema: undefined,
        table: 'posts',
      });
    });

    it('should be recognized by type guards', () => {
      const dataSource = new SqlDataSourceImpl({
        connectionId: 'conn-123',
        database: 'testdb',
        table: 'users',
      });

      expect(isSqlDataSource(dataSource)).toBe(true);
      expect(isDocumentDataSource(dataSource)).toBe(false);
      expect(isKeyValueDataSource(dataSource)).toBe(false);
    });
  });

  describe('initial state', () => {
    it('should have empty columns and rows', () => {
      const dataSource = new SqlDataSourceImpl({
        connectionId: 'conn-123',
        database: 'testdb',
        table: 'users',
      });

      expect(dataSource.getColumns()).toEqual([]);
      expect(dataSource.getRowCount()).toBe(0);
      expect(dataSource.isLoading).toBe(false);
      expect(dataSource.hasMore).toBe(false);
    });
  });
});
