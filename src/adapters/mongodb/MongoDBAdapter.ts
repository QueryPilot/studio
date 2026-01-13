/**
 * MongoDB Frontend Adapter
 *
 * Provides client-side interface for MongoDB operations via Tauri IPC.
 */

import { invoke } from '@tauri-apps/api/core';
import { DbType, type DatabaseParadigm } from '@/types/connection';
import type {
  BaseAdapter,
  AdapterCapability,
  ConnectionTestResult,
} from '../capabilities';
import type {
  FindOptions,
  InsertResult,
  UpdateResult,
  DeleteResult,
  CollectionInfo,
  MongoDatabaseInfo,
} from '../types/mongodb';

/**
 * MongoDB adapter implementing document database operations
 */
export class MongoDBAdapter implements BaseAdapter {
  readonly connectionId: string;
  readonly dbType: DbType = DbType.MongoDB;
  readonly paradigm: DatabaseParadigm = 'document';

  private _connected = false;

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
    return ['document-queryable', 'schema-introspectable'];
  }

  // ============ Document Operations ============

  /**
   * Find documents in a collection
   */
  async findDocuments<T = Record<string, unknown>>(
    collection: string,
    filter: Record<string, unknown> = {},
    options?: FindOptions
  ): Promise<T[]> {
    return invoke('mongo_find_documents', {
      connId: this.connectionId,
      collection,
      filter,
      skip: options?.skip,
      limit: options?.limit,
      sort: options?.sort,
      projection: options?.projection,
    });
  }

  /**
   * Insert a single document
   */
  async insertDocument(
    collection: string,
    document: Record<string, unknown>
  ): Promise<InsertResult> {
    return invoke('mongo_insert_document', {
      connId: this.connectionId,
      collection,
      document,
    });
  }

  /**
   * Update a single document
   */
  async updateDocument(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<UpdateResult> {
    return invoke('mongo_update_document', {
      connId: this.connectionId,
      collection,
      filter,
      update,
    });
  }

  /**
   * Delete a single document
   */
  async deleteDocument(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<DeleteResult> {
    return invoke('mongo_delete_document', {
      connId: this.connectionId,
      collection,
      filter,
    });
  }

  /**
   * Run an aggregation pipeline
   */
  async aggregate<T = Record<string, unknown>>(
    collection: string,
    pipeline: Record<string, unknown>[]
  ): Promise<T[]> {
    return invoke('mongo_aggregate', {
      connId: this.connectionId,
      collection,
      pipeline,
    });
  }

  /**
   * Count documents in a collection
   */
  async countDocuments(
    collection: string,
    filter?: Record<string, unknown>
  ): Promise<number> {
    return invoke('mongo_count_documents', {
      connId: this.connectionId,
      collection,
      filter,
    });
  }

  /**
   * List all collections in the current database
   */
  async listCollections(): Promise<CollectionInfo[]> {
    return invoke('mongo_list_collections', {
      connId: this.connectionId,
    });
  }

  /**
   * List all databases
   */
  async listDatabases(): Promise<MongoDatabaseInfo[]> {
    const result = await invoke<{ name: string }[]>('mongo_list_databases', {
      connId: this.connectionId,
    });
    return result.map((db) => ({ name: db.name }));
  }
}
