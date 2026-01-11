# Query Pilot Backend API Specification

This document provides comprehensive API documentation for all Tauri commands exposed by the Query Pilot Rust backend.

## Overview

The backend follows a clean adapter pattern architecture with trait-based database adapters. All commands are exposed through a unified interface in `commands.rs` and use a connection manager for pooling and lifecycle management.

**Key Components:**
- **Commands**: Unified command interface for all database operations
- **Connection Manager**: Handles connection pooling, idle timeout, and resource cleanup
- **Database Adapters**: Trait-based adapters implementing `DbAdapter` for each database type
- **Secure Storage**: Integrated credential storage (implementation in progress)

All commands are invoked via Tauri's IPC system from the frontend and return Results with structured error handling.

## Implementation Status

**Current State**: PostgreSQL adapter is fully implemented. MySQL, SQLite, and SQL Server adapters are in development. The system uses a streaming query model with `QueryHandle` and `PageChunk` for efficient data transfer.

## Error Handling

All commands return `Result<T, String>` where errors are converted to strings for frontend consumption. The underlying `AppError` type in the backend includes:

- Database errors from adapter operations
- Connection management errors
- Query execution and streaming errors
- Configuration and validation errors
- I/O and serialization errors

Errors are automatically converted to user-friendly messages when crossing the Tauri IPC boundary.

---

## Data Structure: CellValue

All database query results use the standardized `CellValue` structure for consistent data representation across all database types.

### CellValue Structure

```rust
pub struct CellValue {
    pub value_type: CellValueType,        // Type of the cell value
    pub raw_value: Option<Vec<u8>>,       // Raw binary representation (optional)
    pub display_value: String,            // Human-readable display string
    pub db_specific: Option<DbSpecificValue>,  // Database-specific metadata
}
```

### CellValueType Enumeration

The `CellValueType` enum supports both standard cross-database types and PostgreSQL-specific extensions:

#### Standard Types (Cross-Database)

```rust
pub enum CellValueType {
    // Core types
    Null,
    Text,
    Integer,
    Decimal,
    Boolean,
    Date,
    Time,
    DateTime,
    Binary,
    Json,
    Uuid,
    
    // PostgreSQL-specific types (extensive support)
    Array(Box<CellValueType>),
    Composite(Vec<(String, CellValueType)>),
    Range(Box<CellValueType>),
    Geometry,
    Xml,
    Inet,
    Cidr,
    MacAddr,
    Interval,
    // ... and many more PostgreSQL types
    
    // Generic extension
    CustomType(String),
}
```

### Database-Specific Value Metadata

PostgreSQL-specific metadata is captured in:

```rust
pub enum DbSpecificValue {
    PostgreSQL(PostgresValue),
}

pub struct PostgresValue {
    pub oid: u32,           // PostgreSQL type OID
    pub type_name: String,  // Type name in database
    pub type_modifier: i32, // Type modifier (e.g., varchar length)
}
```
  
  // MySQL/MariaDB Extensions  
  | "Set"       // SET type - multiple enum values
  | "Year"      // YEAR type - 4-digit year display
  | "Bit"       // BIT type - binary string representation
  
  // SQL Server Extensions
  | "HierarchyId"    // Hierarchical data - tree path display
  | "Geography"      // Geographic spatial data with SRID
  | "Money"          // Currency values - locale-aware formatting
  | "SmallMoney"     // Smaller currency values
  | "DateTimeOffset" // DateTime with timezone offset
  
  // MongoDB Extensions (Planned)
  | "ObjectId"       // MongoDB ObjectId - 24-char hex with timestamp
  | "BsonRegex"      // BSON regular expressions
  | "BsonTimestamp"  // BSON timestamp with increment
  | "BsonDocument"   // Nested BSON document
  | "MinKey"         // MongoDB MinKey type
  | "MaxKey"         // MongoDB MaxKey type
  
  // NoSQL/Document Extensions
  | "Document"       // Nested document structure
  | "Embedded"       // Embedded object/document
  
  // Vector Database Extensions  
  | "Vector"         // Dense vector embeddings
  | "SparseVector"   // Sparse vector representation
  
  // Graph Database Extensions
  | "Node"           // Graph node with properties
  | "Edge"           // Graph edge/relationship
  | "Path";          // Graph path/traversal

