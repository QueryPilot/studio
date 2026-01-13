/**
 * Capability interfaces for database adapters
 * 
 * This module defines the capability-based interface system that allows different
 * database paradigms (SQL, Document, KeyValue) to be handled through a
 * common interface while still supporting paradigm-specific operations.
 */

import type { DbType, DatabaseParadigm } from '@/types/connection';
import type { 
  RedisValue, 
  RedisType, 
  ScanResult, 
  ZSetMember, 
  StreamEntry 
} from './types/redis';
import type { 
  FindOptions, 
  InsertResult, 
  InsertManyResult, 
  UpdateResult, 
  DeleteResult, 
  CollectionInfo 
} from './types/mongodb';

// ============ Base ============

export interface AdapterMetadata {
  dbType: DbType;
  paradigm: DatabaseParadigm;
  capabilities: AdapterCapability[];
  serverVersion?: string;
}

export type AdapterCapability = 
  | 'sql-queryable'
  | 'schema-introspectable'
  | 'document-queryable'
  | 'keyvalue-operable'
  | 'rich-keyvalue-operable';

export interface BaseAdapter {
  readonly connectionId: string;
  readonly dbType: DbType;
  readonly paradigm: DatabaseParadigm;
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  isConnected(): boolean;
  getCapabilities(): AdapterCapability[];
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  serverVersion?: string;
}

// ============ SQL ============

export interface SqlQueryable extends BaseAdapter {
  executeQuery(sql: string): Promise<CapabilityQueryResult>;
  executeStatement(sql: string): Promise<number>;
}

export interface CapabilityQueryResult {
  columns: CapabilityColumnMeta[];
  rows: Record<string, unknown>[];
}

export interface CapabilityColumnMeta {
  name: string;
  dataType: string;
}

// ============ Schema Introspection ============

export interface SchemaIntrospectable extends BaseAdapter {
  getDatabases(): Promise<DatabaseInfo[]>;
  getSchemas(database: string): Promise<SchemaInfo[]>;
  getTables(database: string, schema?: string): Promise<TableInfo[]>;
  getColumns(table: string): Promise<ColumnInfo[]>;
  getIndexes(table: string): Promise<IndexInfo[]>;
}

export interface DatabaseInfo {
  name: string;
}

export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  tableType: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  indexType?: string;
}

// ============ Document ============

export interface DocumentQueryable extends BaseAdapter {
  findDocuments(
    collection: string,
    filter: object,
    options?: FindOptions
  ): Promise<object[]>;
  
  insertDocument(collection: string, doc: object): Promise<InsertResult>;
  insertDocuments(collection: string, docs: object[]): Promise<InsertManyResult>;
  
  updateDocument(
    collection: string,
    filter: object,
    update: object
  ): Promise<UpdateResult>;
  
  deleteDocument(collection: string, filter: object): Promise<DeleteResult>;
  
  aggregate(collection: string, pipeline: object[]): Promise<object[]>;
  
  countDocuments(collection: string, filter?: object): Promise<number>;
  
  listCollections(): Promise<CollectionInfo[]>;
  
  runCommand(command: object): Promise<object>;
}

// ============ Key-Value ============

export interface KeyValueOperable extends BaseAdapter {
  getKey(key: string): Promise<RedisValue | null>;
  setKey(key: string, value: RedisValue, options?: SetOptions): Promise<void>;
  deleteKeys(keys: string[]): Promise<number>;
  keyExists(keys: string[]): Promise<number>;
  scanKeys(pattern: string, cursor?: string, count?: number): Promise<ScanResult>;
  getKeyType(key: string): Promise<RedisType>;
  getKeyTTL(key: string): Promise<number>;
  setKeyTTL(key: string, seconds: number): Promise<boolean>;
  executeRaw(command: string, args: string[]): Promise<RedisValue>;
  getDatabaseSize(): Promise<number>;
  selectDatabase(index: number): Promise<void>;
  getServerInfo(section?: string): Promise<Record<string, string>>;
}

export interface SetOptions {
  ttlSeconds?: number;
  /** Only set if not exists */
  nx?: boolean;
  /** Only set if exists */
  xx?: boolean;
}

// ============ Rich Key-Value ============

export interface RichKeyValueOperable extends KeyValueOperable {
  // Hash
  hashGetAll(key: string): Promise<Record<string, string>>;
  hashSet(key: string, fields: Record<string, string>): Promise<number>;
  hashDelete(key: string, fields: string[]): Promise<number>;
  
  // List
  listRange(key: string, start: number, stop: number): Promise<string[]>;
  listPush(key: string, values: string[], side: 'left' | 'right'): Promise<number>;
  listLen(key: string): Promise<number>;
  
  // Set
  setMembers(key: string): Promise<string[]>;
  setAdd(key: string, members: string[]): Promise<number>;
  setRemove(key: string, members: string[]): Promise<number>;
  
  // Sorted Set
  zsetRange(key: string, start: number, stop: number, withScores?: boolean): Promise<ZSetMember[]>;
  zsetAdd(key: string, members: ZSetMember[]): Promise<number>;
  
  // Stream
  streamRange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]>;
  streamLen(key: string): Promise<number>;
}

// ============ Type Guards ============

export function isSqlQueryable(adapter: BaseAdapter): adapter is SqlQueryable {
  return adapter.getCapabilities().includes('sql-queryable');
}

export function isSchemaIntrospectable(adapter: BaseAdapter): adapter is SchemaIntrospectable {
  return adapter.getCapabilities().includes('schema-introspectable');
}

export function isDocumentQueryable(adapter: BaseAdapter): adapter is DocumentQueryable {
  return adapter.getCapabilities().includes('document-queryable');
}

export function isKeyValueOperable(adapter: BaseAdapter): adapter is KeyValueOperable {
  return adapter.getCapabilities().includes('keyvalue-operable');
}

export function isRichKeyValueOperable(adapter: BaseAdapter): adapter is RichKeyValueOperable {
  return adapter.getCapabilities().includes('rich-keyvalue-operable');
}
