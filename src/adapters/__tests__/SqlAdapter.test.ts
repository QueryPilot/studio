import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqlAdapter } from '../base/SqlAdapter';
import { DbType } from '@/types/connection';
import type { ColumnInfo, TableRef, SelectOptions, EmbeddedFKConfig } from '../types';

// Mock queryStreamClient to avoid import issues in tests
vi.mock('@/services/queryStreamClient', () => ({
  queryStreamClient: {
    streamWithCallbacks: vi.fn(),
  },
}));

/**
 * Concrete implementation of SqlAdapter for testing.
 * Uses PostgreSQL-style quoting (double quotes).
 */
class TestSqlAdapter extends SqlAdapter {
  readonly dbType = DbType.PostgreSQL;

  quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  formatValue(value: unknown, _column: ColumnInfo): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return `'${this.escapeString(value)}'`;
    return `'${String(value)}'`;
  }

  // Required abstract methods - minimal implementation for tests
  getDatabasesQuery(): string { return ''; }
  getSchemasQuery(): string { return ''; }
  getTablesQuery(_schema: string): string { return ''; }
  getViewsQuery(_schema: string): string { return ''; }
  getFunctionsQuery(_schema: string): string { return ''; }
  getIndexesQuery(_schema: string, _table: string): string { return ''; }
  getIndexUsageStatsQuery(_schema: string, _table: string): string { return ''; }
  getConstraintsQuery(_schema: string, _table: string): string { return ''; }
  getColumnsQuery(_schema: string, _table: string): string { return ''; }
  getTriggersQuery(_schema: string, _table: string): string { return ''; }
  getSupportedIndexTypesQuery(): string { return ''; }
  getSupportedColumnTypesQuery(): string { return ''; }
  getTableCountQuery(_schema: string, _table: string, _exact?: boolean): string { return ''; }
  getTableStatsQuery(_schema: string, _table: string): string { return ''; }
  getForeignKeyTargetsQuery(_schema: string): string { return ''; }
  getObjectDefinitionQuery(): string { return ''; }
  createView(): string { return ''; }
  dropView(): string { return ''; }
  replaceView(): string { return ''; }
  renameView(): string { return ''; }
  addConstraint(): string { return ''; }
  dropConstraint(): string { return ''; }
  renameConstraint(): string { return ''; }
  createSequence(): string { return ''; }
  alterSequence(): string { return ''; }
  dropSequence(): string { return ''; }
  renameSequence(): string { return ''; }
}