// Complete type union
type CellValueType = StandardCellValueType | ExtendedCellValueType;
```

#### Type Detection Strategy

The adapter determines the appropriate CellValueType based on:

1. **Native Type Mapping**: Direct mapping from database type to CellValueType
2. **Type Affinity**: For databases with flexible typing (SQLite), use affinity rules
3. **Content Analysis**: For JSON/XML detection in text columns
4. **Metadata Hints**: Using column metadata to determine specialized types
5. **Fallback**: Unknown or unsupported types default to "Text" or "Unknown"

### Column Metadata

Column metadata is provided via `ColumnMeta`:

```rust
pub struct ColumnMeta {
    pub name: String,
    pub data_type: CellValueType,
    pub nullable: bool,
    pub primary_key: bool,
    pub db_type: String,        // Original database type string
    pub type_oid: Option<u32>,  // PostgreSQL type OID
}
```

### Frontend Rendering Guidelines

#### Standardized Type Rendering

Core types that must be supported by all database views:

- **Null**: Show as empty cell or italic "NULL" placeholder
- **Text**: Plain text display with text selection capability
- **Integer**: Right-aligned with thousands separators (1,234,567)
- **Decimal**: Use `precision`/`scale` metadata for proper decimal formatting
- **Boolean**: Checkbox controls or true/false text indicators
- **Date**: Locale date formatting (e.g., MM/DD/YYYY or DD/MM/YYYY)
- **DateTime**: Full datetime with timezone indicator
- **Time**: Time formatting (HH:MM:SS or 12-hour format)
- **Json**: Syntax highlighted with expand/collapse for nested structures
- **Binary**: Hex representation with download/view options
- **Uuid**: Formatted with hyphens, one-click copy functionality
- **Array**: Expandable list showing individual elements with proper type formatting
- **Unknown**: Fallback to plain text representation

#### Database-Specific Type Rendering

Extended types with specialized rendering requirements:

**PostgreSQL Types:**
- **Geometry**: WKT display with optional map visualization
- **Xml**: XML syntax highlighting with tree view option
- **Enum**: Dropdown showing valid enum values
- **Interval**: Human-readable duration (e.g., "2 days 3:04:05")
- **Range**: Display as "[lower, upper)" with proper bounds
- **Inet/Cidr**: Validated IP address formatting
- **MacAddr**: MAC address with standard colon formatting

**MySQL/MariaDB Types:**
- **Set**: Multi-select checkbox list or chip display
- **Year**: 4-digit year display
- **Bit**: Binary string (e.g., "0b101010")

**SQL Server Types:**
- **HierarchyId**: Tree path display (e.g., "/1/2/3/")
- **Geography**: Coordinate display with optional map
- **Money**: Currency formatting with locale symbols
- **DateTimeOffset**: DateTime with explicit timezone offset

**MongoDB Types (Planned):**
- **ObjectId**: Monospace hex with timestamp tooltip
- **BsonDocument**: Nested JSON viewer
- **MinKey/MaxKey**: Special value indicators

**Advanced Database Types:**
- **Vector**: Array of numbers with dimension indicator
- **Node/Edge**: Graph visualization or property table
- **Path**: Step-by-step path display

#### Rendering Priority

When a database-specific type is not supported by the frontend:
1. Check if it extends a standard type (fallback to standard)
2. Use the `db_type` field to show original type as tooltip
3. Render as "Text" with type indicator badge
4. Log unsupported type for future implementation

---

## Database Commands

All commands use a unified interface through the connection manager. Commands accept a `conn_id` to identify the target connection.

### Connection Management

#### `connect`

Establishes or retrieves a database connection using connection pooling.

**Parameters:**

- `profile: ConnectionProfile` - Connection configuration

**Returns:** `ConnectionInfo`

```rust
pub struct ConnectionInfo {
    pub id: String,           // Connection identifier (connection key)
    pub db_type: DbType,      // Database type
    pub database: String,     // Database name
    pub version: Option<String>,  // Server version
}
```

**ConnectionProfile:**

```rust
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub db_type: DbType,      // PostgreSQL, MySQL, SQLite, SQLServer
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: Option<SslMode>,
    pub options: HashMap<String, String>,  // Additional connection options
}
```

Connections are pooled and reused based on a connection key derived from the profile.

#### `disconnect`

Closes a database connection and removes it from the pool.

**Parameters:**

- `conn_id: String` - Connection identifier

**Returns:** `()`

#### `test_connection`

Tests if a connection is healthy.

**Parameters:**

- `conn_id: String` - Connection identifier

**Returns:** `ConnectionTestResult`

```rust
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
    pub warnings: Vec<String>,
}
```

### Query Execution

The system uses a streaming query model with cursors for efficient handling of large result sets.

#### `execute_query`

Opens a query and returns a handle for streaming results.

**Parameters:**

- `conn_id: String`
- `sql: String`

**Returns:** `QueryHandle`

```rust
pub struct QueryHandle {
    pub id: String,                      // Query identifier
    pub columns: Vec<ColumnMeta>,        // Column metadata
    pub estimated_rows: Option<i64>,     // Row count estimate if available
}
```

#### `fetch_results`

Fetches a page of results from an open query.

**Parameters:**

- `conn_id: String`
- `query_handle: QueryHandle`
- `max_rows: usize` - Maximum rows to fetch

**Returns:** `PageChunk`

```rust
pub struct PageChunk {
    pub rows: Vec<Vec<CellValue>>,  // Result rows
    pub has_more: bool,             // More results available
    pub rows_fetched: usize,        // Rows in this chunk
    pub timing: Option<PageTiming>,  // Performance metrics
}

