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
| Sidebar           | Mongo: DB → Collections. Redis: DB 0-15 only                        |
| Value Editing     | Drawer + Breadcrumb + Inline Expansion                              |
| Redis Editors     | Specialized per type + Fallback for unknown                         |
| MongoDB Features  | All (CRUD, Indexes, Aggregation, Schema, GridFS, Streams, Sharding) |
| Connection Config | Form + Connection String (bidirectional)                            |
| Rust Crates       | `mongodb` (official) + `fred` (Redis)                               |
| Development       | Parallel (MongoDB + Redis tracks)                                   |
| Streaming         | MessagePack (same as SQL), lazy value loading for Redis             |

---

## 1. Architecture

### 1.1 Capability-Based Trait System

```
                    BaseAdapter
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   SqlQueryable   DocumentQueryable   KeyValueOperable
         │               │               │
         │               │               └── RichKeyValueOperable
         │               │                        │
    ┌────┴────┐     ┌────┴────┐              ┌────┴────┐
    │         │     │         │              │         │
 Postgres  MySQL  MongoDB  CouchDB        Redis   Memcached
                                       (rich+base)  (base only)
```

### 1.2 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/TS)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  BaseAdapter (connect, disconnect, testConnection, getMetadata)             │
│       │                                                                     │
│       ├── SqlQueryable ──────────────────┐                                  │
│       ├── SchemaIntrospectable ──────────┼── PostgreSQLAdapter              │
│       │                                  ├── MySQLAdapter                   │
│       │                                  ├── SQLiteAdapter                  │
│       │                                  └── MSSQLAdapter                   │
│       │                                                                     │
│       ├── DocumentQueryable ─────────────┼── MongoDBAdapter                 │
│       ├── SchemaIntrospectable ──────────┘   (collections, aggregation)     │
│       │                                                                     │
│       └── KeyValueOperable ──────────────┬── RedisAdapter                   │
│           └── RichKeyValueOperable ──────┘   (keys, TTL, type operations)   │
└──────────────────────────────────────────┴──────────────────────────────────┘
                                           │
                                           ▼ Tauri IPC (invoke)
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Rust)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Paradigm Operations:                                                       │
│       ├── DocumentOperation { Find, Insert, Update, Delete, Aggregate, ... }│
│       └── KeyValueOperation { Get, Set, Delete, Scan, HashOp, ListOp, ... } │
│                                                                             │
│  Adapters:                                                                  │
│       ├── postgres/ mysql/ sqlite/ mssql/  (existing)                       │
│       ├── mongodb/  (new - uses `mongodb` crate)                            │
│       └── redis/    (new - uses `fred` crate)                               │
└─────────────────────────────────────────────────────────────────────────────┘
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
  findDocuments(collection: string, filter: object, options?: FindOptions): Promise<Document[]>;
  insertDocument(collection: string, doc: object): Promise<InsertResult>;
  insertDocuments(collection: string, docs: object[]): Promise<InsertManyResult>;
  updateDocument(collection: string, filter: object, update: object): Promise<UpdateResult>;
  updateDocuments(collection: string, filter: object, update: object): Promise<UpdateResult>;
  replaceDocument(collection: string, filter: object, replacement: object): Promise<UpdateResult>;
  deleteDocument(collection: string, filter: object): Promise<DeleteResult>;
  deleteDocuments(collection: string, filter: object): Promise<DeleteResult>;
  
  // CRUD - atomic
  findOneAndUpdate(collection: string, filter: object, update: object): Promise<Document | null>;
  findOneAndReplace(collection: string, filter: object, replacement: object): Promise<Document | null>;
  findOneAndDelete(collection: string, filter: object): Promise<Document | null>;
  
  // CRUD - batch & stats
  bulkWrite(collection: string, operations: BulkOperation[]): Promise<BulkWriteResult>;
  countDocuments(collection: string, filter?: object): Promise<number>;
  distinct(collection: string, field: string, filter?: object): Promise<unknown[]>;
  
  // Aggregation
  aggregate(collection: string, pipeline: object[]): Promise<Document[]>;
  
  // Collection management
  listCollections(): Promise<CollectionInfo[]>;
  createCollection(name: string, options?: CollectionOptions): Promise<void>;
  dropCollection(name: string): Promise<void>;
  renameCollection(oldName: string, newName: string): Promise<void>;
  getCollectionStats(collection: string): Promise<CollectionStats>;
  
  // Indexes
  listIndexes(collection: string): Promise<IndexInfo[]>;
  createIndex(collection: string, keys: object, options?: IndexOptions): Promise<string>;
  dropIndex(collection: string, indexName: string): Promise<void>;
  
  // Schema validation
  getValidationRules(collection: string): Promise<ValidationRules | null>;
  setValidationRules(collection: string, rules: ValidationRules): Promise<void>;
  
  // GridFS
  listFiles(bucket?: string): Promise<GridFSFile[]>;
  uploadFile(filename: string, data: Blob, metadata?: object, bucket?: string): Promise<string>;
  downloadFile(fileId: string, bucket?: string): Promise<Blob>;
  deleteFile(fileId: string, bucket?: string): Promise<void>;
  
  // Change streams
  watchCollection(collection: string, pipeline?: object[]): AsyncIterable<ChangeEvent>;
  
  // Sharding
  getShardingStatus(): Promise<ShardingInfo>;
  
  // Escape hatch
  runCommand(command: object): Promise<Document>;
}
```

### 2.3 KeyValueOperable (All key-value stores)

```typescript
interface KeyValueOperable {
  // Key operations
  scanKeys(pattern: string, cursor?: string, count?: number): Promise<ScanResult>;
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
  listPush(key: string, values: string[], side: 'left' | 'right'): Promise<number>;
  listPop(key: string, side: 'left' | 'right', count?: number): Promise<string[]>;
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
  zsetRange(key: string, start: number, stop: number, options?: ZRangeOptions): Promise<ZSetMember[]>;
  zsetAdd(key: string, members: ZSetMember[]): Promise<number>;
  zsetRemove(key: string, members: string[]): Promise<number>;
  zsetScore(key: string, member: string): Promise<number | null>;
  zsetRank(key: string, member: string): Promise<number | null>;
  zsetCardinality(key: string): Promise<number>;
  
