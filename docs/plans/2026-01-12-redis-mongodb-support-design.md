# Redis & MongoDB Support Design

## Overview

This document outlines the design for adding Redis and MongoDB support to Query Pilot, a local-first desktop database IDE.

## Key Decisions

| Area              | Decision                                                            |
| ----------------- | ------------------------------------------------------------------- |
| UX Strategy       | Hybrid - Grid for lists, specialized editors for details            |
| Architecture      | Capability-based traits (extensible per paradigm)                   |
| Backend Command   | Paradigm-level enums (`DocumentOperation`, `KeyValueOperation`)     |
| Query Input       | Native languages (MQL for Mongo, CLI for Redis)                     |
| Sidebar           | Mongo: DB → Collections. Redis: DB 0-15 + key pattern grouping      |
| Value Editing     | Drawer + Breadcrumb + Inline Expansion                              |
| Redis Editors     | Specialized per type + Fallback for unknown                         |
| MongoDB Features  | All (CRUD, Indexes, Aggregation, Schema, GridFS, Streams, Sharding) |
| Connection Config | Form + Connection String (bidirectional, incl. SRV for Atlas)       |
| Rust Crates       | `mongodb = "3.4"` (official) + `fred = "10.1"` (Redis)              |
| Development       | Parallel (MongoDB + Redis tracks)                                   |
| Streaming         | MessagePack (same as SQL), lazy value loading for Redis             |
| Connection Pool   | Fred built-in `RedisPool`, mongodb driver built-in pooling          |

---

## 1. Architecture

### 1.1 Capability-Based Trait System

```mermaid
graph TD
    BaseAdapter --> SqlQueryable
    BaseAdapter --> DocumentQueryable
    BaseAdapter --> KeyValueOperable
    
    KeyValueOperable --> RichKeyValueOperable
    
    SqlQueryable --> Postgres
    SqlQueryable --> MySQL
    
    DocumentQueryable --> MongoDB
    DocumentQueryable --> CouchDB
    
    RichKeyValueOperable --> Redis["Redis<br/>(rich+base)"]
    KeyValueOperable --> Memcached["Memcached<br/>(base only)"]
```

### 1.2 System Overview

```mermaid
flowchart TB
    subgraph Frontend["FRONTEND (React/TS)"]
        BA[BaseAdapter<br/>connect, disconnect, testConnection, getMetadata]
        
        BA --> SQ[SqlQueryable]
        BA --> SI[SchemaIntrospectable]
        BA --> DQ[DocumentQueryable]
        BA --> KV[KeyValueOperable]
        KV --> RKV[RichKeyValueOperable]
        
        SQ --> PG[PostgreSQLAdapter]
        SQ --> MY[MySQLAdapter]
        SQ --> SL[SQLiteAdapter]
        SQ --> MS[MSSQLAdapter]
        
        DQ --> MO[MongoDBAdapter<br/>collections, aggregation]
        
        RKV --> RE[RedisAdapter<br/>keys, TTL, type operations]
    end
    
    Frontend -->|Tauri IPC invoke| Backend
    
    subgraph Backend["BACKEND (Rust)"]
        subgraph Operations["Paradigm Operations"]
            DO[DocumentOperation<br/>Find, Insert, Update, Delete, Aggregate, ...]
            KO[KeyValueOperation<br/>Get, Set, Delete, Scan, HashOp, ListOp, ...]
        end
        
        subgraph Adapters["Adapters"]
            EA[postgres/ mysql/ sqlite/ mssql/<br/>existing]
            MA[mongodb/<br/>new - mongodb crate]
            RA[redis/<br/>new - fred crate]
        end
    end
```

---

## 2. Frontend Capabilities

### 2.1 Base Adapter

```typescript
interface BaseAdapter {
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;
  getMetadata(): AdapterMetadata;
}
```

### 2.2 DocumentQueryable (MongoDB, CouchDB, Firestore)

