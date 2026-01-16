import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyValueOperationExecutor } from '../KeyValueOperationExecutor';
import type { RichKeyValueOperable, AdapterCapability } from '@/adapters/capabilities';
import type { CrudCommand } from '@/types/crud';
import { DbType } from '@/types/connection';

const createMockAdapter = (): RichKeyValueOperable => ({
  connectionId: 'test-connection',
  dbType: DbType.Redis,
  paradigm: 'keyvalue',
  connect: vi.fn(),
  disconnect: vi.fn(),
  testConnection: vi.fn(),
  isConnected: vi.fn(() => true),
  getCapabilities: vi.fn((): AdapterCapability[] => ['keyvalue-operable', 'rich-keyvalue-operable']),
  getKey: vi.fn(),
  setKey: vi.fn(),
  deleteKeys: vi.fn(),
  keyExists: vi.fn(),
  scanKeys: vi.fn(),
  getKeyType: vi.fn(),
  getKeyTTL: vi.fn(),
  setKeyTTL: vi.fn(),
  executeRaw: vi.fn(),
  getDatabaseSize: vi.fn(),
  selectDatabase: vi.fn(),
  getServerInfo: vi.fn(),
  hashGetAll: vi.fn(),
  hashSet: vi.fn(),
  hashDelete: vi.fn(),
  listRange: vi.fn(),
  listPush: vi.fn(),
  listLen: vi.fn(),
  setMembers: vi.fn(),
  setAdd: vi.fn(),
  setRemove: vi.fn(),
  zsetRange: vi.fn(),
  zsetAdd: vi.fn(),
  streamRange: vi.fn(),
  streamLen: vi.fn(),
});

const createCommand = (
  type: CrudCommand['type'],
  key: string,
  payload: object,
  id = 'cmd-1'
): CrudCommand => ({
  id,
  type,
  target: {
    connectionId: 'test-connection',
    table: key,
  },
  payload,
  metadata: {
    description: `${type} operation`,
    affectedRows: 1,
    timestamp: new Date().toISOString(),
  },
  state: 'staged',
});

describe('KeyValueOperationExecutor', () => {
  let executor: KeyValueOperationExecutor;
  let mockAdapter: RichKeyValueOperable;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    executor = new KeyValueOperationExecutor(mockAdapter, 'test-connection');
  });

  describe('paradigm', () => {
    it('should have keyvalue paradigm', () => {
      expect(executor.paradigm).toBe('keyvalue');
    });
  });

  describe('execute', () => {
    it('should execute SET command for string insert', async () => {
      const commands = [
        createCommand('data.insert', 'mykey', {
          values: { value: 'hello world' },
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockAdapter.setKey).toHaveBeenCalledWith(
        'mykey',
        { type: 'string', value: 'hello world' }
      );
    });

    it('should execute HSET command for hash insert', async () => {
      const commands = [
        createCommand('data.insert', 'user:1', {
          values: { name: 'John', age: 30 },
          redisType: 'hash',
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(mockAdapter.hashSet).toHaveBeenCalledWith('user:1', {
        name: 'John',
        age: '30',
      });
    });

    it('should execute RPUSH command for list insert', async () => {
      const commands = [
        createCommand('data.insert', 'mylist', {
          values: { item1: 'a', item2: 'b' },
          redisType: 'list',
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(mockAdapter.listPush).toHaveBeenCalledWith('mylist', ['a', 'b'], 'right');
    });

    it('should execute SADD command for set insert', async () => {
      const commands = [
        createCommand('data.insert', 'myset', {
          values: { member1: 'x', member2: 'y' },
          redisType: 'set',
        }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(mockAdapter.setAdd).toHaveBeenCalledWith('myset', ['x', 'y']);
    });

    it('should execute DEL command for delete', async () => {
      const commands = [
        createCommand('data.delete', 'mykey', {}),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockAdapter.deleteKeys).toHaveBeenCalledWith(['mykey']);
    });

    it('should handle execution errors', async () => {
      vi.mocked(mockAdapter.setKey).mockRejectedValueOnce(
        new Error('Connection lost')
      );

      const commands = [
        createCommand('data.insert', 'mykey', { values: { value: 'test' } }),
      ];

      const result = await executor.execute(commands);

      expect(result.success).toBe(false);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.commandId).toBe('cmd-1');
      expect(result.errors[0]?.message).toContain('Connection lost');
    });

    it('should return success with 0 count for empty commands', async () => {
      const result = await executor.execute([]);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('preview', () => {
    it('should generate Redis command preview for SET', () => {
      const commands = [
        createCommand('data.insert', 'mykey', { values: { value: 'hello' } }),
      ];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('redis-cmds');
      expect(preview.content).toContain('SET');
      expect(preview.content).toContain('mykey');
      expect(preview.operations).toHaveLength(1);
      expect(preview.operations[0]?.action).toBe('set');
      expect(preview.operations[0]?.target).toBe('mykey');
    });

    it('should generate preview for DEL', () => {
      const commands = [
        createCommand('data.delete', 'mykey', {}),
      ];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('redis-cmds');
      expect(preview.content).toContain('DEL');
      expect(preview.content).toContain('mykey');
      expect(preview.operations[0]?.action).toBe('delete');
    });

    it('should generate preview for HSET', () => {
      const commands = [
        createCommand('data.insert', 'user:1', {
          values: { name: 'John' },
          redisType: 'hash',
        }),
      ];

      const preview = executor.preview(commands);

      expect(preview.content).toContain('HSET');
      expect(preview.content).toContain('user:1');
      expect(preview.operations[0]?.action).toBe('hset');
    });

    it('should return empty preview message for no commands', () => {
      const preview = executor.preview([]);

      expect(preview.type).toBe('redis-cmds');
      expect(preview.content).toContain('No Redis commands');
      expect(preview.operations).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('should validate insert command', () => {
      const command = createCommand('data.insert', 'mykey', {
        values: { value: 'test' },
      });

      const result = executor.validate(command);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing key name', () => {
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.insert',
        target: { connectionId: 'test-connection' },
        payload: { values: { value: 'test' } },
        metadata: {
          description: 'Insert',
          affectedRows: 1,
          timestamp: new Date().toISOString(),
        },
        state: 'staged',
      };

      const result = executor.validate(command);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Key name is required');
    });

    it('should reject unsupported operation types', () => {
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'table.create' as CrudCommand['type'],
        target: { connectionId: 'test-connection', table: 'mykey' },
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
