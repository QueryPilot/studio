import { invoke } from '@tauri-apps/api/core';
import { DbType, type DatabaseParadigm } from '@/types/connection';
import type {
  BaseAdapter,
  AdapterCapability,
  ConnectionTestResult,
  RichKeyValueOperable,
  SetOptions,
} from '../capabilities';
import type {
  RedisValue,
  RedisType,
  ScanResult,
  ScanResultWithPreviews,
  ZSetMember,
  StreamEntry,
} from '../types/redis';
import type { KeyValueOperation, KeyValueResult } from '../types/ipc';

export class RedisAdapter implements BaseAdapter, RichKeyValueOperable {
  readonly connectionId: string;
  readonly dbType: DbType = DbType.Redis;
  readonly paradigm: DatabaseParadigm = 'keyvalue';

  private _connected = false;
  private _currentDb = 0;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  async connect(): Promise<void> {
    await invoke('connect', { connectionId: this.connectionId });
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    await invoke('disconnect', { connId: this.connectionId });
    this._connected = false;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return invoke('test_connection', { connectionId: this.connectionId });
  }

  isConnected(): boolean {
    return this._connected;
  }

  getCapabilities(): AdapterCapability[] {
    return ['keyvalue-operable', 'rich-keyvalue-operable'];
  }

  private async execute(operation: KeyValueOperation): Promise<KeyValueResult> {
    return invoke<KeyValueResult>('keyvalue_execute', {
      connId: this.connectionId,
      operation,
    });
  }

  async getKey(key: string): Promise<RedisValue | null> {
    const result = await this.execute({ type: 'get', key });
    return result.type === 'value' ? result.data : null;
  }

  async setKey(key: string, value: RedisValue, options?: SetOptions): Promise<void> {
    await this.execute({ type: 'set', key, value, options });
  }

  async deleteKeys(keys: string[]): Promise<number> {
    const result = await this.execute({ type: 'delete', keys });
    return result.type === 'count' ? result.data : 0;
  }

  async keyExists(keys: string[]): Promise<number> {
    const result = await this.execute({ type: 'exists', keys });
    return result.type === 'count' ? result.data : 0;
  }

  async scanKeys(pattern: string, cursor?: string, count?: number): Promise<ScanResult> {
    const result = await this.execute({
      type: 'scan',
      pattern,
      cursor: cursor ? parseInt(cursor, 10) : 0,
      count: count ?? 10,
    });
    return result.type === 'scan' ? result.data : { cursor: '0', keys: [] };
  }

  async scanKeysWithPreviews(
    pattern: string,
    cursor?: string,
    count?: number,
  ): Promise<ScanResultWithPreviews> {
    const result = await this.execute({
      type: 'scanWithPreviews',
      pattern,
      cursor: cursor ? parseInt(cursor, 10) : 0,
      count: count ?? 200,
    });
    return result.type === 'scanWithPreviews'
      ? result.data
      : { cursor: '0', keys: [] };
  }

  async getKeyType(key: string): Promise<RedisType> {
    const result = await this.execute({ type: 'type', key });
    return result.type === 'key_type' ? result.data : 'unknown';
  }

  async getKeyTTL(key: string): Promise<number> {
    const result = await this.execute({ type: 'ttl', key });
    return result.type === 'ttl' ? result.data : -1;
  }

  async setKeyTTL(key: string, seconds: number): Promise<boolean> {
    const result = await this.execute({ type: 'setTtl', key, seconds });
    return result.type === 'bool' ? result.data : false;
  }

  async executeRaw(command: string, args: string[]): Promise<RedisValue> {
    const result = await this.execute({ type: 'executeRaw', command, args });
    if (result.type === 'value' && result.data) {
      return result.data;
    }
    return { type: 'nil' };
  }

  async getDatabaseSize(): Promise<number> {
    const result = await this.execute({ type: 'dbSize' });
    return result.type === 'count' ? result.data : 0;
  }

  async selectDatabase(index: number): Promise<void> {
    await this.execute({ type: 'selectDb', index });
    this._currentDb = index;
  }

  async getServerInfo(section?: string): Promise<Record<string, string>> {
    const result = await this.execute({ type: 'serverInfo', section });
    return result.type === 'server_info' ? result.data : {};
  }

  getCurrentDatabase(): number {
    return this._currentDb;
  }

  async hashGetAll(key: string): Promise<Record<string, string>> {
    const result = await this.execute({ type: 'hashGetAll', key });
    return result.type === 'hash' ? result.data : {};
  }

  async hashSet(key: string, fields: Record<string, string>): Promise<number> {
    const result = await this.execute({ type: 'hashSet', key, fields });
    return result.type === 'count' ? result.data : 0;
  }

  async hashDelete(key: string, fields: string[]): Promise<number> {
    const result = await this.execute({ type: 'hashDelete', key, fields });
    return result.type === 'count' ? result.data : 0;
  }

  async listRange(key: string, start: number, stop: number): Promise<string[]> {
    const result = await this.execute({ type: 'listRange', key, start, stop });
    return result.type === 'list' ? result.data : [];
  }

  async listPush(key: string, values: string[], side: 'left' | 'right'): Promise<number> {
    const result = await this.execute({ type: 'listPush', key, values, side });
    return result.type === 'count' ? result.data : 0;
  }

  async listLen(key: string): Promise<number> {
    const result = await this.execute({ type: 'listLen', key });
    return result.type === 'count' ? result.data : 0;
  }

  async setMembers(key: string): Promise<string[]> {
    const result = await this.execute({ type: 'setMembers', key });
    return result.type === 'set' ? result.data : [];
  }

  async setAdd(key: string, members: string[]): Promise<number> {
    const result = await this.execute({ type: 'setAdd', key, members });
    return result.type === 'count' ? result.data : 0;
  }

  async setRemove(key: string, members: string[]): Promise<number> {
    const result = await this.execute({ type: 'setRemove', key, members });
    return result.type === 'count' ? result.data : 0;
  }

  async zsetRange(key: string, start: number, stop: number, withScores?: boolean): Promise<ZSetMember[]> {
    const result = await this.execute({ type: 'zSetRange', key, start, stop, with_scores: withScores ?? false });
    return result.type === 'zset' ? result.data : [];
  }

  async zsetAdd(key: string, members: ZSetMember[]): Promise<number> {
    const result = await this.execute({ type: 'zSetAdd', key, members });
    return result.type === 'count' ? result.data : 0;
  }

  async streamRange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]> {
    const result = await this.execute({ type: 'streamRange', key, start, end, count });
    return result.type === 'stream' ? result.data : [];
  }

  async streamLen(key: string): Promise<number> {
    const result = await this.execute({ type: 'streamLen', key });
    return result.type === 'count' ? result.data : 0;
  }
}