```typescript
interface DocumentQueryable {
  // CRUD - basic
  findDocuments(
    collection: string,
    filter: object,
    options?: FindOptions,
  ): Promise<Document[]>;
  insertDocument(collection: string, doc: object): Promise<InsertResult>;
  insertDocuments(
    collection: string,
    docs: object[],
  ): Promise<InsertManyResult>;
  updateDocument(
    collection: string,
    filter: object,
    update: object,
  ): Promise<UpdateResult>;
  updateDocuments(
    collection: string,
    filter: object,
    update: object,
  ): Promise<UpdateResult>;
  replaceDocument(
    collection: string,
    filter: object,
    replacement: object,
  ): Promise<UpdateResult>;
  deleteDocument(collection: string, filter: object): Promise<DeleteResult>;
  deleteDocuments(collection: string, filter: object): Promise<DeleteResult>;

  // CRUD - atomic
  findOneAndUpdate(
    collection: string,
    filter: object,
    update: object,
  ): Promise<Document | null>;
  findOneAndReplace(
    collection: string,
    filter: object,
    replacement: object,
  ): Promise<Document | null>;
  findOneAndDelete(
    collection: string,
    filter: object,
  ): Promise<Document | null>;

  // CRUD - batch & stats
  bulkWrite(
    collection: string,
    operations: BulkOperation[],
  ): Promise<BulkWriteResult>;
  countDocuments(collection: string, filter?: object): Promise<number>;
  distinct(
    collection: string,
    field: string,
    filter?: object,
  ): Promise<unknown[]>;

  // Aggregation
  aggregate(collection: string, pipeline: object[]): Promise<Document[]>;

  // Collection management
  listCollections(): Promise<CollectionInfo[]>;
  createCollection(name: string, options?: CollectionOptions): Promise<void>;
  dropCollection(name: string): Promise<void>;
  renameCollection(oldName: string, newName: string): Promise<void>;
  getCollectionStats(collection: string): Promise<CollectionStats>;

  // Time series collections (MongoDB 5.0+)
  createTimeSeriesCollection(
    name: string,
    options: {
      timeField: string;
      metaField?: string;
      granularity?: "seconds" | "minutes" | "hours";
      expireAfterSeconds?: number;
    },
  ): Promise<void>;

  // Indexes
  listIndexes(collection: string): Promise<IndexInfo[]>;
  createIndex(
    collection: string,
    keys: object,
    options?: IndexOptions,
  ): Promise<string>;
  dropIndex(collection: string, indexName: string): Promise<void>;

  // Schema validation
  getValidationRules(collection: string): Promise<ValidationRules | null>;
  setValidationRules(collection: string, rules: ValidationRules): Promise<void>;

  // GridFS
  listFiles(bucket?: string): Promise<GridFSFile[]>;
  uploadFile(
    filename: string,
    data: Blob,
    metadata?: object,
    bucket?: string,
  ): Promise<string>;
  downloadFile(fileId: string, bucket?: string): Promise<Blob>;
  deleteFile(fileId: string, bucket?: string): Promise<void>;

  // Change streams
  watchCollection(
    collection: string,
    pipeline?: object[],
  ): AsyncIterable<ChangeEvent>;

  // Sharding
  getShardingStatus(): Promise<ShardingInfo>;

  // Transactions (MongoDB 4.0+ replica sets, 4.2+ sharded clusters)
  startSession(): Promise<SessionHandle>;
  withTransaction<T>(
    sessionId: string,
    fn: () => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  commitTransaction(sessionId: string): Promise<void>;
  abortTransaction(sessionId: string): Promise<void>;
  endSession(sessionId: string): Promise<void>;

  // Escape hatch
  runCommand(command: object): Promise<Document>;
}
```

### 2.3 KeyValueOperable (All key-value stores)

```typescript
interface KeyValueOperable {
  // Key operations
  scanKeys(
    pattern: string,
    cursor?: string,
    count?: number,
  ): Promise<ScanResult>;
  getKey(key: string): Promise<RedisValue>;
  setKey(key: string, value: RedisValue, options?: SetOptions): Promise<void>;
  deleteKeys(keys: string[]): Promise<number>;
  unlinkKeys(keys: string[]): Promise<number>;
  renameKey(oldKey: string, newKey: string): Promise<void>;
  copyKey(source: string, dest: string, replace?: boolean): Promise<boolean>;
  keyExists(keys: string[]): Promise<number>;

  // TTL
  getKeyTTL(key: string): Promise<number>;
  setKeyTTL(key: string, seconds: number): Promise<boolean>;
  setKeyExpireAt(key: string, timestamp: number): Promise<boolean>;
  persistKey(key: string): Promise<boolean>;
  touchKeys(keys: string[]): Promise<number>;

  // Metadata
  getKeyType(key: string): Promise<RedisType>;
  getKeyEncoding(key: string): Promise<string>;
  getKeyMemory(key: string): Promise<number>;

  // Database
  selectDatabase(index: number): Promise<void>;
  getDatabaseSize(): Promise<number>;
  getDatabaseList(): Promise<DatabaseInfo[]>;
  getServerInfo(section?: string): Promise<ServerInfo>;

  // Escape hatch
  executeCommand(cmd: string, args: string[]): Promise<RedisValue>;
}
```

### 2.4 RichKeyValueOperable (Redis, Valkey, KeyDB)

