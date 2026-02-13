import { invoke } from '@tauri-apps/api/core';
import { DbType, type DatabaseParadigm } from '@/types/connection';
import type {
  BaseAdapter,
  AdapterCapability,
  ConnectionTestResult,
  DocumentQueryable,
} from '../capabilities';
import type {
  FindOptions,
  FindPageOptions,
  DocumentPageResult,
  DocumentSchemaSample,
  InsertResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  CollectionInfo,
  MongoDatabaseInfo,
} from '../types/mongodb';
import type { DocumentOperation, DocumentResult } from '../types/ipc';

export class MongoDBAdapter implements BaseAdapter, DocumentQueryable {
  readonly connectionId: string;
  readonly dbType: DbType = DbType.MongoDB;
  readonly paradigm: DatabaseParadigm = 'document';

  private _connected = false;

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
    return ['document-queryable', 'schema-introspectable'];
  }

  private async execute<T>(operation: DocumentOperation, database?: string): Promise<T> {
    const result = await invoke<DocumentResult>('document_execute', {
      connId: this.connectionId,
      operation,
      database: database ?? null,
    });
    return result.data as T;
  }

  async findDocuments(
    collection: string,
    filter: object = {},
    options?: FindOptions
  ): Promise<object[]> {
    return this.execute<object[]>({
      type: 'find',
      collection,
      filter,
      skip: options?.skip,
      limit: options?.limit,
      sort: options?.sort,
      projection: options?.projection,
    });
  }

  async findDocumentsPage(
    collection: string,
    filter: object = {},
    options?: FindPageOptions,
  ): Promise<DocumentPageResult<object>> {
    return this.execute<DocumentPageResult<object>>({
      type: 'findPage',
      collection,
      filter,
      limit: options?.limit,
      sort: options?.sort,
      projection: options?.projection,
      cursor: options?.cursor ?? undefined,
    });
  }

  async sampleCollectionSchema(
    collection: string,
    filter?: object,
    options?: { sampleSize?: number; maxDepth?: number },
  ): Promise<DocumentSchemaSample> {
    return this.execute<DocumentSchemaSample>({
      type: 'sampleSchema',
      collection,
      filter,
      sampleSize: options?.sampleSize,
      maxDepth: options?.maxDepth,
    });
  }

  async insertDocument(collection: string, document: object, database?: string): Promise<InsertResult> {
    return this.execute<InsertResult>({
      type: 'insert',
      collection,
      document,
    }, database);
  }

  async insertDocuments(collection: string, documents: object[]): Promise<InsertManyResult> {
    return this.execute<InsertManyResult>({
      type: 'insertMany',
      collection,
      documents,
    });
  }

  async updateDocument(
    collection: string,
    filter: object,
    update: object
  ): Promise<UpdateResult> {
    return this.execute<UpdateResult>({
      type: 'update',
      collection,
      filter,
      update,
    });
  }

  async deleteDocument(collection: string, filter: object): Promise<DeleteResult> {
    return this.execute<DeleteResult>({
      type: 'delete',
      collection,
      filter,
    });
  }

  async aggregate(collection: string, pipeline: object[]): Promise<object[]> {
    return this.execute<object[]>({
      type: 'aggregate',
      collection,
      pipeline,
    });
  }

  async countDocuments(collection: string, filter?: object): Promise<number> {
    return this.execute<number>({
      type: 'count',
      collection,
      filter,
    });
  }

  async listCollections(database?: string): Promise<CollectionInfo[]> {
    return this.execute<CollectionInfo[]>({
      type: 'listCollections',
    }, database);
  }

  async runCommand(command: object, database?: string): Promise<object> {
    return this.execute<object>({
      type: 'runCommand',
      command,
    }, database);
  }

  async listDatabases(): Promise<MongoDatabaseInfo[]> {
    const result = await invoke<{ name: string }[]>('mongo_list_databases', {
      connId: this.connectionId,
    });
    return result.map((db) => ({ name: db.name }));
  }
}
