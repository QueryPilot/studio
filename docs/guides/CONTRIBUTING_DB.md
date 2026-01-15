# Adding New Database Adapters

This guide outlines the process for adding support for a new database (e.g., Oracle, CouchDB, etcd) to Query Pilot.

Query Pilot uses a **Unified Adapter Architecture** with capability-based traits:

1. **Backend (`BaseCapability` + paradigm trait):** Handles connection lifecycle, execution, and streaming.
2. **Frontend (`BaseAdapter` + paradigm interface):** Handles SQL generation (for SQL DBs), introspection queries, and UI operations.

---

## Part 1: Backend Implementation (Rust)

**Location:** `src-tauri/src/adapters/<dbname>/`

### 1. Determine the Paradigm

Choose the appropriate paradigm trait based on your database type:

| Paradigm | Trait | Examples |
|----------|-------|----------|
| SQL | `SqlQueryable` | PostgreSQL, MySQL, SQLite, SQL Server |
| Document | `DocumentQueryable` | MongoDB, CouchDB, Firestore |
| Key-Value | `RichKeyValueOperable` or `KeyValueOperable` | Redis, etcd, Memcached |

### 2. Create Adapter Structure

```
src-tauri/src/adapters/<dbname>/
├── mod.rs              # Public exports
├── adapter.rs          # The adapter implementation
├── types.rs            # Type mapping (DB types -> CellValue)
└── direct_msgpack.rs   # Streaming encoder (optional)
```

### 3. Implement `BaseCapability` Trait

All adapters must implement `BaseCapability` from `src-tauri/src/core/capabilities.rs`:

```rust
use async_trait::async_trait;
use crate::core::capabilities::{BaseCapability, AdapterCapability, CapabilityTestResult};
use crate::error::AppError;
use crate::types::ConnectionProfile;

pub struct CouchDbAdapter {
    client: Arc<tokio::sync::RwLock<Option<CouchClient>>>,
}

#[async_trait]
impl BaseCapability for CouchDbAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        // Establish connection using interior mutability
        let client = /* create client from profile */;
        *self.client.write().await = Some(client);
        Ok(())
    }
    
    async fn disconnect(&self) -> Result<(), AppError> {
        if let Some(client) = self.client.write().await.take() {
            // cleanup
        }
        Ok(())
    }
    
    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        // Test and return latency
    }
    
    fn is_connected(&self) -> bool {
        // Check connection state synchronously
    }
    
    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![AdapterCapability::DocumentQueryable]
    }
}
```

### 4. Implement Paradigm-Specific Trait

```rust
#[async_trait]
impl DocumentQueryable for CouchDbAdapter {
    async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError> {
        // Implementation
    }
    
    // ... other DocumentQueryable methods
}
```

### 5. Add Constructor to `UnifiedAdapter`

**File:** `src-tauri/src/core/manager.rs`

```rust
impl UnifiedAdapter {
    pub fn couchdb(adapter: CouchDbAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const CouchDbAdapter;
        let doc_ptr: *const dyn DocumentQueryable = ptr;
        Self {
            inner: boxed,
            sql: None,
            document: Some(doc_ptr),
            keyvalue: None,
            // ... other fields
            db_type: DbType::CouchDB,
        }
    }
}
```

### 6. Register in Factory

**File:** `src-tauri/src/core/manager.rs`

```rust
fn create_adapter(profile: &ConnectionProfile) -> Result<UnifiedAdapter> {
    match profile.db_type {
        // ... existing adapters
        DbType::CouchDB => Ok(UnifiedAdapter::couchdb(CouchDbAdapter::new())),
    }
}
```

### 7. Add DbType Variant

**File:** `src-tauri/src/types.rs`

```rust
pub enum DbType {
    // ... existing
    CouchDB,
}
```

---

## Part 2: Frontend Implementation (TypeScript)

**Location:** `src/adapters/<dbname>/` or `src/adapters/dialects/<DbName>Adapter.ts`

