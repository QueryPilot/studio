import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisAdapter } from '../redis/RedisAdapter';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

describe('RedisAdapter', () => {
  let adapter: RedisAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RedisAdapter('test-conn-id');
  });

  describe('capability interface compliance', () => {
    it('implements KeyValueOperable interface', () => {
      expect(typeof adapter.getKey).toBe('function');
      expect(typeof adapter.setKey).toBe('function');
      expect(typeof adapter.deleteKeys).toBe('function');
      expect(typeof adapter.keyExists).toBe('function');
      expect(typeof adapter.scanKeys).toBe('function');
      expect(typeof adapter.getKeyType).toBe('function');
      expect(typeof adapter.getKeyTTL).toBe('function');
      expect(typeof adapter.setKeyTTL).toBe('function');
      expect(typeof adapter.executeRaw).toBe('function');
      expect(typeof adapter.getDatabaseSize).toBe('function');
      expect(typeof adapter.selectDatabase).toBe('function');
      expect(typeof adapter.getServerInfo).toBe('function');
    });

    it('implements RichKeyValueOperable interface', () => {
      expect(typeof adapter.hashGetAll).toBe('function');
      expect(typeof adapter.hashSet).toBe('function');
      expect(typeof adapter.hashDelete).toBe('function');
      expect(typeof adapter.listRange).toBe('function');
      expect(typeof adapter.listPush).toBe('function');
      expect(typeof adapter.listLen).toBe('function');
      expect(typeof adapter.setMembers).toBe('function');
      expect(typeof adapter.setAdd).toBe('function');
      expect(typeof adapter.setRemove).toBe('function');
      expect(typeof adapter.zsetRange).toBe('function');
      expect(typeof adapter.zsetAdd).toBe('function');
      expect(typeof adapter.streamRange).toBe('function');
      expect(typeof adapter.streamLen).toBe('function');
    });

    it('declares keyvalue-operable and rich-keyvalue-operable capabilities', () => {
      const capabilities = adapter.getCapabilities();
      expect(capabilities).toContain('keyvalue-operable');
      expect(capabilities).toContain('rich-keyvalue-operable');
    });
  });

  describe('uses keyvalue_execute IPC paradigm - Basic Operations', () => {
    it('getKey calls keyvalue_execute with Get operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'value',
        data: { type: 'string', value: 'hello' },
      });

      const result = await adapter.getKey('mykey');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'get', key: 'mykey' },
      });
      expect(result).toEqual({ type: 'string', value: 'hello' });
    });

    it('setKey calls keyvalue_execute with Set operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'ok' });

      await adapter.setKey('mykey', { type: 'string', value: 'hello' }, { ttlSeconds: 60 });

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: {
          type: 'set',
          key: 'mykey',
          value: { type: 'string', value: 'hello' },
          options: { ttlSeconds: 60 },
        },
      });
    });

    it('deleteKeys calls keyvalue_execute with Delete operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 2 });

      const result = await adapter.deleteKeys(['key1', 'key2']);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'delete', keys: ['key1', 'key2'] },
      });
      expect(result).toBe(2);
    });

    it('keyExists calls keyvalue_execute with Exists operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 2 });

      const result = await adapter.keyExists(['key1', 'key2', 'key3']);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'exists', keys: ['key1', 'key2', 'key3'] },
      });
      expect(result).toBe(2);
    });

    it('scanKeys calls keyvalue_execute with Scan operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'scan',
        data: {
          cursor: '100',
          keys: [{ key: 'user:1', keyType: 'string', ttl: -1 }],
        },
      });

      const result = await adapter.scanKeys('user:*', '0', 10);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'scan', pattern: 'user:*', cursor: 0, count: 10 },
      });
      expect(result).toEqual({
        cursor: '100',
        keys: [{ key: 'user:1', keyType: 'string', ttl: -1 }],
      });
    });

    it('getKeyType calls keyvalue_execute with Type operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'key_type', data: 'hash' });

      const result = await adapter.getKeyType('mykey');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'type', key: 'mykey' },
      });
      expect(result).toBe('hash');
    });

    it('getKeyTTL calls keyvalue_execute with Ttl operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'ttl', data: 3600 });

      const result = await adapter.getKeyTTL('mykey');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'ttl', key: 'mykey' },
      });
      expect(result).toBe(3600);
    });

    it('setKeyTTL calls keyvalue_execute with SetTtl operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'bool', data: true });

      const result = await adapter.setKeyTTL('mykey', 7200);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'setTtl', key: 'mykey', seconds: 7200 },
      });
      expect(result).toBe(true);
    });

    it('executeRaw calls keyvalue_execute with ExecuteRaw operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'value',
        data: { type: 'string', value: 'PONG' },
      });

      const result = await adapter.executeRaw('PING', []);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'executeRaw', command: 'PING', args: [] },
      });
      expect(result).toEqual({ type: 'string', value: 'PONG' });
    });

    it('getDatabaseSize calls keyvalue_execute with DbSize operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 1500 });

      const result = await adapter.getDatabaseSize();

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'dbSize' },
      });
      expect(result).toBe(1500);
    });

    it('selectDatabase calls keyvalue_execute with SelectDb operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'ok' });

      await adapter.selectDatabase(5);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'selectDb', index: 5 },
      });
    });

    it('getServerInfo calls keyvalue_execute with ServerInfo operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'server_info',
        data: { redis_version: '7.0.0', connected_clients: '5' },
      });

      const result = await adapter.getServerInfo('server');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'serverInfo', section: 'server' },
      });
      expect(result).toEqual({ redis_version: '7.0.0', connected_clients: '5' });
    });
  });

  describe('uses keyvalue_execute IPC paradigm - Hash Operations', () => {
    it('hashGetAll calls keyvalue_execute with HashGetAll operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'hash',
        data: { field1: 'value1', field2: 'value2' },
      });

      const result = await adapter.hashGetAll('myhash');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'hashGetAll', key: 'myhash' },
      });
      expect(result).toEqual({ field1: 'value1', field2: 'value2' });
    });

    it('hashSet calls keyvalue_execute with HashSet operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 2 });

      const result = await adapter.hashSet('myhash', { field1: 'value1', field2: 'value2' });

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'hashSet', key: 'myhash', fields: { field1: 'value1', field2: 'value2' } },
      });
      expect(result).toBe(2);
    });

    it('hashDelete calls keyvalue_execute with HashDelete operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 1 });

      const result = await adapter.hashDelete('myhash', ['field1']);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'hashDelete', key: 'myhash', fields: ['field1'] },
      });
      expect(result).toBe(1);
    });
  });

  describe('uses keyvalue_execute IPC paradigm - List Operations', () => {
    it('listRange calls keyvalue_execute with ListRange operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'list',
        data: ['item1', 'item2', 'item3'],
      });

      const result = await adapter.listRange('mylist', 0, -1);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'listRange', key: 'mylist', start: 0, stop: -1 },
      });
      expect(result).toEqual(['item1', 'item2', 'item3']);
    });

    it('listPush calls keyvalue_execute with ListPush operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 5 });

      const result = await adapter.listPush('mylist', ['newitem'], 'right');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'listPush', key: 'mylist', values: ['newitem'], side: 'right' },
      });
      expect(result).toBe(5);
    });

    it('listLen calls keyvalue_execute with ListLen operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 10 });

      const result = await adapter.listLen('mylist');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'listLen', key: 'mylist' },
      });
      expect(result).toBe(10);
    });
  });

  describe('uses keyvalue_execute IPC paradigm - Set Operations', () => {
    it('setMembers calls keyvalue_execute with SetMembers operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'set',
        data: ['member1', 'member2'],
      });

      const result = await adapter.setMembers('myset');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'setMembers', key: 'myset' },
      });
      expect(result).toEqual(['member1', 'member2']);
    });

    it('setAdd calls keyvalue_execute with SetAdd operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 2 });

      const result = await adapter.setAdd('myset', ['member3', 'member4']);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'setAdd', key: 'myset', members: ['member3', 'member4'] },
      });
      expect(result).toBe(2);
    });

    it('setRemove calls keyvalue_execute with SetRemove operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 1 });

      const result = await adapter.setRemove('myset', ['member1']);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'setRemove', key: 'myset', members: ['member1'] },
      });
      expect(result).toBe(1);
    });
  });

  describe('uses keyvalue_execute IPC paradigm - Sorted Set Operations', () => {
    it('zsetRange calls keyvalue_execute with ZSetRange operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'zset',
        data: [{ member: 'a', score: 1.0 }, { member: 'b', score: 2.0 }],
      });

      const result = await adapter.zsetRange('myzset', 0, -1, true);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'zSetRange', key: 'myzset', start: 0, stop: -1, with_scores: true },
      });
      expect(result).toEqual([{ member: 'a', score: 1.0 }, { member: 'b', score: 2.0 }]);
    });

    it('zsetAdd calls keyvalue_execute with ZSetAdd operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 2 });

      const members = [{ member: 'c', score: 3.0 }, { member: 'd', score: 4.0 }];
      const result = await adapter.zsetAdd('myzset', members);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'zSetAdd', key: 'myzset', members },
      });
      expect(result).toBe(2);
    });
  });

  describe('uses keyvalue_execute IPC paradigm - Stream Operations', () => {
    it('streamRange calls keyvalue_execute with StreamRange operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        type: 'stream',
        data: [{ id: '1-0', fields: { field1: 'value1' } }],
      });

      const result = await adapter.streamRange('mystream', '-', '+', 100);

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'streamRange', key: 'mystream', start: '-', end: '+', count: 100 },
      });
      expect(result).toEqual([{ id: '1-0', fields: { field1: 'value1' } }]);
    });

    it('streamLen calls keyvalue_execute with StreamLen operation', async () => {
      mockInvoke.mockResolvedValueOnce({ type: 'count', data: 50 });

      const result = await adapter.streamLen('mystream');

      expect(mockInvoke).toHaveBeenCalledWith('keyvalue_execute', {
        connId: 'test-conn-id',
        operation: { type: 'streamLen', key: 'mystream' },
      });
      expect(result).toBe(50);
    });
  });
});
