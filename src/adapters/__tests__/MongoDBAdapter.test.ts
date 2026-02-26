import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock must be before imports
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { MongoDBAdapter } from '../mongodb/MongoDBAdapter';
import { invoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(invoke);

describe('MongoDBAdapter', () => {
  let adapter: MongoDBAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock return to avoid "undefined" access errors
    mockInvoke.mockResolvedValue({ data: null, type: 'unknown' });
    adapter = new MongoDBAdapter('test-conn-id');
  });

  describe('capability interface compliance', () => {
    it('implements DocumentQueryable interface', () => {
      expect(typeof adapter.findDocuments).toBe('function');
      expect(typeof adapter.findDocumentsPage).toBe('function');
      expect(typeof adapter.sampleCollectionSchema).toBe('function');
      expect(typeof adapter.insertDocument).toBe('function');
      expect(typeof adapter.insertDocuments).toBe('function');
      expect(typeof adapter.updateDocument).toBe('function');
      expect(typeof adapter.deleteDocument).toBe('function');
      expect(typeof adapter.aggregate).toBe('function');
      expect(typeof adapter.countDocuments).toBe('function');
      expect(typeof adapter.listCollections).toBe('function');
      expect(typeof adapter.runCommand).toBe('function');
    });

    it('declares document-queryable capability', () => {
      const capabilities = adapter.getCapabilities();
      expect(capabilities).toContain('document-queryable');
    });
  });

  describe('uses document_execute IPC paradigm', () => {
    it('findDocuments calls document_execute with Find operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'documents',
        data: [{ _id: '1', name: 'test' }],
      });

      const result = await adapter.findDocuments('users', { active: true }, { limit: 10 });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'find',
          collection: 'users',
          filter: { active: true },
          limit: 10,
        }),
      }));
      expect(result).toEqual([{ _id: '1', name: 'test' }]);
    });

    it('findDocumentsPage calls document_execute with FindPage operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'documentPage',
        data: {
          documents: [{ _id: '1', name: 'test' }],
          nextCursor: { lastId: '1', lastSortValues: { _id: '1' } },
          hasMore: true,
        },
      });

      const result = await adapter.findDocumentsPage('users', { active: true }, { limit: 10 });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'findPage',
          collection: 'users',
          filter: { active: true },
          limit: 10,
        }),
      }));
      expect(result.hasMore).toBe(true);
      expect(result.documents).toHaveLength(1);
    });

    it('sampleCollectionSchema calls document_execute with SampleSchema operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'schemaSample',
        data: {
          sampleSize: 500,
          scannedCount: 120,
          fields: [{ path: 'name', occurrences: 120, nullCount: 0, types: ['string'], sampleValues: ['Alice'] }],
        },
      });

      const result = await adapter.sampleCollectionSchema('users', { active: true }, { sampleSize: 500, maxDepth: 3 });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'sampleSchema',
          collection: 'users',
          filter: { active: true },
          sampleSize: 500,
          maxDepth: 3,
        }),
      }));
      expect(result.fields[0]?.path).toBe('name');
    });

    it('insertDocument calls document_execute with Insert operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'insert',
        data: { insertedId: 'new-id-123' },
      });

      const result = await adapter.insertDocument('users', { name: 'John' });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'insert',
          collection: 'users',
          document: { name: 'John' },
        }),
      }));
      expect(result).toEqual({ insertedId: 'new-id-123' });
    });

    it('insertDocuments calls document_execute with InsertMany operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'insertMany',
        data: { insertedIds: ['id1', 'id2'], insertedCount: 2 },
      });

      const result = await adapter.insertDocuments('users', [{ name: 'John' }, { name: 'Jane' }]);

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'insertMany',
          collection: 'users',
          documents: [{ name: 'John' }, { name: 'Jane' }],
        }),
      }));
      expect(result).toEqual({ insertedIds: ['id1', 'id2'], insertedCount: 2 });
    });

    it('updateDocument calls document_execute with Update operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'update',
        data: { matchedCount: 1, modifiedCount: 1 },
      });

      const result = await adapter.updateDocument('users', { _id: '1' }, { $set: { name: 'Updated' } });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'update',
          collection: 'users',
          filter: { _id: '1' },
          update: { $set: { name: 'Updated' } },
        }),
      }));
      expect(result).toEqual({ matchedCount: 1, modifiedCount: 1 });
    });

    it('deleteDocument calls document_execute with Delete operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'delete',
        data: { deletedCount: 1 },
      });

      const result = await adapter.deleteDocument('users', { _id: '1' });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'delete',
          collection: 'users',
          filter: { _id: '1' },
        }),
      }));
      expect(result).toEqual({ deletedCount: 1 });
    });

    it('aggregate calls document_execute with Aggregate operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'documents',
        data: [{ _id: 'group1', count: 5 }],
      });

      const pipeline = [{ $group: { _id: '$category', count: { $sum: 1 } } }];
      const result = await adapter.aggregate('orders', pipeline);

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'aggregate',
          collection: 'orders',
          pipeline,
        }),
      }));
      expect(result).toEqual([{ _id: 'group1', count: 5 }]);
    });

    it('countDocuments calls document_execute with Count operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'count',
        data: 42,
      });

      const result = await adapter.countDocuments('users', { active: true });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'count',
          collection: 'users',
          filter: { active: true },
        }),
      }));
      expect(result).toBe(42);
    });

    it('listCollections calls document_execute with ListCollections operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'collections',
        data: [{ name: 'users' }, { name: 'orders' }],
      });

      const result = await adapter.listCollections();

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'listCollections',
        }),
      }));
      expect(result).toEqual([{ name: 'users' }, { name: 'orders' }]);
    });

    it('runCommand calls document_execute with RunCommand operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'command',
        data: { ok: 1, version: '5.0.0' },
      });

      const result = await adapter.runCommand({ buildInfo: 1 });

      expect(mockInvoke).toHaveBeenCalledWith('document_execute', expect.objectContaining({
        connId: 'test-conn-id',
        operation: expect.objectContaining({
          type: 'runCommand',
          command: { buildInfo: 1 },
        }),
      }));
      expect(result).toEqual({ ok: 1, version: '5.0.0' });
    });
  });
});