```typescript
interface RichKeyValueOperable extends KeyValueOperable {
  // Hash
  hashGetAll(key: string): Promise<Record<string, string>>;
  hashGet(key: string, field: string): Promise<string | null>;
  hashSet(key: string, fields: Record<string, string>): Promise<number>;
  hashDelete(key: string, fields: string[]): Promise<number>;
  hashKeys(key: string): Promise<string[]>;
  hashLen(key: string): Promise<number>;

  // List
  listRange(key: string, start: number, stop: number): Promise<string[]>;
  listPush(
    key: string,
    values: string[],
    side: "left" | "right",
  ): Promise<number>;
  listPop(
    key: string,
    side: "left" | "right",
    count?: number,
  ): Promise<string[]>;
  listSet(key: string, index: number, value: string): Promise<void>;
  listLen(key: string): Promise<number>;
  listIndex(key: string, index: number): Promise<string | null>;

  // Set
  setMembers(key: string): Promise<string[]>;
  setAdd(key: string, members: string[]): Promise<number>;
  setRemove(key: string, members: string[]): Promise<number>;
  setCardinality(key: string): Promise<number>;
  setIsMember(key: string, member: string): Promise<boolean>;

  // Sorted Set
  zsetRange(
    key: string,
    start: number,
    stop: number,
    options?: ZRangeOptions,
  ): Promise<ZSetMember[]>;
  zsetAdd(key: string, members: ZSetMember[]): Promise<number>;
  zsetRemove(key: string, members: string[]): Promise<number>;
  zsetScore(key: string, member: string): Promise<number | null>;
  zsetRank(key: string, member: string): Promise<number | null>;
  zsetCardinality(key: string): Promise<number>;

  // Stream
  streamRange(
    key: string,
    start: string,
    end: string,
    count?: number,
  ): Promise<StreamEntry[]>;
  streamLen(key: string): Promise<number>;
  streamInfo(key: string): Promise<StreamInfo>;

  // ACL (Redis 6+)
  aclWhoAmI(): Promise<string>;
  aclList(): Promise<string[]>;

  // Module detection
  moduleList(): Promise<ModuleInfo[]>;
}
```

### 2.5 RedisModuleOperable (Optional - Redis Stack)

```typescript
// Only available when modules are detected
interface RedisModuleOperable {
  // RedisJSON module
  jsonGet(key: string, path?: string): Promise<unknown>;
  jsonSet(key: string, path: string, value: unknown): Promise<void>;
  jsonMerge(key: string, path: string, value: unknown): Promise<void>;
  jsonDel(key: string, path?: string): Promise<number>;
  jsonType(key: string, path?: string): Promise<string>;

  // RediSearch module (basic support)
  ftSearch(
    index: string,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult>;
  ftInfo(index: string): Promise<IndexInfo>;
  ftList(): Promise<string[]>;
}
```

---

## 3. Backend Structure (Rust)

### 3.1 Directory Structure

```
src-tauri/src/
├── adapters/
│   ├── mod.rs                      # Adapter registry + factory
│   │
│   ├── postgres/                   # (existing)
│   ├── mysql/                      # (existing)
│   ├── sqlite/                     # (existing)
│   ├── mssql/                      # (existing)
│   │
│   ├── mongodb/                    # NEW
│   │   ├── mod.rs
│   │   ├── adapter.rs              # MongoDbAdapter impl
│   │   ├── types.rs                # Bson/Document wrappers
│   │   ├── gridfs.rs               # GridFS operations
│   │   └── msgpack_converter.rs    # Bson → MessagePack for streaming
│   │
│   └── redis/                      # NEW
│       ├── mod.rs
│       ├── adapter.rs              # RedisAdapter impl
│       ├── types.rs                # RedisValue, RedisType enums
│       └── msgpack_converter.rs    # Redis values → MessagePack
│
├── core/
│   ├── adapter.rs                  # Updated trait with paradigm operations
│   └── capabilities.rs             # NEW: capability traits
│
├── commands/
│   ├── mongodb.rs                  # NEW: Tauri commands for MongoDB
│   └── redis.rs                    # NEW: Tauri commands for Redis
│
└── types.rs                        # Updated: DbType enum + new types
```

### 3.2 Paradigm Operations

```rust
// Tauri commands - ONE per paradigm
#[tauri::command]
async fn sql_execute(connection_id: String, query: String) -> Result<QueryResult>

#[tauri::command]
async fn document_execute(connection_id: String, op: DocumentOperation) -> Result<DocumentResult>

#[tauri::command]
async fn keyvalue_execute(connection_id: String, op: KeyValueOperation) -> Result<KeyValueResult>
```

```rust
// All document DBs (MongoDB, CouchDB, Firestore, etc.)
pub enum DocumentOperation {
    Find { collection: String, filter: Value, options: FindOptions },
    Insert { collection: String, documents: Vec<Value> },
    Update { collection: String, filter: Value, update: Value },
    Delete { collection: String, filter: Value },
    Aggregate { collection: String, pipeline: Vec<Value> },
    ListCollections,
    Raw { query: String },  // escape hatch for DB-specific syntax
}

// All key-value DBs (Redis, Memcached, etcd, Valkey, etc.)
pub enum KeyValueOperation {
    Get { key: String },
    Set { key: String, value: Value, ttl: Option<u64> },
    Delete { keys: Vec<String> },
    Scan { pattern: String, cursor: String, count: u32 },
    Exists { keys: Vec<String> },
    Raw { command: String },  // escape hatch for DB-specific commands
}
```

