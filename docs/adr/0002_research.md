# ADR-0002: TablePlus-Class Database Client Architecture Research

## 1) Executive Summary

### Current State Analysis
The DevDB Studio codebase has a solid foundation with:
- **Backend**: Tauri v2 with SQLx integration supporting PostgreSQL, MySQL, and SQLite
- **Frontend**: React 19 with TanStack suite, Monaco Editor, and shadcn/ui components
- **Security**: Encrypted credential storage using AES-GCM with PBKDF2 key derivation
- **State Management**: Zustand stores with persistence, workspace management started

### Key Gaps Identified
1. **Connection Health**: No real-time connection monitoring or auto-reconnect
2. **Query Execution**: Missing cancellation, cursor management, and paging
3. **Tab System**: Global tabs instead of workspace-scoped; no connection binding
4. **Caching**: No systematic cache layer for schema/data
5. **Data Editing**: No inline editing or optimistic updates implemented

### Biggest Risks
1. **Performance**: Large dataset handling without proper virtualization/paging
2. **Stability**: No connection resilience or health monitoring
3. **UX**: Tab/workspace state confusion, no proper persistence

### Shortest Path to v1.0
**Phase 1 (2 weeks)**: Fix workspace-scoped tabs, add connection health monitoring, implement paged query API
**Phase 2 (2 weeks)**: Add data grid with virtualization, query cancellation, basic caching
**Phase 3 (1 week)**: Polish UX, inline editing for PKs, export functionality

### Key Differentiators vs Competition
1. **Rust Performance**: Native performance with memory safety, unlike Electron-based competitors
2. **Workspace-First**: True multi-workspace support with isolated contexts (TablePlus lacks this)
3. **Security-First**: Encrypted storage with OS keychain integration by default

---

## 2) Architecture Map

### (A) Runtime Architecture

```
┌─────────────────────────── Frontend (WebView) ───────────────────────────┐
│  React Components                                                         │
│  ├─ WorkspaceManager ─────────┐                                         │
│  ├─ QueryEditor (Monaco)       ├──► Zustand Stores                      │
│  ├─ DataGrid (TanStack Table)  │    ├─ WorkspaceStore (tabs, conns)     │
│  └─ Sidebar/StatusBar          │    ├─ CacheStore (Dexie + LRU)         │
│                                └──► └─ QueryStore (cursors, results)     │
└───────────────────────────────────────────────────────────────────────────┘
                                    ▼ IPC Commands
┌─────────────────────────── Tauri Backend (Rust) ────────────────────────┐
│  Command Layer                                                           │
│  ├─ db_connect      ├─ db_query_begin    ├─ db_health_subscribe        │
│  ├─ db_execute      ├─ db_query_fetch    └─ db_export_csv              │
│  └─ db_update_cell  └─ db_query_cancel                                 │
│                              ▼                                          │
│  ConnectionRegistry (Arc<RwLock<HashMap<ConnId, ConnectionHandle>>>)    │
│  ├─ ConnectionHandle {                                                  │
│  │   pool: Arc<DatabasePool>,                                           │
│  │   health_task: JoinHandle,                                           │
│  │   cursors: HashMap<CursorId, QueryCursor>,                          │
│  │   abort_registry: HashMap<QueryId, AbortHandle>                     │
│  └─ }                                                                   │
│                              ▼                                          │
│  DbAdapter Trait                                                        │
│  ├─ PostgresAdapter ──► SQLx Pool<Postgres> ──► PostgreSQL             │
│  ├─ MySqlAdapter ────► SQLx Pool<MySql> ──────► MySQL/MariaDB          │
│  └─ SqliteAdapter ───► SQLx Pool<Sqlite> ─────► SQLite File/Memory     │
└──────────────────────────────────────────────────────────────────────────┘
                              ▲ Events (health, progress)
```

### (B) Frontend State Architecture

```
┌─────────────── WorkspaceStore (Zustand + Dexie Persistence) ────────────┐
│  workspace: {                                                            │
│    id: WorkspaceId,                                                      │
│    name: string,                                                         │
│    activeTabId: TabId,                                                   │
│    activeConnectionId: ConnectionId,  ← Synced with active tab          │
│    tabs: Map<TabId, TabState> {                                         │
│      id, type: 'table'|'query'|'result',                               │
│      connectionId: ConnectionId,  ← Each tab bound to connection        │
│      payload: { sql?, table?, filters?, sort? },                       │
│      ui: { scrollOffset, columnWidths, selection }                     │
│    },                                                                   │
│    connections: Map<ConnectionId, ConnectionState> {                    │
│      id, name, dbType, status: 'ready'|'degraded'|'error',            │
│      health: { rttMs, lastPing, missCount }                           │
│    }                                                                    │
│  }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────── CacheStore (LRU Memory + Dexie IndexedDB) ───────────────┐
│  schemaCache: Map<`schema:${connId}`, { tables, views, functions }>     │
│  tableCache: Map<`table:${key}:page:${n}`, { rows, columns }>          │
│  queryCache: Map<`query:${hash}:page:${n}`, { rows, cursor }>          │
│                                                                          │
│  TTLs: schema=10m, table=3m, query=1m                                   │
│  Invalidation: DML→table keys, DDL→schema+tables, close→all            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3) Rust Backend API — Spec & DTOs

### Core Types

```rust
// src-tauri/src/database/types.rs
use serde::{Serialize, Deserialize};
use sqlx::{Pool, Postgres, MySql, Sqlite};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DbType { 
    Postgres, 
    MySql, 
    Sqlite, 
    #[serde(skip)] MsSql,  // Future
    #[serde(skip)] Oracle   // Future
}

#[derive(Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    pub ssl: Option<SslMode>,
    pub ssh: Option<SshTunnelConfig>,
    pub pool_size: Option<u32>,  // Default: 10
}

#[derive(Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub db_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_pk: bool,
    pub is_fk: bool,
    pub fk_reference: Option<ForeignKeyRef>,  // Foreign key reference info
    pub check_constraint: Option<String>,      // CHECK constraint expression
    pub ordinal: i32,
    pub precision: Option<i32>,  // For numeric types
    pub scale: Option<i32>,      // For decimal types  
}

#[derive(Serialize, Deserialize)]
pub struct ForeignKeyRef {
    pub constraint_name: String,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,  // CASCADE, SET NULL, RESTRICT, etc.
    pub on_update: String,
}

#[derive(Serialize, Deserialize)]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    pub kind: DbObjectKind,
    pub row_estimate: Option<i64>,
    pub size_bytes: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DbObjectKind {
    Table,
    View,
    MaterializedView,
    Function,
    Procedure,
    Trigger,
    Sequence,
    Index,
}

#[derive(Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<String>,
    pub execution_time_ms: f64,
}

#[derive(Serialize, Deserialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "E_CONN")]
    Connection,
    #[serde(rename = "E_SQL")]
    SqlError,
    #[serde(rename = "E_TIMEOUT")]
    Timeout,
    #[serde(rename = "E_CANCELLED")]
    Cancelled,
    #[serde(rename = "E_UNSUPPORTED")]
    Unsupported,
    #[serde(rename = "E_IO")]
    IoError,
}

// Runtime types (not serialized)
pub enum DatabasePool {
    Postgres(Arc<Pool<Postgres>>),
    MySql(Arc<Pool<MySql>>),
    Sqlite(Arc<Pool<Sqlite>>),
}

pub struct ConnectionHandle {
    pub pool: Arc<DatabasePool>,
    pub health_task: JoinHandle<()>,
    pub cursors: Arc<RwLock<HashMap<String, QueryCursor>>>,
    pub abort_registry: Arc<RwLock<HashMap<String, CancellationToken>>>,
}

pub struct QueryCursor {
    pub id: String,
    pub sql: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<String>>,  // All values as strings to preserve precision
    pub page_size: usize,
    pub current_page: usize,
    pub total_rows: Option<usize>,
    pub is_complete: bool,
}
```

### DbAdapter Trait

```rust
// src-tauri/src/database/adapter.rs
#[async_trait]
pub trait DbAdapter: Send + Sync {
    async fn ping(&self) -> Result<Duration, AppError>;
    
    async fn list_databases(&self) -> Result<Vec<String>, AppError>;
    
    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError>;
    
    async fn list_tables(&self, database: &str, schema: &str) 
        -> Result<Vec<TableMeta>, AppError>;
    
    async fn table_columns(&self, database: &str, schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError>;
    
    async fn estimate_count(&self, database: &str, schema: &str, table: &str) 
        -> Result<i64, AppError>;
    
    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, 
                         opts: QueryOptions) -> Result<QueryCursor, AppError>;
    
    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, 
                        page_size: usize) -> Result<QueryPage, AppError>;
    
    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) 
        -> Result<ExecuteResult, AppError>;
}

// Implementations
pub struct PostgresAdapter {
    pool: Arc<Pool<Postgres>>,
}

impl PostgresAdapter {
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool: Arc::new(pool) }
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        sqlx::query("SELECT 1").fetch_one(&**self.pool).await
            .map_err(|e| AppError::from_sqlx(e))?;
        Ok(start.elapsed())
    }
    
    async fn list_tables(&self, database: &str, schema: &str) 
        -> Result<Vec<TableMeta>, AppError> {
        let sql = r#"
            SELECT 
                schemaname as schema,
                tablename as name,
                'table' as kind,
                n_live_tup as row_estimate,
                pg_relation_size(schemaname||'.'||tablename) as size_bytes
            FROM pg_stat_user_tables
            WHERE schemaname = $1
            UNION ALL
            SELECT 
                schemaname, viewname, 'view', NULL, 0
            FROM pg_views
            WHERE schemaname = $1
            ORDER BY kind, name
        "#;
        
        let rows = sqlx::query_as::<_, TableMeta>(sql)
            .bind(schema)
            .fetch_all(&**self.pool)
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(rows)
    }
    
    // ... other implementations
}
```

### Tauri Commands

```rust
// src-tauri/src/commands/database.rs
use tauri::State;

