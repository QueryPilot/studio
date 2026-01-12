# Redis & MongoDB Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Redis and MongoDB support to Query Pilot using capability-based architecture.

**Architecture:** Paradigm-level adapters (DocumentAdapter, KeyValueAdapter) extending BaseAdapter with composable capability traits. Backend uses `mongodb` and `fred` crates. Frontend uses TypeScript interfaces mirroring Rust traits. Communication via Tauri IPC with MessagePack streaming for large results.

**Tech Stack:** Rust (mongodb 3.4, fred 10.1), React 19, TypeScript, Zustand, CodeMirror, Tauri 2

---

## Phase 1: Foundation

### Task 1.1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add mongodb and fred crates**

Add to `[dependencies]` section:

```toml
# Document DB
mongodb = { version = "3.4", features = ["tokio-runtime"] }
bson = "2.11"

# Key-Value DB
fred = { version = "10.1", features = ["tokio-runtime", "sentinel-client", "replicas"] }
```

**Step 2: Verify dependencies resolve**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully (may take time to download crates)

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add mongodb and fred dependencies"
```

---

### Task 1.2: Extend DbType Enum

**Files:**
- Modify: `src-tauri/src/types.rs`
- Modify: `src/types/connection.ts`

**Step 1: Add MongoDB and Redis to Rust DbType**

In `src-tauri/src/types.rs`, find `DbType` enum and add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    #[serde(rename = "postgresql")]
    PostgreSQL,
    #[serde(rename = "mysql")]
    MySQL,
    #[serde(rename = "mariadb")]
    MariaDB,
    #[serde(rename = "sqlite")]
    SQLite,
    #[serde(rename = "sqlserver")]
    SQLServer,
    // New paradigms
    #[serde(rename = "mongodb")]
    MongoDB,
    #[serde(rename = "redis")]
    Redis,
}

impl DbType {
    pub fn paradigm(&self) -> DatabaseParadigm {
        match self {
            DbType::PostgreSQL | DbType::MySQL | DbType::MariaDB | 
            DbType::SQLite | DbType::SQLServer => DatabaseParadigm::Sql,
            DbType::MongoDB => DatabaseParadigm::Document,
            DbType::Redis => DatabaseParadigm::KeyValue,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseParadigm {
    Sql,
    Document,
    KeyValue,
}
```

**Step 2: Add to TypeScript types**

In `src/types/connection.ts`, update DbType:

```typescript
export type DbType = 
  | 'postgresql' 
  | 'mysql' 
  | 'mariadb' 
  | 'sqlite' 
  | 'sqlserver'
  | 'mongodb'
  | 'redis';

export type DatabaseParadigm = 'sql' | 'document' | 'keyvalue';

export function getParadigm(dbType: DbType): DatabaseParadigm {
  switch (dbType) {
    case 'postgresql':
    case 'mysql':
    case 'mariadb':
    case 'sqlite':
    case 'sqlserver':
      return 'sql';
    case 'mongodb':
      return 'document';
    case 'redis':
      return 'keyvalue';
  }
}
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Run: `pnpm typecheck`
Expected: Both pass

**Step 4: Commit**

```bash
git add src-tauri/src/types.rs src/types/connection.ts
git commit -m "feat: add MongoDB and Redis to DbType enum"
```

---

### Task 1.3: Create Capability Traits (Rust)

**Files:**
- Create: `src-tauri/src/core/capabilities.rs`
- Modify: `src-tauri/src/core/mod.rs`

**Step 1: Create capabilities module**

Create `src-tauri/src/core/capabilities.rs`:

```rust
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;

/// Base capability - all adapters implement this
#[async_trait]
pub trait BaseAdapter: Send + Sync {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), AppError>;
    async fn disconnect(&mut self) -> Result<(), AppError>;
    async fn test_connection(&self) -> Result<ConnectionTestResult, AppError>;
    fn is_connected(&self) -> bool;
    fn get_capabilities(&self) -> Vec<AdapterCapability>;
}

/// SQL databases only
#[async_trait]
pub trait SqlQueryable: BaseAdapter {
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>;
    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError>;
}

/// Schema introspection - SQL and MongoDB
#[async_trait]
pub trait SchemaIntrospectable: BaseAdapter {
    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError>;
    async fn get_schemas(&self, database: &str) -> Result<Vec<SchemaInfo>, AppError>;
    async fn get_tables(&self, database: &str, schema: Option<&str>) -> Result<Vec<TableInfo>, AppError>;
    async fn get_columns(&self, table: &str) -> Result<Vec<ColumnInfo>, AppError>;
    async fn get_indexes(&self, table: &str) -> Result<Vec<IndexInfo>, AppError>;
}

/// Document databases (MongoDB, CouchDB, Firestore)
#[async_trait]
pub trait DocumentQueryable: BaseAdapter {
    async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError>;
    
    async fn insert_document(&self, collection: &str, doc: Value) -> Result<InsertResult, AppError>;
    async fn insert_documents(&self, collection: &str, docs: Vec<Value>) -> Result<InsertManyResult, AppError>;
    
    async fn update_document(
        &self,
        collection: &str,
        filter: Value,
        update: Value,
    ) -> Result<UpdateResult, AppError>;
    
    async fn delete_document(&self, collection: &str, filter: Value) -> Result<DeleteResult, AppError>;
    
    async fn aggregate(&self, collection: &str, pipeline: Vec<Value>) -> Result<Vec<Value>, AppError>;
    
    async fn count_documents(&self, collection: &str, filter: Option<Value>) -> Result<u64, AppError>;
    
    async fn list_collections(&self) -> Result<Vec<CollectionInfo>, AppError>;
    
    async fn run_command(&self, command: Value) -> Result<Value, AppError>;
}

/// Key-value databases (all: Redis, Memcached, etcd)
#[async_trait]
pub trait KeyValueOperable: BaseAdapter {
    async fn get_key(&self, key: &str) -> Result<Option<RedisValue>, AppError>;
    async fn set_key(&self, key: &str, value: RedisValue, options: SetOptions) -> Result<(), AppError>;
    async fn delete_keys(&self, keys: &[String]) -> Result<u64, AppError>;
    async fn key_exists(&self, keys: &[String]) -> Result<u64, AppError>;
    async fn scan_keys(&self, pattern: &str, cursor: u64, count: u32) -> Result<ScanResult, AppError>;
    async fn get_key_type(&self, key: &str) -> Result<RedisType, AppError>;
    async fn get_key_ttl(&self, key: &str) -> Result<i64, AppError>;
    async fn set_key_ttl(&self, key: &str, seconds: u64) -> Result<bool, AppError>;
    async fn execute_raw(&self, command: &str, args: &[String]) -> Result<RedisValue, AppError>;
    async fn get_database_size(&self) -> Result<u64, AppError>;
    async fn select_database(&self, index: u8) -> Result<(), AppError>;
    async fn get_server_info(&self, section: Option<&str>) -> Result<HashMap<String, String>, AppError>;
}

/// Rich key-value (Redis, Valkey, KeyDB) - extends basic KV
#[async_trait]
pub trait RichKeyValueOperable: KeyValueOperable {
    // Hash
    async fn hash_get_all(&self, key: &str) -> Result<HashMap<String, String>, AppError>;
    async fn hash_set(&self, key: &str, fields: HashMap<String, String>) -> Result<u64, AppError>;
    async fn hash_delete(&self, key: &str, fields: &[String]) -> Result<u64, AppError>;
    
    // List
    async fn list_range(&self, key: &str, start: i64, stop: i64) -> Result<Vec<String>, AppError>;
    async fn list_push(&self, key: &str, values: &[String], side: ListSide) -> Result<u64, AppError>;
    async fn list_len(&self, key: &str) -> Result<u64, AppError>;
    
    // Set
    async fn set_members(&self, key: &str) -> Result<Vec<String>, AppError>;
    async fn set_add(&self, key: &str, members: &[String]) -> Result<u64, AppError>;
    async fn set_remove(&self, key: &str, members: &[String]) -> Result<u64, AppError>;
    
    // Sorted Set
    async fn zset_range(
        &self,
        key: &str,
        start: i64,
        stop: i64,
        with_scores: bool,
    ) -> Result<Vec<ZSetMember>, AppError>;
    async fn zset_add(&self, key: &str, members: &[ZSetMember]) -> Result<u64, AppError>;
    
    // Stream
    async fn stream_range(
        &self,
        key: &str,
        start: &str,
        end: &str,
        count: Option<u32>,
    ) -> Result<Vec<StreamEntry>, AppError>;
    async fn stream_len(&self, key: &str) -> Result<u64, AppError>;
}