  // Stream
  streamRange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]>;
  streamLen(key: string): Promise<number>;
  streamInfo(key: string): Promise<StreamInfo>;
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
└── Sidebar/                        # Updated tree structure
    ├── MongoTree.tsx               # Database → Collections
    └── RedisTree.tsx               # Database (0-15) only
```

### 4.2 Document/Value Editor UX

Drawer with Breadcrumb + Inline Expansion:

```
┌──────────────────────────────────────────────────────────────┐
│ [Keys Grid]         │ [Document Drawer]                      │
│                     │ ┌────────────────────────────────────┐ │
│                     │ │ 📍 user:1 › profile › settings     │ │ ← Breadcrumb
│                     │ ├────────────────────────────────────┤ │
│ user:1        ───▶  │ │ ▼ root                             │ │
│ user:2              │ │   _id: "abc"                       │ │
│ user:3              │ │   ▼ profile: {                     │ │
│                     │ │       name: "John"                 │ │
│                     │ │       ▼ settings: {       ← focus  │ │ ← Inline expanded
│                     │ │           theme: "dark"            │ │
│                     │ │           lang: "en"               │ │
│                     │ │         }                          │ │
│                     │ │     }                              │ │
│                     │ │   ▶ tags: [3 items]                │ │
│                     │ └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 Redis Type Editors

| Type     | Editor Component       | Behavior                                        |
| -------- | ---------------------- | ----------------------------------------------- |
| `string` | Text/JSON Editor       | Auto-detect JSON, toggle raw vs. formatted      |
| `hash`   | Mini DataGrid (2 cols) | Field / Value table, inline add/edit/delete     |
| `list`   | Sortable List          | Drag to reorder, supports LPUSH/RPUSH/LREM      |
| `set`    | Tag Input              | Pills/chips UI, click × to remove, input to add |
| `zset`   | Mini DataGrid + Score  | Member / Score table, sortable by score         |
| `stream` | Timeline (read-only)   | Chronological entries, ID + fields, no edit     |
| Unknown  | Fallback               | Read-only raw view + metadata                   |

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
  
  // Mode 2: Connection string
  connectionString?: string;  // mongodb://user:pass@host1,host2/db?replicaSet=rs0
}
```

### 5.2 Redis

```typescript
interface RedisConnectionConfig {
  // Mode 1: Structured
  host: string;
  port: number;
  database: number;           // 0-15
  user?: string;              // Redis 6+ ACL
  password?: string;
  ssl?: SslConfig;
  ssh?: SshTunnelConfig;
  