### 3.3 Capability Traits

```rust
// Core - ALL key-value stores implement this
trait KeyValueOperable {
    fn get(&self, key: String) -> Result<Value>;
    fn set(&self, key: String, value: Value, ttl: Option<u64>) -> Result<()>;
    fn delete(&self, keys: Vec<String>) -> Result<u64>;
    fn exists(&self, keys: Vec<String>) -> Result<u64>;
    fn scan(&self, pattern: String, cursor: String) -> Result<ScanResult>;
    fn execute_raw(&self, command: String) -> Result<Value>;
}

// Extended - Redis, Valkey, KeyDB implement this
trait RichKeyValueOperable: KeyValueOperable {
    fn hash_get_all(&self, key: String) -> Result<HashMap<String, String>>;
    fn hash_set(&self, key: String, fields: HashMap<String, String>) -> Result<()>;
    fn list_range(&self, key: String, start: i64, stop: i64) -> Result<Vec<String>>;
    fn list_push(&self, key: String, values: Vec<String>, side: Side) -> Result<u64>;
    fn set_members(&self, key: String) -> Result<Vec<String>>;
    fn zset_range(&self, key: String, start: i64, stop: i64) -> Result<Vec<ZSetMember>>;
}
```

---

## 4. UI Components

### 4.1 New Components

```
src/components/
├── DocumentEditor/                 # MongoDB + Redis JSON values
│   ├── index.tsx                   # Main component
│   ├── TreeView.tsx                # Inline expandable tree
│   ├── Breadcrumb.tsx              # Navigation breadcrumb
│   ├── FieldEditor.tsx             # Edit individual fields
│   └── types.ts
│
├── KeyBrowser/                     # Redis key grid + value panel
│   ├── index.tsx                   # Container with grid + drawer
│   ├── KeysGrid.tsx                # Key | Type | TTL | Size grid
│   ├── ValueDrawer.tsx             # Side drawer container
│   └── types.ts
│
├── RedisValueEditors/              # Specialized Redis type editors
│   ├── StringEditor.tsx            # Text/JSON toggle
│   ├── HashEditor.tsx              # Mini 2-column grid
│   ├── ListEditor.tsx              # Sortable list
│   ├── SetEditor.tsx               # Tag/chip input
│   ├── ZSetEditor.tsx              # Member + Score grid
│   ├── StreamViewer.tsx            # Read-only timeline
│   ├── FallbackEditor.tsx          # Unknown types
│   └── index.ts
│
├── CollectionBrowser/              # MongoDB collection grid
│   ├── index.tsx                   # Document grid + drawer
│   ├── DocumentsGrid.tsx           # Top-level fields as columns
│   ├── DocumentDrawer.tsx          # Uses DocumentEditor
│   └── types.ts
│
├── AggregationBuilder/             # MongoDB aggregation pipeline
│   ├── index.tsx                   # Pipeline builder UI
│   ├── StageEditor.tsx             # Single stage config
│   └── types.ts
│
├── ConnectionForm/                 # Updated for Redis/Mongo
│   ├── MongoConnectionForm.tsx     # Form + connection string
│   ├── RedisConnectionForm.tsx     # Form + connection string
│   └── ConnectionStringParser.ts   # Bidirectional parsing
│
├── Sidebar/                        # Updated tree structure
│   ├── MongoTree.tsx               # Database → Collections
│   └── RedisTree.tsx               # Database (0-15) + key pattern grouping
│
└── stores/                         # NEW: Frontend state management
    ├── mongoStore.ts               # Active MongoDB sessions, current DB, aggregation state
    └── redisStore.ts               # Active Redis connection, selected DB, key browser state
```

### 4.2 Document/Value Editor UX

Drawer with Breadcrumb + Inline Expansion:

```mermaid
flowchart LR
    subgraph Grid["Keys Grid"]
        K1["user:1"] --> Doc
        K2["user:2"]
        K3["user:3"]
    end
    
    subgraph Doc["Document Drawer"]
        BC["📍 user:1 › profile › settings"]
        
        subgraph Tree["Tree View"]
            Root["▼ root"]
            ID["  _id: 'abc'"]
            Profile["  ▼ profile:"]
            Name["      name: 'John'"]
            Settings["      ▼ settings: ← focus"]
            Theme["          theme: 'dark'"]
            Lang["          lang: 'en'"]
            Tags["  ▶ tags: [3 items]"]
        end
    end
```

**Interaction Pattern:**
- Breadcrumb shows current path (click to jump)
- Tree nodes expand/collapse inline
- Focused node highlighted
- Edit fields in-place

### 4.3 Redis Type Editors