// ============ Supporting Types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub db_type: crate::types::DbType,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub connection_string: Option<String>,
    pub options: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdapterCapability {
    SqlQueryable,
    SchemaIntrospectable,
    DocumentQueryable,
    KeyValueOperable,
    RichKeyValueOperable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindOptions {
    pub skip: Option<u64>,
    pub limit: Option<u64>,
    pub sort: Option<Value>,
    pub projection: Option<Value>,
}

impl Default for FindOptions {
    fn default() -> Self {
        Self {
            skip: None,
            limit: Some(100),
            sort: None,
            projection: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertResult {
    pub inserted_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertManyResult {
    pub inserted_ids: Vec<String>,
    pub inserted_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub matched_count: u64,
    pub modified_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResult {
    pub deleted_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    pub doc_count: Option<u64>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

// Redis-specific types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum RedisValue {
    Nil,
    String(String),
    Bytes(Vec<u8>),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Array(Vec<RedisValue>),
    Map(HashMap<String, RedisValue>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisType {
    String,
    List,
    Set,
    ZSet,
    Hash,
    Stream,
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SetOptions {
    pub ttl_seconds: Option<u64>,
    pub nx: bool, // Only set if not exists
    pub xx: bool, // Only set if exists
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub cursor: u64,
    pub keys: Vec<KeyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyInfo {
    pub key: String,
    pub key_type: RedisType,
    pub ttl: i64,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEntry {
    pub id: String,
    pub fields: HashMap<String, String>,
}
```

**Step 2: Export from core module**

In `src-tauri/src/core/mod.rs`, add:

```rust
pub mod capabilities;

pub use capabilities::*;
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add src-tauri/src/core/capabilities.rs src-tauri/src/core/mod.rs
git commit -m "feat: add capability traits for adapters"
```

---

### Task 1.4: Create Frontend Capability Interfaces

**Files:**
- Create: `src/adapters/capabilities.ts`
- Create: `src/adapters/types/redis.ts`
- Create: `src/adapters/types/mongodb.ts`

**Step 1: Create capability interfaces**

Create `src/adapters/capabilities.ts`:

```typescript
import type { DbType, DatabaseParadigm } from '@/types/connection';
import type { RedisValue, RedisType, ScanResult, KeyInfo, ZSetMember, StreamEntry } from './types/redis';
import type { 
  FindOptions, InsertResult, InsertManyResult, UpdateResult, 
  DeleteResult, CollectionInfo 
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
  executeQuery(sql: string): Promise<QueryResult>;
  executeStatement(sql: string): Promise<number>;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
}

export interface ColumnMeta {
  name: string;
  dataType: string;
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
  nx?: boolean;
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

export function isDocumentQueryable(adapter: BaseAdapter): adapter is DocumentQueryable {
  return adapter.getCapabilities().includes('document-queryable');
}

export function isKeyValueOperable(adapter: BaseAdapter): adapter is KeyValueOperable {
  return adapter.getCapabilities().includes('keyvalue-operable');
}

export function isRichKeyValueOperable(adapter: BaseAdapter): adapter is RichKeyValueOperable {
  return adapter.getCapabilities().includes('rich-keyvalue-operable');
}
```

**Step 2: Create Redis types**

Create `src/adapters/types/redis.ts`:

```typescript
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
```

**Step 3: Create MongoDB types**

Create `src/adapters/types/mongodb.ts`:

```typescript
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

export interface IndexInfo {
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
}

export interface AggregationStage {
  [operator: string]: unknown;
}
```

**Step 4: Export from adapters index**

Add to `src/adapters/index.ts`:

```typescript
export * from './capabilities';
export * from './types/redis';
export * from './types/mongodb';
```

**Step 5: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 6: Commit**

```bash
git add src/adapters/capabilities.ts src/adapters/types/redis.ts src/adapters/types/mongodb.ts src/adapters/index.ts
git commit -m "feat: add frontend capability interfaces and types"
```

---

### Task 1.5: Create Adapter Module Structure (Rust)

**Files:**
- Create: `src-tauri/src/adapters/mongodb/mod.rs`
- Create: `src-tauri/src/adapters/mongodb/adapter.rs`
- Create: `src-tauri/src/adapters/mongodb/types.rs`
- Create: `src-tauri/src/adapters/redis/mod.rs`
- Create: `src-tauri/src/adapters/redis/adapter.rs`
- Create: `src-tauri/src/adapters/redis/types.rs`
- Modify: `src-tauri/src/adapters/mod.rs`

**Step 1: Create MongoDB module structure**

Create `src-tauri/src/adapters/mongodb/mod.rs`:

```rust
mod adapter;
mod types;

pub use adapter::MongoDbAdapter;
pub use types::*;
```

Create `src-tauri/src/adapters/mongodb/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoConnectionConfig {
    pub hosts: Vec<HostPort>,
    pub database: Option<String>,
    pub auth_source: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub replica_set: Option<String>,
    pub ssl: bool,
    pub connection_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostPort {
    pub host: String,
    pub port: u16,
}

impl Default for MongoConnectionConfig {
    fn default() -> Self {
        Self {
            hosts: vec![HostPort {
                host: "localhost".to_string(),
                port: 27017,
            }],
            database: None,
            auth_source: None,
            username: None,
            password: None,
            replica_set: None,
            ssl: false,
            connection_string: None,
        }
    }
}
```

Create `src-tauri/src/adapters/mongodb/adapter.rs`:

```rust
use async_trait::async_trait;
use mongodb::{Client, Database};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;

pub struct MongoDbAdapter {
    client: Arc<RwLock<Option<Client>>>,
    database: Arc<RwLock<Option<Database>>>,
    connected: bool,
}

impl MongoDbAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            database: Arc::new(RwLock::new(None)),
            connected: false,
        }
    }
}

impl Default for MongoDbAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseAdapter for MongoDbAdapter {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), AppError> {
        // TODO: Implement in Phase 2
        todo!("MongoDB connect not yet implemented")
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let mut client = self.client.write().await;
        *client = None;
        let mut db = self.database.write().await;
        *db = None;
        self.connected = false;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult, AppError> {
        // TODO: Implement in Phase 2
        todo!("MongoDB test_connection not yet implemented")
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::DocumentQueryable,
            AdapterCapability::SchemaIntrospectable,
        ]
    }
}

// DocumentQueryable will be implemented in Phase 2
```

**Step 2: Create Redis module structure**

Create `src-tauri/src/adapters/redis/mod.rs`:

```rust
mod adapter;
mod types;

pub use adapter::RedisAdapter;
pub use types::*;
```

Create `src-tauri/src/adapters/redis/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConnectionConfig {
    pub host: String,
    pub port: u16,
    pub database: u8,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl: bool,
    pub connection_string: Option<String>,
    pub mode: RedisMode,
    pub sentinel_master: Option<String>,
    pub nodes: Vec<HostPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostPort {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisMode {
    Standalone,
    Cluster,
    Sentinel,
}

impl Default for RedisConnectionConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 6379,
            database: 0,
            username: None,
            password: None,
            ssl: false,
            connection_string: None,
            mode: RedisMode::Standalone,
            sentinel_master: None,
            nodes: vec![],
        }
    }
}
```

Create `src-tauri/src/adapters/redis/adapter.rs`:

```rust
use async_trait::async_trait;
use fred::prelude::*;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;

pub struct RedisAdapter {
    client: Arc<RwLock<Option<RedisClient>>>,
    connected: bool,
    current_db: u8,
}

impl RedisAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            connected: false,
            current_db: 0,
        }
    }
}

impl Default for RedisAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseAdapter for RedisAdapter {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), AppError> {
        // TODO: Implement in Phase 2
        todo!("Redis connect not yet implemented")
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let mut client = self.client.write().await;
        if let Some(c) = client.take() {
            let _ = c.quit().await;
        }
        self.connected = false;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult, AppError> {
        // TODO: Implement in Phase 2
        todo!("Redis test_connection not yet implemented")
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::KeyValueOperable,
            AdapterCapability::RichKeyValueOperable,
        ]
    }
}

// KeyValueOperable and RichKeyValueOperable will be implemented in Phase 2
```

**Step 3: Update adapters mod.rs**

In `src-tauri/src/adapters/mod.rs`, add:

```rust
pub mod mongodb;
pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod sqlite;

pub use mongodb::MongoDbAdapter;
pub use redis::RedisAdapter;
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles (with todo! warnings)

**Step 5: Commit**

```bash
git add src-tauri/src/adapters/
git commit -m "feat: add MongoDB and Redis adapter module structure"
```

---

## Phase 2: Core Implementation (Parallel Tracks)

### Task 2.1: MongoDB - Implement Connection

**Files:**
- Modify: `src-tauri/src/adapters/mongodb/adapter.rs`

**Step 1: Write test for MongoDB connection**

Create `src-tauri/tests/mongodb_adapter_test.rs`:

```rust
use querypilot::adapters::MongoDbAdapter;
use querypilot::core::capabilities::*;

#[tokio::test]
#[ignore] // Requires running MongoDB
async fn test_mongodb_connect() {
    let mut adapter = MongoDbAdapter::new();
    
    let config = ConnectionConfig {
        db_type: querypilot::types::DbType::MongoDB,
        host: "localhost".to_string(),
        port: 27017,
        database: Some("test".to_string()),
        username: None,
        password: None,
        connection_string: None,
        options: std::collections::HashMap::new(),
    };
    
    let result = adapter.connect(&config).await;
    assert!(result.is_ok());
    assert!(adapter.is_connected());
    
    adapter.disconnect().await.unwrap();
    assert!(!adapter.is_connected());
}
```

**Step 2: Implement connect method**

Update `src-tauri/src/adapters/mongodb/adapter.rs`:

```rust
use async_trait::async_trait;
use mongodb::{options::ClientOptions, Client, Database};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;

pub struct MongoDbAdapter {
    client: Arc<RwLock<Option<Client>>>,
    database: Arc<RwLock<Option<Database>>>,
    database_name: Arc<RwLock<String>>,
    connected: bool,
}

impl MongoDbAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            database: Arc::new(RwLock::new(None)),
            database_name: Arc::new(RwLock::new(String::new())),
            connected: false,
        }
    }

    fn build_connection_string(config: &ConnectionConfig) -> String {
        if let Some(conn_str) = &config.connection_string {
            return conn_str.clone();
        }

        let auth = match (&config.username, &config.password) {
            (Some(u), Some(p)) => format!("{}:{}@", u, p),
            _ => String::new(),
        };

        let db = config.database.as_deref().unwrap_or("admin");
        
        format!(
            "mongodb://{}{}:{}/{}",
            auth, config.host, config.port, db
        )
    }
}

impl Default for MongoDbAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseAdapter for MongoDbAdapter {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), AppError> {
        let conn_str = Self::build_connection_string(config);
        
        let client_options = ClientOptions::parse(&conn_str)
            .await
            .map_err(|e| AppError::Connection(format!("Failed to parse MongoDB URI: {}", e)))?;
        
        let client = Client::with_options(client_options)
            .map_err(|e| AppError::Connection(format!("Failed to create MongoDB client: {}", e)))?;
        
        // Verify connection with ping
        client
            .database("admin")
            .run_command(bson::doc! { "ping": 1 })
            .await
            .map_err(|e| AppError::Connection(format!("Failed to ping MongoDB: {}", e)))?;
        
        let db_name = config.database.clone().unwrap_or_else(|| "test".to_string());
        let database = client.database(&db_name);
        
        *self.client.write().await = Some(client);
        *self.database.write().await = Some(database);
        *self.database_name.write().await = db_name;
        self.connected = true;
        
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        *self.client.write().await = None;
        *self.database.write().await = None;
        self.connected = false;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult, AppError> {
        let client = self.client.read().await;
        
        match client.as_ref() {
            Some(c) => {
                let start = Instant::now();
                
                let result = c
                    .database("admin")
                    .run_command(bson::doc! { "ping": 1 })
                    .await;
                
                let latency = start.elapsed().as_millis() as u64;
                
                match result {
                    Ok(_) => {
                        // Get server version
                        let build_info = c
                            .database("admin")
                            .run_command(bson::doc! { "buildInfo": 1 })
                            .await
                            .ok();
                        
                        let version = build_info
                            .and_then(|doc| doc.get_str("version").ok().map(|s| s.to_string()));
                        
                        Ok(ConnectionTestResult {
                            success: true,
                            message: "Connection successful".to_string(),
                            latency_ms: Some(latency),
                            server_version: version,
                        })
                    }
                    Err(e) => Ok(ConnectionTestResult {
                        success: false,
                        message: format!("Ping failed: {}", e),
                        latency_ms: Some(latency),
                        server_version: None,
                    }),
                }
            }
            None => Ok(ConnectionTestResult {
                success: false,
                message: "Not connected".to_string(),
                latency_ms: None,
                server_version: None,
            }),
        }
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::DocumentQueryable,
            AdapterCapability::SchemaIntrospectable,
        ]
    }
}
```

**Step 3: Run test (requires MongoDB running)**

Run: `cd src-tauri && cargo test mongodb_adapter_test -- --ignored`
Expected: PASS (if MongoDB is running on localhost:27017)

**Step 4: Commit**

```bash
git add src-tauri/src/adapters/mongodb/adapter.rs src-tauri/tests/mongodb_adapter_test.rs
git commit -m "feat(mongodb): implement connection and test_connection"
```

---

### Task 2.2: Redis - Implement Connection

**Files:**
- Modify: `src-tauri/src/adapters/redis/adapter.rs`

**Step 1: Write test for Redis connection**

Create `src-tauri/tests/redis_adapter_test.rs`:

```rust
use querypilot::adapters::RedisAdapter;
use querypilot::core::capabilities::*;

#[tokio::test]
#[ignore] // Requires running Redis
async fn test_redis_connect() {
    let mut adapter = RedisAdapter::new();
    
    let config = ConnectionConfig {
        db_type: querypilot::types::DbType::Redis,
        host: "localhost".to_string(),
        port: 6379,
        database: Some("0".to_string()),
        username: None,
        password: None,
        connection_string: None,
        options: std::collections::HashMap::new(),
    };
    
    let result = adapter.connect(&config).await;
    assert!(result.is_ok());
    assert!(adapter.is_connected());
    
    adapter.disconnect().await.unwrap();
    assert!(!adapter.is_connected());
}
```

**Step 2: Implement connect method**

Update `src-tauri/src/adapters/redis/adapter.rs`:

```rust
use async_trait::async_trait;
use fred::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;

pub struct RedisAdapter {
    client: Arc<RwLock<Option<RedisClient>>>,
    connected: bool,
    current_db: u8,
}

impl RedisAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            connected: false,
            current_db: 0,
        }
    }

    fn build_config(config: &ConnectionConfig) -> Result<RedisConfig, AppError> {
        if let Some(conn_str) = &config.connection_string {
            return RedisConfig::from_url(conn_str)
                .map_err(|e| AppError::Connection(format!("Invalid Redis URL: {}", e)));
        }

        let mut redis_config = RedisConfig::default();
        
        redis_config.server = ServerConfig::Centralized {
            server: Server::new(config.host.clone(), config.port),
        };
        
        if let Some(password) = &config.password {
            redis_config.password = Some(password.clone());
        }
        
        if let Some(username) = &config.username {
            redis_config.username = Some(username.clone());
        }
        
        if let Some(db) = &config.database {
            if let Ok(db_num) = db.parse::<u8>() {
                redis_config.database = Some(db_num);
            }
        }
        
        Ok(redis_config)
    }
}

impl Default for RedisAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseAdapter for RedisAdapter {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), AppError> {
        let redis_config = Self::build_config(config)?;
        
        let client = RedisClient::new(
            redis_config,
            None,  // perf config
            None,  // connection config  
            None,  // reconnect policy
        );
        
        client.connect();
        client
            .wait_for_connect()
            .await
            .map_err(|e| AppError::Connection(format!("Failed to connect to Redis: {}", e)))?;
        
        // Verify with PING
        let _: String = client
            .ping(None)
            .await
            .map_err(|e| AppError::Connection(format!("Redis PING failed: {}", e)))?;
        
        self.current_db = config
            .database
            .as_ref()
            .and_then(|d| d.parse().ok())
            .unwrap_or(0);
        
        *self.client.write().await = Some(client);
        self.connected = true;
        
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let mut client = self.client.write().await;
        if let Some(c) = client.take() {
            c.quit().await.ok();
        }
        self.connected = false;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult, AppError> {
        let client = self.client.read().await;
        
        match client.as_ref() {
            Some(c) => {
                let start = Instant::now();
                
                let result: Result<String, _> = c.ping(None).await;
                let latency = start.elapsed().as_millis() as u64;
                
                match result {
                    Ok(_) => {
                        // Get server version from INFO
                        let info: Result<String, _> = c.info(Some(InfoKind::Server)).await;
                        
                        let version = info.ok().and_then(|info_str| {
                            info_str
                                .lines()
                                .find(|line| line.starts_with("redis_version:"))
                                .map(|line| line.trim_start_matches("redis_version:").to_string())
                        });
                        
                        Ok(ConnectionTestResult {
                            success: true,
                            message: "Connection successful".to_string(),
                            latency_ms: Some(latency),
                            server_version: version,
                        })
                    }
                    Err(e) => Ok(ConnectionTestResult {
                        success: false,
                        message: format!("PING failed: {}", e),
                        latency_ms: Some(latency),
                        server_version: None,
                    }),
                }
            }
            None => Ok(ConnectionTestResult {
                success: false,
                message: "Not connected".to_string(),
                latency_ms: None,
                server_version: None,
            }),
        }
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::KeyValueOperable,
            AdapterCapability::RichKeyValueOperable,
        ]
    }
}
```

**Step 3: Run test (requires Redis running)**

Run: `cd src-tauri && cargo test redis_adapter_test -- --ignored`
Expected: PASS (if Redis is running on localhost:6379)

**Step 4: Commit**

```bash
git add src-tauri/src/adapters/redis/adapter.rs src-tauri/tests/redis_adapter_test.rs
git commit -m "feat(redis): implement connection and test_connection"
```

---

### Task 2.3: Add Tauri Commands for MongoDB

**Files:**
- Create: `src-tauri/src/commands/mongodb.rs`
- Modify: `src-tauri/src/commands/mod.rs` (or `src-tauri/src/commands.rs`)
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create MongoDB commands**

Create `src-tauri/src/commands/mongodb.rs` (or add to existing commands file):

```rust
use serde_json::Value;
use tauri::State;
use std::sync::Arc;

use crate::core::capabilities::*;
use crate::state::ConnectionManager;

#[tauri::command]
pub async fn mongo_list_collections(
    connection_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<CollectionInfo>, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .list_collections()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_find_documents(
    connection_id: String,
    collection: String,
    filter: Value,
    skip: Option<u64>,
    limit: Option<u64>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<Value>, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    let options = FindOptions {
        skip,
        limit: limit.or(Some(100)),
        sort: None,
        projection: None,
    };
    
    adapter
        .find_documents(&collection, filter, options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_insert_document(
    connection_id: String,
    collection: String,
    document: Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<InsertResult, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .insert_document(&collection, document)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_update_document(
    connection_id: String,
    collection: String,
    filter: Value,
    update: Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<UpdateResult, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .update_document(&collection, filter, update)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_delete_document(
    connection_id: String,
    collection: String,
    filter: Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DeleteResult, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .delete_document(&collection, filter)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_aggregate(
    connection_id: String,
    collection: String,
    pipeline: Vec<Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<Value>, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .aggregate(&collection, pipeline)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mongo_count_documents(
    connection_id: String,
    collection: String,
    filter: Option<Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let adapter = manager
        .get_mongo_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .count_documents(&collection, filter)
        .await
        .map_err(|e| e.to_string())
}
```

**Step 2: Register commands in lib.rs**

Add to the Tauri builder invoke_handler:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::mongodb::mongo_list_collections,
    commands::mongodb::mongo_find_documents,
    commands::mongodb::mongo_insert_document,
    commands::mongodb::mongo_update_document,
    commands::mongodb::mongo_delete_document,
    commands::mongodb::mongo_aggregate,
    commands::mongodb::mongo_count_documents,
])
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

**Step 4: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs
git commit -m "feat(mongodb): add Tauri commands for CRUD operations"
```

---

### Task 2.4: Add Tauri Commands for Redis

**Files:**
- Create: `src-tauri/src/commands/redis.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create Redis commands**

Create `src-tauri/src/commands/redis.rs`:

```rust
use serde_json::Value;
use tauri::State;
use std::sync::Arc;
use std::collections::HashMap;

use crate::core::capabilities::*;
use crate::state::ConnectionManager;

#[tauri::command]
pub async fn redis_scan_keys(
    connection_id: String,
    pattern: String,
    cursor: u64,
    count: Option<u32>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<ScanResult, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .scan_keys(&pattern, cursor, count.unwrap_or(100))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_get_key(
    connection_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Option<RedisValue>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .get_key(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_set_key(
    connection_id: String,
    key: String,
    value: RedisValue,
    ttl_seconds: Option<u64>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    let options = SetOptions {
        ttl_seconds,
        ..Default::default()
    };
    
    adapter
        .set_key(&key, value, options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_delete_keys(
    connection_id: String,
    keys: Vec<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .delete_keys(&keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_get_key_type(
    connection_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<RedisType, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .get_key_type(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_get_key_ttl(
    connection_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .get_key_ttl(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_set_key_ttl(
    connection_id: String,
    key: String,
    seconds: u64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .set_key_ttl(&key, seconds)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_execute_command(
    connection_id: String,
    command: String,
    args: Vec<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<RedisValue, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .execute_raw(&command, &args)
        .await
        .map_err(|e| e.to_string())
}

// Rich KV operations

#[tauri::command]
pub async fn redis_hash_get_all(
    connection_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<HashMap<String, String>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .hash_get_all(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_hash_set(
    connection_id: String,
    key: String,
    fields: HashMap<String, String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .hash_set(&key, fields)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_list_range(
    connection_id: String,
    key: String,
    start: i64,
    stop: i64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .list_range(&key, start, stop)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_set_members(
    connection_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .set_members(&key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_zset_range(
    connection_id: String,
    key: String,
    start: i64,
    stop: i64,
    with_scores: bool,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<ZSetMember>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .zset_range(&key, start, stop, with_scores)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_get_server_info(
    connection_id: String,
    section: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<HashMap<String, String>, String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .get_server_info(section.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_select_database(
    connection_id: String,
    index: u8,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let adapter = manager
        .get_redis_adapter(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    
    adapter
        .select_database(index)
        .await
        .map_err(|e| e.to_string())
}
```

**Step 2: Register commands in lib.rs**

Add to the Tauri builder invoke_handler:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    // Redis commands
    commands::redis::redis_scan_keys,
    commands::redis::redis_get_key,
    commands::redis::redis_set_key,
    commands::redis::redis_delete_keys,
    commands::redis::redis_get_key_type,
    commands::redis::redis_get_key_ttl,
    commands::redis::redis_set_key_ttl,
    commands::redis::redis_execute_command,
    commands::redis::redis_hash_get_all,
    commands::redis::redis_hash_set,
    commands::redis::redis_list_range,
    commands::redis::redis_set_members,
    commands::redis::redis_zset_range,
    commands::redis::redis_get_server_info,
    commands::redis::redis_select_database,
])
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