describe('SqlAdapter', () => {
  let adapter: TestSqlAdapter;

  beforeEach(() => {
    adapter = new TestSqlAdapter('test-conn-id');
  });

  describe('select()', () => {
    it('should generate basic SELECT *', () => {
      const sql = adapter.select({ schema: 'public', table: 'users' });
      expect(sql).toBe('SELECT * FROM "public"."users"');
    });

    it('should support limit and offset (without default ORDER BY when columns unknown)', () => {
      const sql = adapter.select(
        { schema: 'public', table: 'users' },
        { limit: 100, offset: 50 }
      );
      expect(sql).toBe(
        'SELECT * FROM "public"."users" LIMIT 100 OFFSET 50'
      );
    });

    it('should support orderBy', () => {
      const sql = adapter.select(
        { schema: 'public', table: 'users' },
        { orderBy: [{ column: 'id', direction: 'DESC' }] }
      );
      expect(sql).toBe('SELECT * FROM "public"."users" ORDER BY "id" DESC');
    });

    it('should support rawWhere', () => {
      const sql = adapter.select(
        { schema: 'public', table: 'users' },
        { rawWhere: 'status = 1 AND age > 18' }
      );
      expect(sql).toBe('SELECT * FROM "public"."users" WHERE status = 1 AND age > 18');
    });

    it('should add default ORDER BY when columns are specified with limit', () => {
      const sql = adapter.select(
        { schema: 'public', table: 'users' },
        { columns: ['id', 'name', 'email'], limit: 100 }
      );
      expect(sql).toBe(
        'SELECT "id", "name", "email" FROM "public"."users" ORDER BY "id" ASC LIMIT 100'
      );
    });
  });

  describe('selectWithEmbeddedFK()', () => {
    it('should delegate to select() when no embeddedFKs provided', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const options: SelectOptions = { limit: 100 };

      const sql = adapter.selectWithEmbeddedFK(target, options);
      expect(sql).toBe(
        'SELECT * FROM "public"."todos" LIMIT 100'
      );
    });

    it('should delegate to select() when embeddedFKs is empty array', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const options: SelectOptions = { limit: 100, embeddedFKs: [] };

      const sql = adapter.selectWithEmbeddedFK(target, options);
      expect(sql).toBe(
        'SELECT * FROM "public"."todos" LIMIT 100'
      );
    });

    it('should generate LEFT JOIN for single FK with single display column', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, { limit: 300, embeddedFKs });

      expect(sql).toContain('SELECT "public"."todos".*');
      expect(sql).toContain('"t1"."email" AS "__qp_fk__user_id__email"');
      expect(sql).toContain('FROM "public"."todos"');
      expect(sql).not.toContain('ORDER BY');
      expect(sql).toContain('LEFT JOIN "public"."users" AS "t1" ON "public"."todos"."user_id" = "t1"."id"');
      expect(sql).toContain('LIMIT 300');
    });

    it('should generate LEFT JOINs for multiple FKs', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
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

      const sql = adapter.selectWithEmbeddedFK(target, { limit: 300, embeddedFKs });

      expect(sql).toContain('"t1"."email" AS "__qp_fk__user_id__email"');
      expect(sql).toContain('"t2"."name" AS "__qp_fk__category_id__name"');
      expect(sql).toContain('LEFT JOIN "public"."users" AS "t1"');
      expect(sql).toContain('LEFT JOIN "public"."categories" AS "t2"');
    });

    it('should handle multiple display columns per FK', () => {
      const target: TableRef = { schema: 'public', table: 'orders' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'customer_id',
          refSchema: 'sales',
          refTable: 'customers',
          refPkColumn: 'id',
          refDisplayColumns: ['name', 'email', 'phone'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, { embeddedFKs });

      expect(sql).toContain('"t1"."name" AS "__qp_fk__customer_id__name"');
      expect(sql).toContain('"t1"."email" AS "__qp_fk__customer_id__email"');
      expect(sql).toContain('"t1"."phone" AS "__qp_fk__customer_id__phone"');
    });

    it('should support rawWhere clause', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, {
        embeddedFKs,
        rawWhere: 'status = 1',
      });

      expect(sql).toContain('WHERE status = 1');
    });

    it('should prefix orderBy columns with main table reference', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, {
        embeddedFKs,
        orderBy: [{ column: 'id', direction: 'DESC' }],
      });

      expect(sql).toContain('ORDER BY "public"."todos"."id" DESC');
    });

    it('should support limit and offset', () => {
      const target: TableRef = { schema: 'public', table: 'todos' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['email'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, {
        embeddedFKs,
        limit: 100,
        offset: 200,
      });

      expect(sql).toContain('LIMIT 100 OFFSET 200');
    });

    it('should work with table without schema', () => {
      const target: TableRef = { table: 'todos' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'user_id',
          refSchema: 'main',
          refTable: 'users',
          refPkColumn: 'id',
          refDisplayColumns: ['name'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, { embeddedFKs });

      expect(sql).toContain('SELECT "todos".*');
      expect(sql).toContain('FROM "todos"');
      expect(sql).toContain('LEFT JOIN "main"."users" AS "t1" ON "todos"."user_id" = "t1"."id"');
    });

    it('should handle combination of all options', () => {
      const target: TableRef = { schema: 'public', table: 'orders' };
      const embeddedFKs: EmbeddedFKConfig[] = [
        {
          fkColumn: 'customer_id',
          refSchema: 'public',
          refTable: 'customers',
          refPkColumn: 'id',
          refDisplayColumns: ['name', 'email'],
        },
        {
          fkColumn: 'product_id',
          refSchema: 'inventory',
          refTable: 'products',
          refPkColumn: 'product_id',
          refDisplayColumns: ['title'],
        },
      ];

      const sql = adapter.selectWithEmbeddedFK(target, {
        embeddedFKs,
        rawWhere: 'total > 100',
        orderBy: [
          { column: 'created_at', direction: 'DESC' },
          { column: 'id', direction: 'ASC' },
        ],
        limit: 50,
        offset: 10,
      });

      // Check SELECT clause
      expect(sql).toContain('SELECT "public"."orders".*');
      expect(sql).toContain('"t1"."name" AS "__qp_fk__customer_id__name"');
      expect(sql).toContain('"t1"."email" AS "__qp_fk__customer_id__email"');
      expect(sql).toContain('"t2"."title" AS "__qp_fk__product_id__title"');

      // Check FROM clause
      expect(sql).toContain('FROM "public"."orders"');

      // Check JOINs
      expect(sql).toContain('LEFT JOIN "public"."customers" AS "t1" ON "public"."orders"."customer_id" = "t1"."id"');
      expect(sql).toContain('LEFT JOIN "inventory"."products" AS "t2" ON "public"."orders"."product_id" = "t2"."product_id"');

      // Check WHERE
      expect(sql).toContain('WHERE total > 100');

      // Check ORDER BY with table prefix
      expect(sql).toContain('ORDER BY "public"."orders"."created_at" DESC, "public"."orders"."id" ASC');

      // Check LIMIT/OFFSET
      expect(sql).toContain('LIMIT 50 OFFSET 10');
    });
  });
});
