/**
 * Redis-specific types for the key-value adapter
 */

export type RedisType = 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'unknown';

export type RedisValue = 
  | { type: 'nil' }
  | { type: 'string'; value: string }
  | { type: 'bytes'; value: number[] }
  | { type: 'integer'; value: number }
  | { type: 'float'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'array'; value: RedisValue[] }
  | { type: 'map'; value: Record<string, RedisValue> };

export interface ScanResult {
  cursor: string;
  keys: KeyInfo[];
}

export interface KeyInfo {
  key: string;
  keyType: RedisType;
  ttl: number;
  sizeBytes?: number;
}

export interface ZSetMember {
  member: string;
  score: number;
}

export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

export interface RedisConnectionConfig {
  host: string;
  port: number;
  database: number;
  user?: string;
  password?: string;
  ssl?: boolean;
  connectionString?: string;
  mode: 'standalone' | 'cluster' | 'sentinel';
  sentinelMaster?: string;
  nodes?: Array<{ host: string; port: number }>;
}

/**
 * Redis server info parsed from INFO command
 */
export interface RedisServerInfo {
  version?: string;
  mode?: 'standalone' | 'cluster' | 'sentinel';
  connectedClients?: number;
  usedMemory?: number;
  usedMemoryHuman?: string;
  totalSystemMemory?: number;
  maxMemory?: number;
  uptimeInSeconds?: number;
  loadedModules?: string[];
}

/**
 * Redis key pattern for sidebar grouping
 */
export interface KeyPattern {
  pattern: string;
  count: number;
  prefix: string;
}