#[tauri::command]
pub async fn db_connect(
    config: ConnectionConfig,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ConnectResponse, AppError> {
    let conn_id = Uuid::new_v4().to_string();
    
    let pool = match config.db_type {
        DbType::Postgres => {
            let opts = PgPoolOptions::new()
                .max_connections(config.pool_size.unwrap_or(10))
                .connect_timeout(Duration::from_secs(10))
                .idle_timeout(Duration::from_secs(600))
                .acquire_timeout(Duration::from_secs(3));
            
            let pool = opts.connect(&build_conn_string(&config)).await?;
            DatabasePool::Postgres(Arc::new(pool))
        },
        DbType::MySql => { /* similar */ },
        DbType::Sqlite => { /* similar */ },
    };
    
    // Spawn health monitor
    let health_task = spawn_health_monitor(conn_id.clone(), pool.clone());
    
    let handle = ConnectionHandle {
        pool: Arc::new(pool),
        health_task,
        cursors: Arc::new(RwLock::new(HashMap::new())),
        abort_registry: Arc::new(RwLock::new(HashMap::new())),
    };
    
    registry.register(conn_id.clone(), handle).await;
    
    Ok(ConnectResponse { 
        connection_id: conn_id,
        server_version: get_version(&pool).await?,
    })
}

#[tauri::command]
pub async fn db_query_begin(
    connection_id: String,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    opts: Option<QueryOptions>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<QueryBeginResponse, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or(AppError::connection("Connection not found"))?;
    
    let cursor_id = Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    
    // Register cancellation token
    conn.abort_registry.write().await
        .insert(cursor_id.clone(), cancel_token.clone());
    
    // Start query with cancellation
    let adapter = create_adapter(&conn.pool);
    let cursor = tokio::select! {
        result = adapter.begin_query(&sql, params, opts.unwrap_or_default()) => {
            result?
        },
        _ = cancel_token.cancelled() => {
            return Err(AppError::cancelled("Query cancelled by user"));
        }
    };
    
    let columns = cursor.columns.clone();
    let total_approx = cursor.total_rows;
    
    // Store cursor
    conn.cursors.write().await.insert(cursor_id.clone(), cursor);
    
    Ok(QueryBeginResponse {
        cursor_id,
        columns,
        total_approx,
    })
}

#[tauri::command]
pub async fn db_query_fetch(
    cursor_id: String,
    page: usize,
    page_size: usize,
    registry: State<'_, ConnectionRegistry>,
) -> Result<QueryFetchResponse, AppError> {
    // Find cursor across all connections
    let (conn, mut cursor) = registry.find_cursor(&cursor_id).await
        .ok_or(AppError::not_found("Cursor not found"))?;
    
    let adapter = create_adapter(&conn.pool);
    let page_data = adapter.fetch_page(&mut cursor, page, page_size).await?;
    
    // Update cursor state
    cursor.current_page = page;
    conn.cursors.write().await.insert(cursor_id, cursor);
    
    Ok(QueryFetchResponse {
        rows: page_data.rows,
        page,
        done: page_data.is_last,
    })
}

#[tauri::command]
pub async fn db_query_cancel(
    cursor_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<CancelResponse, AppError> {
    let (conn, _) = registry.find_cursor(&cursor_id).await
        .ok_or(AppError::not_found("Cursor not found"))?;
    
    // Trigger cancellation
    if let Some(token) = conn.abort_registry.write().await.remove(&cursor_id) {
        token.cancel();
    }
    
    // Remove cursor
    conn.cursors.write().await.remove(&cursor_id);
    
    Ok(CancelResponse { cancelled: true })
}

#[tauri::command]
pub async fn db_update_cell(
    connection_id: String,
    update: CellUpdate,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ExecuteResult, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or(AppError::connection("Connection not found"))?;
    
    // Build UPDATE query with PK conditions
    let sql = build_update_sql(&update);
    let params = build_update_params(&update);
    
    let adapter = create_adapter(&conn.pool);
    adapter.execute(&sql, Some(params)).await
}

#[tauri::command]
pub async fn db_export_query_to_csv(
    connection_id: String,
    export: ExportRequest,
    registry: State<'_, ConnectionRegistry>,
    app: tauri::AppHandle,
) -> Result<ExportResponse, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or(AppError::connection("Connection not found"))?;
    
    // Stream query results to CSV file
    let adapter = create_adapter(&conn.pool);
    let cursor = adapter.begin_query(&export.sql, export.params, 
                                    QueryOptions::default()).await?;
    
    let file = File::create(&export.file_path).await?;
    let mut writer = csv_async::AsyncWriter::from_writer(file);
    
    // Write headers
    writer.write_record(cursor.columns.iter().map(|c| &c.name)).await?;
    
    let mut rows_written = 0;
    let mut page = 0;
    
    loop {
        let page_data = adapter.fetch_page(&mut cursor, page, 1000).await?;
        
        for row in page_data.rows {
            writer.write_record(row.iter().map(|v| v.to_string())).await?;
            rows_written += 1;
            
            // Emit progress event
            if rows_written % 1000 == 0 {
                app.emit_all("export:progress", ExportProgress {
                    file_path: export.file_path.clone(),
                    rows_written,
                }).ok();
            }
        }
        
        if page_data.is_last { break; }
        page += 1;
    }
    
    writer.flush().await?;
    
    Ok(ExportResponse {
        file_path: export.file_path,
        rows_written,
    })
}
```

### Error Mapping

| Driver Error | AppError Code | Description |
|-------------|---------------|-------------|
| `ConnectionRefused` | `E_CONN` | Database unreachable |
| `AuthenticationFailed` | `E_CONN` | Invalid credentials |
| `SyntaxError` | `E_SQL` | SQL syntax error |
| `ConstraintViolation` | `E_SQL` | FK/unique violation |
| `Timeout` | `E_TIMEOUT` | Query timeout |
| `Cancelled` | `E_CANCELLED` | User cancellation |
| `FeatureNotSupported` | `E_UNSUPPORTED` | Driver limitation |

### Paging Strategy Comparison

| Strategy | Consistency | Memory | Latency | Recommendation |
|----------|------------|--------|---------|----------------|
| **LIMIT/OFFSET** | ❌ Phantom reads | ✅ Low | ✅ Fast | Default for ad-hoc queries |
| **Keyset** | ✅ Stable | ✅ Low | ✅ Fast | Tables with PK |
| **Server Cursor** | ✅ Snapshot | ❌ Server memory | ❌ Hold connection | Large exports |

**Default**: LIMIT/OFFSET with client-side row deduplication for consistency checks.

---

## 4) Connection Health & Resilience

### Backend Health Monitor

```rust
// src-tauri/src/database/health.rs
pub fn spawn_health_monitor(
    conn_id: String,
    pool: Arc<DatabasePool>,
    app: AppHandle,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        let mut miss_count = 0;
        let mut last_status = ConnectionStatus::Ready;
        
        loop {
            interval.tick().await;
            
            // Add jitter (±10%)
            let jitter = Duration::from_millis(rand::random::<u64>() % 3000);
            tokio::time::sleep(jitter).await;
            
            let result = match &*pool {
                DatabasePool::Postgres(p) => {
                    sqlx::query("SELECT 1")
                        .fetch_one(&**p)
                        .timeout(Duration::from_secs(5))
                        .await
                },
                DatabasePool::MySql(p) => { /* similar */ },
                DatabasePool::Sqlite(p) => {
                    sqlx::query("PRAGMA user_version")
                        .fetch_one(&**p)
                        .timeout(Duration::from_millis(500))
                        .await
                },
            };
            
            let (status, rtt) = match result {
                Ok(_) => {
                    let rtt = start.elapsed().as_millis() as u32;
                    miss_count = 0;
                    
                    let status = if rtt < 150 {
                        ConnectionStatus::Ready
                    } else if rtt < 1000 {
                        ConnectionStatus::Degraded
                    } else {
                        ConnectionStatus::Degraded
                    };
                    
                    (status, Some(rtt))
                },
                Err(_) => {
                    miss_count += 1;
                    
                    let status = if miss_count == 1 {
                        ConnectionStatus::Degraded
                    } else if miss_count >= 2 {
                        // Start reconnection with exponential backoff
                        spawn_reconnect(conn_id.clone(), pool.clone(), app.clone());
                        ConnectionStatus::Reconnecting
                    } else {
                        ConnectionStatus::Error
                    };
                    
                    (status, None)
                }
            };
            
            // Only emit if status changed or RTT significantly different
            if status != last_status || rtt_changed(last_rtt, rtt) {
                app.emit_all("db:connection_status", ConnectionHealthEvent {
                    connection_id: conn_id.clone(),
                    status: status.clone(),
                    reason: get_reason(&status, miss_count),
                    rtt_ms: rtt,
                    at: SystemTime::now().timestamp_millis(),
                }).ok();
                
                last_status = status;
            }
        }
    })
}