| Type        | Editor Component       | Behavior                                        |
| ----------- | ---------------------- | ----------------------------------------------- |
| `string`    | Text/JSON Editor       | Auto-detect JSON, toggle raw vs. formatted      |
| `hash`      | Mini DataGrid (2 cols) | Field / Value table, inline add/edit/delete     |
| `list`      | Sortable List          | Drag to reorder, supports LPUSH/RPUSH/LREM      |
| `set`       | Tag Input              | Pills/chips UI, click × to remove, input to add |
| `zset`      | Mini DataGrid + Score  | Member / Score table, sortable by score         |
| `stream`    | Timeline (read-only)   | Chronological entries, ID + fields, no edit     |
| `ReJSON-RL` | DocumentEditor         | Reuse MongoDB DocumentEditor for JSON paths     |
| Unknown     | Fallback               | Read-only raw view + metadata                   |

### 4.4 Redis Sidebar with Key Pattern Grouping

```mermaid
graph TD
    subgraph Sidebar["Redis Sidebar"]
        SI["📊 Server Info"]
        SI --> V["Version: 7.2.0"]
        SI --> M["Memory: 128MB / 4GB"]
        SI --> MO["Modules: ReJSON, RediSearch"]
        
        DB0["[0] default (1,234 keys)"]
        DB0 --> U["📁 user:* (500 keys)"]
        U --> U1["user:1"]
        U --> U2["user:2"]
        U --> UE["... (scan on expand)"]
        DB0 --> S["📁 session:* (300 keys)"]
        DB0 --> C["📁 cache:* (200 keys)"]
        DB0 --> O["📁 [other] (234 keys)"]
        
        DB1["[1] cache (empty)"]
        DB2["[2] sessions (50 keys)"]
        DBN["... (collapse empty DBs)"]
    end
```

**Key grouping logic:**

1. On connect, run `SCAN 0 COUNT 1000` to sample keys
2. Extract common prefixes (split on `:` or `.`)
3. Group keys with >5 occurrences into virtual folders
4. Lazy-load folder contents on expand

---

## 5. Connection Configuration

### 5.1 MongoDB

```typescript
interface MongoConnectionConfig {
  // Mode 1: Structured
  hosts: { host: string; port: number }[];
  database?: string;
  authSource?: string;
  user?: string;
  password?: string;
  replicaSet?: string;
  ssl?: SslConfig;
  ssh?: SshTunnelConfig;

  // Atlas / SRV support
  srv?: boolean; // Use mongodb+srv:// DNS seed list
  directConnection?: boolean; // Force single-node connection (testing)
  appName?: string; // Application name for Atlas monitoring

  // Authentication
  authMechanism?:
    | "SCRAM-SHA-256"
    | "SCRAM-SHA-1"
    | "MONGODB-X509"
    | "MONGODB-AWS";

  // Mode 2: Connection string
  connectionString?: string; // mongodb://... or mongodb+srv://...
}
```

**Connection String Examples:**

```
# Standard replica set
mongodb://user:pass@host1:27017,host2:27017/mydb?replicaSet=rs0

# Atlas SRV (recommended for cloud)
mongodb+srv://user:pass@cluster0.abc123.mongodb.net/mydb?retryWrites=true&w=majority

# With explicit auth mechanism
mongodb+srv://user:pass@cluster0.mongodb.net/mydb?authMechanism=SCRAM-SHA-256&authSource=admin
```

### 5.2 Redis

```typescript
interface RedisConnectionConfig {
  // Mode 1: Structured
  host: string;
  port: number;
  database: number; // 0-15
  ssl?: SslConfig;
  ssh?: SshTunnelConfig;

  // Authentication (Redis 6+ ACL preferred)
  auth?:
    | { type: "acl"; username: string; password: string } // Redis 6+ ACL
    | { type: "password"; password: string }; // Legacy AUTH

  // Cluster/Sentinel
  mode: "standalone" | "cluster" | "sentinel";
  sentinelMaster?: string;
  sentinelPassword?: string; // Sentinel auth (separate from Redis auth)
  nodes?: { host: string; port: number }[];

  // Mode 2: Connection string
  connectionString?: string; // redis://user:pass@host:6379/0 or rediss:// for TLS
}
```

**Connection String Examples:**

```
# Standalone with ACL (Redis 6+)
redis://myuser:mypass@localhost:6379/0

# Standalone with legacy password
redis://:mypass@localhost:6379/0

# TLS connection
rediss://user:pass@redis.example.com:6380/0

# Cluster (multiple nodes)
redis://host1:6379,host2:6379,host3:6379
```

### 5.3 DbType Enum Update

**Rust (`src-tauri/src/types.rs`):**

```rust
pub enum DbType {
    // SQL (existing)
    PostgreSQL,
    MySQL,
    MariaDB,        // Keep existing
    SQLite,
    SQLServer,      // Keep existing name

    // Document (new)
    MongoDB,

    // KeyValue (new)
    Redis,
}
```

**TypeScript (`src/types/connection.ts`):**