**Step 4: Commit**

```bash
git add src-tauri/src/commands/redis.rs src-tauri/src/lib.rs
git commit -m "feat(redis): add Tauri commands for key-value operations"
```

---

### Task 2.5: Create Frontend MongoDB Adapter

**Files:**
- Create: `src/adapters/mongodb/MongoDBAdapter.ts`
- Create: `src/adapters/mongodb/index.ts`

**Step 1: Create MongoDB adapter**

Create `src/adapters/mongodb/MongoDBAdapter.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  BaseAdapter,
  DocumentQueryable,
  AdapterCapability,
  ConnectionTestResult,
} from '../capabilities';
import type {
  FindOptions,
  InsertResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  CollectionInfo,
} from '../types/mongodb';

export class MongoDBAdapter implements DocumentQueryable {
  readonly connectionId: string;
  readonly dbType = 'mongodb' as const;
  readonly paradigm = 'document' as const;
  
  private _connected = false;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  async connect(): Promise<void> {
    await invoke('connect', { connectionId: this.connectionId });
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    await invoke('disconnect', { connectionId: this.connectionId });
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

  // DocumentQueryable implementation

  async findDocuments(
    collection: string,
    filter: object = {},
    options?: FindOptions
  ): Promise<object[]> {
    return invoke('mongo_find_documents', {
      connectionId: this.connectionId,
      collection,
      filter,
      skip: options?.skip,
      limit: options?.limit,
    });
  }

  async insertDocument(collection: string, doc: object): Promise<InsertResult> {
    return invoke('mongo_insert_document', {
      connectionId: this.connectionId,
      collection,
      document: doc,
    });
  }

  async insertDocuments(collection: string, docs: object[]): Promise<InsertManyResult> {
    return invoke('mongo_insert_documents', {
      connectionId: this.connectionId,
      collection,
      documents: docs,
    });
  }

  async updateDocument(
    collection: string,
    filter: object,
    update: object
  ): Promise<UpdateResult> {
    return invoke('mongo_update_document', {
      connectionId: this.connectionId,
      collection,
      filter,
      update,
    });
  }

  async deleteDocument(collection: string, filter: object): Promise<DeleteResult> {
    return invoke('mongo_delete_document', {
      connectionId: this.connectionId,
      collection,
      filter,
    });
  }

  async aggregate(collection: string, pipeline: object[]): Promise<object[]> {
    return invoke('mongo_aggregate', {
      connectionId: this.connectionId,
      collection,
      pipeline,
    });
  }

  async countDocuments(collection: string, filter?: object): Promise<number> {
    return invoke('mongo_count_documents', {
      connectionId: this.connectionId,
      collection,
      filter,
    });
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return invoke('mongo_list_collections', {
      connectionId: this.connectionId,
    });
  }

  async runCommand(command: object): Promise<object> {
    return invoke('mongo_run_command', {
      connectionId: this.connectionId,
      command,
    });
  }
}
```

Create `src/adapters/mongodb/index.ts`:

```typescript
export { MongoDBAdapter } from './MongoDBAdapter';
export * from '../types/mongodb';
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 3: Commit**

```bash
git add src/adapters/mongodb/
git commit -m "feat(mongodb): add frontend MongoDB adapter"
```

---

### Task 2.6: Create Frontend Redis Adapter

**Files:**
- Create: `src/adapters/redis/RedisAdapter.ts`
- Create: `src/adapters/redis/index.ts`

**Step 1: Create Redis adapter**

Create `src/adapters/redis/RedisAdapter.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  BaseAdapter,
  RichKeyValueOperable,
  AdapterCapability,
  ConnectionTestResult,
  SetOptions,
} from '../capabilities';
import type {
  RedisValue,
  RedisType,
  ScanResult,
  ZSetMember,
  StreamEntry,
} from '../types/redis';

export class RedisAdapter implements RichKeyValueOperable {
  readonly connectionId: string;
  readonly dbType = 'redis' as const;
  readonly paradigm = 'keyvalue' as const;
  
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
    await invoke('disconnect', { connectionId: this.connectionId });
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

  // KeyValueOperable implementation

  async getKey(key: string): Promise<RedisValue | null> {
    return invoke('redis_get_key', {
      connectionId: this.connectionId,
      key,
    });
  }

  async setKey(key: string, value: RedisValue, options?: SetOptions): Promise<void> {
    return invoke('redis_set_key', {
      connectionId: this.connectionId,
      key,
      value,
      ttlSeconds: options?.ttlSeconds,
    });
  }

  async deleteKeys(keys: string[]): Promise<number> {
    return invoke('redis_delete_keys', {
      connectionId: this.connectionId,
      keys,
    });
  }

  async keyExists(keys: string[]): Promise<number> {
    return invoke('redis_key_exists', {
      connectionId: this.connectionId,
      keys,
    });
  }

  async scanKeys(pattern: string, cursor = '0', count = 100): Promise<ScanResult> {
    return invoke('redis_scan_keys', {
      connectionId: this.connectionId,
      pattern,
      cursor: parseInt(cursor, 10),
      count,
    });
  }

  async getKeyType(key: string): Promise<RedisType> {
    return invoke('redis_get_key_type', {
      connectionId: this.connectionId,
      key,
    });
  }

  async getKeyTTL(key: string): Promise<number> {
    return invoke('redis_get_key_ttl', {
      connectionId: this.connectionId,
      key,
    });
  }

  async setKeyTTL(key: string, seconds: number): Promise<boolean> {
    return invoke('redis_set_key_ttl', {
      connectionId: this.connectionId,
      key,
      seconds,
    });
  }