async fn spawn_reconnect(
    conn_id: String, 
    pool: Arc<DatabasePool>,
    app: AppHandle,
) {
    tokio::spawn(async move {
        let backoff = [1, 2, 5, 10, 30]; // seconds
        
        for (attempt, delay) in backoff.iter().enumerate() {
            tokio::time::sleep(Duration::from_secs(*delay)).await;
            
            if let Ok(_) = ping_pool(&pool).await {
                app.emit_all("db:connection_recovered", RecoveredEvent {
                    connection_id: conn_id.clone(),
                    attempts: attempt + 1,
                }).ok();
                
                return; // Success, exit reconnect loop
            }
        }
        
        // Max attempts reached
        app.emit_all("db:connection_error", ConnectionErrorEvent {
            connection_id: conn_id,
            error: AppError::connection("Failed to reconnect after 5 attempts"),
        }).ok();
    });
}
```

### Frontend Health Handling

```typescript
// src/hooks/useConnectionHealth.ts
export function useConnectionHealth() {
  const updateHealth = useWorkspaceStore(s => s.updateConnectionHealth);
  
  useEffect(() => {
    const unlisten = Promise.all([
      listen<ConnectionHealthEvent>('db:connection_status', (event) => {
        updateHealth(event.payload.connection_id, {
          status: event.payload.status,
          rttMs: event.payload.rtt_ms,
          lastPing: event.payload.at,
          reason: event.payload.reason,
        });
        
        // Update UI based on status
        if (event.payload.status === 'error') {
          toast.error(`Connection lost: ${event.payload.reason}`, {
            action: {
              label: 'Retry',
              onClick: () => retryConnection(event.payload.connection_id),
            },
          });
        } else if (event.payload.status === 'degraded') {
          toast.warning(`Connection degraded: ${event.payload.rtt_ms}ms RTT`);
        }
      }),
      
      listen<RecoveredEvent>('db:connection_recovered', (event) => {
        toast.success(`Connection recovered after ${event.payload.attempts} attempts`);
      }),
    ]);
    
    return () => { unlisten.then(fns => fns.forEach(fn => fn())); };
  }, []);
  
  // Browser online/offline detection
  useEffect(() => {
    const handleOffline = () => {
      setBrowserOnline(false);
      toast.warning('You are offline. Some features may be limited.');
    };
    
    const handleOnline = () => {
      setBrowserOnline(true);
      toast.success('Connection restored');
      // Trigger health check for all connections
      checkAllConnections();
    };
    
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);
}

// src/components/StatusBar.tsx
export function StatusBar() {
  const health = useWorkspaceStore(s => 
    s.getConnectionHealth(s.activeConnectionId)
  );
  
  const statusColor = {
    ready: 'bg-green-500',
    degraded: 'bg-amber-500',
    reconnecting: 'bg-amber-500 animate-pulse',
    error: 'bg-red-500',
  }[health?.status || 'ready'];
  
  return (
    <div className="flex items-center gap-2">
      <div className={cn('w-2 h-2 rounded-full', statusColor)} />
      {health?.status === 'degraded' && (
        <span className="text-xs text-muted-foreground">
          {health.rttMs}ms
        </span>
      )}
      {health?.status === 'reconnecting' && (
        <span className="text-xs">Reconnecting...</span>
      )}
      {health?.status === 'error' && (
        <Button size="xs" onClick={retry}>Retry</Button>
      )}
    </div>
  );
}
```

### Guardrails

```typescript
// Disable write operations when unhealthy
const canExecute = health?.status === 'ready' || health?.status === 'degraded';
const canEdit = health?.status === 'ready';

<Button 
  disabled={!canExecute}
  onClick={executeQuery}
>
  Execute
</Button>

<DataGrid
  editable={canEdit}
  onEdit={handleEdit}
/>
```

---

## 5) Schema Metadata Cheat-Sheet

### PostgreSQL

```sql
-- Databases
SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname;

-- Schemas
SELECT schema_name FROM information_schema.schemata 
WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
ORDER BY schema_name;

-- Tables & Views
SELECT 
    schemaname AS schema,
    tablename AS name,
    'table' AS kind,
    n_live_tup AS row_estimate
FROM pg_stat_user_tables
WHERE schemaname = $1
UNION ALL
SELECT 
    schemaname, viewname, 'view', NULL
FROM pg_views
WHERE schemaname = $1
ORDER BY kind, name;

-- Columns with PKs
SELECT 
    c.column_name,
    c.data_type,
    c.is_nullable = 'YES' AS nullable,
    c.column_default AS default_value,
    EXISTS(
        SELECT 1 FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints tc 
        ON k.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
        AND k.table_schema = c.table_schema
        AND k.table_name = c.table_name
        AND k.column_name = c.column_name
    ) AS is_pk,
    c.ordinal_position
FROM information_schema.columns c
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position;

-- Row count estimate (fast)
SELECT reltuples::BIGINT AS estimate
FROM pg_class
WHERE oid = ($1||'.'||$2)::regclass;
```

### MySQL/MariaDB

```sql
-- Databases
SHOW DATABASES;

-- Tables
SELECT 
    TABLE_NAME AS name,
    TABLE_TYPE AS kind,
    TABLE_ROWS AS row_estimate,
    DATA_LENGTH + INDEX_LENGTH AS size_bytes
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_TYPE, TABLE_NAME;

-- Columns
SELECT 
    COLUMN_NAME AS name,
    DATA_TYPE AS db_type,
    IS_NULLABLE = 'YES' AS nullable,
    COLUMN_DEFAULT AS default_value,
    COLUMN_KEY = 'PRI' AS is_pk,
    ORDINAL_POSITION AS ordinal
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION;

-- Fast count
SELECT COUNT(*) AS estimate FROM `table` LIMIT 1;
```

### SQLite

```sql
-- Tables
SELECT name, type FROM sqlite_master 
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;

-- Columns (via PRAGMA)
PRAGMA table_info('table_name');

-- Row estimate
SELECT COUNT(*) FROM table_name LIMIT 1;
```

**References**:
- [PostgreSQL Information Schema](https://www.postgresql.org/docs/current/information-schema.html)
- [MySQL Information Schema](https://dev.mysql.com/doc/refman/8.0/en/information-schema.html)
- [SQLite PRAGMA](https://www.sqlite.org/pragma.html)

---

## 6) Frontend "Reactor" Plan — State, Tabs, Persistence

### Workspace-Scoped State Model

```typescript
// src/stores/workspaceStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Dexie from 'dexie';

type WorkspaceId = string;
type ConnectionId = string;
type TabId = string;

interface TabState {
  id: TabId;
  type: 'table' | 'view' | 'query' | 'schema' | 'function' | 'result';
  title: string;
  connectionId: ConnectionId;
  payload?: {
    schema?: string;
    table?: string;
    initialSQL?: string;
    parentTabId?: TabId; // For result tabs
    sort?: Array<{col: string; dir: 'asc' | 'desc'}>;
    filters?: Array<{col: string; op: string; val: any}>;
  };
  ui?: {
    scrollOffset?: number;
    columnOrder?: string[];
    columnWidths?: Record<string, number>;
    selection?: {rows: string[]; cols: string[]};
  };
}

interface ConnectionState {
  id: ConnectionId;
  name: string;
  dbType: 'postgres' | 'mysql' | 'sqlite';
  database?: string;
  status: 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'error' | 'closed';
  lastError?: string;
  health?: {
    rttMs?: number;
    lastPing?: number;
    missCount?: number;
  };
}

interface WorkspaceState {
  id: WorkspaceId;
  name: string;
  activeTabId?: TabId;
  activeConnectionId?: ConnectionId; // Always synced with active tab
  tabs: Map<TabId, TabState>;
  connections: Map<ConnectionId, ConnectionState>;
  tabOrder: TabId[]; // For tab bar rendering
}

interface WorkspaceStore {
  workspaces: Map<WorkspaceId, WorkspaceState>;
  activeWorkspaceId?: WorkspaceId;
  
  // Workspace operations
  createWorkspace: (name: string) => WorkspaceId;
  switchWorkspace: (id: WorkspaceId) => Promise<void>;
  deleteWorkspace: (id: WorkspaceId) => void;
  
  // Tab operations (workspace-scoped)
  addTab: (tab: Omit<TabState, 'id'>) => TabId;
  closeTab: (tabId: TabId) => void;
  switchTab: (tabId: TabId) => void;
  updateTab: (tabId: TabId, updates: Partial<TabState>) => void;
  
  // Connection operations
  addConnection: (conn: ConnectionConfig) => Promise<ConnectionId>;
  removeConnection: (connId: ConnectionId) => void;
  updateConnectionHealth: (connId: ConnectionId, health: Partial<ConnectionState>) => void;
  
  // Persistence
  saveWorkspace: () => Promise<void>;
  loadWorkspace: (id: WorkspaceId) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: undefined,
      
      addTab: (tab) => {
        const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const workspaceId = get().activeWorkspaceId;
        if (!workspaceId) return '';
        
        set(state => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return state;
          
          const newTab: TabState = { ...tab, id: tabId };
          workspace.tabs.set(tabId, newTab);
          workspace.tabOrder.push(tabId);
          workspace.activeTabId = tabId;
          workspace.activeConnectionId = tab.connectionId; // Sync connection
          
          return { workspaces: new Map(state.workspaces) };
        });
        
        return tabId;
      },
      
      switchTab: (tabId) => {
        set(state => {
          const workspace = state.workspaces.get(state.activeWorkspaceId!);
          if (!workspace) return state;
          
          const tab = workspace.tabs.get(tabId);
          if (!tab) return state;
          
          workspace.activeTabId = tabId;
          workspace.activeConnectionId = tab.connectionId; // Sync connection
          
          return { workspaces: new Map(state.workspaces) };
        });
      },
      
      saveWorkspace: async () => {
        const state = get();
        const workspace = state.workspaces.get(state.activeWorkspaceId!);
        if (!workspace) return;
        
        await db.workspaces.put({
          id: workspace.id,
          data: serializeWorkspace(workspace),
          updatedAt: Date.now(),
        });
      },
      
      loadWorkspace: async (id) => {
        const stored = await db.workspaces.get(id);
        if (!stored) return;
        
        const workspace = deserializeWorkspace(stored.data);
        
        set(state => ({
          workspaces: new Map(state.workspaces).set(id, workspace),
          activeWorkspaceId: id,
        }));
        
        // Reconnect to databases
        for (const conn of workspace.connections.values()) {
          if (conn.status !== 'closed') {
            await reconnectDatabase(conn.id);
          }
        }
      },
    }),
    {
      name: 'workspace-store',
      storage: createDexieStorage(), // Custom Dexie adapter
    }
  )
);

