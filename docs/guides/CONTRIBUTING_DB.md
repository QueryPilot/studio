# Adding New Database Adapters

This guide outlines the "Gold Standard" process for adding support for a new database (e.g., Oracle, Snowflake, Redis) to Query Pilot.

Query Pilot uses a **Split-Brain Adapter Pattern**:
1.  **Frontend (`SqlAdapter`):** The "Brain". Handles SQL generation, introspection queries, and DDL.
2.  **Backend (`DbAdapter`):** The "Muscle". Handles connection lifecycle, execution, and high-performance streaming.

---

## Part 1: Frontend Implementation (The Brain)

**Location:** `src/adapters/dialects/<DbName>Adapter.ts`

The Frontend adapter is the Source of Truth for "how to talk to the database".

### 1. Create the Adapter Class
Implement the `SqlAdapter` interface (from `src/adapters/base/SqlAdapter.ts`).

```typescript
import { SqlAdapter } from '../base/SqlAdapter';

export class OracleAdapter implements SqlAdapter {
  // ... implementation
}
```

### 2. Implement Core Methods

#### Metadata Queries (Introspection)
You must implement queries that return standard system catalog info:
*   `getTablesQuery(schema)`: Returns `table_name`, `table_schema`, `table_type`.
*   `getColumnsQuery(schema, table)`: Returns `column_name`, `data_type`, `is_nullable`.
*   `getIndexesQuery(...)`: Returns index definitions.

#### Data Manipulation (DML)
*   `buildSelect(...)`: Generate SELECT statements with LIMIT/OFFSET.
*   `buildInsert(...)`: Generate INSERT with `RETURNING` support if available.

#### Data Definition (DDL)
*   `addColumn(...)`: `ALTER TABLE ... ADD COLUMN ...`
*   `createTable(...)`: `CREATE TABLE ...`

### 3. Register the Adapter
Add your adapter to the registry in `src/adapters/index.ts` (or `adapterRegistry.ts`).

```typescript
export const getAdapter = (dbType: DbType): SqlAdapter => {
  switch (dbType) {
    case 'oracle': return new OracleAdapter();
    // ...
  }
};
```

---

## Part 2: Backend Implementation (The Muscle)

**Location:** `src-tauri/src/adapters/<dbname>/`

The Backend adapter handles the raw TCP connection and binary data transfer.

### 1. Structure
Create a new module directory:
```
src-tauri/src/adapters/oracle/
├── mod.rs              # Public exports
├── adapter.rs          # The DbAdapter implementation
├── types.rs            # Type mapping (Oracle -> CellValue)
└── direct_msgpack.rs   # Streaming encoder
```

### 2. Implement `DbAdapter` Trait
Implement `src-tauri/src/adapters/mod.rs::DbAdapter`.

```rust
#[async_trait]
impl DbAdapter for OracleAdapter {
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Establish connection
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        // Run simple query
    }
    
    // ...
}
```

### 3. Type Mapping (`types.rs`)
Map database-specific types to Query Pilot's `CellValueType`.

```rust
pub fn map_type(oracle_type: &OracleType) -> CellValueType {
    match oracle_type {
        OracleType::Varchar2 => CellValueType::Text,
        OracleType::Number => CellValueType::Decimal,
        // ...
    }
}
```

### 4. High-Performance Streaming (`direct_msgpack.rs`)
Implement the `DirectMsgPackEncoder` for your database. This is critical for DataGrid performance.
*   It must take a raw row from the driver.
*   It must serialize it directly to MessagePack bytes **without** intermediate allocations.

### 5. Register in Factory
Update `src-tauri/src/connection_manager.rs` to initialize your adapter.

---

## Checklist for Reviewers

- [ ] **Frontend:** `getTablesQuery` returns correct columns?
- [ ] **Frontend:** DDL generation matches database syntax?
- [ ] **Backend:** `connect` handles SSL/TLS correctly?
- [ ] **Backend:** `DirectMsgPackEncoder` implemented for fast streaming?
- [ ] **Integration:** Can we browse tables in the UI?
- [ ] **Integration:** Can we run a `SELECT *` query?
