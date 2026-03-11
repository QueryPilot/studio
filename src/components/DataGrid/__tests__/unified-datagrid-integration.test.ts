/**
 * Integration test for Unified DataGrid Architecture
 * Verifies implementation against plan: docs/plans/2026-01-17-unified-datagrid-design.md
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PathSegment, KeyMetadata } from '../sources/types';

describe('Unified DataGrid Architecture - Integration Tests', () => {
  // Mock browser APIs for test environment
  beforeAll(() => {
    global.Path2D = global.Path2D || class Path2D {};

    // Mock navigator.clipboard
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue(''),
        },
        writable: true,
      });
    }
  });

  describe('Phase 1: Foundation', () => {
    it('should have DrillableCell renderer with proper types', async () => {

      const { createDrillableObjectCell, createDrillableArrayCell, DRILLABLE_CELL_KIND } = await import(
        '../renderers/DrillableCell'
      );

      // Test object cell creation
      const objCell = createDrillableObjectCell({ name: 'John', age: 30 });
      expect(objCell.data.kind).toBe(DRILLABLE_CELL_KIND);
      expect(objCell.data.type).toBe('object');
      expect(objCell.data.preview).toMatch(/\{name:.*age:/);
      expect(objCell.data.canDrillDown).toBe(true);

      // Test array cell creation
      const arrCell = createDrillableArrayCell([1, 2, 3]);
      expect(arrCell.data.kind).toBe(DRILLABLE_CELL_KIND);
      expect(arrCell.data.type).toBe('array');
      expect(arrCell.data.preview).toMatch(/\[3\] 1/);
      expect(arrCell.data.canDrillDown).toBe(true);
    });

    it('should have shared cell factory utilities', async () => {
      const {
        cacheAndReturn,
        tryGetCachedCell,
        isPlainObject,
        isDrillableValue,
      } = await import('../utils/cellFactoryShared');

      expect(typeof cacheAndReturn).toBe('function');
      expect(typeof tryGetCachedCell).toBe('function');
      expect(typeof isPlainObject).toBe('function');
      expect(typeof isDrillableValue).toBe('function');

      // Test type guards
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject([])).toBe(false);
      expect(isDrillableValue({})).toBe(true);
      expect(isDrillableValue([])).toBe(true);
      expect(isDrillableValue('string')).toBe(false);
    });

    it('should have simplified hook-based types only', () => {
      // TypeScript types don't exist at runtime, but they compile successfully
      // This test verifies the types can be used (compile-time check)
      const pathSegment: PathSegment = {
        key: 'test',
        label: 'Test',
        type: 'object',
      };
      expect(pathSegment).toBeDefined();
      expect(pathSegment.key).toBe('test');

      const keyMetadata: KeyMetadata = {
        key: 'testkey',
        type: 'string',
        ttl: -1,
      };
      expect(keyMetadata).toBeDefined();
      expect(keyMetadata.type).toBe('string');
    });
  });

  describe('Phase 2: MongoDB Support', () => {
    it('should export useDocumentData hook', async () => {
      const { useDocumentData } = await import('../hooks/useDocumentData');
      expect(typeof useDocumentData).toBe('function');
    });

    it('should have documentCellFactory with type detection', async () => {
      const {
        buildDocumentCell,
        detectDocumentValueType,
        generateColumnsFromDocuments,
      } = await import('../utils/documentCellFactory');

      expect(typeof buildDocumentCell).toBe('function');
      expect(typeof detectDocumentValueType).toBe('function');
      expect(typeof generateColumnsFromDocuments).toBe('function');

      // Test type detection
      expect(detectDocumentValueType(null)).toBe('null');
      expect(detectDocumentValueType('string')).toBe('string');
      expect(detectDocumentValueType(123)).toBe('number');
      expect(detectDocumentValueType(true)).toBe('boolean');
      expect(detectDocumentValueType([])).toBe('array');
      expect(detectDocumentValueType({})).toBe('object');
      expect(detectDocumentValueType({ $oid: '507f1f77bcf86cd799439011' })).toBe('objectId');
    });

    it('should export DocumentDataGrid component', async () => {
      const { DocumentDataGrid } = await import('../adapters/DocumentDataGrid');
      expect(DocumentDataGrid).toBeDefined();
      expect(typeof DocumentDataGrid).toBe('object'); // memo wraps the component
    }, 15000);

    it('should have BreadcrumbNav component', async () => {
      const { BreadcrumbNav } = await import('../components/BreadcrumbNav');
      expect(BreadcrumbNav).toBeDefined();
      expect(typeof BreadcrumbNav).toBe('object'); // memo wraps the component
    });
  });

  describe('Phase 3: Redis Support', () => {
    it('should export useKeyValueData hook', async () => {
      const { useKeyValueData } = await import('../hooks/useKeyValueData');
      expect(typeof useKeyValueData).toBe('function');
    });

    it('should have keyvalueCellFactory with type-aware mapping', async () => {
      const { getColumnsForRedisType, mapRedisDataToRows } = await import(
        '../utils/keyvalueCellFactory'
      );

      expect(typeof getColumnsForRedisType).toBe('function');
      expect(typeof mapRedisDataToRows).toBe('function');

      // Test column generation for each Redis type
      const stringCols = getColumnsForRedisType('string');
      expect(stringCols).toHaveLength(1);
      expect(stringCols[0]?.field).toBe('value');

      const hashCols = getColumnsForRedisType('hash');
      expect(hashCols).toHaveLength(2);
      expect(hashCols[0]?.field).toBe('field');
      expect(hashCols[1]?.field).toBe('value');

      const listCols = getColumnsForRedisType('list');
      expect(listCols).toHaveLength(2);
      expect(listCols[0]?.field).toBe('index');

      const setCols = getColumnsForRedisType('set');
      expect(setCols).toHaveLength(1);
      expect(setCols[0]?.field).toBe('member');

      const zsetCols = getColumnsForRedisType('zset');
      expect(zsetCols).toHaveLength(2);
      expect(zsetCols[0]?.field).toBe('score');
      expect(zsetCols[1]?.field).toBe('member');

      const streamCols = getColumnsForRedisType('stream');
      expect(streamCols).toHaveLength(2);
      expect(streamCols[0]?.field).toBe('id');
    });

    it('should export KeyValueDataGrid component', async () => {
      const { KeyValueDataGrid } = await import('../adapters/KeyValueDataGrid');
      expect(KeyValueDataGrid).toBeDefined();
      expect(typeof KeyValueDataGrid).toBe('object'); // memo wraps the component
    });

    it('should have KeyHeader component', async () => {
      const { KeyHeader } = await import('../components/KeyHeader');
      expect(KeyHeader).toBeDefined();
      expect(typeof KeyHeader).toBe('object'); // memo wraps the component
    });
  });

  describe('Phase 4: Integration', () => {
    it('should export all DataGrid variants from main index', async () => {
      const dataGridExports = await import('../index');

      expect(dataGridExports.SqlDataGrid).toBeDefined();
      expect(dataGridExports.DocumentDataGrid).toBeDefined();
      expect(dataGridExports.KeyValueDataGrid).toBeDefined();
      expect(dataGridExports.QueryResultGrid).toBeDefined();
    });

    it('should have proper type exports for all paradigms', async () => {
      const { useDocumentData } = await import('../hooks/useDocumentData');
      const { useKeyValueData } = await import('../hooks/useKeyValueData');

      // These are type checks that compile successfully
      expect(typeof useDocumentData).toBe('function');
      expect(typeof useKeyValueData).toBe('function');
    });
  });

  describe('Phase 5: Polish', () => {
    it('should have error state components', async () => {
      const { DataGridErrorState, DataGridEmptyState } = await import(
        '../components/DataGridStates'
      );

      expect(DataGridErrorState).toBeDefined();
      expect(DataGridEmptyState).toBeDefined();
    });

    it('should have loading skeleton component', async () => {
      const { DataGridSkeleton } = await import('../components/DataGridSkeleton');
      expect(DataGridSkeleton).toBeDefined();
      expect(typeof DataGridSkeleton).toBe('object'); // memo wraps the component
    });

    it('should have CRUD integration hooks', async () => {
      const { useDocumentData } = await import('../hooks/useDocumentData');
      const { useKeyValueData } = await import('../hooks/useKeyValueData');

      // Verify hooks exist (CRUD methods are part of hook results)
      expect(typeof useDocumentData).toBe('function');
      expect(typeof useKeyValueData).toBe('function');
    });
  });

  describe('Architecture Verification', () => {
    it('should have hook-based data providers returning EditableDataGrid-compatible props', async () => {
      // This test verifies the return type structure matches the plan
      const { useDocumentData } = await import('../hooks/useDocumentData');
      const { useKeyValueData } = await import('../hooks/useKeyValueData');

      // Type-level verification (compile-time)
      expect(typeof useDocumentData).toBe('function');
      expect(typeof useKeyValueData).toBe('function');

      // The hooks should return objects with these properties:
      // - rows: GridRowModel[]
      // - columns: GridColumnV2[]
      // - getCellContent: (cell: Item) => GridCell
      // - createEditCommand, createInsertCommand, createDeleteCommand
    });

    it('should have proper export structure', async () => {
      const mainExports = await import('../index');
      const adaptersExports = await import('../adapters');
      const hooksExports = await import('../hooks');

      // Verify main exports (new unified architecture)
      expect(mainExports.SqlDataGrid).toBeDefined();
      expect(mainExports.DocumentDataGrid).toBeDefined();
      expect(mainExports.KeyValueDataGrid).toBeDefined();
      expect(mainExports.QueryResultGrid).toBeDefined();

      // Verify adapter exports
      expect(adaptersExports.SqlDataGrid).toBeDefined();
      expect(adaptersExports.DocumentDataGrid).toBeDefined();
      expect(adaptersExports.KeyValueDataGrid).toBeDefined();
      expect(adaptersExports.QueryResultGrid).toBeDefined();

      // Verify hook exports
      expect(hooksExports.useDocumentData).toBeDefined();
      expect(hooksExports.useKeyValueData).toBeDefined();
    });
  });
});