  async executeRaw(command: string, args: string[]): Promise<RedisValue> {
    return invoke('redis_execute_command', {
      connectionId: this.connectionId,
      command,
      args,
    });
  }

  async getDatabaseSize(): Promise<number> {
    return invoke('redis_get_database_size', {
      connectionId: this.connectionId,
    });
  }

  async selectDatabase(index: number): Promise<void> {
    await invoke('redis_select_database', {
      connectionId: this.connectionId,
      index,
    });
    this._currentDb = index;
  }

  async getServerInfo(section?: string): Promise<Record<string, string>> {
    return invoke('redis_get_server_info', {
      connectionId: this.connectionId,
      section,
    });
  }

  // RichKeyValueOperable implementation

  async hashGetAll(key: string): Promise<Record<string, string>> {
    return invoke('redis_hash_get_all', {
      connectionId: this.connectionId,
      key,
    });
  }

  async hashSet(key: string, fields: Record<string, string>): Promise<number> {
    return invoke('redis_hash_set', {
      connectionId: this.connectionId,
      key,
      fields,
    });
  }

  async hashDelete(key: string, fields: string[]): Promise<number> {
    return invoke('redis_hash_delete', {
      connectionId: this.connectionId,
      key,
      fields,
    });
  }

  async listRange(key: string, start: number, stop: number): Promise<string[]> {
    return invoke('redis_list_range', {
      connectionId: this.connectionId,
      key,
      start,
      stop,
    });
  }

  async listPush(key: string, values: string[], side: 'left' | 'right'): Promise<number> {
    return invoke('redis_list_push', {
      connectionId: this.connectionId,
      key,
      values,
      side,
    });
  }

  async listLen(key: string): Promise<number> {
    return invoke('redis_list_len', {
      connectionId: this.connectionId,
      key,
    });
  }

  async setMembers(key: string): Promise<string[]> {
    return invoke('redis_set_members', {
      connectionId: this.connectionId,
      key,
    });
  }

  async setAdd(key: string, members: string[]): Promise<number> {
    return invoke('redis_set_add', {
      connectionId: this.connectionId,
      key,
      members,
    });
  }

  async setRemove(key: string, members: string[]): Promise<number> {
    return invoke('redis_set_remove', {
      connectionId: this.connectionId,
      key,
      members,
    });
  }

  async zsetRange(
    key: string,
    start: number,
    stop: number,
    withScores = true
  ): Promise<ZSetMember[]> {
    return invoke('redis_zset_range', {
      connectionId: this.connectionId,
      key,
      start,
      stop,
      withScores,
    });
  }

  async zsetAdd(key: string, members: ZSetMember[]): Promise<number> {
    return invoke('redis_zset_add', {
      connectionId: this.connectionId,
      key,
      members,
    });
  }

  async streamRange(
    key: string,
    start: string,
    end: string,
    count?: number
  ): Promise<StreamEntry[]> {
    return invoke('redis_stream_range', {
      connectionId: this.connectionId,
      key,
      start,
      end,
      count,
    });
  }

  async streamLen(key: string): Promise<number> {
    return invoke('redis_stream_len', {
      connectionId: this.connectionId,
      key,
    });
  }

  get currentDatabase(): number {
    return this._currentDb;
  }
}
```

Create `src/adapters/redis/index.ts`:

```typescript
export { RedisAdapter } from './RedisAdapter';
export * from '../types/redis';
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 3: Commit**

```bash
git add src/adapters/redis/
git commit -m "feat(redis): add frontend Redis adapter"
```

---

## Phase 3: Editors

### Task 3.1: Create DocumentEditor Base Component

**Files:**
- Create: `src/components/DocumentEditor/index.tsx`
- Create: `src/components/DocumentEditor/types.ts`
- Create: `src/components/DocumentEditor/Breadcrumb.tsx`

**Step 1: Create types**

Create `src/components/DocumentEditor/types.ts`:

```typescript
export interface DocumentNode {
  key: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
  path: string[];
  expanded?: boolean;
  children?: DocumentNode[];
}

export interface DocumentEditorProps {
  document: object;
  onUpdate?: (path: string[], value: unknown) => void;
  onDelete?: (path: string[]) => void;
  readOnly?: boolean;
  maxDepth?: number;
}

export interface BreadcrumbProps {
  path: string[];
  onNavigate: (path: string[]) => void;
}

export interface TreeViewProps {
  nodes: DocumentNode[];
  focusPath: string[];
  onToggle: (path: string[]) => void;
  onSelect: (path: string[]) => void;
  onEdit: (path: string[], value: unknown) => void;
}
```

**Step 2: Create Breadcrumb component**

Create `src/components/DocumentEditor/Breadcrumb.tsx`:

```typescript
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbProps {
  path: string[];
  rootLabel?: string;
  onNavigate: (path: string[]) => void;
}

export function Breadcrumb({ path, rootLabel = 'root', onNavigate }: BreadcrumbProps) {
  const segments = [rootLabel, ...path];

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground px-3 py-2 border-b bg-muted/30">
      <span className="text-xs">📍</span>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const segmentPath = path.slice(0, index);

        return (
          <span key={index} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3" />}
            <button
              onClick={() => onNavigate(segmentPath)}
              className={cn(
                'hover:text-foreground transition-colors',
                isLast && 'text-foreground font-medium'
              )}
              disabled={isLast}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
```

**Step 3: Create main DocumentEditor component**

Create `src/components/DocumentEditor/index.tsx`:

```typescript
import { useState, useMemo, useCallback } from 'react';
import { Breadcrumb } from './Breadcrumb';
import { TreeView } from './TreeView';
import type { DocumentEditorProps, DocumentNode } from './types';

function parseDocument(obj: unknown, path: string[] = []): DocumentNode[] {
  if (obj === null) {
    return [{ key: 'null', value: null, type: 'null', path }];
  }

  if (typeof obj !== 'object') {
    return [];
  }

  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj);

  return entries.map(([key, value]) => {
    const nodePath = [...path, key];
    const type = getValueType(value);

    const node: DocumentNode = {
      key,
      value,
      type,
      path: nodePath,
      expanded: false,
    };

    if (type === 'object' || type === 'array') {
      node.children = parseDocument(value, nodePath);
    }

    return node;
  });
}

function getValueType(value: unknown): DocumentNode['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

export function DocumentEditor({
  document,
  onUpdate,
  onDelete,
  readOnly = false,
  maxDepth = 10,
}: DocumentEditorProps) {
  const [focusPath, setFocusPath] = useState<string[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const nodes = useMemo(() => parseDocument(document), [document]);

  const handleToggle = useCallback((path: string[]) => {
    const pathKey = path.join('.');
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  }, []);

  const handleNavigate = useCallback((path: string[]) => {
    setFocusPath(path);
    // Auto-expand parent paths
    const pathsToExpand = path.map((_, i) => path.slice(0, i + 1).join('.'));
    setExpandedPaths((prev) => new Set([...prev, ...pathsToExpand]));
  }, []);

  const handleEdit = useCallback(
    (path: string[], value: unknown) => {
      if (!readOnly && onUpdate) {
        onUpdate(path, value);
      }
    },
    [readOnly, onUpdate]
  );

  return (
    <div className="flex flex-col h-full bg-background border rounded-md">
      <Breadcrumb path={focusPath} onNavigate={handleNavigate} />
      <div className="flex-1 overflow-auto p-2">
        <TreeView
          nodes={nodes}
          focusPath={focusPath}
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          onSelect={setFocusPath}
          onEdit={handleEdit}
          readOnly={readOnly}
          maxDepth={maxDepth}
        />
      </div>
    </div>
  );
}

export * from './types';
```

**Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: May fail due to missing TreeView - that's next task

**Step 5: Commit**

```bash
git add src/components/DocumentEditor/
git commit -m "feat: add DocumentEditor base component with Breadcrumb"
```

---

### Task 3.2: Create TreeView Component

**Files:**
- Create: `src/components/DocumentEditor/TreeView.tsx`
- Create: `src/components/DocumentEditor/TreeNode.tsx`
- Create: `src/components/DocumentEditor/FieldEditor.tsx`

**Step 1: Create FieldEditor for inline editing**

Create `src/components/DocumentEditor/FieldEditor.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';

interface FieldEditorProps {
  value: unknown;
  type: string;
  onSave: (value: unknown) => void;
  onCancel: () => void;
}

export function FieldEditor({ value, type, onSave, onCancel }: FieldEditorProps) {
  const [editValue, setEditValue] = useState(
    type === 'object' || type === 'array' ? JSON.stringify(value, null, 2) : String(value ?? '')
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    let parsedValue: unknown = editValue;

    try {
      if (type === 'number') {
        parsedValue = Number(editValue);
        if (isNaN(parsedValue as number)) return;
      } else if (type === 'boolean') {
        parsedValue = editValue.toLowerCase() === 'true';
      } else if (type === 'null') {
        parsedValue = null;
      } else if (type === 'object' || type === 'array') {
        parsedValue = JSON.parse(editValue);
      }
    } catch {
      return; // Invalid input
    }

    onSave(parsedValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-6 text-xs font-mono"
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave}>
        <Check className="h-3 w-3 text-green-500" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel}>
        <X className="h-3 w-3 text-red-500" />
      </Button>
    </div>
  );
}
```

**Step 2: Create TreeNode component**

Create `src/components/DocumentEditor/TreeNode.tsx`:

```typescript
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldEditor } from './FieldEditor';
import type { DocumentNode } from './types';

interface TreeNodeProps {
  node: DocumentNode;
  depth: number;
  isExpanded: boolean;
  isFocused: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: (value: unknown) => void;
  readOnly: boolean;
  maxDepth: number;
  expandedPaths: Set<string>;
  onTogglePath: (path: string[]) => void;
  onSelectPath: (path: string[]) => void;
  onEditPath: (path: string[], value: unknown) => void;
}

const TYPE_COLORS: Record<string, string> = {
  string: 'text-green-600 dark:text-green-400',
  number: 'text-blue-600 dark:text-blue-400',
  boolean: 'text-purple-600 dark:text-purple-400',
  null: 'text-gray-500',
  object: 'text-foreground',
  array: 'text-foreground',
};

export function TreeNode({
  node,
  depth,
  isExpanded,
  isFocused,
  onToggle,
  onSelect,
  onEdit,
  readOnly,
  maxDepth,
  expandedPaths,
  onTogglePath,
  onSelectPath,
  onEditPath,
}: TreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isExpandable = (node.type === 'object' || node.type === 'array') && hasChildren;
  const atMaxDepth = depth >= maxDepth;

  const formatValue = (value: unknown, type: string): string => {
    if (type === 'null') return 'null';
    if (type === 'string') return `"${value}"`;
    if (type === 'object') return `{${node.children?.length || 0} fields}`;
    if (type === 'array') return `[${node.children?.length || 0} items]`;
    return String(value);
  };

  const handleDoubleClick = () => {
    if (!readOnly && node.type !== 'object' && node.type !== 'array') {
      setIsEditing(true);
    }
  };

  const handleSave = (value: unknown) => {
    onEdit(value);
    setIsEditing(false);
  };

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer hover:bg-muted/50',
          isFocused && 'bg-muted ring-1 ring-primary/50'
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expand/Collapse toggle */}
        <span className="w-4 h-4 flex items-center justify-center">
          {isExpandable && !atMaxDepth ? (
            <button onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </span>

        {/* Key */}
        <span className="text-sm font-medium text-muted-foreground">{node.key}:</span>

        {/* Value */}
        {isEditing ? (
          <FieldEditor
            value={node.value}
            type={node.type}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <span className={cn('text-sm font-mono', TYPE_COLORS[node.type])}>
            {formatValue(node.value, node.type)}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && !atMaxDepth && (
        <div>
          {node.children!.map((child) => {
            const childPathKey = child.path.join('.');
            return (
              <TreeNode
                key={childPathKey}
                node={child}
                depth={depth + 1}
                isExpanded={expandedPaths.has(childPathKey)}
                isFocused={false}
                onToggle={() => onTogglePath(child.path)}
                onSelect={() => onSelectPath(child.path)}
                onEdit={(value) => onEditPath(child.path, value)}
                readOnly={readOnly}
                maxDepth={maxDepth}
                expandedPaths={expandedPaths}
                onTogglePath={onTogglePath}
                onSelectPath={onSelectPath}
                onEditPath={onEditPath}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create TreeView component**

Create `src/components/DocumentEditor/TreeView.tsx`:

```typescript
import { TreeNode } from './TreeNode';
import type { DocumentNode } from './types';