pub struct PageTiming {
    pub fetch_ms: u32,    // Time to fetch from database
    pub decode_ms: u32,   // Time to decode values
}
```

### Schema Introspection

#### `get_databases`

Retrieves available databases.

**Parameters:**

- `conn_id: String`

**Returns:** `Vec<Database>`

```rust
pub struct Database {
    pub name: String,
    pub owner: Option<String>,
    pub encoding: Option<String>,
    pub collation: Option<String>,
    pub size: Option<String>,
}
```

#### `get_schemas`

Lists schemas within a database.

**Parameters:**

- `conn_id: String`
- `database: String`

**Returns:** `Vec<Schema>`

```rust
pub struct Schema {
    pub name: String,
    pub owner: Option<String>,
}
```

#### `get_tables`

Lists tables in a schema.

**Parameters:**

- `conn_id: String`
- `schema: String`

**Returns:** `Vec<Table>`

```rust
pub struct Table {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    pub owner: Option<String>,
    pub size: Option<String>,
    pub row_count: Option<i64>,
    pub comment: Option<String>,
}

pub enum TableKind {
    Regular,
    Partitioned,
    Foreign,
    Temporary,
}
```

#### `get_views`

Lists views in a schema.

**Parameters:**

- `conn_id: String`
- `schema: String`

**Returns:** `Vec<View>`

```rust
pub struct View {
    pub schema: String,
    pub name: String,
    pub owner: Option<String>,
    pub definition: Option<String>,
    pub is_materialized: bool,
    pub comment: Option<String>,
}
```

#### `get_functions`

Lists functions in a schema.

**Parameters:**

- `conn_id: String`
- `schema: String`

**Returns:** `Vec<Function>`

```rust
pub struct Function {
    pub schema: String,
    pub name: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
    pub is_aggregate: bool,
    pub is_window: bool,
    pub is_trigger: bool,
    pub source: Option<String>,
}
```

#### `get_indexes`

Retrieves indexes for a table.

**Parameters:**

- `conn_id: String`
- `table: String`

**Returns:** `Vec<Index>`

```rust
pub struct Index {
    pub name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub is_partial: bool,
    pub definition: String,
}
```

#### `get_constraints`

Retrieves constraints for a table.

**Parameters:**

- `conn_id: String`
- `table: String`

**Returns:** `Vec<Constraint>`

```rust
pub struct Constraint {
    pub name: String,
    pub table_name: String,
    pub constraint_type: ConstraintType,
    pub definition: String,
    pub foreign_table: Option<String>,
}

