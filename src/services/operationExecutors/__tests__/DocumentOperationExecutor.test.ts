import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentOperationExecutor } from '../DocumentOperationExecutor';
import type { DocumentQueryable, AdapterCapability } from '@/adapters/capabilities';
import type { CrudCommand } from '@/types/crud';
import { DbType } from '@/types/connection';

const createMockAdapter = (): DocumentQueryable => ({
  connectionId: 'test-connection',
  dbType: DbType.MongoDB,
  paradigm: 'document',
  connect: vi.fn(),
  disconnect: vi.fn(),
  testConnection: vi.fn(),
  isConnected: vi.fn(() => true),
  getCapabilities: vi.fn((): AdapterCapability[] => ['document-queryable']),
  findDocuments: vi.fn(),
  insertDocument: vi.fn(),
  insertDocuments: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  aggregate: vi.fn(),
  countDocuments: vi.fn(),
  listCollections: vi.fn(),
  runCommand: vi.fn(),
});

const createCommand = (
  type: CrudCommand['type'],
  table: string,
  payload: object,
  id = 'cmd-1'
): CrudCommand => ({
  id,
  type,
  target: {
    connectionId: 'test-connection',
    table,
  },
  payload,
  metadata: {
    description: `${type} operation`,
    affectedRows: 1,
    timestamp: new Date().toISOString(),
  },
  state: 'staged',
});

describe('DocumentOperationExecutor', () => {
  let executor: DocumentOperationExecutor;
  let mockAdapter: DocumentQueryable;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    executor = new DocumentOperationExecutor(mockAdapter, 'test-connection');
  });

  describe('paradigm', () => {
    it('should have document paradigm', () => {
      expect(executor.paradigm).toBe('document');
    });
  });

  describe('execute', () => {
    it('should execute insert command', async () => {
      const commands = [
        createCommand('data.insert', 'users', {
          values: { name: 'John', email: 'john@example.com' },
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockAdapter.insertDocument).toHaveBeenCalledWith('users', {
        name: 'John',
        email: 'john@example.com',
      });
    });

    it('should execute update command', async () => {
      const commands = [
        createCommand('data.update', 'users', {
          primaryKeys: { _id: 'user-123' },
          column: 'name',
          newValue: 'Jane',
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockAdapter.updateDocument).toHaveBeenCalledWith(
        'users',
        { _id: 'user-123' },
        { $set: { name: 'Jane' } }
      );
    });

    it('should execute delete command', async () => {
      const commands = [
        createCommand('data.delete', 'users', {
          primaryKeys: { _id: 'user-123' },
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockAdapter.deleteDocument).toHaveBeenCalledWith('users', {
        _id: 'user-123',
      });
    });

    it('should handle execution errors', async () => {
      vi.mocked(mockAdapter.insertDocument).mockRejectedValueOnce(
        new Error('Document validation failed')
      );

      const commands = [
        createCommand('data.insert', 'users', { values: { name: 'John' } }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(false);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.commandId).toBe('cmd-1');
      expect(result.errors[0]?.message).toContain('Document validation failed');
    });

    it('should execute multiple commands', async () => {
      const commands = [
        createCommand(
          'data.insert',
          'users',
          { values: { name: 'John' } },
          'cmd-1'
        ),
        createCommand(
          'data.update',
          'users',
          { primaryKeys: { _id: 'user-1' }, column: 'active', newValue: true },
          'cmd-2'
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(2);
      expect(mockAdapter.insertDocument).toHaveBeenCalledTimes(1);
      expect(mockAdapter.updateDocument).toHaveBeenCalledTimes(1);
    });

    it('should return success with 0 count for empty commands', async () => {
      const result = await executor.execute([]);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('preview', () => {
    it('should generate MongoDB shell syntax preview for insert', () => {
      const commands = [
        createCommand('data.insert', 'users', { values: { name: 'John', age: 30 } }),
      ];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('mongo-ops');
      expect(preview.content).toContain('db.users.insertOne');
      expect(preview.content).toContain('"name": "John"');
      expect(preview.operations).toHaveLength(1);
      expect(preview.operations[0]?.action).toBe('insert');
      expect(preview.operations[0]?.target).toBe('users');
    });

    it('should generate preview for update', () => {
      const commands = [
        createCommand('data.update', 'products', {
          primaryKeys: { _id: 'prod-1' },
          column: 'price',
          newValue: 29.99,
        }),
      ];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('mongo-ops');
      expect(preview.content).toContain('db.products.updateOne');
      expect(preview.content).toContain('_id');
      expect(preview.content).toContain('$set');
      expect(preview.operations[0]?.action).toBe('update');
    });

    it('should generate preview for delete', () => {
      const commands = [
        createCommand('data.delete', 'logs', {
          primaryKeys: { _id: 'log-123' },
        }),
      ];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('mongo-ops');
      expect(preview.content).toContain('db.logs.deleteOne');
      expect(preview.operations[0]?.action).toBe('delete');
    });

    it('should return empty preview message for no commands', () => {
      const preview = executor.preview([]);

      expect(preview.type).toBe('mongo-ops');
      expect(preview.content).toContain('No MongoDB operations');
      expect(preview.operations).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('should validate insert command', () => {
      const command = createCommand('data.insert', 'users', {
        values: { name: 'John' },
      });

      const result = executor.validate(command);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject update without primary keys', () => {
      const command = createCommand('data.update', 'users', {
        column: 'name',
        newValue: 'Jane',
      });

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Update requires document identifier (_id)');
    });

    it('should reject delete without primary keys', () => {
      const command = createCommand('data.delete', 'users', {});

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Delete requires document identifier (_id)');
    });

    it('should reject missing collection name', () => {
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.insert',
        target: { connectionId: 'test-connection' },
        payload: { values: { name: 'John' } },
        metadata: {
          description: 'Insert',
          affectedRows: 1,
          timestamp: new Date().toISOString(),
        },
        state: 'staged',
      };

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Collection name is required');
    });

    it('should reject unsupported operation types', () => {
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'table.create' as CrudCommand['type'],
        target: { connectionId: 'test-connection', table: 'users' },
        payload: {},
        metadata: {
          description: 'Create table',
          affectedRows: 0,
          timestamp: new Date().toISOString(),
        },
        state: 'staged',
      };

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unsupported operation type');
    });
  });
});