interface TreeViewProps {
  nodes: DocumentNode[];
  focusPath: string[];
  expandedPaths: Set<string>;
  onToggle: (path: string[]) => void;
  onSelect: (path: string[]) => void;
  onEdit: (path: string[], value: unknown) => void;
  readOnly: boolean;
  maxDepth: number;
}

export function TreeView({
  nodes,
  focusPath,
  expandedPaths,
  onToggle,
  onSelect,
  onEdit,
  readOnly,
  maxDepth,
}: TreeViewProps) {
  const focusPathKey = focusPath.join('.');

  return (
    <div className="font-mono text-sm">
      {nodes.map((node) => {
        const pathKey = node.path.join('.');
        return (
          <TreeNode
            key={pathKey}
            node={node}
            depth={0}
            isExpanded={expandedPaths.has(pathKey)}
            isFocused={pathKey === focusPathKey}
            onToggle={() => onToggle(node.path)}
            onSelect={() => onSelect(node.path)}
            onEdit={(value) => onEdit(node.path, value)}
            readOnly={readOnly}
            maxDepth={maxDepth}
            expandedPaths={expandedPaths}
            onTogglePath={onToggle}
            onSelectPath={onSelect}
            onEditPath={onEdit}
          />
        );
      })}
    </div>
  );
}
```

**Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 5: Commit**

```bash
git add src/components/DocumentEditor/
git commit -m "feat: add TreeView and TreeNode components for DocumentEditor"
```

---

### Task 3.3: Create ValueDrawer Component

**Files:**
- Create: `src/components/ValueDrawer/index.tsx`
- Create: `src/components/ValueDrawer/types.ts`

**Step 1: Create types**

Create `src/components/ValueDrawer/types.ts`:

```typescript
import type { RedisType, RedisValue } from '@/adapters/types/redis';

export interface ValueDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export interface RedisValueDrawerProps {
  open: boolean;
  onClose: () => void;
  keyName: string;
  keyType: RedisType;
  value: RedisValue | null;
  ttl: number;
  onSave?: (value: RedisValue) => void;
  onDelete?: () => void;
  onSetTTL?: (seconds: number) => void;
  readOnly?: boolean;
}

export interface MongoDocumentDrawerProps {
  open: boolean;
  onClose: () => void;
  collection: string;
  document: object | null;
  onSave?: (document: object) => void;
  onDelete?: () => void;
  readOnly?: boolean;
}
```

**Step 2: Create ValueDrawer component**

Create `src/components/ValueDrawer/index.tsx`:

```typescript
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ValueDrawerProps } from './types';

