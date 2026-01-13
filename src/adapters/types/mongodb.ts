/**
 * MongoDB-specific types for the document adapter
 */

export interface FindOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
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

export interface MongoIndexInfo {
  name: string;
  keys: Record<string, 1 | -1>;
  unique?: boolean;
  sparse?: boolean;
  ttl?: number;
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
  validationLevel?: 'off' | 'strict' | 'moderate';
  validationAction?: 'error' | 'warn';
}
