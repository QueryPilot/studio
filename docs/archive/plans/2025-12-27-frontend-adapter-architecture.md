# Frontend Database Adapter Architecture

## Date: 2025-12-27

## Overview

Refactor the application to move SQL generation from Rust backend to Frontend, using a multi-paradigm adapter pattern. This simplifies the backend to a single `execute_query` command while enabling support for SQL, NoSQL, and Graph databases through frontend adapters.

## Goals

1. **Single backend command** - `execute_query` handles all database operations
2. **Frontend-driven SQL generation** - Adapters generate dialect-specific queries
3. **Multi-paradigm support** - SQL, Document (MongoDB), Graph (Neo4j) databases
4. **Massive simplification** - Delete ~1700 lines of Rust CRUD code

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Query Panel          Data Grid (CRUD)         Introspection    │
│       │                     │                       │           │
│       ▼                     ▼                       ▼           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Database Adapter (per dialect)              │   │
│  │  • PostgreSQLAdapter  • MySQLAdapter  • SQLiteAdapter   │   │
│  │  • MSSQLAdapter       • MongoDBAdapter (future)         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│                   execute_query(sql)                            │
│                            │                                    │
│                            ▼                                    │
│                   MessagePack Decoder                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼ IPC
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Rust) - Simplified                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   execute_query(sql: String)                                    │
│        │                                                        │
│        ▼                                                        │
│   DirectMsgPackEncoder → Binary MessagePack → IPC Channel       │
│                                                                  │
│   No CRUD logic. No type conversion. Just execute and stream.   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Adapter Design

### Directory Structure

```
src/adapters/
  ├── index.ts                    # Adapter factory + getAdapter()
  ├── types.ts                    # DatabaseAdapter interface
  │
  ├── base/
  │   ├── SqlAdapter.ts           # Shared SQL logic (quoting, transactions)
  │   ├── DocumentAdapter.ts      # Shared document DB logic (future)
  │   └── GraphAdapter.ts         # Shared graph DB logic (future)
  │
  └── dialects/
      ├── PostgreSQLAdapter.ts    # PostgreSQL-specific SQL generation
      ├── MySQLAdapter.ts         # MySQL-specific (backticks, LIMIT syntax)
      ├── SQLiteAdapter.ts        # SQLite-specific
      ├── MSSQLAdapter.ts         # SQL Server (TOP, square brackets)
      ├── MongoDBAdapter.ts       # MongoDB query documents (future)
      └── Neo4jAdapter.ts         # Cypher queries (future)
```

### Core Interface

```typescript
type QueryPayload = string | object;  // SQL string or document/graph query

interface DatabaseAdapter {
  readonly dbType: DbType;
  readonly paradigm: 'sql' | 'document' | 'graph' | 'keyvalue';

  // Execute query via appropriate backend command
  execute(query: QueryPayload): Promise<QueryResult>;

  // CRUD generation - returns appropriate query for this database
  insert(target: TableRef, data: RowData, options?: { returning?: boolean }): QueryPayload;
  update(target: TableRef, data: RowData, where: WhereClause): QueryPayload;
  delete(target: TableRef, where: WhereClause): QueryPayload;
  select(target: TableRef, options?: SelectOptions): QueryPayload;

  // Batch operations
  transaction(operations: QueryPayload[]): QueryPayload;

  // Value & identifier formatting (dialect-specific)
  formatValue(value: unknown, columnMeta: ColumnMeta): string;
  quoteIdentifier(name: string): string;
  quoteString(value: string): string;
}

interface TableRef {
  schema?: string;
  table: string;
}

interface WhereClause {
  [column: string]: unknown;  // Simple equality for now
}

type RowData = Record<string, unknown>;
```

### SQL Adapter Base Class

