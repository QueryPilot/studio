# DevDB Studio Backend API Specification

This document provides comprehensive API documentation for all Tauri commands exposed by the DevDB Studio Rust backend.

## Overview

The backend exposes three main categories of commands:

- **Database Operations**: Connection management, querying, schema introspection
- **Secure Storage**: Encrypted credential management and secure data storage
- **Health Monitoring**: Connection health and performance monitoring

All commands are invoked via Tauri's IPC system from the frontend and return Results with structured error handling.

## Implementation Status

**Current State**: PostgreSQL, MySQL, MariaDB, SQLite, and Microsoft SQL Server adapters are fully implemented with comprehensive type support. MongoDB adapter specification is complete and ready for implementation. Other NoSQL and cloud database adapters remain in planning phase.

## Error Handling

All commands return `Result<T, AppError>` where `AppError` includes:

- `Database(String)` - SQL/database adapter errors
- `ConnectionNotFound(String)` - Connection ID not found in registry
- `CursorNotFound(String)` - Query cursor ID not found
- `QueryCancelled(String)` - Query operation was cancelled
- `QueryNotFound(String)` - Query/cursor ID not found
- `InvalidConfig(String)` - Invalid connection configuration
- `ValidationError(String)` - Invalid input parameters
- `Timeout(String)` - Operation timeout
- `Io(String)` - File system errors
- `Serialization(String)` - JSON serialization errors
- `Unsupported(String)` - Unsupported operation

---

## Data Structure: CellValue

All database query results and table data operations now use the standardized `CellValue` structure for consistent frontend rendering across all database types.

### CellValue Structure

```typescript
{
  value: any | null,                    // Actual data value or null for SQL NULL
  db_type: string,                      // Original database type (e.g., "VARCHAR(255)", "INT", "TIMESTAMP")
  value_type: CellValueType,            // Standardized type for frontend rendering
  metadata?: CellMetadata,              // Optional formatting and precision metadata
  is_truncated: boolean,                // Whether value was truncated due to size limits
  byte_size?: number                    // Original byte size (useful for binary/large data)
}
```

### CellValueType Enumeration

Types are divided into standardized cross-database types and database-specific extensions:

#### Standardized Types (Cross-Database)

Core types supported across all database adapters:

```typescript
type StandardCellValueType =
  | "Null"      // SQL NULL - render as empty or "NULL" indicator
  | "Text"      // String data - plain text with selection
  | "Integer"   // Integer numbers - right-align, thousands separators
  | "Decimal"   // Floating/decimal numbers - use precision/scale metadata
  | "Boolean"   // Boolean values - checkboxes or true/false text
  | "Date"      // Date only - locale date formatting
  | "DateTime"  // Date with time - full datetime formatting with timezone
  | "Time"      // Time only - time formatting without date
  | "Json"      // JSON data - syntax highlighting, expand/collapse
  | "Binary"    // Binary data - hex display or download options
  | "Uuid"      // UUID values - formatted with hyphens, copy functionality
  | "Array"     // Array/list values - expandable list with element formatting
  | "Unknown";  // Unsupported types - fallback to plain text
```

#### Database-Specific Extended Types

Additional types for specialized database features:

