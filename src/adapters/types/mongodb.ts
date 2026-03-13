/**
 * MongoDB-specific types for the document adapter
 */

export interface FindOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
}

export interface CursorToken {
  lastId: unknown;
  lastSortValues?: Record<string, unknown>;
}

export interface FindPageOptions extends Omit<FindOptions, "skip"> {
  cursor?: CursorToken | null;
}

export interface DocumentPageResult<T = object> {
  documents: T[];
  nextCursor: CursorToken | null;
  hasMore: boolean;
}

export interface DocumentFieldStat {
  path: string;
  occurrences: number;
  nullCount: number;
  types: string[];
  sampleValues: unknown[];
}

export interface DocumentSchemaSample {
  sampleSize: number;
  scannedCount: number;
  fields: DocumentFieldStat[];
}

export interface InsertResult {
  insertedId: string;
}

export interface InsertManyResult {
  insertedIds: string[];
  insertedCount: number;
}

export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface DeleteResult {
  deletedCount: number;
}

export interface CollectionInfo {
  name: string;
  docCount?: number;
  sizeBytes?: number;
}

export type MongoIndexKeyValue = 1 | -1 | 'text';

export type MongoIndexKeySpec = Record<string, MongoIndexKeyValue>;

export interface MongoIndexOptions {
  name?: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  background?: boolean;
  defaultLanguage?: string;
  languageOverride?: string;
  weights?: Record<string, number>;
  partialFilterExpression?: Record<string, unknown>;
}

export interface MongoIndexInfo {
  name: string;
  keys: MongoIndexKeySpec;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  defaultLanguage?: string;
  languageOverride?: string;
  weights?: Record<string, number>;
  hidden?: boolean;
  textIndexVersion?: number;
  usageCount?: number;
  raw?: Record<string, unknown>;
}

export interface MongoConnectionConfig {
  hosts: Array<{ host: string; port: number }>;
  database?: string;
  authSource?: string;
  user?: string;
  password?: string;
  replicaSet?: string;
  ssl?: boolean;
  connectionString?: string;
  /** Use mongodb+srv:// DNS seed list (Atlas) */
  srv?: boolean;
  /** Force single-node connection (testing) */
  directConnection?: boolean;
  /** Application name for Atlas monitoring */
  appName?: string;
  /** Authentication mechanism */
  authMechanism?: 'SCRAM-SHA-256' | 'SCRAM-SHA-1' | 'MONGODB-X509' | 'MONGODB-AWS';
}

export interface AggregationStage {
  [operator: string]: unknown;
}

/**
 * MongoDB database info
 */
export interface MongoDatabaseInfo {
  name: string;
  sizeOnDisk?: number;
  empty?: boolean;
}

/**
 * MongoDB collection stats
 */
export interface CollectionStats {
  name: string;
  count: number;
  size: number;
  avgObjSize?: number;
  storageSize?: number;
  totalIndexSize?: number;
  indexCount?: number;
}

/**
 * MongoDB validation rules for a collection
 */
export interface ValidationRules {
  $jsonSchema?: Record<string, unknown>;
  clearValidator?: boolean;
  validationLevel?: 'off' | 'strict' | 'moderate';
  validationAction?: 'error' | 'warn';
}

export interface MongoCollectionMetadata {
  name: string;
  options?: Record<string, unknown>;
  validator?: Record<string, unknown>;
  validationLevel?: ValidationRules['validationLevel'];
  validationAction?: ValidationRules['validationAction'];
  stats?: Partial<CollectionStats>;
}

export interface CreateIndexResult {
  indexName: string;
}

export interface MongoFindExplainRequest {
  mode: 'find';
  filter?: object;
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
  skip?: number;
  limit?: number;
}

export interface MongoAggregateExplainRequest {
  mode: 'aggregate';
  pipeline: object[];
}

export type MongoExplainRequest =
  | MongoFindExplainRequest
  | MongoAggregateExplainRequest;

export type MongoExplainResult = Record<string, unknown>;