  // Cluster/Sentinel
  mode: 'standalone' | 'cluster' | 'sentinel';
  sentinelMaster?: string;
  nodes?: { host: string; port: number }[];
  
  // Mode 2: Connection string
  connectionString?: string;  // redis://user:pass@host:6379/0
}
```

### 5.3 DbType Enum Update

```rust
pub enum DbType {
    // SQL (existing)
    PostgreSQL,
    MySQL,
    SQLite,
    MSSQL,
    
    // Document (new)
    MongoDB,
    
    // KeyValue (new)
    Redis,
}
```

---

## 6. Data Flow & Streaming

Same MessagePack streaming pattern as SQL, with lazy loading for Redis values:

```
Frontend                              Backend (Rust)
   │                                       │
   ├── invoke("document_execute") ────────▶│
   │   { op: Find, collection, filter }    ├── Translate to native call
   │                                       ├── Stream documents via IPC
   │◀── MessagePack chunks ────────────────┤
   │    [{_id, name, ...}, ...]            │
   └── Render in DocumentsGrid             │


   ├── invoke("keyvalue_execute") ────────▶│
   │   { op: Scan, pattern: "user:*" }     ├── SCAN cursor loop
   │                                       ├── Stream key metadata via IPC
   │◀── MessagePack chunks ────────────────┤
   │    [{key, type, ttl, size}, ...]      │
   └── Render in KeysGrid                  │
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
    
    // SQL-specific
    SqlSyntaxError { message: String, position: Option<u32> },
    
    // Document-specific
    DocumentValidationFailed { collection: String, errors: Vec<ValidationError> },
    DuplicateKey { collection: String, key: Value },
    
    // KeyValue-specific
    KeyNotFound { key: String },
    WrongType { key: String, expected: String, actual: String },
    
    // Common
    PermissionDenied { operation: String },
    NotSupported { operation: String, reason: String },
    Unknown { message: String },
}
```

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Update DbType enum
- Add paradigm traits (DocumentQueryable, KeyValueOperable)
- Base adapter infrastructure
- Connection config types

### Phase 2: Core Implementation (Week 3-5)
**MongoDB Track:**
- mongodb crate integration
- MongoDbAdapter (connect, disconnect, basic CRUD)
- MongoConnectionForm
- Sidebar: Database/Collection tree
- CollectionBrowser (grid)

**Redis Track (parallel):**
- fred crate integration
- RedisAdapter (connect, disconnect, basic ops)
- RedisConnectionForm
- Sidebar: Database 0-15
- KeyBrowser (grid)

### Phase 3: Editors (Week 6-7)
**MongoDB Track:**
- DocumentEditor component (TreeView + Breadcrumb)
- CodeEditor: JS/MQL mode
- Inline CRUD in grid

**Redis Track (parallel):**
- StringEditor, HashEditor, ListEditor
- SetEditor, ZSetEditor
- StreamViewer, FallbackEditor
- CodeEditor: Redis mode

### Phase 4: Advanced Features (Week 8-10)
**MongoDB Track:**
- Indexes UI
- Aggregation pipeline builder
- Schema validation UI
- GridFS browser
- Change streams viewer
- Sharding info panel

**Redis Track (parallel):**
- TTL management UI
- Key analysis/stats
- Cluster mode (if time)

### Phase 5: Polish (Week 11-12)
- Connection string parser (bidirectional)
- Error handling refinement
- Performance optimization
- Testing & bug fixes

---

## 9. Testing Strategy

### Backend (Rust)
- **Unit:** Mock database responses, test adapter logic
- **Integration:** Use `testcontainers` crate for real MongoDB/Redis
- **Commands:** Test Tauri commands with mock adapters

### Frontend (TypeScript)
- **Unit:** Vitest for adapters, utility functions
- **Component:** React Testing Library for editors
- **Integration:** Mock Tauri IPC, test full component flows

---

## 10. Dependencies

### Rust (Cargo.toml)
```toml
[dependencies]
mongodb = "2.8"
fred = "9.0"
```

### CodeMirror Modes
- MongoDB: Built-in JavaScript mode
- Redis: Custom mode or extended shell mode