```typescript
export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MariaDB = "MariaDB",
  SQLite = "SQLite",
  SQLServer = "SQLServer",
  // New
  MongoDB = "MongoDB",
  Redis = "Redis",
}
```

---

## 6. Data Flow & Streaming

Same MessagePack streaming pattern as SQL, with lazy loading for Redis values:

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as Backend (Rust)
    
    Note over FE,BE: Document Query Flow
    FE->>BE: invoke("document_execute")<br/>{op: Find, collection, filter}
    BE->>BE: Translate to native call
    BE-->>FE: MessagePack chunks<br/>[{_id, name, ...}, ...]
    FE->>FE: Render in DocumentsGrid
    
    Note over FE,BE: KeyValue Scan Flow
    FE->>BE: invoke("keyvalue_execute")<br/>{op: Scan, pattern: "user:*"}
    BE->>BE: SCAN cursor loop
    BE-->>FE: MessagePack chunks<br/>[{key, type, ttl, size}, ...]
    FE->>FE: Render in KeysGrid
```

Redis lazy loading: Keys grid shows metadata only. Values fetched on row click.

---

## 7. Error Handling

```rust
pub enum AdapterError {
    // Connection
    ConnectionFailed { message: String, code: Option<String> },
    AuthenticationFailed { message: String },
    Timeout { operation: String, duration_ms: u64 },
    SrvResolutionFailed { host: String, message: String },  // MongoDB Atlas DNS

    // SQL-specific
    SqlSyntaxError { message: String, position: Option<u32> },

    // Document-specific
    DocumentValidationFailed { collection: String, errors: Vec<ValidationError> },
    DuplicateKey { collection: String, key: Value },
    TransactionFailed { session_id: String, message: String },

    // KeyValue-specific
    KeyNotFound { key: String },
    WrongType { key: String, expected: String, actual: String },

    // Redis cluster-specific
    ClusterRedirect {
        kind: ClusterRedirectKind,  // MOVED or ASK
        slot: u16,
        addr: String,
    },
    ClusterDown { message: String },

    // Redis module-specific
    ModuleNotLoaded { module: String },

    // Common
    PermissionDenied { operation: String },
    NotSupported { operation: String, reason: String },
    Unknown { message: String },
}

pub enum ClusterRedirectKind {
    Moved,
    Ask,
}
```

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2) ✅ COMPLETED

- [x] Update DbType enum (Rust + TypeScript)
- [x] Add paradigm traits (DocumentQueryable, KeyValueOperable)
- [x] Base adapter infrastructure
- [x] Connection config types (MongoConnectionConfig, RedisConnectionConfig)
- [ ] Set up testcontainers for integration tests
- [x] Create mongoStore.ts and redisStore.ts

### Phase 2: Core Implementation (Week 3-5) ✅ COMPLETED

**MongoDB Track:**

- [x] mongodb crate 3.4 integration
- [x] MongoDbAdapter (connect, disconnect, basic CRUD)
- [x] SRV/Atlas connection string support
- [x] Tauri commands for MongoDB operations
- [x] Frontend MongoDBAdapter class
- [x] MongoConnectionForm (integrated into main ConnectionForm)
- [x] Sidebar: Database/Collection tree (MongoDBSidebar.tsx)
- [x] CollectionBrowser (grid) - src/components/MongoDB/CollectionBrowser.tsx

**Redis Track (parallel):**

- [x] fred crate 10.1 integration
- [x] RedisAdapter (connect, disconnect, basic ops)
- [x] Tauri commands for Redis operations
- [x] Frontend RedisAdapter class
- [x] RedisConnectionForm (integrated into main ConnectionForm)
- [ ] ACL v2 authentication support (deferred)
- [x] Sidebar: Database 0-15 + key browser (RedisSidebar.tsx)
- [x] KeyBrowser (grid with lazy value loading) - src/components/Redis/KeyBrowser.tsx

### Phase 3: Editors (Week 6-7) ✅ COMPLETED

**MongoDB Track:**

- [x] DocumentEditor component - src/components/MongoDB/DocumentEditor.tsx
- [x] CodeEditor: JSON mode with MQL hints (uses existing JSON mode)
- [x] Inline CRUD in grid (via CollectionBrowser)

**Redis Track (parallel):**

- [x] StringEditor - src/components/Redis/editors/StringEditor.tsx
- [x] HashEditor - src/components/Redis/editors/HashEditor.tsx
- [x] ListEditor - src/components/Redis/editors/ListEditor.tsx
- [x] SetEditor - src/components/Redis/editors/SetEditor.tsx
- [ ] ZSetEditor, StreamViewer (deferred)
- [x] CodeEditor: Redis CLI mode (added to types)
- [ ] Module detection (deferred)

### Phase 4: Advanced Features (Week 8-10) - PARTIAL

**MongoDB Track:**

- [x] Indexes UI - backend commands: mongo_list_indexes, mongo_create_index, mongo_drop_index
- [x] Aggregation via mongo_aggregate command
- [ ] Schema validation UI (deferred)
- [ ] GridFS browser (deferred)
- [ ] Change streams viewer (deferred)
- [ ] Sharding info panel (deferred)
- [ ] Transaction support (deferred)

**Redis Track (parallel):**

- [x] TTL management UI - via KeyBrowser with redis_ttl, redis_expire commands
- [x] Key type detection - redis_type command
- [ ] Cluster mode support (deferred)
- [ ] RedisJSON editor (deferred)
- [ ] RediSearch basic UI (deferred)

### Phase 5: Polish (Week 11-12) - PARTIAL

- [x] Connection string parser - MongoDB SRV/Atlas support added
- [x] Error handling - AppError integration
- [ ] Performance optimization (ongoing)
- [ ] Integration tests with testcontainers (deferred)
- [ ] Frontend component tests (deferred)
- [x] Documentation updates - this file updated

---

## 9. Testing Strategy

### Backend (Rust)

**Unit Tests:**

- Mock database responses, test adapter logic
- Test BSON ↔ MessagePack conversion
- Test Redis value type detection

**Integration Tests (with testcontainers):**

```rust
#[tokio::test]
async fn test_mongodb_crud() {
    let container = GenericImage::new("mongo", "7")
        .with_exposed_port(27017)
        .start()
        .await;

    let adapter = MongoDbAdapter::new(&format!(
        "mongodb://localhost:{}",
        container.get_host_port(27017)
    )).await.unwrap();

    // Test CRUD operations
}

