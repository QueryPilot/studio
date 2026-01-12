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

## Summary: Remaining Phases

This plan covers **Phase 1 (Foundation)** and **Phase 2 (Core Implementation)** in full detail.

**Phases 3-5 will include:**

### Phase 3: Editors (Tasks 3.1 - 3.10)
- DocumentEditor component with TreeView + Breadcrumb
- Redis type-specific editors (String, Hash, List, Set, ZSet, Stream)
- FallbackEditor for unknown types
- CodeMirror modes for MQL and Redis CLI
- Value drawer component

### Phase 4: Advanced Features (Tasks 4.1 - 4.12)
- MongoDB: Indexes UI, Aggregation builder, Schema validation, GridFS, Change streams
- Redis: TTL management, Key analysis, Server info panel
- Connection string parser (bidirectional)
- Import/Export (JSON)

### Phase 5: Polish (Tasks 5.1 - 5.6)
- Error handling refinement
- Performance optimization
- Integration tests with testcontainers
- Documentation
- Final testing

---

**Shall I continue with Phase 3-5 detailed tasks, or is this enough to start implementation?**
