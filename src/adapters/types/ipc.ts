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
  | { type: 'setTtl'; key: string; seconds: number }
  | { type: 'executeRaw'; command: string; args: string[] }
  | { type: 'dbSize' }
  | { type: 'selectDb'; index: number }
  | { type: 'serverInfo'; section?: string }
  | { type: 'hashGetAll'; key: string }
  | { type: 'hashSet'; key: string; fields: Record<string, string> }
  | { type: 'hashDelete'; key: string; fields: string[] }
  | { type: 'listRange'; key: string; start: number; stop: number }
  | { type: 'listPush'; key: string; values: string[]; side: 'left' | 'right' }
  | { type: 'listLen'; key: string }
  | { type: 'setMembers'; key: string }
  | { type: 'setAdd'; key: string; members: string[] }
  | { type: 'setRemove'; key: string; members: string[] }
  | { type: 'zSetRange'; key: string; start: number; stop: number; with_scores: boolean }
  | { type: 'zSetAdd'; key: string; members: ZSetMember[] }
  | { type: 'streamRange'; key: string; start: string; end: string; count?: number }
  | { type: 'streamLen'; key: string };

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