export function ValueDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: ValueDrawerProps) {
  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 w-[400px] bg-background border-l shadow-xl',
        'transform transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

export * from './types';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/ValueDrawer/
git commit -m "feat: add ValueDrawer base component"
```

---

### Task 3.4: Create Redis StringEditor

**Files:**
- Create: `src/components/RedisValueEditors/StringEditor.tsx`
- Create: `src/components/RedisValueEditors/types.ts`
- Create: `src/components/RedisValueEditors/index.ts`

**Step 1: Create types**

Create `src/components/RedisValueEditors/types.ts`:

```typescript
import type { RedisValue } from '@/adapters/types/redis';

export interface RedisEditorProps<T = RedisValue> {
  value: T;
  onChange: (value: T) => void;
  readOnly?: boolean;
}

export interface StringEditorProps extends RedisEditorProps<string> {
  isJson?: boolean;
}

export interface HashEditorProps extends RedisEditorProps<Record<string, string>> {}

export interface ListEditorProps extends RedisEditorProps<string[]> {
  onPush?: (value: string, side: 'left' | 'right') => void;
  onPop?: (side: 'left' | 'right') => void;
}

export interface SetEditorProps extends RedisEditorProps<string[]> {
  onAdd?: (member: string) => void;
  onRemove?: (member: string) => void;
}

export interface ZSetEditorProps extends RedisEditorProps<Array<{ member: string; score: number }>> {
  onAdd?: (member: string, score: number) => void;
  onRemove?: (member: string) => void;
}
```

**Step 2: Create StringEditor**

Create `src/components/RedisValueEditors/StringEditor.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { StringEditorProps } from './types';

export function StringEditor({ value, onChange, readOnly = false }: StringEditorProps) {
  const [viewMode, setViewMode] = useState<'raw' | 'formatted'>('raw');

  const isValidJson = useMemo(() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  const formattedValue = useMemo(() => {
    if (!isValidJson) return value;
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }, [value, isValidJson]);

  const displayValue = viewMode === 'formatted' ? formattedValue : value;

  const handleChange = (newValue: string) => {
    if (readOnly) return;
    
    if (viewMode === 'formatted' && isValidJson) {
      // Minify back when saving from formatted view
      try {
        const parsed = JSON.parse(newValue);
        onChange(JSON.stringify(parsed));
      } catch {
        onChange(newValue);
      }
    } else {
      onChange(newValue);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {isValidJson && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">JSON detected</span>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as 'raw' | 'formatted')}
            size="sm"
          >
            <ToggleGroupItem value="raw" className="text-xs">
              Raw
            </ToggleGroupItem>
            <ToggleGroupItem value="formatted" className="text-xs">
              Formatted
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <Textarea
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        readOnly={readOnly}
        className={cn(
          'font-mono text-sm min-h-[200px] resize-y',
          readOnly && 'bg-muted cursor-not-allowed'
        )}
        placeholder="Enter string value..."
      />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{value.length} characters</span>
        <span>{new Blob([value]).size} bytes</span>
      </div>
    </div>
  );
}
```

**Step 3: Create index export**

Create `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export * from './types';
```

**Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 5: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis StringEditor component"
```

---

### Task 3.5: Create Redis HashEditor

**Files:**
- Modify: `src/components/RedisValueEditors/HashEditor.tsx`
- Modify: `src/components/RedisValueEditors/index.ts`

**Step 1: Create HashEditor**

Create `src/components/RedisValueEditors/HashEditor.tsx`:

```typescript
import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { HashEditorProps } from './types';

export function HashEditor({ value, onChange, readOnly = false }: HashEditorProps) {
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const entries = Object.entries(value);

  const handleAdd = () => {
    if (!newField.trim() || readOnly) return;
    
    onChange({
      ...value,
      [newField.trim()]: newValue,
    });
    setNewField('');
    setNewValue('');
  };

  const handleDelete = (field: string) => {
    if (readOnly) return;
    
    const updated = { ...value };
    delete updated[field];
    onChange(updated);
  };

  const handleEdit = (field: string) => {
    setEditingField(field);
    setEditValue(value[field]);
  };

  const handleSaveEdit = () => {
    if (editingField === null || readOnly) return;
    
    onChange({
      ...value,
      [editingField]: editValue,
    });
    setEditingField(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {entries.length} field{entries.length !== 1 ? 's' : ''}
      </div>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Field</TableHead>
              <TableHead>Value</TableHead>
              {!readOnly && <TableHead className="w-[80px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([field, val]) => (
              <TableRow key={field}>
                <TableCell className="font-mono text-sm">{field}</TableCell>
                <TableCell>
                  {editingField === field ? (
                    <div className="flex gap-1">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, handleSaveEdit)}
                        className="h-7 text-sm font-mono"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveEdit}>
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="font-mono text-sm cursor-pointer hover:bg-muted px-1 rounded"
                      onDoubleClick={() => handleEdit(field)}
                    >
                      {val}
                    </span>
                  )}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(field)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}

            {/* Add new field row */}
            {!readOnly && (
              <TableRow>
                <TableCell>
                  <Input
                    value={newField}
                    onChange={(e) => setNewField(e.target.value)}
                    placeholder="New field..."
                    className="h-7 text-sm"
                    onKeyDown={(e) => handleKeyDown(e, handleAdd)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Value..."
                    className="h-7 text-sm font-mono"
                    onKeyDown={(e) => handleKeyDown(e, handleAdd)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleAdd}
                    disabled={!newField.trim()}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 2: Update exports**

Update `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export { HashEditor } from './HashEditor';
export * from './types';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis HashEditor component"
```

---

### Task 3.6: Create Redis ListEditor

**Files:**
- Create: `src/components/RedisValueEditors/ListEditor.tsx`
- Modify: `src/components/RedisValueEditors/index.ts`

**Step 1: Create ListEditor**

Create `src/components/RedisValueEditors/ListEditor.tsx`:

```typescript
import { useState } from 'react';
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ListEditorProps } from './types';

export function ListEditor({
  value,
  onChange,
  onPush,
  onPop,
  readOnly = false,
}: ListEditorProps) {
  const [newValue, setNewValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = (side: 'left' | 'right') => {
    if (!newValue.trim() || readOnly) return;

    if (onPush) {
      onPush(newValue.trim(), side);
    } else {
      const updated =
        side === 'left' ? [newValue.trim(), ...value] : [...value, newValue.trim()];
      onChange(updated);
    }
    setNewValue('');
  };

  const handleDelete = (index: number) => {
    if (readOnly) return;
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(value[index]);
  };

  const handleSaveEdit = () => {
    if (editingIndex === null || readOnly) return;
    const updated = [...value];
    updated[editingIndex] = editValue;
    onChange(updated);
    setEditingIndex(null);
    setEditValue('');
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (readOnly) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= value.length) return;

    const updated = [...value];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {value.length} item{value.length !== 1 ? 's' : ''}
      </div>

      {/* Add new item */}
      {!readOnly && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAdd('left')}
            disabled={!newValue.trim()}
          >
            <ArrowUp className="h-3 w-3 mr-1" />
            LPUSH
          </Button>
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="New item..."
            className="flex-1 h-8 text-sm font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd('right');
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAdd('right')}
            disabled={!newValue.trim()}
          >
            RPUSH
            <ArrowDown className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}

      {/* List items */}
      <div className="border rounded-md divide-y">
        {value.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Empty list
          </div>
        ) : (
          value.map((item, index) => (
            <div
              key={index}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50',
                editingIndex === index && 'bg-muted'
              )}
            >
              {!readOnly && (
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
              )}

              <span className="text-xs text-muted-foreground w-8">[{index}]</span>

              {editingIndex === index ? (
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') setEditingIndex(null);
                  }}
                  onBlur={handleSaveEdit}
                  className="flex-1 h-7 text-sm font-mono"
                  autoFocus
                />
              ) : (
                <span
                  className="flex-1 font-mono text-sm cursor-pointer truncate"
                  onDoubleClick={() => handleEdit(index)}
                >
                  {item}
                </span>
              )}

              {!readOnly && (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleMove(index, 'up')}
                    disabled={index === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleMove(index, 'down')}
                    disabled={index === value.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={() => handleDelete(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Update exports**

Update `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export { HashEditor } from './HashEditor';
export { ListEditor } from './ListEditor';
export * from './types';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis ListEditor component"
```

---

### Task 3.7: Create Redis SetEditor

**Files:**
- Create: `src/components/RedisValueEditors/SetEditor.tsx`
- Modify: `src/components/RedisValueEditors/index.ts`

**Step 1: Create SetEditor**

Create `src/components/RedisValueEditors/SetEditor.tsx`:

```typescript
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { SetEditorProps } from './types';

export function SetEditor({
  value,
  onChange,
  onAdd,
  onRemove,
  readOnly = false,
}: SetEditorProps) {
  const [newMember, setNewMember] = useState('');

  const handleAdd = () => {
    if (!newMember.trim() || readOnly) return;
    if (value.includes(newMember.trim())) return; // Sets don't allow duplicates

    if (onAdd) {
      onAdd(newMember.trim());
    } else {
      onChange([...value, newMember.trim()]);
    }
    setNewMember('');
  };

  const handleRemove = (member: string) => {
    if (readOnly) return;

    if (onRemove) {
      onRemove(member);
    } else {
      onChange(value.filter((m) => m !== member));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {value.length} member{value.length !== 1 ? 's' : ''}
      </div>

      {/* Add new member */}
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            placeholder="Add member..."
            className="flex-1 h-8 text-sm font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newMember.trim() || value.includes(newMember.trim())}
          >
            <Plus className="h-3 w-3 mr-1" />
            SADD
          </Button>
        </div>
      )}

      {/* Members as tags */}
      <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[100px] bg-muted/20">
        {value.length === 0 ? (
          <span className="text-sm text-muted-foreground">Empty set</span>
        ) : (
          value.map((member) => (
            <Badge
              key={member}
              variant="secondary"
              className="font-mono text-sm py-1 px-2 gap-1"
            >
              {member}
              {!readOnly && (
                <button
                  onClick={() => handleRemove(member)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Update exports**

Update `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export { HashEditor } from './HashEditor';
export { ListEditor } from './ListEditor';
export { SetEditor } from './SetEditor';
export * from './types';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis SetEditor component"
```

---

### Task 3.8: Create Redis ZSetEditor

**Files:**
- Create: `src/components/RedisValueEditors/ZSetEditor.tsx`
- Modify: `src/components/RedisValueEditors/index.ts`

**Step 1: Create ZSetEditor**

Create `src/components/RedisValueEditors/ZSetEditor.tsx`:

```typescript
import { useState } from 'react';
import { Plus, Trash2, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ZSetEditorProps } from './types';

export function ZSetEditor({
  value,
  onChange,
  onAdd,
  onRemove,
  readOnly = false,
}: ZSetEditorProps) {
  const [newMember, setNewMember] = useState('');
  const [newScore, setNewScore] = useState('0');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const sortedValue = [...value].sort((a, b) =>
    sortOrder === 'desc' ? b.score - a.score : a.score - b.score
  );

  const handleAdd = () => {
    if (!newMember.trim() || readOnly) return;
    const score = parseFloat(newScore);
    if (isNaN(score)) return;

    if (onAdd) {
      onAdd(newMember.trim(), score);
    } else {
      // Check if member already exists
      const existing = value.findIndex((m) => m.member === newMember.trim());
      if (existing >= 0) {
        // Update score
        const updated = [...value];
        updated[existing] = { member: newMember.trim(), score };
        onChange(updated);
      } else {
        onChange([...value, { member: newMember.trim(), score }]);
      }
    }
    setNewMember('');
    setNewScore('0');
  };

  const handleRemove = (member: string) => {
    if (readOnly) return;

    if (onRemove) {
      onRemove(member);
    } else {
      onChange(value.filter((m) => m.member !== member));
    }
  };

  const toggleSort = () => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {value.length} member{value.length !== 1 ? 's' : ''}
        </span>
        <Button size="sm" variant="ghost" onClick={toggleSort}>
          <ArrowUpDown className="h-3 w-3 mr-1" />
          Score {sortOrder === 'desc' ? '↓' : '↑'}
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-[120px]">Score</TableHead>
              {!readOnly && <TableHead className="w-[60px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedValue.map(({ member, score }) => (
              <TableRow key={member}>
                <TableCell className="font-mono text-sm">{member}</TableCell>
                <TableCell className="font-mono text-sm text-blue-600 dark:text-blue-400">
                  {score}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleRemove(member)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}

            {/* Add new member row */}
            {!readOnly && (
              <TableRow>
                <TableCell>
                  <Input
                    value={newMember}
                    onChange={(e) => setNewMember(e.target.value)}
                    placeholder="Member..."
                    className="h-7 text-sm font-mono"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={newScore}
                    onChange={(e) => setNewScore(e.target.value)}
                    className="h-7 text-sm font-mono"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleAdd}
                    disabled={!newMember.trim()}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 2: Update exports**

Update `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export { HashEditor } from './HashEditor';
export { ListEditor } from './ListEditor';
export { SetEditor } from './SetEditor';
export { ZSetEditor } from './ZSetEditor';
export * from './types';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis ZSetEditor component"
```

---

### Task 3.9: Create Redis StreamViewer and FallbackEditor

**Files:**
- Create: `src/components/RedisValueEditors/StreamViewer.tsx`
- Create: `src/components/RedisValueEditors/FallbackEditor.tsx`
- Modify: `src/components/RedisValueEditors/index.ts`

**Step 1: Create StreamViewer (read-only)**

Create `src/components/RedisValueEditors/StreamViewer.tsx`:

```typescript
import { Clock } from 'lucide-react';
import type { StreamEntry } from '@/adapters/types/redis';

interface StreamViewerProps {
  entries: StreamEntry[];
  streamLength: number;
}

export function StreamViewer({ entries, streamLength }: StreamViewerProps) {
  const parseTimestamp = (id: string): Date | null => {
    const [timestamp] = id.split('-');
    const ms = parseInt(timestamp, 10);
    if (isNaN(ms)) return null;
    return new Date(ms);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        Showing {entries.length} of {streamLength} entries (streams are append-only)
      </div>

      <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Empty stream
          </div>
        ) : (
          entries.map((entry) => {
            const timestamp = parseTimestamp(entry.id);

            return (
              <div key={entry.id} className="p-3">
                {/* Entry header */}
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {entry.id}
                  </code>
                  {timestamp && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timestamp.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Entry fields */}
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {Object.entries(entry.fields).map(([field, value]) => (
                    <div key={field} className="contents">
                      <span className="text-muted-foreground">{field}:</span>
                      <span className="font-mono truncate">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create FallbackEditor**

Create `src/components/RedisValueEditors/FallbackEditor.tsx`:

```typescript
import { AlertTriangle, Copy, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { RedisType } from '@/adapters/types/redis';

interface FallbackEditorProps {
  keyName: string;
  keyType: RedisType;
  rawValue: string;
  ttl: number;
  sizeBytes?: number;
  encoding?: string;
  onCopy?: () => void;
  onDelete?: () => void;
  onSetTTL?: () => void;
}

export function FallbackEditor({
  keyName,
  keyType,
  rawValue,
  ttl,
  sizeBytes,
  encoding,
  onCopy,
  onDelete,
  onSetTTL,
}: FallbackEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="default">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No specialized editor for type <code className="font-mono">{keyType}</code>.
          Showing raw value (read-only).
        </AlertDescription>
      </Alert>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="text-muted-foreground">Type:</div>
        <div className="font-mono">{keyType}</div>

        <div className="text-muted-foreground">TTL:</div>
        <div className="font-mono flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {ttl === -1 ? 'No expiry' : ttl === -2 ? 'Key not found' : `${ttl}s`}
        </div>

        {sizeBytes !== undefined && (
          <>
            <div className="text-muted-foreground">Size:</div>
            <div className="font-mono">{sizeBytes} bytes</div>
          </>
        )}

        {encoding && (
          <>
            <div className="text-muted-foreground">Encoding:</div>
            <div className="font-mono">{encoding}</div>
          </>
        )}
      </div>

      {/* Raw value */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">Raw Value:</div>
        <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
          {rawValue}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {onCopy && (
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="h-3 w-3 mr-1" />
            Copy Value
          </Button>
        )}
        {onSetTTL && (
          <Button size="sm" variant="outline" onClick={onSetTTL}>
            <Clock className="h-3 w-3 mr-1" />
            Set TTL
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3 mr-1" />
            Delete Key
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Update exports**

Update `src/components/RedisValueEditors/index.ts`:

```typescript
export { StringEditor } from './StringEditor';
export { HashEditor } from './HashEditor';
export { ListEditor } from './ListEditor';
export { SetEditor } from './SetEditor';
export { ZSetEditor } from './ZSetEditor';
export { StreamViewer } from './StreamViewer';
export { FallbackEditor } from './FallbackEditor';
export * from './types';
```

**Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 5: Commit**

```bash
git add src/components/RedisValueEditors/
git commit -m "feat: add Redis StreamViewer and FallbackEditor components"
```

---

### Task 3.10: Create MQL Editor (CodeMirror JavaScript mode)

**Files:**
- Create: `src/components/CodeEditor/MqlEditor.tsx`
- Modify: `src/components/CodeEditor/index.ts`

**Step 1: Create MqlEditor**

Create `src/components/CodeEditor/MqlEditor.tsx`:

```typescript
import { forwardRef, useEffect, useImperativeHandle, useRef, useMemo } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeExtensions } from './themes';

export interface MqlEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
}

interface MqlEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  onExecute?: (query: string) => void;
  readOnly?: boolean;
  height?: string;
  placeholder?: string;
}

export const MqlEditor = forwardRef<MqlEditorHandle, MqlEditorProps>(
  (
    {
      initialValue = '',
      onChange,
      onExecute,
      readOnly = false,
      height = '200px',
      placeholder = 'db.collection.find({ field: "value" })',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();

    const themeCompartment = useMemo(() => new Compartment(), []);

    useImperativeHandle(ref, () => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (value: string) => {
        if (viewRef.current) {
          viewRef.current.dispatch({
            changes: {
              from: 0,
              to: viewRef.current.state.doc.length,
              insert: value,
            },
          });
        }
      },
      focus: () => viewRef.current?.focus(),
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const executeKeymap = keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            if (onExecute && viewRef.current) {
              onExecute(viewRef.current.state.doc.toString());
            }
            return true;
          },
        },
      ]);

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
      });

      const state = EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          syntaxHighlighting(defaultHighlightStyle),
          bracketMatching(),
          autocompletion(),
          highlightActiveLine(),
          javascript(), // Use JavaScript mode for MQL
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
          ]),
          executeKeymap,
          updateListener,
          themeCompartment.of(getThemeExtensions(theme)),
          EditorView.editable.of(!readOnly),
          EditorView.theme({
            '&': { height },
            '.cm-scroller': { overflow: 'auto' },
          }),
          EditorView.contentAttributes.of({
            'aria-label': 'MongoDB Query Editor',
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []); // Only run once on mount

    // Update theme when it changes
    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: themeCompartment.reconfigure(getThemeExtensions(theme)),
        });
      }
    }, [theme, themeCompartment]);

    return (
      <div
        ref={containerRef}
        className="border rounded-md overflow-hidden"
        data-placeholder={placeholder}
      />
    );
  }
);

MqlEditor.displayName = 'MqlEditor';
```

**Step 2: Update CodeEditor exports**

Update `src/components/CodeEditor/index.ts` to add:

```typescript
export { MqlEditor } from './MqlEditor';
export type { MqlEditorHandle } from './MqlEditor';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/CodeEditor/
git commit -m "feat: add MqlEditor component for MongoDB queries"
```

---

### Task 3.11: Create Redis CLI Editor

**Files:**
- Create: `src/components/CodeEditor/RedisEditor.tsx`
- Modify: `src/components/CodeEditor/index.ts`

**Step 1: Create RedisEditor**

Create `src/components/CodeEditor/RedisEditor.tsx`:

```typescript
import { forwardRef, useEffect, useImperativeHandle, useRef, useMemo } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  CompletionContext,
} from '@codemirror/autocomplete';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeExtensions } from './themes';

// Redis commands for autocomplete
const REDIS_COMMANDS = [
  'GET', 'SET', 'DEL', 'EXISTS', 'EXPIRE', 'TTL', 'KEYS', 'SCAN',
  'HGET', 'HSET', 'HGETALL', 'HDEL', 'HKEYS', 'HVALS', 'HMSET', 'HMGET',
  'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LRANGE', 'LLEN', 'LINDEX', 'LSET',
  'SADD', 'SREM', 'SMEMBERS', 'SISMEMBER', 'SCARD', 'SUNION', 'SINTER',
  'ZADD', 'ZREM', 'ZRANGE', 'ZRANGEBYSCORE', 'ZSCORE', 'ZCARD', 'ZRANK',
  'XADD', 'XREAD', 'XRANGE', 'XLEN', 'XINFO',
  'PING', 'INFO', 'DBSIZE', 'FLUSHDB', 'SELECT', 'CONFIG', 'CLIENT',
  'MULTI', 'EXEC', 'WATCH', 'UNWATCH', 'DISCARD',
  'PUBLISH', 'SUBSCRIBE', 'PSUBSCRIBE',
  'JSON.GET', 'JSON.SET', 'JSON.DEL', // RedisJSON
  'FT.SEARCH', 'FT.CREATE', // RediSearch
];

const redisCompletions = (context: CompletionContext) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const input = word.text.toUpperCase();
  const options = REDIS_COMMANDS
    .filter((cmd) => cmd.startsWith(input))
    .map((cmd) => ({
      label: cmd,
      type: 'keyword',
    }));

  return {
    from: word.from,
    options,
  };
};

export interface RedisEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
}

interface RedisEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  onExecute?: (command: string) => void;
  readOnly?: boolean;
  height?: string;
  placeholder?: string;
}

export const RedisEditor = forwardRef<RedisEditorHandle, RedisEditorProps>(
  (
    {
      initialValue = '',
      onChange,
      onExecute,
      readOnly = false,
      height = '100px',
      placeholder = 'HGETALL user:123',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();

    const themeCompartment = useMemo(() => new Compartment(), []);

    useImperativeHandle(ref, () => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (value: string) => {
        if (viewRef.current) {
          viewRef.current.dispatch({
            changes: {
              from: 0,
              to: viewRef.current.state.doc.length,
              insert: value,
            },
          });
        }
      },
      focus: () => viewRef.current?.focus(),
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const executeKeymap = keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            if (onExecute && viewRef.current) {
              onExecute(viewRef.current.state.doc.toString());
            }
            return true;
          },
        },
        {
          key: 'Enter',
          run: () => {
            // Execute on Enter for single-line commands
            if (onExecute && viewRef.current) {
              const doc = viewRef.current.state.doc.toString();
              if (!doc.includes('\n')) {
                onExecute(doc);
                return true;
              }
            }
            return false;
          },
        },
      ]);

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
      });

      const state = EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          syntaxHighlighting(defaultHighlightStyle),
          highlightActiveLine(),
          StreamLanguage.define(shell), // Use shell mode for Redis CLI
          autocompletion({ override: [redisCompletions] }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
          ]),
          executeKeymap,
          updateListener,
          themeCompartment.of(getThemeExtensions(theme)),
          EditorView.editable.of(!readOnly),
          EditorView.theme({
            '&': { height },
            '.cm-scroller': { overflow: 'auto' },
          }),
          EditorView.contentAttributes.of({
            'aria-label': 'Redis Command Editor',
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: themeCompartment.reconfigure(getThemeExtensions(theme)),
        });
      }
    }, [theme, themeCompartment]);

    return (
      <div
        ref={containerRef}
        className="border rounded-md overflow-hidden"
        data-placeholder={placeholder}
      />
    );
  }
);

RedisEditor.displayName = 'RedisEditor';
```

**Step 2: Update CodeEditor exports**

Update `src/components/CodeEditor/index.ts` to add:

```typescript
export { RedisEditor } from './RedisEditor';
export type { RedisEditorHandle } from './RedisEditor';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/components/CodeEditor/
git commit -m "feat: add RedisEditor component with command autocomplete"
```

---

## Phase 4: Advanced Features

### Task 4.1: Implement MongoDB DocumentQueryable Trait (Rust)

**Files:**
- Modify: `src-tauri/src/adapters/mongodb/adapter.rs`

**Step 1: Implement DocumentQueryable trait**

Add to `src-tauri/src/adapters/mongodb/adapter.rs`:

```rust
use bson::{doc, Document};
use mongodb::options::{FindOptions as MongoFindOptions, IndexOptions};
use futures::TryStreamExt;
use serde_json::Value;

#[async_trait]
impl DocumentQueryable for MongoDbAdapter {
    async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let filter_doc: Document = bson::to_document(&filter)
            .map_err(|e| AppError::Query(format!("Invalid filter: {}", e)))?;
        
        let mut mongo_options = MongoFindOptions::default();
        mongo_options.skip = options.skip;
        mongo_options.limit = options.limit.map(|l| l as i64);
        
        if let Some(sort) = options.sort {
            mongo_options.sort = Some(bson::to_document(&sort)?);
        }
        if let Some(proj) = options.projection {
            mongo_options.projection = Some(bson::to_document(&proj)?);
        }
        
        let mut cursor = coll.find(filter_doc).with_options(mongo_options).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        let mut results = Vec::new();
        while let Some(doc) = cursor.try_next().await
            .map_err(|e| AppError::Query(e.to_string()))? {
            let value: Value = bson::from_document(doc)
                .map_err(|e| AppError::Query(e.to_string()))?;
            results.push(value);
        }
        
        Ok(results)
    }

    async fn insert_document(&self, collection: &str, doc: Value) -> Result<InsertResult, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let document: Document = bson::to_document(&doc)
            .map_err(|e| AppError::Query(format!("Invalid document: {}", e)))?;
        
        let result = coll.insert_one(document).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(InsertResult {
            inserted_id: result.inserted_id.to_string(),
        })
    }

    async fn insert_documents(&self, collection: &str, docs: Vec<Value>) -> Result<InsertManyResult, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let documents: Vec<Document> = docs.into_iter()
            .map(|d| bson::to_document(&d))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Query(format!("Invalid document: {}", e)))?;
        
        let result = coll.insert_many(documents).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(InsertManyResult {
            inserted_ids: result.inserted_ids.values().map(|id| id.to_string()).collect(),
            inserted_count: result.inserted_ids.len() as u64,
        })
    }

    async fn update_document(
        &self,
        collection: &str,
        filter: Value,
        update: Value,
    ) -> Result<UpdateResult, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let filter_doc: Document = bson::to_document(&filter)?;
        let update_doc: Document = bson::to_document(&update)?;
        
        let result = coll.update_one(filter_doc, update_doc).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(UpdateResult {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
        })
    }

    async fn delete_document(&self, collection: &str, filter: Value) -> Result<DeleteResult, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let filter_doc: Document = bson::to_document(&filter)?;
        
        let result = coll.delete_one(filter_doc).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(DeleteResult {
            deleted_count: result.deleted_count,
        })
    }

    async fn aggregate(&self, collection: &str, pipeline: Vec<Value>) -> Result<Vec<Value>, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let pipeline_docs: Vec<Document> = pipeline.into_iter()
            .map(|s| bson::to_document(&s))
            .collect::<Result<Vec<_>, _>>()?;
        
        let mut cursor = coll.aggregate(pipeline_docs).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        let mut results = Vec::new();
        while let Some(doc) = cursor.try_next().await? {
            let value: Value = bson::from_document(doc)?;
            results.push(value);
        }
        
        Ok(results)
    }

    async fn count_documents(&self, collection: &str, filter: Option<Value>) -> Result<u64, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let coll = db.collection::<Document>(collection);
        let filter_doc = match filter {
            Some(f) => bson::to_document(&f)?,
            None => doc! {},
        };
        
        let count = coll.count_documents(filter_doc).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn list_collections(&self) -> Result<Vec<CollectionInfo>, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let collections = db.list_collection_names().await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(collections.into_iter().map(|name| CollectionInfo {
            name,
            doc_count: None,
            size_bytes: None,
        }).collect())
    }

    async fn run_command(&self, command: Value) -> Result<Value, AppError> {
        let db = self.database.read().await;
        let db = db.as_ref().ok_or(AppError::NotConnected)?;
        
        let cmd_doc: Document = bson::to_document(&command)?;
        let result = db.run_command(cmd_doc).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(bson::from_document(result)?)
    }
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

**Step 3: Commit**

```bash
git add src-tauri/src/adapters/mongodb/adapter.rs
git commit -m "feat(mongodb): implement DocumentQueryable trait"
```

---

### Task 4.2: Implement Redis KeyValueOperable Trait (Rust)

**Files:**
- Modify: `src-tauri/src/adapters/redis/adapter.rs`

**Step 1: Implement KeyValueOperable trait**

Add to `src-tauri/src/adapters/redis/adapter.rs`:

```rust
use fred::prelude::*;
use std::collections::HashMap;

#[async_trait]
impl KeyValueOperable for RedisAdapter {
    async fn get_key(&self, key: &str) -> Result<Option<RedisValue>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: Option<String> = client.get(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result.map(|s| RedisValue::String(s)))
    }

    async fn set_key(&self, key: &str, value: RedisValue, options: SetOptions) -> Result<(), AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let str_value = match value {
            RedisValue::String(s) => s,
            RedisValue::Integer(i) => i.to_string(),
            RedisValue::Float(f) => f.to_string(),
            RedisValue::Boolean(b) => b.to_string(),
            _ => return Err(AppError::Query("Unsupported value type for SET".into())),
        };
        
        match (options.ttl_seconds, options.nx, options.xx) {
            (Some(ttl), false, false) => {
                client.set(key, str_value, Some(Expiration::EX(ttl as i64)), None, false).await?;
            }
            (None, true, false) => {
                client.set(key, str_value, None, Some(SetOptions::NX), false).await?;
            }
            (None, false, true) => {
                client.set(key, str_value, None, Some(SetOptions::XX), false).await?;
            }
            _ => {
                client.set(key, str_value, None, None, false).await?;
            }
        }
        
        Ok(())
    }

    async fn delete_keys(&self, keys: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = client.del(keys).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn key_exists(&self, keys: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = client.exists(keys).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn scan_keys(&self, pattern: &str, cursor: u64, count: u32) -> Result<ScanResult, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let (new_cursor, keys): (u64, Vec<String>) = client
            .scan(pattern, Some(cursor), Some(count as u64))
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        // Get type and TTL for each key
        let mut key_infos = Vec::new();
        for key in keys {
            let key_type = self.get_key_type(&key).await.unwrap_or(RedisType::Unknown);
            let ttl = self.get_key_ttl(&key).await.unwrap_or(-1);
            
            key_infos.push(KeyInfo {
                key,
                key_type,
                ttl,
                size_bytes: None,
            });
        }
        
        Ok(ScanResult {
            cursor: new_cursor,
            keys: key_infos,
        })
    }

    async fn get_key_type(&self, key: &str) -> Result<RedisType, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let type_str: String = client.type_(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        let redis_type = match type_str.as_str() {
            "string" => RedisType::String,
            "list" => RedisType::List,
            "set" => RedisType::Set,
            "zset" => RedisType::ZSet,
            "hash" => RedisType::Hash,
            "stream" => RedisType::Stream,
            _ => RedisType::Unknown,
        };
        
        Ok(redis_type)
    }

    async fn get_key_ttl(&self, key: &str) -> Result<i64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let ttl: i64 = client.ttl(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(ttl)
    }

    async fn set_key_ttl(&self, key: &str, seconds: u64) -> Result<bool, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: bool = client.expire(key, seconds as i64).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result)
    }

    async fn execute_raw(&self, command: &str, args: &[String]) -> Result<RedisValue, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: fred::types::RedisValue = client
            .custom_raw(fred::types::CustomCommand::new(command, None, false), args.to_vec())
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(convert_redis_value(result))
    }

    async fn get_database_size(&self) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let size: u64 = client.dbsize().await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(size)
    }

    async fn select_database(&self, index: u8) -> Result<(), AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        client.select(index).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(())
    }

    async fn get_server_info(&self, section: Option<&str>) -> Result<HashMap<String, String>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let info_kind = section.map(|s| InfoKind::Custom(s.to_string()));
        let info_str: String = client.info(info_kind).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        let mut result = HashMap::new();
        for line in info_str.lines() {
            if let Some((key, value)) = line.split_once(':') {
                result.insert(key.to_string(), value.to_string());
            }
        }
        
        Ok(result)
    }
}

fn convert_redis_value(value: fred::types::RedisValue) -> RedisValue {
    match value {
        fred::types::RedisValue::Null => RedisValue::Nil,
        fred::types::RedisValue::String(s) => RedisValue::String(s.to_string()),
        fred::types::RedisValue::Integer(i) => RedisValue::Integer(i),
        fred::types::RedisValue::Double(f) => RedisValue::Float(f),
        fred::types::RedisValue::Boolean(b) => RedisValue::Boolean(b),
        fred::types::RedisValue::Array(arr) => {
            RedisValue::Array(arr.into_iter().map(convert_redis_value).collect())
        }
        fred::types::RedisValue::Map(map) => {
            let converted: HashMap<String, RedisValue> = map.into_iter()
                .filter_map(|(k, v)| {
                    k.into_string().map(|key| (key, convert_redis_value(v)))
                })
                .collect();
            RedisValue::Map(converted)
        }
        fred::types::RedisValue::Bytes(b) => RedisValue::Bytes(b.to_vec()),
        _ => RedisValue::Nil,
    }
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

**Step 3: Commit**

```bash
git add src-tauri/src/adapters/redis/adapter.rs
git commit -m "feat(redis): implement KeyValueOperable trait"
```

---

### Task 4.3: Implement Redis RichKeyValueOperable Trait (Rust)

**Files:**
- Modify: `src-tauri/src/adapters/redis/adapter.rs`

**Step 1: Implement RichKeyValueOperable trait**

Add to `src-tauri/src/adapters/redis/adapter.rs`:

```rust
#[async_trait]
impl RichKeyValueOperable for RedisAdapter {
    async fn hash_get_all(&self, key: &str) -> Result<HashMap<String, String>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: HashMap<String, String> = client.hgetall(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result)
    }

    async fn hash_set(&self, key: &str, fields: HashMap<String, String>) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let pairs: Vec<(String, String)> = fields.into_iter().collect();
        let count: u64 = client.hset(key, pairs).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn hash_delete(&self, key: &str, fields: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = client.hdel(key, fields).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn list_range(&self, key: &str, start: i64, stop: i64) -> Result<Vec<String>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: Vec<String> = client.lrange(key, start, stop).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result)
    }

    async fn list_push(&self, key: &str, values: &[String], side: ListSide) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = match side {
            ListSide::Left => client.lpush(key, values).await,
            ListSide::Right => client.rpush(key, values).await,
        }.map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn list_len(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let len: u64 = client.llen(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(len)
    }

    async fn set_members(&self, key: &str) -> Result<Vec<String>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: Vec<String> = client.smembers(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result)
    }

    async fn set_add(&self, key: &str, members: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = client.sadd(key, members).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn set_remove(&self, key: &str, members: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let count: u64 = client.srem(key, members).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn zset_range(
        &self,
        key: &str,
        start: i64,
        stop: i64,
        with_scores: bool,
    ) -> Result<Vec<ZSetMember>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        if with_scores {
            let result: Vec<(String, f64)> = client.zrange(key, start, stop, None, false, None, true).await
                .map_err(|e| AppError::Query(e.to_string()))?;
            
            Ok(result.into_iter().map(|(member, score)| ZSetMember { member, score }).collect())
        } else {
            let members: Vec<String> = client.zrange(key, start, stop, None, false, None, false).await
                .map_err(|e| AppError::Query(e.to_string()))?;
            
            Ok(members.into_iter().map(|member| ZSetMember { member, score: 0.0 }).collect())
        }
    }

    async fn zset_add(&self, key: &str, members: &[ZSetMember]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let pairs: Vec<(f64, String)> = members.iter()
            .map(|m| (m.score, m.member.clone()))
            .collect();
        
        let count: u64 = client.zadd(key, None, None, false, false, pairs).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(count)
    }

    async fn stream_range(
        &self,
        key: &str,
        start: &str,
        end: &str,
        count: Option<u32>,
    ) -> Result<Vec<StreamEntry>, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let result: Vec<(String, HashMap<String, String>)> = client
            .xrange(key, start, end, count.map(|c| c as u64))
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(result.into_iter().map(|(id, fields)| StreamEntry { id, fields }).collect())
    }

    async fn stream_len(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        let client = client.as_ref().ok_or(AppError::NotConnected)?;
        
        let len: u64 = client.xlen(key).await
            .map_err(|e| AppError::Query(e.to_string()))?;
        
        Ok(len)
    }
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

**Step 3: Commit**

```bash
git add src-tauri/src/adapters/redis/adapter.rs
git commit -m "feat(redis): implement RichKeyValueOperable trait"
```

---

## Phase 5: Polish

### Task 5.1: Add Integration Tests with testcontainers

**Files:**
- Create: `src-tauri/tests/integration/mongodb_test.rs`
- Create: `src-tauri/tests/integration/redis_test.rs`

**Step 1: Create MongoDB integration test**

Create `src-tauri/tests/integration/mongodb_test.rs`:

```rust
use testcontainers::{clients::Cli, GenericImage};

#[tokio::test]
async fn test_mongodb_crud_operations() {
    let docker = Cli::default();
    let mongo_image = GenericImage::new("mongo", "7.0")
        .with_exposed_port(27017);
    
    let container = docker.run(mongo_image);
    let port = container.get_host_port_ipv4(27017);
    
    let mut adapter = MongoDbAdapter::new();
    let config = ConnectionConfig {
        db_type: DbType::MongoDB,
        host: "localhost".to_string(),
        port,
        database: Some("test".to_string()),
        ..Default::default()
    };
    
    adapter.connect(&config).await.unwrap();
    
    // Test insert
    let doc = serde_json::json!({
        "name": "Alice",
        "age": 30
    });
    let result = adapter.insert_document("users", doc).await.unwrap();
    assert!(!result.inserted_id.is_empty());
    
    // Test find
    let docs = adapter.find_documents("users", serde_json::json!({}), Default::default()).await.unwrap();
    assert_eq!(docs.len(), 1);
    
    // Test update
    let update_result = adapter.update_document(
        "users",
        serde_json::json!({"name": "Alice"}),
        serde_json::json!({"$set": {"age": 31}})
    ).await.unwrap();
    assert_eq!(update_result.modified_count, 1);
    
    // Test delete
    let delete_result = adapter.delete_document(
        "users",
        serde_json::json!({"name": "Alice"})
    ).await.unwrap();
    assert_eq!(delete_result.deleted_count, 1);
    
    adapter.disconnect().await.unwrap();
}
```

**Step 2: Create Redis integration test**

Create `src-tauri/tests/integration/redis_test.rs`:

```rust
use testcontainers::{clients::Cli, GenericImage};

#[tokio::test]
async fn test_redis_key_operations() {
    let docker = Cli::default();
    let redis_image = GenericImage::new("redis", "7.2")
        .with_exposed_port(6379);
    
    let container = docker.run(redis_image);
    let port = container.get_host_port_ipv4(6379);
    
    let mut adapter = RedisAdapter::new();
    let config = ConnectionConfig {
        db_type: DbType::Redis,
        host: "localhost".to_string(),
        port,
        database: Some("0".to_string()),
        ..Default::default()
    };
    
    adapter.connect(&config).await.unwrap();
    
    // Test set/get
    adapter.set_key("test:key", RedisValue::String("hello".to_string()), Default::default()).await.unwrap();
    let value = adapter.get_key("test:key").await.unwrap();
    assert_eq!(value, Some(RedisValue::String("hello".to_string())));
    
    // Test hash
    let mut fields = HashMap::new();
    fields.insert("name".to_string(), "Alice".to_string());
    fields.insert("age".to_string(), "30".to_string());
    adapter.hash_set("test:user", fields).await.unwrap();
    
    let hash = adapter.hash_get_all("test:user").await.unwrap();
    assert_eq!(hash.get("name"), Some(&"Alice".to_string()));
    
    // Test list
    adapter.list_push("test:list", &["a".to_string(), "b".to_string()], ListSide::Right).await.unwrap();
    let list = adapter.list_range("test:list", 0, -1).await.unwrap();
    assert_eq!(list, vec!["a", "b"]);
    
    // Test set
    adapter.set_add("test:set", &["x".to_string(), "y".to_string()]).await.unwrap();
    let members = adapter.set_members("test:set").await.unwrap();
    assert!(members.contains(&"x".to_string()));
    
    // Test delete
    let deleted = adapter.delete_keys(&["test:key".to_string()]).await.unwrap();
    assert_eq!(deleted, 1);
    
    adapter.disconnect().await.unwrap();
}
```

**Step 3: Add testcontainers to dev dependencies**

Add to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
testcontainers = "0.15"
```

**Step 4: Run tests**

Run: `cd src-tauri && cargo test --test integration`
Expected: PASS (requires Docker running)

**Step 5: Commit**

```bash
git add src-tauri/tests/integration/ src-tauri/Cargo.toml
git commit -m "test: add integration tests with testcontainers"
```

---

### Task 5.2: Add Connection String Parser

**Files:**
- Create: `src/adapters/utils/connectionStringParser.ts`
- Modify: `src/adapters/index.ts`

**Step 1: Create connection string parser**

Create `src/adapters/utils/connectionStringParser.ts`:

```typescript
import type { MongoConnectionConfig } from '../types/mongodb';
import type { RedisConnectionConfig } from '../types/redis';

export function parseMongoConnectionString(connectionString: string): Partial<MongoConnectionConfig> {
  try {
    const url = new URL(connectionString);
    
    const hosts = url.host.split(',').map((h) => {
      const [host, portStr] = h.split(':');
      return { host, port: parseInt(portStr, 10) || 27017 };
    });
    
    const config: Partial<MongoConnectionConfig> = {
      hosts,
      database: url.pathname.slice(1) || undefined,
      user: url.username || undefined,
      password: url.password || undefined,
      ssl: url.protocol === 'mongodb+srv:',
      connectionString,
    };
    
    // Parse query params
    const params = url.searchParams;
    if (params.has('authSource')) {
      config.authSource = params.get('authSource')!;
    }
    if (params.has('replicaSet')) {
      config.replicaSet = params.get('replicaSet')!;
    }
    
    return config;
  } catch {
    throw new Error('Invalid MongoDB connection string');
  }
}

export function buildMongoConnectionString(config: MongoConnectionConfig): string {
  if (config.connectionString) return config.connectionString;
  
  const protocol = config.ssl ? 'mongodb+srv' : 'mongodb';
  const auth = config.user && config.password
    ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
    : '';
  const hosts = config.hosts.map((h) => `${h.host}:${h.port}`).join(',');
  const database = config.database || '';
  
  const params = new URLSearchParams();
  if (config.authSource) params.set('authSource', config.authSource);
  if (config.replicaSet) params.set('replicaSet', config.replicaSet);
  
  const queryString = params.toString();
  return `${protocol}://${auth}${hosts}/${database}${queryString ? '?' + queryString : ''}`;
}

export function parseRedisConnectionString(connectionString: string): Partial<RedisConnectionConfig> {
  try {
    const url = new URL(connectionString);
    
    const config: Partial<RedisConnectionConfig> = {
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      database: parseInt(url.pathname.slice(1), 10) || 0,
      user: url.username || undefined,
      password: url.password || undefined,
      ssl: url.protocol === 'rediss:',
      connectionString,
      mode: 'standalone',
    };
    
    return config;
  } catch {
    throw new Error('Invalid Redis connection string');
  }
}

export function buildRedisConnectionString(config: RedisConnectionConfig): string {
  if (config.connectionString) return config.connectionString;
  
  const protocol = config.ssl ? 'rediss' : 'redis';
  const auth = config.password
    ? config.user
      ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
      : `:${encodeURIComponent(config.password)}@`
    : '';
  
  return `${protocol}://${auth}${config.host}:${config.port}/${config.database}`;
}
```

**Step 2: Export from adapters index**

Add to `src/adapters/index.ts`:

```typescript
export * from './utils/connectionStringParser';
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: Passes

**Step 4: Commit**

```bash
git add src/adapters/utils/connectionStringParser.ts src/adapters/index.ts
git commit -m "feat: add bidirectional connection string parser"
```

---

### Task 5.3: Frontend Unit Tests

**Files:**
- Create: `src/adapters/__tests__/connectionStringParser.test.ts`
- Create: `src/components/RedisValueEditors/__tests__/StringEditor.test.tsx`

**Step 1: Test connection string parser**

Create `src/adapters/__tests__/connectionStringParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseMongoConnectionString,
  buildMongoConnectionString,
  parseRedisConnectionString,
  buildRedisConnectionString,
} from '../utils/connectionStringParser';

describe('MongoDB connection string', () => {
  it('parses basic connection string', () => {
    const config = parseMongoConnectionString('mongodb://localhost:27017/mydb');
    expect(config.hosts?.[0]).toEqual({ host: 'localhost', port: 27017 });
    expect(config.database).toBe('mydb');
  });

  it('parses connection string with auth', () => {
    const config = parseMongoConnectionString('mongodb://user:pass@localhost:27017/mydb');
    expect(config.user).toBe('user');
    expect(config.password).toBe('pass');
  });

  it('parses replica set', () => {
    const config = parseMongoConnectionString(
      'mongodb://host1:27017,host2:27017/mydb?replicaSet=rs0'
    );
    expect(config.hosts?.length).toBe(2);
    expect(config.replicaSet).toBe('rs0');
  });

  it('builds connection string from config', () => {
    const config = {
      hosts: [{ host: 'localhost', port: 27017 }],
      database: 'test',
      user: 'admin',
      password: 'secret',
    };
    const str = buildMongoConnectionString(config);
    expect(str).toContain('mongodb://admin:secret@localhost:27017/test');
  });
});

describe('Redis connection string', () => {
  it('parses basic connection string', () => {
    const config = parseRedisConnectionString('redis://localhost:6379/0');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(6379);
    expect(config.database).toBe(0);
  });

  it('parses connection string with password', () => {
    const config = parseRedisConnectionString('redis://:mypassword@localhost:6379/1');
    expect(config.password).toBe('mypassword');
    expect(config.database).toBe(1);
  });

  it('handles rediss:// for SSL', () => {
    const config = parseRedisConnectionString('rediss://localhost:6379/0');
    expect(config.ssl).toBe(true);
  });

  it('builds connection string from config', () => {
    const config = {
      host: 'redis.example.com',
      port: 6380,
      database: 2,
      password: 'secret',
      ssl: true,
      mode: 'standalone' as const,
    };
    const str = buildRedisConnectionString(config);
    expect(str).toBe('rediss://:secret@redis.example.com:6380/2');
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit connectionStringParser`
Expected: PASS

**Step 3: Commit**

```bash
git add src/adapters/__tests__/
git commit -m "test: add connection string parser unit tests"
```

---

**Plan complete and saved to `docs/plans/2026-01-12-redis-mongodb-implementation-plan.md`.**

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