```typescript
abstract class SqlAdapter implements DatabaseAdapter {
  readonly paradigm = 'sql' as const;
  protected connectionId: string;

  constructor(connection: ConnectionProfile) {
    this.connectionId = connection.id;
  }

  // Shared transaction wrapping
  transaction(statements: QueryPayload[]): string {
    const stmts = statements.filter(s => typeof s === 'string') as string[];
    return `BEGIN;\n${stmts.join(';\n')};\nCOMMIT;`;
  }

  // Execute via execute_query (renamed from stream_query)
  async execute(sql: string): Promise<QueryResult> {
    return invoke('execute_query', {
      connId: this.connectionId,
      sql
    });
  }

  // Generate INSERT
  insert(target: TableRef, data: RowData, options?: { returning?: boolean }): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data).map(c => this.quoteIdentifier(c)).join(', ');
    const values = Object.entries(data)
      .map(([col, val]) => this.formatValue(val, { name: col }))
      .join(', ');

    let sql = `INSERT INTO ${table} (${columns}) VALUES (${values})`;
    if (options?.returning) {
      sql += ' RETURNING *';
    }
    return sql;
  }

  // Generate UPDATE
  update(target: TableRef, data: RowData, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const setClause = Object.entries(data)
      .map(([col, val]) => `${this.quoteIdentifier(col)} = ${this.formatValue(val, { name: col })}`)
      .join(', ');
    const whereClause = this.buildWhereClause(where);

    return `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`;
  }

  // Generate DELETE
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    return `DELETE FROM ${table} WHERE ${whereClause}`;
  }

  // Generate SELECT
  select(target: TableRef, options?: SelectOptions): string {
    const table = this.formatTableRef(target);
    const columns = options?.columns?.map(c => this.quoteIdentifier(c)).join(', ') || '*';

    let sql = `SELECT ${columns} FROM ${table}`;
    if (options?.where) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    return sql;
  }

  protected formatTableRef(target: TableRef): string {
    if (target.schema) {
      return `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(target.table)}`;
    }
    return this.quoteIdentifier(target.table);
  }

  protected buildWhereClause(where: WhereClause): string {
    return Object.entries(where)
      .map(([col, val]) => `${this.quoteIdentifier(col)} = ${this.formatValue(val, { name: col })}`)
      .join(' AND ');
  }

  // Abstract - each dialect implements
  abstract quoteIdentifier(name: string): string;
  abstract quoteString(value: string): string;
  abstract formatValue(value: unknown, meta: { name: string }): string;
}
```

### PostgreSQL Adapter

```typescript
class PostgreSQLAdapter extends SqlAdapter {
  readonly dbType = DbType.PostgreSQL;

  quoteIdentifier(name: string): string {
    // Escape any double quotes in the identifier
    return `"${name.replace(/"/g, '""')}"`;
  }

  quoteString(value: string): string {
    // PostgreSQL escape syntax
    return `'${value.replace(/'/g, "''")}'`;
  }

  formatValue(value: unknown, meta: { name: string; db_type?: string }): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'::timestamptz`;
    }

    if (Array.isArray(value)) {
      const elements = value.map(v => this.formatValue(v, meta)).join(', ');
      return `ARRAY[${elements}]`;
    }

    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    }

    // String value
    return this.quoteString(String(value));
  }
}
```

### MySQL Adapter

```typescript
class MySQLAdapter extends SqlAdapter {
  readonly dbType = DbType.MySQL;

  quoteIdentifier(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
  }

  quoteString(value: string): string {
    return `'${value.replace(/'/g, "\\'")}'`;
  }

  formatValue(value: unknown, meta: { name: string }): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';  // MySQL uses 1/0 for booleans
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value instanceof Date) {
      return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    }

    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
    }

    return this.quoteString(String(value));
  }

  // MySQL doesn't support RETURNING, override update/insert
  insert(target: TableRef, data: RowData, options?: { returning?: boolean }): string {
    const base = super.insert(target, data, { returning: false });
    // For MySQL, we'd need to use LAST_INSERT_ID() separately
    return base;
  }
}
```

### Adapter Factory

```typescript
import { PostgreSQLAdapter } from './dialects/PostgreSQLAdapter';
import { MySQLAdapter } from './dialects/MySQLAdapter';
import { SQLiteAdapter } from './dialects/SQLiteAdapter';
import { MSSQLAdapter } from './dialects/MSSQLAdapter';

const adapterCache = new Map<string, DatabaseAdapter>();

export function getAdapter(connection: ConnectionProfile): DatabaseAdapter {
  // Return cached adapter if exists
  if (adapterCache.has(connection.id)) {
    return adapterCache.get(connection.id)!;
  }

  let adapter: DatabaseAdapter;

  switch (connection.db_type) {
    case DbType.PostgreSQL:
      adapter = new PostgreSQLAdapter(connection);
      break;
    case DbType.MySQL:
      adapter = new MySQLAdapter(connection);
      break;
    case DbType.SQLite:
      adapter = new SQLiteAdapter(connection);
      break;
    case DbType.MSSQL:
      adapter = new MSSQLAdapter(connection);
      break;
    default:
      throw new Error(`Unsupported database type: ${connection.db_type}`);
  }

  adapterCache.set(connection.id, adapter);
  return adapter;
}

export function clearAdapter(connectionId: string): void {
  adapterCache.delete(connectionId);
}
```

## CRUD Flow

### Cell Edit to Database

```
User edits cell in DataGrid
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  crudStore.stageEdit(tableKey, {                                │
│    type: 'update',                                              │
│    column: 'name',                                              │
│    rowId: { id: 123 },  // Primary key(s)                       │
│    oldValue: 'John',                                            │
│    newValue: 'Jane'                                             │
│  })                                                             │
└─────────────────────────────────────────────────────────────────┘
         │
         │  User clicks "Save" / Cmd+S
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  crudStore.commitChanges()                                      │
│                                                                 │
│  1. Get adapter for connection                                  │
│     const adapter = getAdapter(connection);                     │
│                                                                 │
│  2. Generate SQL for each staged edit                           │
│     const statements = stagedEdits.map(edit => {                │
│       if (edit.type === 'update')                               │
│         return adapter.update(table, values, where);            │
│       if (edit.type === 'insert')                               │
│         return adapter.insert(table, values, {returning: true});│
│       if (edit.type === 'delete')                               │
│         return adapter.delete(table, where);                    │
│     });                                                         │
│                                                                 │
│  3. Wrap in transaction                                         │
│     const sql = adapter.transaction(statements);                │
│                                                                 │
│  4. Execute                                                     │
│     const result = await adapter.execute(sql);                  │
│                                                                 │
│  5. Process RETURNING rows (extract new IDs, etc.)              │
│                                                                 │
│  6. Clear staged edits                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Generated SQL Example