#[tokio::test]
async fn test_redis_data_types() {
    let container = GenericImage::new("redis", "7")
        .with_exposed_port(6379)
        .start()
        .await;

    let adapter = RedisAdapter::new(&format!(
        "redis://localhost:{}",
        container.get_host_port(6379)
    )).await.unwrap();

    // Test all data types: string, hash, list, set, zset, stream
}
```

**Commands:** Test Tauri commands with mock adapters

### Frontend (TypeScript)

**Unit Tests:**

- Vitest for adapters, utility functions
- Connection string parsing (both directions)
- Key pattern detection algorithm

**Component Tests:**

- React Testing Library for editors
- DocumentEditor tree navigation
- Redis type editor interactions

**Integration Tests:**

- Mock Tauri IPC, test full component flows
- Store actions with mocked backend responses

---

## 10. Dependencies

### Rust (Cargo.toml)

```toml
[dependencies]
# MongoDB - Official driver with GridFS, change streams, transactions
mongodb = { version = "3.4", features = ["sync"] }  # Use async by default

# Redis - High-performance async client
fred = { version = "10.1", features = [
    "subscriber-client",     # Pub/Sub support
    "sentinel-client",       # Sentinel mode
    "replicas",              # Read from replicas
    "dns",                   # DNS resolution for cluster
] }

[dev-dependencies]
# Integration testing with real databases
testcontainers = "0.15"
testcontainers-modules = { version = "0.3", features = ["redis", "mongo"] }
```

### Frontend Dependencies

```json
{
  "dependencies": {
    "@codemirror/lang-json": "^6.0.1"
  }
}
```

### CodeMirror Modes

- **MongoDB:** `@codemirror/lang-json` for document editing + custom MQL syntax highlighting
- **Redis:** Custom Lezer grammar for Redis CLI commands (or basic shell mode as fallback)

---

## 11. Frontend Store Structure

### 11.1 MongoDB Store (`src/stores/mongoStore.ts`)

```typescript
interface MongoStoreState {
  // Current context
  currentDatabase: string | null;
  currentCollection: string | null;

  // Sessions for transactions
  activeSessions: Map<string, SessionInfo>;

  // Aggregation builder state
  aggregationPipeline: AggregationStage[];
  aggregationResult: Document[] | null;

  // Collection cache
  collectionStats: Map<string, CollectionStats>;

  // Actions
  setCurrentDatabase: (db: string) => void;
  setCurrentCollection: (collection: string) => void;
  addAggregationStage: (stage: AggregationStage) => void;
  removeAggregationStage: (index: number) => void;
  runAggregation: () => Promise<void>;
}
```

### 11.2 Redis Store (`src/stores/redisStore.ts`)

```typescript
interface RedisStoreState {
  // Current context
  currentDatabase: number; // 0-15

  // Server info
  serverInfo: ServerInfo | null;
  loadedModules: ModuleInfo[];

  // Key browser state
  keyPatterns: KeyPattern[]; // Detected patterns for grouping
  selectedKey: string | null;
  keyValue: RedisValue | null;

  // Scan state (for pagination)
  scanCursor: string;
  scanPattern: string;
  scannedKeys: KeyMetadata[];