pub enum ConstraintType {
    PrimaryKey,
    ForeignKey,
    Unique,
    Check,
    Exclusion,
}
```

#### `get_columns`

Retrieves column metadata for a table.

**Parameters:**

- `conn_id: String`
- `schema: String`
- `table: String`

**Returns:** `Vec<ColumnMeta>`

The `ColumnMeta` structure is described in the Column Metadata section above.

#### `get_triggers`

Retrieves triggers for a table.

**Parameters:**

- `conn_id: String`
- `schema: String`
- `table: String`

**Returns:** `Vec<Trigger>`

```rust
pub struct Trigger {
    pub name: String,
    pub schema: String,
    pub table_name: String,
    pub event: String,        // INSERT, UPDATE, DELETE, TRUNCATE
    pub timing: String,       // BEFORE, AFTER, INSTEAD OF
    pub level: String,        // ROW, STATEMENT
    pub enabled: bool,
    pub function: String,
    pub condition: Option<String>,
}
```

### Table Data Operations

#### `get_table_count`

Retrieves the total row count for a table.

**Parameters:**

- `conn_id: String`
- `schema: String`
- `table: String`

**Returns:** `i64`

#### `stream_query`

Executes a query with streaming results for optimal performance on large datasets.

**Parameters:**

- `conn_id: String`
- `sql: String`
- `page_size: usize` - Rows per chunk (default: 1000)

**Returns:** `String` (stream_id)

**Emitted Events:** `query-stream-{stream_id}`

```rust
pub enum StreamEvent {
    Started { 
        columns: Vec<ColumnMeta>,
        estimated_rows: Option<i64>
    },
    Data {
        rows: Vec<Vec<CellValue>>,
        row_offset: usize,
    },
    Progress {
        rows_fetched: usize,
        percentage: Option<f32>,
    },
    Completed {
        total_rows: usize,
        execution_time_ms: u64,
    },
    Error {
        message: String,
        code: Option<String>,
    },
}
```

Streaming enables real-time data display as results arrive from the database, providing immediate feedback to users even for queries returning millions of rows.

## Adapter Architecture

The system uses a trait-based adapter pattern where each database type implements the `DbAdapter` trait:

```rust
#[async_trait]
pub trait DbAdapter: Send + Sync {
    // Connection management
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()>;
    async fn disconnect(&mut self) -> Result<()>;
    async fn test_connection(&self) -> Result<ConnectionTestResult>;
    async fn is_connected(&self) -> bool;
    
    // Query execution with streaming
    async fn open_query(&self, sql: &str) -> Result<QueryHandle>;
    async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk>;
    async fn close_query(&self, handle: &QueryHandle) -> Result<()>;
    async fn cancel_query(&self, handle: &QueryHandle) -> Result<()>;
    
    // Simple query execution (for DDL, etc)
    async fn execute(&self, sql: &str) -> Result<u64>;
    
    // Introspection methods
    async fn get_databases(&self) -> Result<Vec<Database>>;
    async fn get_schemas(&self, database: &str) -> Result<Vec<Schema>>;
    async fn get_tables(&self, schema: &str) -> Result<Vec<Table>>;
    async fn get_views(&self, schema: &str) -> Result<Vec<View>>;
    async fn get_functions(&self, schema: &str) -> Result<Vec<Function>>;
    async fn get_indexes(&self, table: &str) -> Result<Vec<Index>>;
    async fn get_constraints(&self, table: &str) -> Result<Vec<Constraint>>;
    async fn get_table_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>>;
    async fn get_table_row_count(&self, schema: &str, table: &str) -> Result<i64>;
    
    // Table operations
    async fn get_triggers(&self, schema: &str, table: &str) -> Result<Vec<Trigger>>;
    async fn get_table_count(&self, schema: &str, table: &str) -> Result<i64>;
    
    // Database-specific features
    fn get_supported_types(&self) -> Vec<CellValueType>;
    fn supports_schemas(&self) -> bool { true }
    fn supports_procedures(&self) -> bool { false }
    fn supports_functions(&self) -> bool { true }
    fn supports_streaming(&self) -> bool { true }
}
```

## Connection Manager

The `ConnectionManager` handles connection pooling and lifecycle:

- **Connection Pooling**: Reuses connections based on connection keys
- **Idle Timeout**: Automatically closes idle connections after 10 minutes
- **Resource Cleanup**: Background reaper task removes stale connections
- **Query Tracking**: Monitors active queries per connection

```rust
pub struct ConnectionManager {
    connections: Arc<DashMap<String, LiveConnection>>,
    queries: Arc<DashMap<String, QueryHandle>>,
    idle_timeout: Duration,
    // ... other fields
}