### 1. For SQL Databases

Implement the `DatabaseAdapter` interface:

```typescript
import { DatabaseAdapter } from '../types';

export class OracleAdapter implements DatabaseAdapter {
  constructor(private connectionId: string) {}
  
  // Metadata queries
  getTablesQuery(schema?: string): string { ... }
  getColumnsQuery(schema: string, table: string): string { ... }
  
  // DML generation
  insert(target: TableRef, row: RowData): string { ... }
  update(target: TableRef, data: RowData, where: WhereClause): string { ... }
  
  // DDL generation
  addColumn(target: TableRef, payload: ColumnAddPayload): string { ... }
}
```

### 2. For Document/KeyValue Databases

Implement the `BaseAdapter` interface and paradigm-specific methods:

```typescript
import { BaseAdapter } from '../types';

export class CouchDBAdapter implements BaseAdapter {
  connectionId: string;
  dbType: DbType;
  paradigm: 'document' = 'document';
  
  // Document operations call Tauri commands
  async findDocuments(collection: string, filter: object): Promise<Document[]> {
    return invoke('document_execute', {
      connId: this.connectionId,
      op: { type: 'Find', collection, filter }
    });
  }
}
```

### 3. Register in Adapter Factory

**File:** `src/adapters/index.ts`

For SQL adapters, add to `sqlAdapterModules`:

```typescript
const sqlAdapterModules = {
  [DbType.Oracle]: () => import('./dialects/OracleAdapter').then(m => m.OracleAdapter),
};
```

For Document/KeyValue, the `getAdapter` function routes by paradigm automatically.

---

## Part 3: Add Tauri Commands (if needed)

**Location:** `src-tauri/src/commands/<paradigm>.rs`

For new paradigm-specific commands:

```rust
// commands/document.rs
#[tauri::command]
pub async fn couchdb_specific_operation(
    conn_id: String,
    // ... params
    state: State<'_, AppState>,
) -> Result<SomeResult, String> {
    // Implementation
}
```

Register in `src-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::document::couchdb_specific_operation,
])
```

---

## Checklist for Reviewers

### Backend
- [ ] `BaseCapability` implemented with `connect`/`disconnect` using interior mutability
- [ ] Paradigm trait implemented (`SqlQueryable`, `DocumentQueryable`, or `RichKeyValueOperable`)
- [ ] `UnifiedAdapter` constructor added
- [ ] Factory registration added
- [ ] `DbType` variant added
- [ ] SSL/TLS handling correct
- [ ] Connection pooling appropriate for the database
- [ ] Error handling uses `AppError`

### Frontend
- [ ] Adapter implements correct interface (`DatabaseAdapter` for SQL, `BaseAdapter` for others)
- [ ] Type guards work (`isSqlAdapter`, `isDocumentAdapter`, `isKeyValueAdapter`)
- [ ] Registered in adapter factory

### Integration
- [ ] Can connect/disconnect in UI
- [ ] Can browse data (tables/collections/keys)
- [ ] Can execute queries/operations
- [ ] SSH tunneling works (if applicable)

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UnifiedAdapter                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ inner: Box<dyn BaseCapability>                                │   │
│  │ sql: Option<*const dyn SqlQueryable>                          │   │
│  │ document: Option<*const dyn DocumentQueryable>                │   │
│  │ keyvalue: Option<*const dyn RichKeyValueOperable>             │   │
│  │ db_type: DbType                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Methods:                                                            │
│  - connect(), disconnect(), test_connection(), is_connected()        │
│  - as_sql() -> Option<&dyn SqlQueryable>                             │
│  - as_document() -> Option<&dyn DocumentQueryable>                   │
│  - as_keyvalue() -> Option<&dyn RichKeyValueOperable>                │
└─────────────────────────────────────────────────────────────────────┘
```

No changes needed to `UnifiedAdapter` methods, `commands/` routing, or frontend `getAdapter()` when adding new databases of an existing paradigm.