```typescript
type ExtendedCellValueType =
  // PostgreSQL Extensions
  | "Geometry"  // PostGIS spatial data - coordinates or map rendering
  | "Xml"       // XML data - syntax highlighting and structure formatting
  | "Enum"      // User-defined enumerated types - show options, validate
  | "Interval"  // Time intervals - duration formatting
  | "TsVector"  // Full-text search vectors
  | "TsQuery"   // Full-text search queries
  | "Range"     // Range types (int4range, daterange, etc.)
  | "Inet"      // IP addresses - validated formatting
  | "Cidr"      // Network addresses with CIDR notation
  | "MacAddr"   // MAC addresses - formatted with colons
  
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

### CellMetadata Structure

Rich metadata for proper value formatting and display:

```typescript
{
  precision?: number,                   // Numeric precision (total digits)
  scale?: number,                       // Numeric scale (decimal places)
  max_length?: number,                  // Maximum character length for text
  charset?: string,                     // Character encoding (utf8, latin1, etc.)
  timezone?: string,                    // Timezone for temporal types
  element_type?: string,                // Element type for arrays
  srid?: number,                        // Spatial Reference System ID for geometry
  enum_values?: string[],               // Available values for enum types
  attributes?: Record<string, any>      // Additional database-specific metadata
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

**Note:** PostgreSQL, MSSQL, and SQLite adapters are fully implemented with all data types supported. Other database adapters (MySQL, MariaDB) remain as placeholder implementations.

**Data Conversion Architecture:** Each database adapter is responsible for converting its native data types to the standardized `CellValue` format. This provides:

- **Consistent Frontend**: Single data structure for all database types
- **Rich Metadata**: Type hints, precision, and formatting information
- **Database Flexibility**: Each adapter handles type conversion independently
- **Future Extensibility**: New database types can be added without frontend changes

### Connection Management

#### `db_connect`

Establishes a new database connection with auto-generated ID.

**Parameters:**

- `config: ConnectionConfig` - Connection configuration

**Returns:** `ConnectResponse`

```typescript
{
  connection_id: string,
  server_version: string | null
}
```

**ConnectionConfig:**

```typescript
{
  id: string,
  name: string,
  db_type: "Postgres" | "Mysql" | "Sqlite" | "Mssql" | "Mariadb" | "Mongodb",
  host: string,
  port: number,
  database: string,
  username: string,
  password?: string,
  max_connections: number,
  min_connections: number,
  connection_timeout: number, // milliseconds
  idle_timeout: number,
  max_lifetime: number,
  // MSSQL specific
  instance_name?: string,
  auth_type?: "windows" | "sql",
  encrypt?: boolean,
  trust_server_certificate?: boolean,
  // MongoDB specific
  connection_string?: string,      // Full MongoDB URI (alternative to host/port)
  replica_set?: string,            // Replica set name
  auth_mechanism?: string,         // SCRAM-SHA-1, SCRAM-SHA-256, MONGODB-X509, etc.
  tls?: boolean,                   // Enable TLS/SSL
  tls_ca_file?: string,           // Path to CA certificate
  direct_connection?: boolean,     // Force direct connection (bypass discovery)
  server_selection_timeout_ms?: number  // Server selection timeout
}
```

#### `db_connect_by_id`

Connects using stored credentials from secure storage with workspace isolation.

**Parameters:**

- `connection_id: string` - Stored connection identifier
- `workspace_id?: string` - Optional workspace for connection isolation

**Returns:** `ConnectResponse`

#### `db_disconnect`

Closes a database connection and cleans up resources.

**Parameters:**

- `connection_id: string`

**Returns:** `()`

#### `db_test_connection`

Tests database connectivity without persisting the connection.

**Parameters:**

- `config: ConnectionConfig`

**Returns:** `TestConnectionResult`

```typescript
{
  success: boolean,
  error_message?: string
}
```

#### `db_ping`

Tests active connection health and measures round-trip time.

**Parameters:**

- `connection_id: string`

**Returns:** `number` (milliseconds)

### Schema Introspection

#### `db_list_databases`

Retrieves available databases on the server.

**Parameters:**

- `connection_id: string`

**Returns:** `string[]`

#### `db_list_schemas`

Lists schemas within a database.

**Parameters:**

- `connection_id: string`
- `database: string`

**Returns:** `string[]`

#### `db_list_tables`

Lists tables and views in a schema.

**Parameters:**

- `connection_id: string`
- `database: string`
- `schema: string`

**Returns:** `TableMeta[]`

```typescript
{
  schema: string,
  name: string,
  kind: "Table" | "View" | "MaterializedView",
  row_estimate?: number,
  size_bytes?: number
}
```

#### `db_list_functions`

Lists functions/stored procedures in a schema.

**Parameters:**

- `connection_id: string`
- `database: string`
- `schema: string`

**Returns:** `FunctionMeta[]`

```typescript
{
  schema: string,
  name: string,
  return_type: string,
  arguments: string[]
}
```

#### `db_table_columns`

Retrieves column metadata for a table.

**Parameters:**

- `connection_id: string`
- `database: string`
- `schema: string`
- `table: string`

**Returns:** `ColumnMeta[]`

```typescript
{
  name: string,
  db_type: string,
  nullable: boolean,
  default?: string,
  is_pk: boolean,
  is_fk: boolean,
  ordinal: number,
  precision?: number,
  scale?: number,

  // SQLite specific (sq_*)
  sq_is_autoincrement?: boolean,
  sq_is_strict?: boolean,
  sq_is_generated?: boolean,
  sq_generation_expression?: string,
  sq_collation?: string,

  // PostgreSQL specific (pg_*)
  pg_is_array?: boolean,
  pg_array_dimensions?: number,
  pg_enum_values?: string[],
  pg_is_generated?: boolean,
  pg_generation_expression?: string,

  // MySQL specific (my_*)
  my_is_json?: boolean,
  my_enum_values?: string[],
  my_set_values?: string[],
  my_is_virtual?: boolean,
  my_is_stored?: boolean,
  my_generation_expression?: string,
  my_charset?: string,
  my_collation?: string,

  // MariaDB specific (ma_*)
  ma_is_json?: boolean,
  ma_enum_values?: string[],
  ma_set_values?: string[],
  ma_is_virtual?: boolean,
  ma_is_persistent?: boolean,
  ma_generation_expression?: string,
  ma_charset?: string,
  ma_collation?: string,

  // MSSQL specific (ms_*)
  ms_is_identity?: boolean,
  ms_identity_seed?: number,
  ms_identity_increment?: number,
  ms_is_computed?: boolean,
  ms_computation_expression?: string,
  ms_is_hierarchyid?: boolean,
  ms_is_spatial?: boolean,
  ms_is_sparse?: boolean,
  ms_is_column_set?: boolean,
  ms_collation?: string,

  // Oracle specific (or_*)
  or_is_identity?: boolean,
  or_is_virtual?: boolean,
  or_data_default?: string,
  or_char_length?: number,
  or_is_nested_table?: boolean,

  // Redis specific (rd_*) - for RedisJSON/RedisGraph
  rd_path?: string,
  rd_index_type?: string,
  rd_is_sortable?: boolean,
  rd_is_searchable?: boolean,
  rd_key_type?: string,

  // MongoDB specific (mg_*)
  mg_is_required?: boolean,              // Field is required in validation schema
  mg_is_sparse_index?: boolean,          // Field has sparse index
  mg_index_type?: string,                // Index type (2d, 2dsphere, text, hashed)
  mg_is_text_indexed?: boolean,          // Field is part of text index
  mg_text_weights?: number,              // Text search weight
  mg_bson_type?: string,                 // Original BSON type (ObjectId, Decimal128, etc.)
  mg_field_path?: string,                // Nested field path (e.g., "address.city")
  mg_is_array_element?: boolean,         // Field represents array element type
  mg_validation_rule?: string,           // JSON Schema validation rule
  mg_encryption?: string,                // Field-level encryption settings

  // Cassandra specific (cs_*)
  cs_is_partition_key?: boolean,
  cs_is_clustering_key?: boolean,
  cs_is_static?: boolean,
  cs_is_frozen?: boolean,
  cs_clustering_order?: string,

  // Amazon Redshift specific (rs_*)
  rs_distkey?: boolean,
  rs_sortkey?: number,
  rs_encode?: string,
  rs_is_identity?: boolean,
  rs_compression?: string,

  // ClickHouse specific (ch_*)
  ch_is_in_partition_key?: boolean,
  ch_is_in_sorting_key?: boolean,
  ch_is_in_primary_key?: boolean,
  ch_defausq_kind?: string,
  ch_compression_codec?: string,

  // BigQuery specific (bq_*)
  bq_is_partitioning_column?: boolean,
  bq_is_clustering_column?: boolean,
  bq_policy_tags?: string[],
  bq_max_length?: number,
  bq_precision?: number,
  bq_scale?: number,

  // LibSQL specific (ls_*)
  ls_is_generated?: boolean,
  ls_generation_expression?: string,
  ls_is_virtual?: boolean,
  ls_collation?: string,

  // Cloudflare D1 specific (d1_*)
  d1_is_autoincrement?: boolean,
  d1_is_generated?: boolean,
  d1_generation_expression?: string,
  d1_collation?: string,

  // Snowflake specific (sf_*)
  sf_is_identity?: boolean,
  sf_identity_start?: number,
  sf_identity_increment?: number,
  sf_is_cluster_key?: boolean,
  sf_tag?: Record<string, string>,

  // DuckDB specific (dk_*)
  dk_is_generated?: boolean,
  dk_generation_expression?: string,
  dk_is_compressed?: boolean,
  dk_compression_type?: string,

  // CockroachDB specific (cr_*)
  cr_is_computed?: boolean,
  cr_computed_expression?: string,
  cr_is_hidden?: boolean,
  cr_is_inaccessible?: boolean,
  cr_is_inverted?: boolean,

  // Greenplum specific (gp_*)
  gp_is_distributed?: boolean,
  gp_distribution_key?: boolean,
  gp_storage_type?: string,
  gp_compression_type?: string,
  gp_compression_level?: number,

  // Vertica specific (ve_*)
  ve_is_segmented?: boolean,
  ve_segment_expression?: string,
  ve_encoding?: string,
  ve_access_rank?: number,
  ve_is_grouped?: boolean
}
```

#### `db_table_indexes`

Retrieves index information for a table (PostgreSQL only currently).

**Parameters:**

- `connection_id: string`
- `database: string`
- `schema: string`
- `table: string`

**Returns:** `TableIndex[]`

### Query Execution

#### `db_query_begin`

Initiates streaming query execution with cursor-based result fetching.

**Parameters:**

- `connection_id: string`
- `sql: string`
- `params?: Value[]` - Parameterized query values
- `opts?: QueryOptions` - Query configuration

**Returns:** `QueryBeginResponse`

```typescript
{
  cursor_id: string,
  columns: ColumnMeta[],
  rows: CellValue[][],            // First page of results using CellValue structure
  total_rows?: number,            // Total row count if available
  is_complete: boolean            // Whether this is the complete result set
}
```

**QueryOptions:**

```typescript
{
  page_size: number,      // Default: 100
  max_rows?: number,      // Default: unlimited
  timeout_ms?: number     // Default: 30000
}
```

#### `db_query_fetch`

Fetches a page of results from an active query cursor.

**Parameters:**

- `connection_id: string`
- `cursor_id: string`
- `page: number` - Zero-based page index
- `page_size: number`

**Returns:** `QueryFetchResponse`

```typescript
{
  rows: CellValue[][],            // Page of results using CellValue structure
  page: number,                   // Zero-based page number
  is_complete: boolean            // Whether this is the final page
}
```

#### `db_query_close`

Closes a query cursor and frees resources.

**Parameters:**

- `connection_id: string`
- `cursor_id: string`

**Returns:** `()`

#### `db_query_cancel`

Cancels an in-progress query operation.

**Parameters:**

- `connection_id: string`
- `query_id: string`

**Returns:** `()`

#### `db_execute`

Executes non-SELECT queries (INSERT, UPDATE, DELETE, DDL).

**Parameters:**

- `connection_id: string`
- `sql: string`
- `params?: Value[]`

**Returns:** `ExecuteResult`

```typescript
{
  rows_affected: number,
  last_insert_id?: string,
  execution_time_ms: number
}
```

### Table Data Operations

#### `db_table_data`

Streams table data with filtering, sorting, and pagination via Tauri events.

**Parameters:**

- `connection_id: string`
- `table: string`
- `schema?: string`
- `select?: string[]` - Column selection
- `sorts?: SortSpec[]` - Sorting criteria
- `filters?: FilterSpec[]` - Filtering conditions
- `search?: string` - Global search term
- `cursor?: string` - Cursor-based pagination
- `offset?: number` - Offset-based pagination
- `limit?: number` - Result limit (max 1000)

**Returns:** `string` (stream_id for event listening)

**Emitted Events:** `table-data-{stream_id}`

- `Meta` - Column metadata and pagination info
- `Rows` - Data rows using CellValue structure with next cursor
- `Done` - Stream completion
- `Error` - Error information

**Event Payloads:**

```typescript
// Meta event
{
  type: "meta",
  table: string,
  schema?: string,
  columns: ColumnMeta[],
  selected: string[],
  page_size: number,
  cursor_key_columns: string[]
}

// Rows event
{
  type: "rows",
  rows: Record<string, CellValue>[],    // Row data as column_name -> CellValue maps
  next_cursor?: string                  // Pagination cursor for next batch
}

// Done event
{
  type: "done"
}

// Error event
{
  type: "error",
  code: string,
  message: string
}
```

**SortSpec:**

```typescript
{
  column: string,
  direction: "asc" | "desc"
}
```

**FilterSpec:**

```typescript
{
  column: string,
  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE" | "IN" | "IS NULL" | "IS NOT NULL" | "BETWEEN",
  value: any
}
```

#### `db_update_cell`

Updates a single table cell using primary key identification.

**Parameters:**

- `connection_id: string`
- `update: CellUpdate`

**CellUpdate:**

```typescript
{
  schema: string,
  table: string,
  column: string,
  pk: Record<string, any>, // Primary key values
  new_value: any
}
```

**Returns:** `ExecuteResult`

#### `db_estimate_count`

Estimates or counts total rows in a table.

**Parameters:**

- `connection_id: string`
- `database: string`
- `schema: string`
- `table: string`

**Returns:** `number`

---

## Secure Storage Commands

All secure storage operations use encrypted storage with OS keychain integration.

### Connection Management

#### `store_connection`

Stores database connection credentials securely.

**Parameters:**

- `connection: ConnectionConfig`

**Returns:** `string` (connection_id)

#### `get_connection`

Retrieves stored connection configuration.

**Parameters:**

- `connection_id: string`

**Returns:** `ConnectionConfig`

#### `list_connections`

Lists all stored connections.

**Returns:** `ConnectionConfig[]`

#### `update_connection`

Updates stored connection configuration.

**Parameters:**

- `connection_id: string`
- `connection: ConnectionConfig`

**Returns:** `()`

#### `delete_connection`

Removes stored connection.

**Parameters:**

- `connection_id: string`

**Returns:** `()`

#### `delete_all_connections`

Removes all stored connections.

**Returns:** `number` (deleted_count)

#### `cleanup_test_connections`

Removes connections with "TEST\_" name prefix.

**Returns:** `number` (cleaned_count)

### Generic Secure Storage

#### `secure_set`

Stores arbitrary secure data.

**Parameters:**

- `key: string`
- `value: string`

**Returns:** `()`

#### `secure_get`

Retrieves secure data.

**Parameters:**

- `key: string`

**Returns:** `string | null`

#### `secure_delete`

Deletes secure data entry.

**Parameters:**

- `key: string`

**Returns:** `()`

#### `secure_list_keys`

Lists available secure storage keys.

**Parameters:**

- `prefix?: string` - Key prefix filter

**Returns:** `string[]`

### Security Operations

#### `rotate_keys`

Rotates encryption keys and re-encrypts all data.

**Returns:** `()`

#### `get_audit_log`

Retrieves security audit log entries.

**Parameters:**

- `limit?: number`

**Returns:** `Value[]` (Currently returns empty array)

#### `clear_all_storage`

Emergency reset of all secure storage (requires confirmation).

**Parameters:**

- `confirmation: string` - Must be "CONFIRM_DELETE_ALL"

**Returns:** `()` (Currently not implemented)

---

## Health Monitoring Commands

### Connection Health

#### `test_connection`

Tests if a registered connection is healthy.

**Parameters:**

- `connection_id: string`

**Returns:** `boolean`

#### `get_connection_health`

Retrieves detailed connection health metrics.

**Parameters:**

- `connection_id: string`

**Returns:** `Value`

```typescript
{
  connectionId: string,
  status: "ready" | "degraded" | "error",
  healthy: boolean,
  rttMs?: number,
  error?: string
}
```

**Status Thresholds:**

- `ready`: RTT ≤ 150ms
- `degraded`: RTT > 150ms
- `error`: Connection failed

---

## Database Support Matrix

| Database              | Prefix | Connection | Queries | Streaming | Metadata | Table Data |
| --------------------- | ------ | ---------- | ------- | --------- | -------- | ---------- |
| PostgreSQL            | `pg_`  | ✅         | ✅      | ✅        | ✅       | ✅         |
| MySQL                 | `my_`  | ✅         | ✅      | ✅        | ✅       | ✅         |
| MariaDB               | `ma_`  | ✅         | ✅      | ✅        | ✅       | ✅         |
| SQLite                | `sq_`  | ✅         | ✅      | ✅        | ✅       | ✅         |
| Microsoft SQL Server  | `ms_`  | ✅         | ✅      | ✅        | ✅       | ✅         |
| Oracle                | `or_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Redis                 | `rd_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| MongoDB               | `mg_`  | 📋         | 📋      | 📋        | 📋       | 📋         |
| Cassandra             | `cs_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Amazon Redshift       | `rs_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| ClickHouse            | `ch_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| BigQuery              | `bq_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| LibSQL                | `ls_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Cloudflare D1         | `d1_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Snowflake             | `sf_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| DuckDB                | `dk_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| CockroachDB           | `cr_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Greenplum             | `gp_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |
| Vertica               | `ve_`  | 🚧         | 🚧      | 🚧        | 🚧       | 🚧         |

**Legend:**

- ✅ Currently supported
- 📋 Actively planned (specification complete)
- ⚠️ Temporarily disabled
- 🚧 Planned/future support
- Database-specific fields in `ColumnMeta` use the prefix shown above

### PostgreSQL Type Support

The PostgreSQL adapter provides support for most native PostgreSQL data types:

#### Currently Implemented Types

**Numeric Types:**

- `INT2/SMALLINT`, `INT4/INT/INTEGER`, `INT8/BIGINT` → CellValueType::Integer
- `REAL/FLOAT4`, `DOUBLE PRECISION/FLOAT8` → CellValueType::Decimal
- `NUMERIC/DECIMAL` → CellValueType::Decimal (with precision/scale metadata)
- `MONEY` → CellValueType::Decimal

**Text Types:**

- `VARCHAR/CHARACTER VARYING`, `CHAR/CHARACTER`, `TEXT` → CellValueType::Text
- `NAME`, `BPCHAR` → CellValueType::Text

**Boolean:**

- `BOOL/BOOLEAN` → CellValueType::Boolean

**Date/Time Types:**

- `DATE` → CellValueType::Date
- `TIME`, `TIMETZ` → CellValueType::Time
- `TIMESTAMP`, `TIMESTAMPTZ` → CellValueType::DateTime (with timezone metadata)
- `INTERVAL` → CellValueType::Text

**Binary:**

- `BYTEA` → CellValueType::Binary (hex representation)

**UUID:**

- `UUID` → CellValueType::Uuid

**JSON:**

- `JSON`, `JSONB` → CellValueType::Json

**Network Types:**

- `INET`, `CIDR`, `MACADDR`, `MACADDR8` → CellValueType::Text

**Geometric Types:**

- `POINT`, `LINE`, `LSEG`, `BOX`, `PATH`, `POLYGON`, `CIRCLE` → CellValueType::Geometry

**XML:**

- `XML` → CellValueType::Xml

**Arrays:**

- PostgreSQL arrays (type names starting with `_`) → CellValueType::Array (with element_type metadata)

**Bit Types:**

- `BIT`, `VARBIT` → CellValueType::Text

**Custom/Enum Types:**

- User-defined types and enums → CellValueType::Enum or CellValueType::Unknown

#### Not Yet Supported (Planned)

**Full-Text Search Types:**
- `TSVECTOR` → Will map to CellValueType::TsVector (currently falls back to Text)
- `TSQUERY` → Will map to CellValueType::TsQuery (currently falls back to Text)

**Key-Value Store:**
- `HSTORE` → Will map to CellValueType::Json or specialized HStore type

**Range Types:**
- `INT4RANGE`, `INT8RANGE`, `NUMRANGE` → Partial support, needs improvement
- `TSRANGE`, `TSTZRANGE`, `DATERANGE` → Partial support, needs improvement

**Composite Types:**
- User-defined composite types → Currently fallback to Text/Unknown
- Row types → Need specialized handling

**Advanced Extensions:**
- PostGIS advanced spatial types (beyond basic geometry)
- `LTREE` - Hierarchical tree-like data
- `CUBE` - Multi-dimensional cubes
- `CITEXT` - Case-insensitive text
- `PG_LSN` - Log Sequence Number
- Custom domain types with constraints

All implemented types include proper null handling, precision/scale metadata for numeric types, and byte size tracking for large values.

### SQLite Type Support (Implemented)

The SQLite adapter provides comprehensive support for SQLite's dynamic type system:

**Numeric Types:**
- `INTEGER`, `INT`, `TINYINT`, `SMALLINT`, `MEDIUMINT`, `BIGINT` → CellValueType::Integer
- `REAL`, `DOUBLE`, `FLOAT`, `NUMERIC`, `DECIMAL` → CellValueType::Decimal

**Text Types:**
- `TEXT`, `VARCHAR`, `CHAR`, `NVARCHAR`, `NCHAR` → CellValueType::Text
- String values matching UUID pattern → CellValueType::Uuid

**Boolean:**
- `BOOLEAN`, `BOOL` → CellValueType::Boolean (stored as INTEGER 0/1)

**Date/Time Types:**
- `DATE` → CellValueType::Date
- `DATETIME`, `TIMESTAMP` → CellValueType::DateTime
- `TIME` → CellValueType::Time

**Binary:**
- `BLOB` → CellValueType::Binary (hex representation)

**JSON:**
- `JSON` → CellValueType::Json (stored as TEXT, parsed on retrieval)

**Special Features:**
- SQLite's dynamic typing system properly handled
- PRAGMA statements used for metadata introspection
- Foreign key relationships detected via PRAGMA foreign_key_list
- Autoincrement columns properly identified
- Generated columns and virtual tables supported
- Full-text search (FTS) tables filtered from standard table listings
- Transaction support with proper isolation

All types include proper null handling and automatic type affinity resolution according to SQLite's type system rules.

### MySQL/MariaDB Type Support (Implemented)

The MySQL adapter provides comprehensive support for MySQL and MariaDB data types:

**Numeric Types:**
- `TINYINT`, `SMALLINT`, `MEDIUMINT`, `INT`, `BIGINT` → CellValueType::Integer
- `FLOAT`, `DOUBLE` → CellValueType::Decimal
- `DECIMAL`, `NUMERIC` → CellValueType::Decimal (with precision/scale metadata)
- `BIT` → CellValueType::Integer

**Text Types:**
- `CHAR`, `VARCHAR` → CellValueType::Text
- `TINYTEXT`, `TEXT`, `MEDIUMTEXT`, `LONGTEXT` → CellValueType::Text
- `ENUM`, `SET` → CellValueType::Enum (with enum_values metadata)

**Date/Time Types:**
- `DATE` → CellValueType::Date
- `TIME` → CellValueType::Time
- `DATETIME`, `TIMESTAMP` → CellValueType::DateTime
- `YEAR` → CellValueType::Integer

**Binary Types:**
- `BINARY`, `VARBINARY` → CellValueType::Binary
- `TINYBLOB`, `BLOB`, `MEDIUMBLOB`, `LONGBLOB` → CellValueType::Binary

**JSON:**
- `JSON` → CellValueType::Json (MySQL 5.7+ and MariaDB 10.2+)

**Special Features:**
- Auto-detection of MariaDB vs MySQL for compatibility
- Support for generated/virtual columns
- Character set and collation metadata
- Foreign key relationship detection
- Index information including unique and fulltext indexes
- Proper handling of MySQL's strict mode and SQL modes

All types include proper null handling, charset/collation metadata, and automatic conversion to CellValue format.

### Microsoft SQL Server Type Support (Implemented)

The MSSQL adapter provides comprehensive support for SQL Server data types:

**Numeric Types:**
- `TINYINT`, `SMALLINT`, `INT`, `BIGINT` → CellValueType::Integer
- `REAL`, `FLOAT` → CellValueType::Decimal
- `DECIMAL`, `NUMERIC`, `MONEY`, `SMALLMONEY` → CellValueType::Decimal (with precision/scale)

**Text Types:**
- `CHAR`, `VARCHAR`, `NCHAR`, `NVARCHAR` → CellValueType::Text
- `TEXT`, `NTEXT` → CellValueType::Text (deprecated but supported)

**Date/Time Types:**
- `DATE` → CellValueType::Date
- `TIME` → CellValueType::Time
- `DATETIME`, `DATETIME2`, `SMALLDATETIME` → CellValueType::DateTime
- `DATETIMEOFFSET` → CellValueType::DateTime (with timezone metadata)

**Binary Types:**
- `BINARY`, `VARBINARY` → CellValueType::Binary
- `IMAGE` → CellValueType::Binary (deprecated but supported)

**Special Types:**
- `UNIQUEIDENTIFIER` → CellValueType::Uuid
- `XML` → CellValueType::Xml
- `HIERARCHYID` → CellValueType::Text
- `GEOGRAPHY`, `GEOMETRY` → CellValueType::Geometry

**SQL Server Features:**
- Identity columns with seed and increment metadata
- Computed columns with expressions
- Sparse columns support
- Temporal tables (system-versioned)
- Column encryption metadata
- Proper handling of schemas beyond 'dbo'

### MongoDB Type Support (Planned)

The MongoDB adapter will provide comprehensive support for BSON data types with document-oriented features:

**Core BSON Types:**
- `ObjectId` → CellValueType::Text (24-char hex string)
- `String` → CellValueType::Text
- `Int32`, `Int64` → CellValueType::Integer
- `Double` → CellValueType::Decimal
- `Decimal128` → CellValueType::Decimal (with precision: 34)
- `Boolean` → CellValueType::Boolean

**Date/Time Types:**
- `Date` (BSON DateTime) → CellValueType::DateTime (UTC timezone)
- `Timestamp` → CellValueType::DateTime (with metadata for increment)

**Complex Types:**
- `Document` (embedded) → CellValueType::Json
- `Array` → CellValueType::Array (with element_type metadata)
- `Binary` → CellValueType::Binary (with subtype metadata)

**Special Types:**
- `Null` → CellValueType::Null
- `Regex` → CellValueType::Text (pattern string)
- `JavaScript` → CellValueType::Text
- `Symbol` → CellValueType::Text
- `MinKey`, `MaxKey` → CellValueType::Text (special values)

**MongoDB-Specific Features:**
- **Schema Inference**: Dynamic schema discovery through document sampling
- **Query Support**: Both SQL translation and native MQL/aggregation pipelines
- **Nested Fields**: Dot notation support for nested document access
- **Collection Metadata**: Document count, index information, validation rules
- **GridFS Support**: Large binary object storage (future)
- **Change Streams**: Real-time data monitoring (future)

**Query Translation Examples:**
```sql
-- SQL query
SELECT name, age FROM users WHERE age > 25 ORDER BY created_at DESC LIMIT 10

-- Translates to MongoDB
db.users.find(
  { age: { $gt: 25 } },
  { projection: { name: 1, age: 1 } }
).sort({ created_at: -1 }).limit(10)
```

**Connection Configuration:**
- Connection string format: `mongodb://[username:password@]host[:port][/database][?options]`
- Support for replica sets and sharded clusters
- TLS/SSL configuration
- Various authentication mechanisms (SCRAM, X.509, etc.)

## Currently Unsupported Database Types

The following databases are planned for future support but not yet implemented:

### Oracle Database
- **Prefix**: `or_`
- **Challenges**: Oracle-specific SQL extensions (PL/SQL), proprietary data types, licensing
- **Planned Features**: Support for schemas, packages, stored procedures, Oracle-specific types

### Redis
- **Prefix**: `rd_`
- **Challenges**: Key-value paradigm vs tabular display, command syntax differences
- **Planned Features**: RedisJSON, RedisGraph, RedisSearch module support

### Apache Cassandra
- **Prefix**: `cs_`
- **Challenges**: CQL vs SQL, eventual consistency model, partition keys
- **Planned Features**: Keyspace management, CQL support, partition key handling

### Amazon Redshift
- **Prefix**: `rs_`
- **Challenges**: Cloud-specific authentication, distribution keys, sort keys
- **Planned Features**: Spectrum external tables, distribution strategies

### ClickHouse
- **Prefix**: `ch_`
- **Challenges**: Column-oriented storage, specialized SQL dialect
- **Planned Features**: Materialized views, distributed tables, sampling

### Google BigQuery
- **Prefix**: `bq_`
- **Challenges**: Cloud authentication, nested/repeated fields, partitioning
- **Planned Features**: Standard SQL support, dataset management, partition handling

### LibSQL (Turso)
- **Prefix**: `ls_`
- **Challenges**: Edge database features, embedded replicas
- **Planned Features**: Local-first development, sync capabilities

### Cloudflare D1
- **Prefix**: `d1_`
- **Challenges**: Cloudflare API integration, Workers platform specifics
- **Planned Features**: REST API integration, Workers KV support

### Snowflake
- **Prefix**: `sf_`
- **Challenges**: Cloud warehousing concepts, virtual warehouses, stages
- **Planned Features**: Warehouse management, staged file support, time travel

### DuckDB
- **Prefix**: `dk_`
- **Challenges**: In-process analytical database, Parquet file support
- **Planned Features**: File-based operations, analytical functions, extensions

### CockroachDB
- **Prefix**: `cr_`
- **Challenges**: Distributed SQL, multi-region support
- **Planned Features**: Distributed transactions, region management

### Greenplum
- **Prefix**: `gp_`
- **Challenges**: MPP architecture, segment management
- **Planned Features**: Parallel query execution, distribution policies

### Vertica
- **Prefix**: `ve_`
- **Challenges**: Columnar storage, projections instead of indexes
- **Planned Features**: Projection management, flex tables support

### Additional Databases Under Consideration

**Graph Databases:**
- Neo4j - Property graph model
- ArangoDB - Multi-model (document, graph, key-value)
- Amazon Neptune - Managed graph database

**Time-Series Databases:**
- InfluxDB - Time-series specific optimizations
- TimescaleDB - PostgreSQL extension for time-series
- QuestDB - High-performance time-series

**Search Engines:**
- Elasticsearch - Full-text search and analytics
- OpenSearch - Open-source Elasticsearch fork
- Solr - Enterprise search platform

**Vector Databases:**
- Pinecone - Vector similarity search
- Weaviate - Vector search with ML models
- Qdrant - Vector similarity engine

**Other Databases:**
- CouchDB - Document database with sync
- RethinkDB - Real-time push architecture
- ScyllaDB - C++ Cassandra-compatible database
- YugabyteDB - Distributed PostgreSQL-compatible
- PlanetScale - Serverless MySQL-compatible
- Neon - Serverless PostgreSQL-compatible
- Supabase - PostgreSQL with real-time features
- Firebase Realtime/Firestore - Google's NoSQL offerings

## Performance Considerations

- **Connection Pooling**: Each connection uses configurable connection pools (default: 1-5 connections)
- **Query Streaming**: Large result sets are streamed via cursors to manage memory
- **Page Limits**: Table data operations are limited to 1000 rows per request
- **Timeouts**: Default query timeout is 30 seconds, configurable per query
- **Resource Cleanup**: Always call `db_query_close` to free cursor resources

## Security Features

- **Encrypted Storage**: All credentials encrypted with AES-GCM/ChaCha20-Poly1305
- **OS Keychain**: Master keys stored in OS-native secure storage
- **Key Rotation**: Supports encryption key rotation with data re-encryption
- **Workspace Isolation**: Connections can be isolated per workspace
- **Audit Logging**: Security operations are logged (implementation pending)

## Usage Patterns

### Basic Query Execution

```typescript
// 1. Connect
const conn = await invoke("db_connect", { config });

// 2. Begin query - returns first page automatically
const query = await invoke("db_query_begin", {
  connection_id: conn.connection_id,
  sql: "SELECT id, name, email, created_at FROM users",
  opts: { page_size: 50 },
});

// Access first page data with rich type information
query.rows.forEach((row) => {
  const id = row[0]; // CellValue with value_type: "Integer"
  const name = row[1]; // CellValue with value_type: "Text"
  const email = row[2]; // CellValue with value_type: "Text"
  const created = row[3]; // CellValue with value_type: "DateTime"

  console.log(`User ${name.value}: ${email.value} (${created.value})`);

  // Check if value is null
  if (email.is_null()) {
    console.log("Email is NULL");
  }

  // Access type information for rendering
  console.log(`Email type: ${email.value_type} (${email.db_type})`);
});

// 3. Fetch additional pages if needed
if (!query.is_complete) {
  const page = await invoke("db_query_fetch", {
    connection_id: conn.connection_id,
    cursor_id: query.cursor_id,
    page: 1,
    page_size: 50,
  });

  // Process page.rows (CellValue[][])
}

// 4. Close cursor
await invoke("db_query_close", {
  connection_id: conn.connection_id,
  cursor_id: query.cursor_id,
});
```

### Streaming Table Data

```typescript
// Start streaming
const streamId = await invoke("db_table_data", {
  connection_id: "conn-123",
  table: "users",
  schema: "public",
  sorts: [{ column: "created_at", direction: "desc" }],
  filters: [{ column: "status", operator: "=", value: "active" }],
  limit: 100,
});

// Listen for events
await listen(`table-data-${streamId}`, (event) => {
  switch (event.payload.type) {
    case "meta":
      // Column metadata for table setup
      const { columns, selected, table, schema } = event.payload;
      console.log(`Streaming ${table}.${selected.join(", ")}`);

      // Use column metadata to configure UI
      columns.forEach((col) => {
        console.log(
          `Column ${col.name}: ${col.db_type} (nullable: ${col.nullable})`,
        );
      });
      break;

    case "rows":
      // Process rows with CellValue structure
      const { rows, next_cursor } = event.payload;

      rows.forEach((row) => {
        // Each row is Record<string, CellValue>
        const id = row.id; // CellValue for id column
        const name = row.name; // CellValue for name column
        const email = row.email; // CellValue for email column
        const status = row.status; // CellValue for status column

        // Use CellValue methods for display
        console.log(`${id.display_string()}: ${name.display_string()}`);

        // Handle different value types appropriately
        if (email.value_type === "Text" && !email.is_null()) {
          console.log(`Email: ${email.value}`);
        }

        // Use metadata for precision formatting
        if (name.metadata?.max_length) {
          console.log(`Name max length: ${name.metadata.max_length}`);
        }

        // Check for truncated data
        if (email.is_truncated) {
          console.log("Email data was truncated - show 'view full' option");
        }
      });

      // Store cursor for pagination
      if (next_cursor) {
        console.log(`Next cursor: ${next_cursor}`);
      }
      break;

    case "done":
      console.log("Table data streaming completed");
      break;

    case "error":
      console.error("Streaming error:", event.payload.message);
      break;
  }
});
```