```sql
-- Frontend generates this complete SQL string:
BEGIN;
UPDATE "public"."users" SET "name" = 'Jane' WHERE "id" = 123 RETURNING *;
UPDATE "public"."users" SET "email" = 'new@example.com' WHERE "id" = 456 RETURNING *;
INSERT INTO "public"."users" ("name", "email") VALUES ('Bob', 'bob@example.com') RETURNING *;
COMMIT;
```

## Rust Backend Simplification

### Files to Delete (~1700 lines)

```
src-tauri/src/
├── crud/                          # DELETE ENTIRE DIRECTORY
│   ├── mod.rs
│   ├── executor.rs
│   └── validator.rs
│
├── adapters/postgres/
│   └── simple_converter.rs        # DELETE (created today, no longer needed)
```

### Files to Modify

**commands.rs:**
- Rename `stream_query` → `execute_query`
- Delete `query` command
- Delete `execute_crud_transaction` command

**lib.rs:**
- Update command registration
- Remove CRUD command imports

**types.rs:**
- Remove CRUD types (CrudTransaction, CrudCommand, etc.)

**adapters/postgres/adapter.rs:**
- Remove `query()` method
- Remove `SimpleConverter` usage
- Keep only: `connect()`, `disconnect()`, `test_connection()`, `is_connected()`, `get_pool()`

### Final Backend Structure

```
src-tauri/src/
├── commands.rs
│   └── execute_query              # THE ONLY query command
│
├── adapters/postgres/
│   ├── adapter.rs                 # Connection lifecycle only
│   ├── direct_msgpack.rs          # MessagePack encoder (unchanged)
│   ├── pool.rs                    # Connection pooling (unchanged)
│   └── types.rs                   # Type mapping (unchanged)
│
├── core/
│   └── manager.rs                 # Connection management (unchanged)
│
└── (ssh, vault, ai, etc.)         # Unchanged
```

## SQL Injection Prevention

Frontend adapters must prevent SQL injection:

### Identifier Quoting

```typescript
quoteIdentifier(name: string): string {
  // Reject dangerous characters
  if (/[\0\x08\x09\x1a\n\r"'\\%]/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  // Double any quotes and wrap
  return `"${name.replace(/"/g, '""')}"`;
}
```

### Value Formatting

```typescript
formatValue(value: unknown, meta: ColumnMeta): string {
  // NULL handling
  if (value === null || value === undefined) return 'NULL';

  // Type-specific formatting
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return String(value);
  }

  if (typeof value === 'string') {
    // Escape single quotes by doubling
    return `'${value.replace(/'/g, "''")}'`;
  }

  // ... other types
}
```

## Migration Path

### Phase 1: Create Frontend Adapters
1. Create `src/adapters/` directory structure
2. Implement `DatabaseAdapter` interface
3. Implement `SqlAdapter` base class
4. Implement `PostgreSQLAdapter`, `MySQLAdapter`, `SQLiteAdapter`, `MSSQLAdapter`

### Phase 2: Update Frontend
1. Update `crudStore.ts` to use adapters
2. Rename `stream_query` → `execute_query` in service calls
3. Update introspection to use adapters (optional, can keep existing)

### Phase 3: Simplify Backend
1. Rename `stream_query` → `execute_query` in Rust
2. Delete `src-tauri/src/crud/` directory
3. Delete `simple_converter.rs`
4. Remove `query()` method from adapter
5. Remove CRUD types from `types.rs`
6. Update command registrations

### Phase 4: Testing
1. Test all CRUD operations (insert, update, delete)
2. Test transactions (multi-statement)
3. Test each database dialect
4. Test edge cases (NULL, special characters, Unicode)

## Success Criteria

- [ ] All CRUD operations work via frontend adapters
- [ ] Transactions work (BEGIN/COMMIT/ROLLBACK)
- [ ] All 4 SQL dialects generate correct SQL
- [ ] SQL injection prevention verified
- [ ] ~1700 lines deleted from Rust backend
- [ ] Single `execute_query` command handles everything
- [ ] All existing tests pass
- [ ] No performance regression

## Future Extensions

1. **MongoDB Adapter** - Generate query documents instead of SQL
2. **Neo4j Adapter** - Generate Cypher queries
3. **Redis Adapter** - Generate Redis commands
4. **Query Builder UI** - Visual query builder using adapters
