import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentOperationExecutor } from '../DocumentOperationExecutor';
import type { DocumentQueryable, AdapterCapability } from '@/adapters/capabilities';
import type { CrudCommand } from '@/types/crud';
import { DbType } from '@/types/connection';

const createMockAdapter = () => ({
  connectionId: 'test-connection',
  dbType: DbType.MongoDB,
  paradigm: 'document',
  connect: vi.fn(),
  disconnect: vi.fn(),
  testConnection: vi.fn(),
  isConnected: vi.fn(() => true),
  getCapabilities: vi.fn((): AdapterCapability[] => ['document-queryable']),
  findDocuments: vi.fn(),
  findDocumentsPage: vi.fn(),
  sampleCollectionSchema: vi.fn(),
  insertDocument: vi.fn(),
  insertDocuments: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  aggregate: vi.fn(),
  countDocuments: vi.fn(),
  listCollections: vi.fn(),
  getCollectionMetadata: vi.fn(),
  listIndexes: vi.fn(),
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
  updateCollectionValidation: vi.fn(),
  explainCollectionOperation: vi.fn(),
  runCommand: vi.fn(),
}) satisfies DocumentQueryable;

const createCommand = (
  type: CrudCommand['type'],
  table: string,
  payload: object,
  id = 'cmd-1',
  targetOverrides: Partial<CrudCommand['target']> = {},
): CrudCommand => ({
  id,
  type,
  target: {
    connectionId: 'test-connection',
    table,
    ...targetOverrides,
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
  let mockAdapter: ReturnType<typeof createMockAdapter>;

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
        createCommand(
          'data.insert',
          'users',
          {
            values: { name: 'John', email: 'john@example.com' },
          },
          'cmd-1',
          { database: 'app-db' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(vi.mocked(mockAdapter.insertDocument)).toHaveBeenCalledWith('users', {
        name: 'John',
        email: 'john@example.com',
      }, 'app-db');
    });

    it('should execute update command', async () => {
      const commands = [
        createCommand(
          'data.update',
          'users',
          {
            primaryKeys: { _id: 'user-123' },
            column: 'name',
            newValue: 'Jane',
          },
          'cmd-1',
          { database: 'app-db' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(vi.mocked(mockAdapter.updateDocument)).toHaveBeenCalledWith(
        'users',
        { _id: 'user-123' },
        { $set: { name: 'Jane' } },
        'app-db',
      );
    });

    it('should strip synthetic nested-array identity keys from update filters', async () => {
      const commands = [
        createCommand('data.update', 'orders', {
          primaryKeys: { _id: 'order-123', __index: 2 },
          column: 'items.2.productSku',
          newValue: 'AUDIO-0012323',
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(vi.mocked(mockAdapter.updateDocument)).toHaveBeenCalledWith(
        'orders',
        { _id: 'order-123' },
        { $set: { 'items.2.productSku': 'AUDIO-0012323' } }
      );
    });

    it('should execute delete command', async () => {
      const commands = [
        createCommand(
          'data.delete',
          'users',
          {
            primaryKeys: { _id: 'user-123' },
          },
          'cmd-1',
          { database: 'app-db' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(vi.mocked(mockAdapter.deleteDocument)).toHaveBeenCalledWith('users', {
        _id: 'user-123',
      }, 'app-db');
    });

    it('should execute staged MongoDB index creation', async () => {
      const commands = [
        createCommand(
          'document.index.create',
          'users',
          {
            definition: {
              name: 'users_email_text',
              keys: { email: 'text', createdAt: -1 },
              options: {
                unique: false,
                defaultLanguage: 'english',
                languageOverride: 'language',
              },
            },
          },
          'cmd-1',
          { database: 'analytics' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(vi.mocked(mockAdapter.createIndex)).toHaveBeenCalledWith(
        'users',
        { email: 'text', createdAt: -1 },
        {
          unique: false,
          defaultLanguage: 'english',
          languageOverride: 'language',
          name: 'users_email_text',
        },
        'analytics',
      );
    });

    it('should execute staged MongoDB index drop', async () => {
      const commands = [
        createCommand(
          'document.index.drop',
          'users',
          {
            indexName: 'users_email_text',
          },
          'cmd-1',
          { database: 'analytics' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(vi.mocked(mockAdapter.dropIndex)).toHaveBeenCalledWith(
        'users',
        'users_email_text',
        'analytics',
      );
    });

    it('should execute staged MongoDB validation update', async () => {
      const commands = [
        createCommand(
          'document.validation.update',
          'users',
          {
            validationJson: JSON.stringify({
              $jsonSchema: {
                bsonType: 'object',
                required: ['email'],
              },
            }),
            validationLevel: 'moderate',
            validationAction: 'warn',
          },
          'cmd-1',
          { database: 'analytics' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(vi.mocked(mockAdapter.updateCollectionValidation)).toHaveBeenCalledWith(
        'users',
        {
          $jsonSchema: {
            bsonType: 'object',
            required: ['email'],
          },
          validationLevel: 'moderate',
          validationAction: 'warn',
        },
        'analytics',
      );
    });

    it('should execute staged MongoDB validation clear against the target database', async () => {
      const commands = [
        createCommand(
          'document.validation.update',
          'users',
          {
            clearValidator: true,
            validationLevel: 'off',
            validationAction: 'warn',
          },
          'cmd-1',
          { database: 'analytics' },
        ),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(vi.mocked(mockAdapter.updateCollectionValidation)).toHaveBeenCalledWith(
        'users',
        {
          clearValidator: true,
          validationLevel: 'off',
          validationAction: 'warn',
        },
        'analytics',
      );
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
      expect(vi.mocked(mockAdapter.insertDocument)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(mockAdapter.updateDocument)).toHaveBeenCalledTimes(1);
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

    it('should generate preview for index creation and validation updates', () => {
      const commands = [
        createCommand('document.index.create', 'users', {
          definition: {
            name: 'users_email_idx',
            keys: { email: 1, createdAt: -1 },
            options: { unique: true, sparse: true },
          },
        }),
        createCommand('document.validation.update', 'users', {
          validationJson: '{"$jsonSchema":{"bsonType":"object"}}',
          validationLevel: 'strict',
          validationAction: 'error',
        }, 'cmd-2'),
      ];

      const preview = executor.preview(commands);

      expect(preview.content).toContain('db.users.createIndex');
      expect(preview.content).toContain('db.runCommand');
      expect(preview.operations[0]?.action).toBe('createIndex');
      expect(preview.operations[1]?.action).toBe('updateValidation');
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

    it('should reject invalid validation JSON', () => {
      const command = createCommand('document.validation.update', 'users', {
        validationJson: '["not-an-object"]',
        validationLevel: 'strict',
        validationAction: 'error',
      });

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation JSON must be an object');
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