// Dexie persistence layer
class WorkspaceDB extends Dexie {
  workspaces!: Table<{id: string; data: any; updatedAt: number}>;
  history!: Table<{id: string; sql: string; connectionId: string; timestamp: number}>;
  favorites!: Table<{id: string; name: string; sql: string; connectionId: string}>;
  
  constructor() {
    super('DevDBStudio');
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      history: '++id, connectionId, timestamp',
      favorites: '++id, connectionId, name',
    });
  }
}

const db = new WorkspaceDB();
```

### Rules Implementation

```typescript
// Rule: Focusing a tab sets activeConnectionId
function TabBar() {
  const { tabs, activeTabId, switchTab } = useWorkspaceStore();
  
  return (
    <div className="flex">
      {tabs.map(tab => (
        <Tab
          key={tab.id}
          active={tab.id === activeTabId}
          onClick={() => switchTab(tab.id)} // This syncs connection
        >
          <ConnectionBadge connectionId={tab.connectionId} />
          {tab.title}
        </Tab>
      ))}
    </div>
  );
}

// Rule: Sidebar follows activeConnectionId
function DatabaseSidebar() {
  const { activeConnectionId, connections } = useWorkspaceStore();
  
  return (
    <div>
      {Array.from(connections.values()).map(conn => (
        <ConnectionPanel
          key={conn.id}
          connection={conn}
          expanded={conn.id === activeConnectionId}
          onExpand={() => setExpandedConnection(conn.id)}
        />
      ))}
    </div>
  );
}
```

### Migration from Global Stores

```typescript
// src/migration/migrateLegacyStores.ts
export async function migrateLegacyStores() {
  // Check for old tab store
  const oldTabs = localStorage.getItem('tabs-storage');
  if (oldTabs) {
    const { tabs } = JSON.parse(oldTabs);
    
    // Create default workspace
    const workspaceId = useWorkspaceStore.getState().createWorkspace('Migrated');
    
    // Migrate tabs
    for (const oldTab of tabs) {
      useWorkspaceStore.getState().addTab({
        type: oldTab.type,
        title: oldTab.name,
        connectionId: oldTab.connectionId || 'default',
        payload: { initialSQL: oldTab.content },
      });
    }
    
    // Clean up
    localStorage.removeItem('tabs-storage');
  }
}
```

---

## 7) Data Grid — Virtualization & Inline Editors

### Implementation with TanStack Table + Virtual

```typescript
// src/components/DataGrid/DataGrid.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  useReactTable, 
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table';

interface DataGridProps {
  connectionId: string;
  table?: string;
  sql?: string;
  editable?: boolean;
}

const FETCH_SIZE = 500;  // Rows per page
const WINDOW_SIZE = 1500; // Max rows in memory

