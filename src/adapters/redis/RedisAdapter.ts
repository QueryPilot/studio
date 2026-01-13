/**
 * Redis Frontend Adapter
 *
 * Provides client-side interface for Redis operations via Tauri IPC.
 */

import { invoke } from '@tauri-apps/api/core';
import { DbType, type DatabaseParadigm } from '@/types/connection';
import type {
  BaseAdapter,
  AdapterCapability,
  ConnectionTestResult,
} from '../capabilities';

/**
 * Redis adapter implementing key-value database operations
 */
export class RedisAdapter implements BaseAdapter {
  readonly connectionId: string;
  readonly dbType: DbType = DbType.Redis;
  readonly paradigm: DatabaseParadigm = 'keyvalue';

  private _connected = false;
  private _currentDb = 0;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  // ============ BaseAdapter Implementation ============

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

  // ============ Key-Value Operations ============

  /**
   * Get a string value
   */
  async getString(key: string): Promise<string | null> {
    return invoke('redis_get', {
      connId: this.connectionId,
      key,
    });
  }

  /**
   * Set a string value
   */
  async setString(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await invoke('redis_set', {
      connId: this.connectionId,
      key,
      value,
      ttlSeconds,
    });
  }

  /**
   * Delete a key
   */
  async deleteKey(key: string): Promise<number> {
    return invoke('redis_delete', {
      connId: this.connectionId,
      key,
    });
  }

  /**
   * Check if a key exists
   */
  async keyExists(key: string): Promise<boolean> {
    return invoke('redis_exists', {
      connId: this.connectionId,
      key,
    });
  }

  /**
   * Get TTL of a key (-1 if no expiry, -2 if key doesn't exist)
   */
  async getKeyTTL(key: string): Promise<number> {
    return invoke('redis_ttl', {
      connId: this.connectionId,
      key,
    });
  }

  /**
   * Set TTL on a key
   */
  async setKeyTTL(key: string, seconds: number): Promise<boolean> {
    return invoke('redis_expire', {
      connId: this.connectionId,
      key,
      seconds,
    });
  }

  /**
   * Get database size (number of keys)
   */
  async getDatabaseSize(): Promise<number> {
    return invoke('redis_dbsize', {
      connId: this.connectionId,
    });
  }

  /**
   * Get server info
   */
  async getServerInfo(): Promise<string> {
    return invoke('redis_info', {
      connId: this.connectionId,
    });
  }

  /**
   * Get current database index
   */
  getCurrentDatabase(): number {
    return this._currentDb;
  }

  // ============ Hash Operations ============

  /**
   * Get all fields and values from a hash
   */
  async hashGetAll(key: string): Promise<Record<string, string>> {
    return invoke('redis_hgetall', {
      connId: this.connectionId,
      key,
    });
  }

  /**
   * Set a hash field
   */
  async hashSet(key: string, field: string, value: string): Promise<boolean> {
    return invoke('redis_hset', {
      connId: this.connectionId,
      key,
      field,
      value,
    });
  }

  // ============ List Operations ============

  /**
   * Get list range
   */
  async listRange(key: string, start: number, stop: number): Promise<string[]> {
    return invoke('redis_lrange', {
      connId: this.connectionId,
      key,
      start,
      stop,
    });
  }

  // ============ Set Operations ============

  /**
   * Get set members
   */
  async setMembers(key: string): Promise<string[]> {
    return invoke('redis_smembers', {
      connId: this.connectionId,
      key,
    });
  }
}
