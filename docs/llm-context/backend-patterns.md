# Backend Patterns

## Tech Stack

- Rust + Tauri 2
- tokio (async runtime)
- DashMap (concurrent connection pool)
- rmp-serde (MessagePack serialization)

## Directory Structure

```
src-tauri/src/
├── commands/           # Tauri IPC commands
│   ├── connection.rs   # Connect/disconnect/test (all DBs)
│   ├── sql.rs          # SQL query execution
│   ├── document.rs     # MongoDB operations
│   └── keyvalue.rs     # Redis operations
├── core/
│   ├── manager.rs      # ConnectionManager + UnifiedAdapter
│   └── capabilities.rs # Capability traits
├── adapters/           # Database implementations
│   ├── postgres/
│   ├── mysql/
│   ├── sqlite/
│   ├── mssql/
│   ├── mongodb/
│   └── redis/
├── ssh/                # SSH tunnel management
├── aws/                # AWS Session Manager
├── crud/               # CRUD transaction handling
├── vault.rs            # Encrypted storage
└── keychain.rs         # OS keychain integration
```

## Command Organization

Commands are organized by paradigm:

| File | Paradigm | Operations |
|------|----------|------------|
| `connection.rs` | All | connect, disconnect, test_connection |
| `sql.rs` | SQL | query, execute_query, switch_database |
| `document.rs` | Document | find, insert, update, delete, aggregate |
| `keyvalue.rs` | Key-Value | get, set, scan, delete, hash/list/set ops |

## Adding a Tauri Command

1. Define in `src-tauri/src/commands/<paradigm>.rs`:
```rust
#[tauri::command]
pub async fn my_command(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<MyResult, String> {
    let conn = manager.get_connection(&conn_id).await?;
    // ... implementation
    Ok(result)
}
```

2. Register in `src-tauri/src/lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    commands::sql::my_command,
    // ...
])
```

3. Call from frontend:
```typescript
const result = await invoke('my_command', { connId })
```

## Capability-Based Adapters

All adapters implement `BaseCapability`:
```rust
pub trait BaseCapability: Send + Sync {
    async fn connect(&mut self) -> Result<()>;
    async fn disconnect(&mut self) -> Result<()>;
    async fn test_connection(&self) -> Result<()>;
    fn is_connected(&self) -> bool;
}
```

Paradigm-specific traits add operations:
- `SqlQueryable` - execute_query, execute_statement
- `DocumentQueryable` - find_documents, insert_document, aggregate
- `RichKeyValueOperable` - Hash, List, Set, ZSet, Stream operations

## UnifiedAdapter Pattern

Runtime capability checking:
```rust
let unified = manager.get_connection(&conn_id).await?;

// Check and use SQL capability
if let Some(sql) = unified.as_sql() {
    sql.execute_query(&query).await?;
}

// Check and use document capability
if let Some(doc) = unified.as_document() {
    doc.find_documents(&collection, filter).await?;
}
```

## ConnectionManager

- DashMap-based concurrent pool
- 30-minute idle timeout with reaper
- Dual-layer tunnel support (SSH or AWS SSM)
- Deduplicates concurrent connection attempts

## Error Handling

Use `Result<T, E>` with the `?` operator. Avoid `unwrap()` except in tests.

```rust
pub async fn query(...) -> Result<QueryResult, String> {
    let conn = manager.get_connection(&conn_id)
        .await
        .map_err(|e| e.to_string())?;
    // ...
}
```

## Adding a Database Adapter

See [CONTRIBUTING_DB.md](../guides/CONTRIBUTING_DB.md) for the complete guide.

Summary:
1. Determine paradigm (SQL, Document, Key-Value)
2. Create adapter in `src-tauri/src/adapters/<dbname>/`
3. Implement `BaseCapability` + paradigm-specific trait
4. Add `UnifiedAdapter` constructor in `manager.rs`
5. Register `DbType` variant
6. Create frontend adapter in `src/adapters/`