  // Actions
  selectDatabase: (index: number) => Promise<void>;
  scanKeys: (pattern: string, reset?: boolean) => Promise<void>;
  selectKey: (key: string) => Promise<void>;
  refreshServerInfo: () => Promise<void>;
  detectModules: () => Promise<void>;
}
```

---

## 12. Migration Considerations

### 12.1 Existing Adapter Updates

The frontend adapter factory (`src/adapters/index.ts`) needs updates:

```typescript
const adapterModules = {
  // Existing
  [DbType.PostgreSQL]: () => import("./dialects/PostgreSQLAdapter"),
  [DbType.MySQL]: () => import("./dialects/MySQLAdapter"),
  [DbType.MariaDB]: () => import("./dialects/MySQLAdapter"),
  [DbType.SQLite]: () => import("./dialects/SQLiteAdapter"),
  [DbType.SQLServer]: () => import("./dialects/MSSQLAdapter"),

  // New - these use different paradigms, need separate handling
  [DbType.MongoDB]: () => import("./dialects/MongoDBAdapter"),
  [DbType.Redis]: () => import("./dialects/RedisAdapter"),
};
```

### 12.2 Connection Form Updates

`ConnectionForm.tsx` needs to conditionally render different forms:

```typescript
const dbTypeOptions = [
  // Existing SQL
  { value: "postgresql", label: "PostgreSQL", paradigm: "sql" },
  { value: "mysql", label: "MySQL", paradigm: "sql" },
  // ...

  // New
  { value: "mongodb", label: "MongoDB", paradigm: "document" },
  { value: "redis", label: "Redis", paradigm: "keyvalue" },
];

// Render different form based on paradigm
{
  paradigm === "sql" && <SqlConnectionFields />;
}
{
  paradigm === "document" && <MongoConnectionForm />;
}
{
  paradigm === "keyvalue" && <RedisConnectionForm />;
}
```

---

## 13. Risks & Mitigations

| Risk                                  | Impact | Mitigation                                                             |
| ------------------------------------- | ------ | ---------------------------------------------------------------------- |
| **MongoDB 3.x API breaking changes**  | High   | Review migration guide before starting; allocate extra time in Phase 2 |
| **Redis cluster complexity**          | Medium | Start with standalone mode; cluster support can slip to Phase 5        |
| **SRV DNS resolution in Tauri**       | Medium | Test early on macOS/Windows; may need system DNS resolver fallback     |
| **Large key scans blocking UI**       | High   | Implement SCAN with small COUNT (100); use virtualized lists           |
| **Redis module detection edge cases** | Low    | Graceful fallback to core types if MODULE LIST fails                   |
| **GridFS large file handling**        | Medium | Stream files in chunks; add size limits in UI                          |
| **Change streams connection drops**   | Medium | Implement reconnection logic with resume tokens                        |
| **SSH tunnel + Redis cluster**        | High   | May not be feasible; document limitation or defer                      |

---

## 14. Resolved Questions

### 14.1 Query History for Non-SQL Paradigms

**Decision:** Unified table with polymorphic content.

```typescript
interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  paradigm: "sql" | "document" | "keyvalue";
  timestamp: Date;
  executionTimeMs: number;

  // Polymorphic content
  content:
    | { type: "sql"; query: string }
    | {
        type: "mql";
        collection: string;
        operation: string;
        filter?: object;
        pipeline?: object[];
      }
    | { type: "redis"; command: string; args: string[] };
}
```

**Rationale:** Single table enables unified "recent queries" across all paradigms while preserving type-specific structure for each.

---

### 14.2 Workspace Behavior

**Decision:** Hybrid tabs within panel.

```mermaid
graph TD
    subgraph MongoPanel["MongoDB: mydb.users"]
        MT["[Query] [Browse] [Indexes] [Schema] [Aggregation]"]
        MC["(Content changes based on selected tab)"]
    end
    
    subgraph RedisPanel["Redis: localhost:6379 [DB 0]"]
        RT["[CLI] [Browse] [Server Info]"]
        RC["(Content changes based on selected tab)"]
    end
```

**Rationale:** One panel per connection with paradigm-specific tabs gives users flexibility in how they work with data.

---

### 14.3 Import/Export

**Decision:** JSON export/import in Phase 4, RDB deferred.

| Feature               | Phase    |
| --------------------- | -------- |
| MongoDB → JSON export | Phase 4  |
| MongoDB ← JSON import | Phase 4  |
| Redis → JSON export   | Phase 4  |
| Redis ← JSON import   | Phase 4  |
| Redis → RDB export    | Deferred |
| Redis ← RDB import    | Deferred |

**Rationale:** JSON import/export uses existing CRUD infrastructure. RDB requires special handling (BGSAVE, file access) with lower priority.

---

### 14.4 AI Integration

**Decision:** All paradigms, phased rollout.

| Phase   | AI Capability                                 |
| ------- | --------------------------------------------- |
| Phase 3 | Basic MongoDB/Redis command generation        |
| Phase 4 | Aggregation pipelines, complex Redis patterns |

**Rationale:** The AI already understands these syntaxes. Main work is providing paradigm context and schema information (collections, key patterns).