pub struct LiveConnection {
    pub id: String,
    pub adapter: Box<dyn DbAdapter>,
    pub profile: ConnectionProfile,
    pub created_at: Instant,
    pub last_used: Arc<RwLock<Instant>>,
    pub query_count: Arc<AtomicUsize>,
    pub active_queries: Arc<AtomicUsize>,
}
```

## Secure Storage

**Note**: Secure storage commands are planned but not yet exposed as Tauri commands. The infrastructure exists in `src/storage/secure_store.rs` for future implementation.

## Database Support Matrix

| Database              | Status | Notes |
| --------------------- | ------ | ----- |
| PostgreSQL            | ✅     | Fully implemented with extensive type support |
| MySQL                 | 🚧     | In development |
| SQLite                | 🚧     | In development |
| Microsoft SQL Server  | 🚧     | In development |
| MongoDB               | 📋     | Planned |
| Other databases       | 🚧     | Future consideration |

**Legend:**
- ✅ Currently supported
- 🚧 In development
- 📋 Planned
- ❌ Not supported

## PostgreSQL Type Support

The PostgreSQL adapter (`src-tauri/src/adapters/postgres/`) provides comprehensive type support through the `CellValueType` enum. Notable PostgreSQL-specific types include:

- **Arrays**: Multi-dimensional array support with `Array(Box<CellValueType>)`
- **Composite Types**: User-defined composite types
- **Range Types**: Range and multirange support
- **Geometric Types**: PostGIS and native geometric types
- **Network Types**: INET, CIDR, MAC addresses
- **Full-Text Search**: TsVector and TsQuery
- **XML and JSON**: Native XML and JSON/JSONB support
- **UUID**: Native UUID type
- **Money**: Currency type
- **Custom Types**: Enums and domains

The adapter automatically maps PostgreSQL OIDs to appropriate `CellValueType` variants and provides database-specific metadata through the `PostgresValue` structure.


## Performance Considerations

- **Connection Pooling**: Connections are pooled and reused based on connection keys
- **Idle Timeout**: Connections automatically close after 10 minutes of inactivity
- **Query Streaming**: Large result sets use streaming with `QueryHandle` and `PageChunk`
- **Real-time Results**: `stream_query` provides immediate feedback with chunked data delivery
- **Resource Management**: Background reaper task manages connection lifecycle
- **Concurrent Queries**: Multiple queries can run concurrently on the same connection
- **Virtual Scrolling**: Frontend handles millions of rows efficiently with pagination
- **Memory Efficiency**: Streaming prevents memory overflow on large datasets

## Usage Example

### Basic Query Execution

```typescript
// 1. Connect to database
const conn = await invoke("connect", { 
  profile: {
    id: "my-connection",
    name: "Production DB",
    db_type: "PostgreSQL",
    host: "localhost",
    port: 5432,
    database: "myapp",
    username: "user",
    password: "pass"
  }
});

// 2. Execute a query
const queryHandle = await invoke("execute_query", {
  conn_id: conn.id,
  sql: "SELECT id, name, email FROM users WHERE active = true"
});

// 3. Fetch results in pages
const results = await invoke("fetch_results", {
  conn_id: conn.id,
  query_handle: queryHandle,
  max_rows: 100
});

// Process results
results.rows.forEach(row => {
  // Each row is an array of CellValue objects
  const [id, name, email] = row;
  console.log(`User: ${name.display_value} (${email.display_value})`);
});

// 4. Fetch more if available
if (results.has_more) {
  const moreResults = await invoke("fetch_results", {
    conn_id: conn.id,
    query_handle: queryHandle,
    max_rows: 100
  });
}

// 5. Get schema information
const databases = await invoke("get_databases", { conn_id: conn.id });
const schemas = await invoke("get_schemas", { conn_id: conn.id, database: "myapp" });
const tables = await invoke("get_tables", { conn_id: conn.id, schema: "public" });

// 6. Disconnect when done
await invoke("disconnect", { conn_id: conn.id });
```
