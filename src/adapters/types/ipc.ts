/**
 * IPC types matching Rust enums in src-tauri/src/commands.rs
 */

import type { InsertResult, InsertManyResult, UpdateResult, DeleteResult, CollectionInfo } from './mongodb';
import type { RedisValue, RedisType, ScanResult, ZSetMember, StreamEntry } from './redis';
import type { SetOptions } from '../capabilities';

export type DocumentOperation =
  | { type: 'find'; collection: string; filter: object; skip?: number; limit?: number; sort?: Record<string, 1 | -1>; projection?: Record<string, 0 | 1> }
  | { type: 'insert'; collection: string; document: object }
  | { type: 'insert_many'; collection: string; documents: object[] }
  | { type: 'update'; collection: string; filter: object; update: object }
  | { type: 'delete'; collection: string; filter: object }
  | { type: 'aggregate'; collection: string; pipeline: object[] }
  | { type: 'count'; collection: string; filter?: object }
  | { type: 'list_collections' }
  | { type: 'run_command'; command: object };

export type DocumentResult =
  | { type: 'documents'; data: object[] }
  | { type: 'insert'; data: InsertResult }
  | { type: 'insert_many'; data: InsertManyResult }
  | { type: 'update'; data: UpdateResult }
  | { type: 'delete'; data: DeleteResult }
  | { type: 'count'; data: number }
  | { type: 'collections'; data: CollectionInfo[] }
  | { type: 'command'; data: object };

export type KeyValueOperation =
  | { type: 'get'; key: string }
  | { type: 'set'; key: string; value: RedisValue; options?: SetOptions }
  | { type: 'delete'; keys: string[] }
  | { type: 'exists'; keys: string[] }
  | { type: 'scan'; pattern: string; cursor: number; count: number }
  | { type: 'type'; key: string }
  | { type: 'ttl'; key: string }
  | { type: 'set_ttl'; key: string; seconds: number }
  | { type: 'execute_raw'; command: string; args: string[] }
  | { type: 'db_size' }
  | { type: 'select_db'; index: number }
  | { type: 'server_info'; section?: string }
  | { type: 'hash_get_all'; key: string }
  | { type: 'hash_set'; key: string; fields: Record<string, string> }
  | { type: 'hash_delete'; key: string; fields: string[] }
  | { type: 'list_range'; key: string; start: number; stop: number }
  | { type: 'list_push'; key: string; values: string[]; side: 'left' | 'right' }
  | { type: 'list_len'; key: string }
  | { type: 'set_members'; key: string }
  | { type: 'set_add'; key: string; members: string[] }
  | { type: 'set_remove'; key: string; members: string[] }
  | { type: 'zset_range'; key: string; start: number; stop: number; with_scores: boolean }
  | { type: 'zset_add'; key: string; members: ZSetMember[] }
  | { type: 'stream_range'; key: string; start: string; end: string; count?: number }
  | { type: 'stream_len'; key: string };

export type KeyValueResult =
  | { type: 'value'; data: RedisValue | null }
  | { type: 'ok' }
  | { type: 'count'; data: number }
  | { type: 'bool'; data: boolean }
  | { type: 'scan'; data: ScanResult }
  | { type: 'key_type'; data: RedisType }
  | { type: 'ttl'; data: number }
  | { type: 'server_info'; data: Record<string, string> }
  | { type: 'hash'; data: Record<string, string> }
  | { type: 'list'; data: string[] }
  | { type: 'set'; data: string[] }
  | { type: 'zset'; data: ZSetMember[] }
  | { type: 'stream'; data: StreamEntry[] };