export function DataGrid({ connectionId, table, sql, editable }: DataGridProps) {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursorId, setCursorId] = useState<string>();
  const [hasMore, setHasMore] = useState(true);
  const [editingCell, setEditingCell] = useState<{row: number; col: string} | null>();
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Fetch data with paging
  const fetchPage = useCallback(async (page: number) => {
    if (!cursorId) {
      // Begin query
      const response = await invoke<QueryBeginResponse>('db_query_begin', {
        connectionId,
        sql: sql || `SELECT * FROM ${table}`,
        opts: { maxRows: WINDOW_SIZE },
      });
      
      setCursorId(response.cursor_id);
      setColumns(response.columns);
    }
    
    // Fetch page
    const pageData = await invoke<QueryFetchResponse>('db_query_fetch', {
      cursorId,
      page,
      pageSize: FETCH_SIZE,
    });
    
    setData(prev => {
      const newData = [...prev, ...pageData.rows];
      // Window management - keep only last WINDOW_SIZE rows
      if (newData.length > WINDOW_SIZE) {
        return newData.slice(-WINDOW_SIZE);
      }
      return newData;
    });
    
    setHasMore(!pageData.done);
  }, [connectionId, cursorId, sql, table]);
  
  // Column factory with type-specific renderers and editors
  const tableColumns = useMemo(() => {
    return columns.map(col => ({
      id: col.name,
      header: col.name,
      accessorFn: (row: any) => row[col.name],
      cell: ({ row, column }) => {
        const value = row.original[column.id];
        const isEditing = editingCell?.row === row.index && 
                         editingCell?.col === column.id;
        
        if (isEditing && editable) {
          return (
            <CellEditor
              value={value}
              type={col.db_type}
              onSave={(newValue) => handleCellSave(row, column, newValue)}
              onCancel={() => setEditingCell(null)}
            />
          );
        }
        
        return <CellRenderer value={value} type={col.db_type} />;
      },
    }));
  }, [columns, editingCell, editable]);
  
  // Table instance
  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  
  // Virtual scrolling
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 35, // Row height
    overscan: 10,
  });
  
  // Handle cell edit
  const handleCellSave = async (row: any, column: any, newValue: any) => {
    const primaryKeys = columns.filter(c => c.is_pk);
    if (primaryKeys.length === 0) {
      toast.error('Cannot edit: table has no primary key');
      return;
    }
    
    // Optimistic update
    const rowIndex = row.index;
    setData(prev => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [column.id]: newValue };
      return updated;
    });
    
    try {
      await invoke('db_update_cell', {
        connectionId,
        update: {
          schema: 'public', // TODO: from context
          table,
          pk: primaryKeys.reduce((acc, pk) => ({
            ...acc,
            [pk.name]: row.original[pk.name],
          }), {}),
          column: column.id,
          newValue,
        },
      });
      
      toast.success('Cell updated');
    } catch (error) {
      // Revert on failure
      setData(prev => {
        const reverted = [...prev];
        reverted[rowIndex] = row.original;
        return reverted;
      });
      
      toast.error(`Update failed: ${error.message}`);
    }
    
    setEditingCell(null);
  };
  
  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current || loading || !hasMore) return;
      
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      if (scrollHeight - scrollTop - clientHeight < 500) {
        setLoading(true);
        const nextPage = Math.floor(data.length / FETCH_SIZE);
        fetchPage(nextPage).finally(() => setLoading(false));
      }
    };
    
    containerRef.current?.addEventListener('scroll', handleScroll);
    return () => containerRef.current?.removeEventListener('scroll', handleScroll);
  }, [data.length, loading, hasMore]);
  
  return (
    <div ref={containerRef} className="relative h-full overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th 
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className="border-b px-2 py-1"
                >
                  {header.column.columnDef.header}
                  <ColumnResizer header={header} />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const row = table.getRowModel().rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="absolute w-full"
              >
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    className="border-b px-2 py-1"
                    onDoubleClick={() => {
                      if (editable) {
                        setEditingCell({ 
                          row: virtualRow.index, 
                          col: cell.column.id 
                        });
                      }
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
          {loading && (
            <tr className="absolute" style={{ transform: `translateY(${virtualizer.getTotalSize()}px)` }}>
              <td colSpan={columns.length} className="text-center py-4">
                <Spinner /> Loading more rows...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

### Cell Editor Components

```typescript
// src/components/DataGrid/CellEditor.tsx
interface CellEditorProps {
  value: any;
  type: string;
  onSave: (value: any) => void;
  onCancel: () => void;
}

export function CellEditor({ value, type, onSave, onCancel }: CellEditorProps) {
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave(editValue);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };
  
  // Type-specific editors
  if (type.includes('bool')) {
    return (
      <Checkbox
        checked={editValue}
        onCheckedChange={checked => {
          setEditValue(checked);
          onSave(checked);
        }}
      />
    );
  }
  
  // Numeric types - handle as strings to preserve precision
  if (type.includes('int') || type.includes('float') || type.includes('decimal') || 
      type.includes('numeric') || type.includes('bigint')) {
    return (
      <NumericInput
        ref={inputRef}
        value={editValue}
        onChange={setEditValue}
        onKeyDown={handleKeyDown}
        type={type}
        precision={col.precision}
        scale={col.scale}
        className="h-6 px-1 font-mono"
      />
    );
  }
  
  if (type.includes('date')) {
    return (
      <DatePicker
        value={editValue}
        onChange={date => {
          setEditValue(date);
          onSave(date);
        }}
      />
    );
  }
  
  if (type.includes('json')) {
    return (
      <JsonEditor
        value={editValue}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }
  
  // Default text editor
  if (value && value.length > 100) {
    return (
      <Textarea
        ref={inputRef}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-[100px]"
      />
    );
  }
  
  return (
    <Input
      ref={inputRef}
      type="text"
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className="h-6 px-1"
    />
  );
}
```

---

## 8) Query Editor — Monaco + Autocomplete

### Monaco Integration

```typescript
// src/components/QueryEditor/QueryEditor.tsx
import Editor, { Monaco } from '@monaco-editor/react';
import { useTheme } from 'next-themes';

interface QueryEditorProps {
  connectionId: string;
  initialSql?: string;
  onExecute: (sql: string, selection?: string) => void;
}

export function QueryEditor({ connectionId, initialSql, onExecute }: QueryEditorProps) {
  const { theme } = useTheme();
  const [sql, setSql] = useState(initialSql || '');
  const [executing, setExecuting] = useState(false);
  const [cursorId, setCursorId] = useState<string>();
  const editorRef = useRef<any>();
  const monacoRef = useRef<Monaco>();
  
  // Schema cache for autocomplete
  const schemaCache = useCacheStore(s => s.getSchema(connectionId));
  
  // Configure Monaco
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Register SQL completion provider
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: createCompletionProvider(schemaCache),
    });
    
    // Add keyboard shortcuts
    editor.addAction({
      id: 'execute-query',
      label: 'Execute Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => executeQuery(),
    });
    
    editor.addAction({
      id: 'execute-selection',
      label: 'Execute Selection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => executeSelection(),
    });
  };
  
  // Execute query with progress
  const executeQuery = async () => {
    if (executing) return;
    
    setExecuting(true);
    const startTime = Date.now();
    
    try {
      // Begin query
      const response = await invoke<QueryBeginResponse>('db_query_begin', {
        connectionId,
        sql,
        opts: { readOnly: false },
      });
      
      setCursorId(response.cursor_id);
      
      // Open result tab
      const tabId = useWorkspaceStore.getState().addTab({
        type: 'result',
        title: `Result ${new Date().toLocaleTimeString()}`,
        connectionId,
        payload: {
          parentTabId: getCurrentTabId(),
          initialSQL: sql,
        },
      });
      
      // Emit result to tab
      emitToTab(tabId, 'query:result', {
        cursorId: response.cursor_id,
        columns: response.columns,
        executionTime: Date.now() - startTime,
      });
      
    } catch (error) {
      toast.error(`Query failed: ${error.message}`);
    } finally {
      setExecuting(false);
    }
  };
  
  // Execute selected text
  const executeSelection = () => {
    const selection = editorRef.current?.getSelection();
    const selectedText = editorRef.current?.getModel()
      ?.getValueInRange(selection);
    
    if (selectedText) {
      executeQuery(selectedText);
    } else {
      // Execute statement at cursor
      const position = editorRef.current?.getPosition();
      const statement = getStatementAtPosition(sql, position);
      if (statement) {
        executeQuery(statement);
      }
    }
  };
  
  // Cancel query
  const cancelQuery = async () => {
    if (!cursorId) return;
    
    try {
      await invoke('db_query_cancel', { cursorId });
      toast.info('Query cancelled');
    } catch (error) {
      toast.error(`Failed to cancel: ${error.message}`);
    }
    
    setCursorId(undefined);
    setExecuting(false);
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 border-b">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={executeQuery}
            disabled={executing || !sql.trim()}
          >
            {executing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Execute (⌘↵)
              </>
            )}
          </Button>
          
          {executing && (
            <Button
              size="sm"
              variant="outline"
              onClick={cancelQuery}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={formatSql}>
            Format
          </Button>
          <Button size="sm" variant="ghost" onClick={showHistory}>
            History
          </Button>
        </div>
      </div>
      
      <Editor
        height="100%"
        language="sql"
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        value={sql}
        onChange={value => setSql(value || '')}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          wordWrap: 'on',
        }}
      />
    </div>
  );
}
```

### Autocomplete Provider

```typescript
// src/components/QueryEditor/completionProvider.ts
export function createCompletionProvider(schema: SchemaCache) {
  return {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      
      const suggestions = [];
      
      // Add tables
      for (const table of schema.tables) {
        suggestions.push({
          label: table.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: `${table.kind} (${table.row_estimate} rows)`,
          insertText: table.name,
          range,
        });
      }
      
      // Add columns if table is referenced
      const lineContent = model.getLineContent(position.lineNumber);
      const tableMatch = /FROM\s+(\w+)/i.exec(lineContent);
      
      if (tableMatch) {
        const tableName = tableMatch[1];
        const columns = schema.getColumns(tableName);
        
        for (const col of columns) {
          suggestions.push({
            label: col.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `${col.db_type}${col.nullable ? '' : ' NOT NULL'}`,
            insertText: col.name,
            range,
          });
        }
      }
      
      // Add SQL keywords
      const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP BY', 
                       'ORDER BY', 'LIMIT', 'OFFSET', 'UNION'];
      
      for (const keyword of keywords) {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range,
        });
      }
      
      // Add functions
      const functions = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'NOW', 
                        'COALESCE', 'CAST'];
      
      for (const func of functions) {
        suggestions.push({
          label: func,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${func}()`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
      }
      
      return { suggestions };
    },
  };
}
```

---

## 9) Caching & Invalidation Plan

### Cache Implementation

```typescript
// src/services/cacheService.ts
import { LRUCache } from 'lru-cache';
import Dexie from 'dexie';

interface CacheEntry<T> {
  key: string;
  data: T;
  ttl: number;
  timestamp: number;
}

class CacheService {
  private memoryCache: LRUCache<string, any>;
  private db: CacheDB;
  
  constructor() {
    // In-memory LRU cache
    this.memoryCache = new LRUCache({
      max: 100, // Max entries
      maxSize: 50 * 1024 * 1024, // 50MB
      sizeCalculation: (value) => JSON.stringify(value).length,
      ttl: 1000 * 60, // 1 minute default
      updateAgeOnGet: true,
    });
    
    // IndexedDB for persistence
    this.db = new CacheDB();
  }
  
  // Schema caching (5-10 min TTL)
  async getSchema(connectionId: string): Promise<Schema | null> {
    const key = `schema:${connectionId}`;
    
    // Check memory
    let cached = this.memoryCache.get(key);
    if (cached) return cached;
    
    // Check IndexedDB
    cached = await this.db.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      this.memoryCache.set(key, cached.data, { ttl: cached.ttl });
      return cached.data;
    }
    
    return null;
  }
  
  async setSchema(connectionId: string, schema: Schema) {
    const key = `schema:${connectionId}`;
    const ttl = 1000 * 60 * 10; // 10 minutes
    
    this.memoryCache.set(key, schema, { ttl });
    
    await this.db.cache.put({
      key,
      data: schema,
      ttl,
      timestamp: Date.now(),
    });
  }
  
  // Table data caching (1-3 min TTL)
  async getTablePage(
    connectionId: string,
    table: string,
    sort: string,
    filter: string,
    page: number
  ): Promise<TablePage | null> {
    const key = `table:${connectionId}:${table}:${sort}:${filter}:page:${page}`;
    
    const cached = this.memoryCache.get(key);
    if (cached) return cached;
    
    const stored = await this.db.cache.get(key);
    if (stored && Date.now() - stored.timestamp < stored.ttl) {
      this.memoryCache.set(key, stored.data, { ttl: stored.ttl });
      return stored.data;
    }
    
    return null;
  }
  
  async setTablePage(
    connectionId: string,
    table: string,
    sort: string,
    filter: string,
    page: number,
    data: TablePage
  ) {
    const key = `table:${connectionId}:${table}:${sort}:${filter}:page:${page}`;
    const ttl = 1000 * 60 * 3; // 3 minutes
    
    this.memoryCache.set(key, data, { ttl });
    
    await this.db.cache.put({
      key,
      data,
      ttl,
      timestamp: Date.now(),
    });
  }
  
  // Query result caching (1 min TTL)
  async getQueryResult(
    connectionId: string,
    sql: string,
    params: any[],
    page: number
  ): Promise<QueryResult | null> {
    const hash = await this.hashQuery(sql, params);
    const key = `query:${connectionId}:${hash}:page:${page}`;
    
    return this.memoryCache.get(key);
  }
  
  // Invalidation strategies
  async invalidateTable(connectionId: string, table: string) {
    // Clear all pages for this table
    const pattern = `table:${connectionId}:${table}:`;
    
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(pattern)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Clear from IndexedDB
    const keys = await this.db.cache
      .where('key')
      .startsWith(pattern)
      .primaryKeys();
    
    await this.db.cache.bulkDelete(keys);
  }
  
  async invalidateSchema(connectionId: string) {
    const schemaKey = `schema:${connectionId}`;
    this.memoryCache.delete(schemaKey);
    await this.db.cache.delete(schemaKey);
    
    // Also invalidate all tables
    const pattern = `table:${connectionId}:`;
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(pattern)) {
        this.memoryCache.delete(key);
      }
    }
  }
  
  async invalidateConnection(connectionId: string) {
    // Clear everything for this connection
    const patterns = [
      `schema:${connectionId}`,
      `table:${connectionId}:`,
      `query:${connectionId}:`,
    ];
    
    for (const pattern of patterns) {
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(pattern)) {
          this.memoryCache.delete(key);
        }
      }
    }
    
    // Clear from IndexedDB
    for (const pattern of patterns) {
      const keys = await this.db.cache
        .where('key')
        .startsWith(pattern)
        .primaryKeys();
      
      await this.db.cache.bulkDelete(keys);
    }
  }
  
  // Memory management
  async pruneCache() {
    const stats = this.memoryCache.calculatedSize;
    
    if (stats > 40 * 1024 * 1024) { // Above 40MB
      // Prune cold entries
      this.memoryCache.purgeStale();
      
      // If still too large, clear oldest entries
      if (this.memoryCache.calculatedSize > 40 * 1024 * 1024) {
        const keys = Array.from(this.memoryCache.keys());
        const toDelete = Math.floor(keys.length * 0.3); // Remove 30%
        
        for (let i = 0; i < toDelete; i++) {
          this.memoryCache.delete(keys[i]);
        }
      }
    }
  }
  
  private async hashQuery(sql: string, params: any[]): Promise<string> {
    const text = `${sql}:${JSON.stringify(params)}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Dexie database
class CacheDB extends Dexie {
  cache!: Table<CacheEntry<any>>;
  
  constructor() {
    super('DevDBCache');
    this.version(1).stores({
      cache: 'key, timestamp',
    });
  }
}

export const cacheService = new CacheService();
```

### Wire to Commands

```typescript
// Hook into successful operations
tauri.listen('db:execute_success', (event) => {
  const { connectionId, affectedTables } = event.payload;
  
  // Invalidate affected tables
  for (const table of affectedTables) {
    cacheService.invalidateTable(connectionId, table);
  }
});

tauri.listen('db:ddl_executed', (event) => {
  const { connectionId } = event.payload;
  
  // DDL changes schema
  cacheService.invalidateSchema(connectionId);
});

tauri.listen('db:connection_closed', (event) => {
  const { connectionId } = event.payload;
  
  // Clear all cache for closed connection
  cacheService.invalidateConnection(connectionId);
});
```

---

## 10) Security & Secrets

### Tauri Security Model

```rust
// src-tauri/src/security/vault.rs
use keyring::Entry;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Argon2, PasswordHasher};

pub struct SecureVault {
    master_key: Option<Key<Aes256Gcm>>,
}

impl SecureVault {
    pub async fn unlock(&mut self, master_password: &str) -> Result<(), AppError> {
        // Derive key from master password
        let salt = self.get_or_create_salt().await?;
        let key = derive_key(master_password, &salt)?;
        
        // Verify key by decrypting test value
        self.verify_key(&key).await?;
        
        self.master_key = Some(key);
        Ok(())
    }
    
    pub async fn store_credential(
        &self,
        connection_id: &str,
        password: &str,
    ) -> Result<(), AppError> {
        let key = self.master_key.as_ref()
            .ok_or(AppError::locked("Vault is locked"))?;
        
        // Encrypt password
        let encrypted = encrypt_value(password, key)?;
        
        // Store in OS keychain as backup
        if let Ok(entry) = Entry::new("DevDBStudio", connection_id) {
            entry.set_password(&base64::encode(&encrypted))?;
        }
        
        // Also store in encrypted file
        self.store_to_file(connection_id, &encrypted).await?;
        
        Ok(())
    }
    
    pub async fn get_credential(&self, connection_id: &str) -> Result<String, AppError> {
        let key = self.master_key.as_ref()
            .ok_or(AppError::locked("Vault is locked"))?;
        
        // Try OS keychain first
        if let Ok(entry) = Entry::new("DevDBStudio", connection_id) {
            if let Ok(encrypted_b64) = entry.get_password() {
                let encrypted = base64::decode(&encrypted_b64)?;
                return decrypt_value(&encrypted, key);
            }
        }
        
        // Fallback to encrypted file
        let encrypted = self.load_from_file(connection_id).await?;
        decrypt_value(&encrypted, key)
    }
}

// Redact sensitive data in logs
pub fn redact_sensitive(sql: &str) -> String {
    // Redact passwords in connection strings
    let re = regex::Regex::new(r"password=([^;]+)").unwrap();
    re.replace_all(sql, "password=***").to_string()
}

// Secure defaults
pub fn get_pool_options() -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(10)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .test_before_acquire(true)
}
```

### Threat Model

1. **Credential Storage**: Encrypted at rest, never in plaintext
2. **Memory Safety**: Zeroize sensitive data after use
3. **Network**: TLS/SSL required for remote connections
4. **SQL Injection**: Parameterized queries only
5. **Process Isolation**: Tauri sandboxing per window

---

## 11) IPC & Performance Guardrails

### IPC Payload Management

```rust
// Chunk large results
#[tauri::command]
pub async fn db_fetch_chunked(
    cursor_id: String,
    chunk_size: usize,
) -> Result<ChunkedResponse, AppError> {
    const MAX_CHUNK: usize = 10_000; // Max rows per IPC call
    
    let chunk_size = chunk_size.min(MAX_CHUNK);
    
    // ... fetch data ...
    
    if rows.len() > chunk_size {
        // Store remainder in cursor
        cursor.buffer = rows.split_off(chunk_size);
        
        Ok(ChunkedResponse {
            rows,
            has_more: true,
            next_token: Some(cursor.next_token()),
        })
    } else {
        Ok(ChunkedResponse {
            rows,
            has_more: false,
            next_token: None,
        })
    }
}
```

### Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| TTFB (First Row) | < 100ms | `query_begin` → first `fetch` |
| Render 10k cells | < 500ms | Virtual scroll paint |
| Memory (idle) | < 150MB | Rust: 50MB, WebView: 100MB |
| Memory (active) | < 500MB | With 100k rows loaded |
| Export 1M rows | < 30s | Streaming CSV write |

### Profiling

```rust
// Backend profiling
#[cfg(debug_assertions)]
use flame;

#[tauri::command]
pub async fn db_query_profiled(sql: String) -> Result<QueryResult, AppError> {
    flame::start("query_total");
    
    flame::start("parse");
    let parsed = parse_sql(&sql)?;
    flame::end("parse");
    
    flame::start("execute");
    let result = execute_query(parsed).await?;
    flame::end("execute");
    
    flame::start("serialize");
    let response = serialize_result(result)?;
    flame::end("serialize");
    
    flame::end("query_total");
    
    // Dump flame graph
    flame::dump_html(File::create("flame.html")?)?;
    
    Ok(response)
}
```

---

## 12) Tests & CI/CD

### Test Matrix

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        db: [postgres:14, mysql:8, sqlite]
    
    runs-on: ${{ matrix.os }}
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      
      mysql:
        image: mysql:8
        env:
          MYSQL_ROOT_PASSWORD: test
        options: >-
          --health-cmd "mysqladmin ping"
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install pnpm
        run: npm i -g pnpm
      
      - name: Install dependencies
        run: |
          pnpm install
          cd src-tauri && cargo build
      
      - name: Unit tests
        run: |
          pnpm test
          cd src-tauri && cargo test
      
      - name: Integration tests
        run: |
          pnpm test:integration
        env:
          TEST_DB: ${{ matrix.db }}
      
      - name: E2E tests
        run: |
          pnpm test:e2e
        if: matrix.os == 'ubuntu-latest'
```

### Integration Tests

```rust
// src-tauri/tests/connection_tests.rs
#[tokio::test]
async fn test_connection_lifecycle() {
    let registry = ConnectionRegistry::new();
    
    // Connect
    let conn_id = registry.connect(ConnectionConfig {
        db_type: DbType::Postgres,
        host: "localhost".into(),
        port: 5432,
        user: "test".into(),
        password: "test".into(),
        database: Some("testdb".into()),
    }).await.unwrap();
    
    // Health check
    let health = registry.get_health(&conn_id).await.unwrap();
    assert_eq!(health.status, ConnectionStatus::Ready);
    
    // Query
    let cursor_id = registry.begin_query(
        &conn_id,
        "SELECT 1 as test",
        None,
        QueryOptions::default(),
    ).await.unwrap();
    
    let page = registry.fetch_page(&cursor_id, 0, 10).await.unwrap();
    assert_eq!(page.rows.len(), 1);
    
    // Cancel
    registry.cancel_query(&cursor_id).await.unwrap();
    
    // Close
    registry.close(&conn_id).await.unwrap();
}

#[tokio::test]
async fn test_query_cancellation() {
    let registry = ConnectionRegistry::new();
    let conn_id = setup_test_connection(&registry).await;
    
    // Start long query
    let cursor_id = registry.begin_query(
        &conn_id,
        "SELECT pg_sleep(10)",
        None,
        QueryOptions::default(),
    ).await.unwrap();
    
    // Cancel after 1 second
    tokio::time::sleep(Duration::from_secs(1)).await;
    
    let result = registry.cancel_query(&cursor_id).await;
    assert!(result.is_ok());
    
    // Verify cursor is gone
    let fetch_result = registry.fetch_page(&cursor_id, 0, 10).await;
    assert!(fetch_result.is_err());
}
```

### E2E Tests

```typescript
// tests/e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';

test('workspace state persistence', async ({ page }) => {
  // Create workspace
  await page.goto('/');
  await page.click('[data-testid="create-workspace"]');
  await page.fill('[name="workspace-name"]', 'Test Workspace');
  await page.click('[type="submit"]');
  
  // Add connection
  await page.click('[data-testid="add-connection"]');
  await page.fill('[name="host"]', 'localhost');
  await page.fill('[name="database"]', 'testdb');
  await page.click('[data-testid="test-connection"]');
  await expect(page.locator('[data-testid="connection-status"]'))
    .toHaveText('Connected');
  
  // Open table tab
  await page.click('[data-testid="table-users"]');
  await expect(page.locator('[data-testid="tab-title"]'))
    .toContainText('users');
  
  // Reload page
  await page.reload();
  
  // Verify state restored
  await expect(page.locator('[data-testid="workspace-name"]'))
    .toHaveText('Test Workspace');
  await expect(page.locator('[data-testid="tab-title"]'))
    .toContainText('users');
});

test('connection health monitoring', async ({ page }) => {
  await setupConnection(page);
  
  // Simulate network drop
  await page.context().setOffline(true);
  
  // Check degraded status
  await expect(page.locator('[data-testid="connection-health"]'))
    .toHaveClass(/degraded/);
  
  // Restore network
  await page.context().setOffline(false);
  
  // Check recovered
  await expect(page.locator('[data-testid="connection-health"]'))
    .toHaveClass(/ready/);
});
```

---

## 13) Roadmap — 30/60/90

### 30 Days - v0.9 (Foundation)

**Acceptance Criteria**:
- Query latency < 100ms for 10k rows
- Memory usage < 200MB with 3 connections
- Zero crashes in 24h stress test

**Deliverables**:
1. ✅ Workspace-scoped tabs with proper persistence
2. ✅ Typed Rust API with connection registry
3. ✅ Paged query execution with cancellation
4. ✅ Connection health monitoring with auto-reconnect
5. ✅ Schema/table metadata caching
6. ✅ Query editor with basic autocomplete
7. ✅ Virtual scrolling data grid (TanStack Table)

### 60 Days - v1.0 (MVP)

**Acceptance Criteria**:
- Support 1M+ row datasets with < 500MB memory
- Export 100k rows in < 10s
- 99.9% uptime over 7 days

**Deliverables**:
1. ✅ Inline editing with PK identity
2. ✅ Insert/delete row operations
3. ✅ DDL/DML cache invalidation
4. ✅ Streaming CSV/JSON export
5. ✅ Query history with search
6. ✅ Favorites/saved queries
7. ✅ Encrypted credential vault
8. ✅ Signed installers for all platforms

### 90 Days - v1.1 (Polish)

**Acceptance Criteria**:
- MSSQL support with same performance
- SSH tunnel latency < 50ms overhead
- License validation < 100ms

**Deliverables**:
1. ✅ MSSQL adapter implementation
2. ✅ SSH tunnel manager with bastion support
3. ✅ ERD generator with interactive layout
4. ✅ Schema diff tool with migration scripts
5. ✅ Query explain visualizer
6. ✅ Advanced autocomplete with snippets
7. ✅ License management system
8. ✅ Opt-in telemetry with privacy controls

---

## 14) Pro/Enterprise Feature Set

### Productivity Tier ($19/mo)

**AI SQL Copilot**
```typescript
// Local-first with Ollama/CodeLlama option
interface AICopilotFeatures {
  naturalLanguageToSQL: (prompt: string, schema: Schema) => Promise<string>;
  explainQuery: (sql: string) => Promise<Explanation>;
  optimizeQuery: (sql: string, stats: TableStats) => Promise<Optimization>;
  generateTestData: (table: string, rows: number) => Promise<InsertScript>;
}

// Implementation
async function nlToSQL(prompt: string): Promise<string> {
  const schema = await cacheService.getSchema(connectionId);
  
  const response = await ai.complete({
    model: 'codellama-7b-sql',
    prompt: `Given schema: ${formatSchema(schema)}
             Generate SQL for: ${prompt}`,
    temperature: 0.1,
  });
  
  // Validate and sandbox
  const parsed = await validateSQL(response.sql);
  if (parsed.hasDDL || parsed.hasDangerousDML) {
    return confirmWithUser(parsed);
  }
  
  return response.sql;
}
```

**Advanced Autocomplete**
- Cross-schema references with JOINs
- Column type inference
- Function signature help
- User-defined snippets
- Recent query patterns

### Data & Schema Tier ($39/mo)

**ERD Generator**
```typescript
interface ERDFeatures {
  generateDiagram: (schema: string) => Promise<MermaidDiagram>;
  interactiveLayout: (diagram: Diagram) => GraphLayout;
  exportFormats: ['SVG', 'PNG', 'PDF', 'Mermaid'];
  filtering: {
    bySchema: boolean;
    byRelationship: boolean;
    byTablePattern: boolean;
  };
}
```

**Schema Diff & Sync**
```typescript
interface SchemaDiffFeatures {
  compareSchemas: (source: Connection, target: Connection) => Promise<Diff>;
  generateMigration: (diff: Diff) => MigrationScript;
  safeSync: (script: MigrationScript) => Promise<SyncResult>;
  rollbackPlan: (script: MigrationScript) => RollbackScript;
}
```

**Data Compare**
- Row-by-row comparison with checksums
- Sampling strategies for large tables
- Conflict resolution UI
- Bidirectional sync

### Performance Tier ($49/mo)

**Query Profiler**
```typescript
interface ProfilerFeatures {
  explainAnalyze: (sql: string) => Promise<ExecutionPlan>;
  visualizePlan: (plan: ExecutionPlan) => PlanDiagram;
  compareVariants: (queries: string[]) => ComparisonReport;
  indexRecommendations: (plan: ExecutionPlan) => IndexSuggestions;
  historicalAnalysis: (queryId: string) => TrendReport;
}
```

**Session Monitor**
```sql
-- Real-time monitoring queries
SELECT pid, usename, application_name, state, 
       query, wait_event_type, wait_event,
       pg_blocking_pids(pid) as blocked_by
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY backend_start;
```

### Security Tier ($59/mo)

**SSH/Bastion Manager**
- Multi-hop tunnel support
- Key management with agent forwarding
- Connection pooling through tunnels
- Auto-reconnect with exponential backoff

**Team Vault**
```typescript
interface TeamVault {
  shareConnection: (conn: Connection, team: Team, permissions: Permission[]) => ShareLink;
  encryption: 'E2E-AES256-GCM';
  audit: AuditLog[];
  roles: ['read-only', 'read-write', 'admin'];
  mfa: boolean;
}
```

### Enterprise Tier (Custom)

**Plugin API**
```typescript
interface PluginAPI {
  registerDriver: (driver: DatabaseDriver) => void;
  registerPanel: (panel: PanelComponent) => void;
  registerCommand: (command: Command) => void;
  hooks: {
    beforeQuery: Hook<QueryContext>;
    afterQuery: Hook<QueryResult>;
    beforeEdit: Hook<EditContext>;
  };
}
```

**Licensing**
- Seat-based with device limits
- Offline activation via signed tokens
- Grace period for network issues
- Usage analytics (opt-in)

### Pricing Strategy

| Tier | Price | Features | Target |
|------|-------|----------|--------|
| **Free** | $0 | Unlimited connections/workspaces/tabs, BYO AI (OpenAI/Anthropic/Ollama), core features | Individual developers |
| **Pro** | $19/mo | Integrated AI copilot, advanced autocomplete, query profiler, ERD generator | Professional developers |
| **Team** | $39/seat | Shared workspaces, team vault, collaboration, schema diff/sync | Small teams |
| **Enterprise** | Custom | SSO, audit logs, plugin API, priority support, on-premise | Large organizations |

---

## 15) Appendices

### A. DbAdapter Implementation (Rust)

```rust
// Helper function to convert row values to strings for precision preservation
fn row_to_strings(row: &PgRow, columns: &[ColumnMeta]) -> Vec<String> {
    columns.iter().enumerate().map(|(i, col)| {
        // Get value as string to preserve precision
        if row.try_get_raw(i).is_err() {
            return "null".to_string();
        }
        
        match col.db_type.as_str() {
            "BOOL" | "boolean" => {
                row.try_get::<bool, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "INT2" | "INT4" | "INT8" | "smallint" | "integer" | "bigint" => {
                // Get integers as string to preserve full range
                row.try_get::<i64, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "NUMERIC" | "DECIMAL" | "numeric" | "decimal" => {
                // Use BigDecimal for exact decimal representation
                row.try_get::<sqlx::types::BigDecimal, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "FLOAT4" | "FLOAT8" | "real" | "double precision" => {
                // Get floats as string with full precision
                row.try_get::<f64, _>(i)
                    .map(|v| format!("{:.17}", v)) // Max precision for f64
                    .unwrap_or_else(|_| "null".to_string())
            },
            "JSON" | "JSONB" | "json" | "jsonb" => {
                row.try_get::<serde_json::Value, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            _ => {
                // All other types as string
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| "null".to_string())
            }
        }
    }).collect()
}

// Full PostgreSQL adapter implementation
impl DbAdapter for PostgresAdapter {
    async fn begin_query(
        &self,
        sql: &str,
        params: Option<Vec<Value>>,
        opts: QueryOptions,
    ) -> Result<QueryCursor, AppError> {
        // Parse and validate SQL
        let statements = sqlparser::parse_statements(sql)?;
        if statements.len() > 1 && !opts.allow_multiple {
            return Err(AppError::sql("Multiple statements not allowed"));
        }
        
        // Check read-only mode
        if opts.read_only && !is_read_only(&statements[0]) {
            return Err(AppError::sql("Write operations not allowed in read-only mode"));
        }
        
        // Execute with EXPLAIN if requested
        let final_sql = if opts.explain {
            format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {}", sql)
        } else {
            sql.to_string()
        };
        
        // Start transaction for consistency
        let mut tx = self.pool.begin().await?;
        
        // Set statement timeout
        sqlx::query("SET statement_timeout = $1")
            .bind(opts.timeout_ms.unwrap_or(30000))
            .execute(&mut tx)
            .await?;
        
        // Create server-side cursor for large results
        let cursor_name = format!("cursor_{}", Uuid::new_v4());
        let declare = format!("DECLARE {} CURSOR FOR {}", cursor_name, final_sql);
        
        sqlx::query(&declare)
            .execute(&mut tx)
            .await?;
        
        // Fetch first batch to get columns
        let fetch = format!("FETCH 100 FROM {}", cursor_name);
        let rows = sqlx::query(&fetch)
            .fetch_all(&mut tx)
            .await?;
        
        // Extract column metadata
        let columns = if !rows.is_empty() {
            rows[0].columns()
                .iter()
                .map(|col| ColumnMeta {
                    name: col.name().to_string(),
                    db_type: col.type_info().name().to_string(),
                    nullable: true, // TODO: Get from catalog
                    default: None,
                    is_pk: false,
                    is_fk: false,
                    ordinal: col.ordinal() as i32,
                })
                .collect()
        } else {
            vec![]
        };
        
        // Convert rows to strings to preserve precision
        let string_rows = rows.into_iter()
            .map(|row| row_to_strings(&row, &columns))
            .collect();
        
        Ok(QueryCursor {
            id: Uuid::new_v4().to_string(),
            sql: sql.to_string(),
            columns,
            rows: string_rows,
            page_size: 100,
            current_page: 0,
            total_rows: None, // Will be set async
            is_complete: false,
            cursor_name: Some(cursor_name),
            transaction: Some(tx),
        })
    }
}
```

### B. Column Factory (TypeScript)

```typescript
// Type-specific column renderers and editors
export function createColumns(
  metadata: ColumnMeta[],
  editable: boolean
): ColumnDef<any>[] {
  return metadata.map(meta => ({
    id: meta.name,
    header: ({ column }) => (
      <div className="flex items-center gap-1">
        <span>{meta.name}</span>
        <Badge variant="outline" className="text-xs">
          {meta.db_type}
        </Badge>
        {meta.is_pk && <Key className="w-3 h-3" />}
      </div>
    ),
    accessorFn: row => row[meta.name],
    cell: ({ getValue, row, column, table }) => {
      const value = getValue();
      const isEditing = table.options.meta?.editingCell?.id === 
                       `${row.id}-${column.id}`;
      
      if (isEditing && editable) {
        return (
          <CellEditor
            value={value}
            type={meta.db_type}
            onSave={newValue => {
              table.options.meta?.updateData(row.index, column.id, newValue);
            }}
            onCancel={() => {
              table.options.meta?.setEditingCell(null);
            }}
          />
        );
      }
      
      // Type-specific rendering
      if (meta.db_type.includes('json')) {
        return <JsonCell value={value} />;
      }
      
      if (meta.db_type.includes('timestamp')) {
        return <DateCell value={value} format="YYYY-MM-DD HH:mm:ss" />;
      }
      
      if (meta.db_type.includes('bool')) {
        return <BooleanCell value={value} />;
      }
      
      if (meta.db_type.includes('bytea') || meta.db_type.includes('blob')) {
        return <BinaryCell value={value} />;
      }
      
      // Default text
      return <TextCell value={value} truncate={100} />;
    },
    sortingFn: meta.db_type.includes('num') || 
                meta.db_type.includes('int') || 
                meta.db_type.includes('float')
      ? 'alphanumericCaseSensitive'
      : 'text',
    filterFn: meta.db_type.includes('json')
      ? 'includesString'
      : 'auto',
    size: getDefaultColumnWidth(meta.db_type),
    minSize: 50,
    maxSize: 500,
  }));
}

function getDefaultColumnWidth(dbType: string): number {
  if (dbType.includes('id')) return 100;
  if (dbType.includes('bool')) return 80;
  if (dbType.includes('int')) return 100;
  if (dbType.includes('timestamp')) return 180;
  if (dbType.includes('text')) return 300;
  if (dbType.includes('json')) return 400;
  return 150;
}
```

### C. Column Check Constraints Queries

```sql
-- PostgreSQL: Fetch check constraints for columns
SELECT 
    a.attname AS column_name,
    pg_get_constraintdef(con.oid) AS check_constraint
FROM pg_constraint con
JOIN pg_attribute a ON a.attnum = ANY(con.conkey)
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'c'  -- 'c' for check constraints
    AND n.nspname = $1    -- schema name
    AND c.relname = $2    -- table name
ORDER BY a.attname;

-- MySQL: Fetch check constraints (MySQL 8.0.16+)
SELECT 
    tc.CONSTRAINT_NAME,
    cc.CHECK_CLAUSE as check_constraint
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.CHECK_CONSTRAINTS cc
    ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
    AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = ? 
    AND tc.TABLE_NAME = ?
    AND tc.CONSTRAINT_TYPE = 'CHECK';

-- SQLite: Parse check constraints from table DDL
SELECT sql FROM sqlite_master 
WHERE type = 'table' AND name = ?;
-- Then parse CHECK constraints from the CREATE TABLE statement
```

### D. Complete Column Metadata Fetching (Rust)

```rust
async fn fetch_column_metadata(
    &self,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnMeta>, AppError> {
    // Main column information
    let columns_sql = r#"
        SELECT 
            c.column_name,
            c.data_type,
            c.is_nullable = 'YES' AS nullable,
            c.column_default,
            c.ordinal_position,
            c.numeric_precision,
            c.numeric_scale
        FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position
    "#;
    
    // Primary key information
    let pk_sql = r#"
        SELECT kcu.column_name
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
            AND kcu.table_schema = $1
            AND kcu.table_name = $2
    "#;
    
    // Foreign key information with references
    let fk_sql = r#"
        SELECT 
            kcu.column_name,
            kcu.constraint_name,
            ccu.table_schema AS referenced_schema,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            rc.delete_rule AS on_delete,
            rc.update_rule AS on_update
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
            ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND kcu.table_schema = $1
            AND kcu.table_name = $2
    "#;
    
    // Check constraints
    let check_sql = r#"
        SELECT 
            a.attname AS column_name,
            pg_get_constraintdef(con.oid) AS check_constraint
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attnum = ANY(con.conkey)
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c'
            AND n.nspname = $1
            AND c.relname = $2
    "#;
    
    // Execute all queries in parallel
    let (columns, pks, fks, checks) = tokio::join!(
        sqlx::query(&columns_sql).bind(schema).bind(table).fetch_all(&self.pool),
        sqlx::query(&pk_sql).bind(schema).bind(table).fetch_all(&self.pool),
        sqlx::query(&fk_sql).bind(schema).bind(table).fetch_all(&self.pool),
        sqlx::query(&check_sql).bind(schema).bind(table).fetch_all(&self.pool),
    );
    
    // Build column metadata with all constraint information
    let mut column_map = HashMap::new();
    
    for row in columns? {
        let col = ColumnMeta {
            name: row.get("column_name"),
            db_type: row.get("data_type"),
            nullable: row.get("nullable"),
            default: row.get("column_default"),
            is_pk: false,
            is_fk: false,
            fk_reference: None,
            check_constraint: None,
            ordinal: row.get("ordinal_position"),
            precision: row.get("numeric_precision"),
            scale: row.get("numeric_scale"),
        };
        column_map.insert(col.name.clone(), col);
    }
    
    // Add PK flags
    for row in pks? {
        if let Some(col) = column_map.get_mut(&row.get::<String, _>("column_name")) {
            col.is_pk = true;
        }
    }
    
    // Add FK references
    for row in fks? {
        if let Some(col) = column_map.get_mut(&row.get::<String, _>("column_name")) {
            col.is_fk = true;
            col.fk_reference = Some(ForeignKeyRef {
                constraint_name: row.get("constraint_name"),
                referenced_schema: row.get("referenced_schema"),
                referenced_table: row.get("referenced_table"),
                referenced_column: row.get("referenced_column"),
                on_delete: row.get("on_delete"),
                on_update: row.get("on_update"),
            });
        }
    }
    
    // Add check constraints
    for row in checks? {
        if let Some(col) = column_map.get_mut(&row.get::<String, _>("column_name")) {
            col.check_constraint = Some(row.get("check_constraint"));
        }
    }
    
    // Sort by ordinal and return
    let mut columns: Vec<_> = column_map.into_values().collect();
    columns.sort_by_key(|c| c.ordinal);
    
    Ok(columns)
}
```

### E. Metadata SQL Reference

```sql
-- PostgreSQL: Complete schema information
WITH table_info AS (
  SELECT 
    n.nspname as schema_name,
    c.relname as table_name,
    c.relkind as table_type,
    pg_stat_get_live_tuples(c.oid) as row_count,
    pg_total_relation_size(c.oid) as total_size,
    obj_description(c.oid, 'pg_class') as comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND c.relkind IN ('r', 'v', 'm', 'p')
),
column_info AS (
  SELECT 
    table_schema,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    ordinal_position
  FROM information_schema.columns
),
constraint_info AS (
  SELECT 
    kcu.table_schema,
    kcu.table_name,
    kcu.column_name,
    tc.constraint_type
  FROM information_schema.key_column_usage kcu
  JOIN information_schema.table_constraints tc
    ON kcu.constraint_name = tc.constraint_name
)
SELECT 
  t.*,
  json_agg(
    json_build_object(
      'name', c.column_name,
      'type', c.data_type,
      'nullable', c.is_nullable = 'YES',
      'default', c.column_default,
      'is_pk', EXISTS(
        SELECT 1 FROM constraint_info ci 
        WHERE ci.table_schema = c.table_schema 
          AND ci.table_name = c.table_name 
          AND ci.column_name = c.column_name 
          AND ci.constraint_type = 'PRIMARY KEY'
      ),
      'ordinal', c.ordinal_position
    ) ORDER BY c.ordinal_position
  ) as columns
FROM table_info t
LEFT JOIN column_info c 
  ON t.schema_name = c.table_schema 
  AND t.table_name = c.table_name
GROUP BY t.schema_name, t.table_name, t.table_type, 
         t.row_count, t.total_size, t.comment
ORDER BY t.schema_name, t.table_name;

-- MySQL: Fast table statistics
SELECT 
  TABLE_NAME,
  TABLE_TYPE,
  ENGINE,
  TABLE_ROWS,
  DATA_LENGTH + INDEX_LENGTH as SIZE_BYTES,
  CREATE_TIME,
  UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- SQLite: Schema from sqlite_master
SELECT 
  name,
  type,
  sql
FROM sqlite_master
WHERE type IN ('table', 'view', 'index')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;
```

### D. References

1. **Tauri v2 Documentation**: https://v2.tauri.app/
2. **SQLx**: https://github.com/launchbadge/sqlx
3. **TanStack Table v8**: https://tanstack.com/table/v8
4. **Dexie.js**: https://dexie.org/
5. **Monaco Editor**: https://microsoft.github.io/monaco-editor/
6. **Database Information Schemas**:
   - PostgreSQL: https://www.postgresql.org/docs/current/information-schema.html
   - MySQL: https://dev.mysql.com/doc/refman/8.0/en/information-schema.html
   - SQLite: https://www.sqlite.org/schematab.html

---

## Summary

This research document provides a comprehensive architecture for building a TablePlus-class database client with Tauri. Key innovations include:

1. **Workspace-scoped state management** solving the tab/connection binding issue
2. **Real-time health monitoring** with automatic reconnection
3. **Typed, cancelable query API** with cursor management
4. **Two-tier caching** (LRU + IndexedDB) with smart invalidation
5. **Virtual scrolling data grid** with inline editing
6. **Security-first design** with encrypted credential storage

The 30-day roadmap focuses on core stability, the 60-day milestone delivers a production-ready MVP, and the 90-day target adds enterprise features. The Pro/Enterprise feature set provides clear monetization paths with tiered offerings from $19-59/month per seat.

Implementation prioritizes Rust's memory safety and performance advantages while leveraging React's ecosystem for rapid UI development. The architecture scales from single-user desktop usage to team collaboration with cloud sync capabilities.