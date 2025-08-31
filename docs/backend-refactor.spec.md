# DevDB Studio — Backend Specification (v1.0)

This is the **authoritative backend spec** for the Tauri/Rust side of DevDB Studio. It covers runtime, module layout, type contracts, command APIs, adapters for Postgres/MySQL/SQLite, SSH, encryption, Safe Mode, paging/streaming, ERD/diff, import/export, errors, logging, and performance guarantees.

---

## 0) Principles & Guarantees

- **Local-first**: no cloud proxy; all DB traffic stays on the user’s machine.
- **Safety**: destructive SQL is blocked or requires explicit override.
- **Performance**: incremental fetch with constant memory; cancelable long ops.
- **Maintainability**: single `DbAdapter` trait, per-DB impls; small commands layer.
- **Security**: secrets encrypted at rest (AES-GCM, Argon2id); SSH host key pinning.
- **Typed contracts**: all Tauri commands are stable, versioned, and typed via Serde.

---

## 1) Runtime, Concurrency & Dependencies

- **Runtime**: `tokio` multi-thread scheduler.
- **Async IO**: all DB drivers are async; commands are `async fn`.
- **Serialization**: `serde` (JSON over the Tauri bridge).
- **Key crates**:

  - DB: `tokio-postgres`, `mysql_async`, `rusqlite` / `tokio_rusqlite`
  - SSH: `ssh2`
  - Crypto: `aes-gcm`, `argon2`, `rand`, `zeroize`, `keyring`
  - Infra: `dashmap`, `thiserror`, `anyhow`, `time`, `bytes`, `serde_json`

- **Cancellation**:

  - PG: driver cancel token
  - MySQL: drop statement/conn (reconnect)
  - SQLite: `Connection::interrupt()` (via `rusqlite`)

---

## 2) Source Layout

```
src-tauri/
  src/
    commands.rs             # Tauri #[command] entrypoints (thin)
    error.rs                # AppError + mapping
    main.rs                 # setup, state, tokio runtime
    conn/
      manager.rs            # ConnManager (multi-DB, pooling, idle reap)
      types.rs              # DbKind, ConnProfile, DbRef, SafePolicy, SecretRef
    adapters/
      mod.rs                # DbAdapter trait + shared types
      postgres.rs
      mysql.rs
      sqlite.rs
      snapshot.rs           # normalized schema model (+ diff utils)
    ssh/
      tunnel.rs             # direct + ProxyJump tunnels, known_hosts
      config.rs             # ~/.ssh/config parser helpers
    security/
      crypto.rs             # AES-GCM, Argon2id, key rotation
      keystore.rs           # OS keychain wrapper
      settings_store.rs     # encrypted settings (read/write/migrate)
      audit.rs              # Safe Mode audit log (redacted)
```

---

## 3) Core Data Models (Rust)

```rust
// conn/types.rs
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub enum DbKind { Postgres, Mysql, Sqlite }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub enum SafePolicy { Off, Warn, Block }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConnProfile {
  pub id: String,
  pub name: String,
  pub kind: DbKind,
  pub host: Option<String>, pub port: Option<u16>,
  pub database: Option<String>, pub username: Option<String>,
  pub ssl_mode: Option<String>,              // per-DB meaning (e.g., require/verify-full)
  pub file_path: Option<String>,             // SQLite
  pub ssh: Option<SshProfile>,
  pub safe_mode: SafePolicy,
  pub tags: Vec<String>,
  pub options: serde_json::Value,            // driver-specific (e.g., timeouts)
  // secrets are not stored here; see SecretRef
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SshProfile {
  pub host: String, pub port: u16, pub user: Option<String>,
  pub identity_file: Option<String>, pub use_agent: bool,
  pub proxy_jump: Vec<String>, // host aliases chain
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SecretRef {
  pub connection_password: Option<String>,   // plaintext from UI, not persisted
  pub ssh_key_passphrase: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DbRef { pub id: String, pub kind: DbKind }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct QueryHandle { pub qid: String, pub columns: Vec<ColumnMeta> }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ColumnMeta {
  pub name: String, pub data_type: String, pub nullable: bool
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PageChunk {
  pub rows: Vec<Vec<serde_json::Value>>,
  pub done: bool,
  pub row_count_hint: Option<u64>, // if known
  pub timings_ms: Option<PageTimings>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PageTimings { pub fetch: u32, pub decode: u32 }
```

**JSON value rules**:

- Dates/times returned as **ISO-8601 strings** (UTC or with offset).
- Binary (bytea/BLOB) returned as **base64 strings** with `{ "type":"bytes","data":"..." }` pattern if needed later.
- Null as JSON `null`.

---

## 4) Error Model

```rust
// error.rs
#[derive(thiserror::Error, Debug)]
pub enum AppError {
  #[error("connection not found")] NotFound,
  #[error("connection closed")] ConnClosed,
  #[error("sql blocked by safe mode")] SafeBlocked,
  #[error("sql syntax error: {0}")] SqlSyntax(String),
  #[error("timeout")] Timeout,
  #[error("driver error: {0}")] Driver(String),
  #[error("io error: {0}")] Io(String),
  #[error("ssh error: {0}")] Ssh(String),
  #[error("encryption error: {0}")] Crypto(String),
  #[error("internal error")] Internal,
}

#[derive(serde::Serialize)]
pub struct AppErrPayload { code: &'static str, message: String, details: serde_json::Value }
```

**Mapping to codes** (stable contract):

- `E_NOT_FOUND`, `E_CONN_CLOSED`, `E_SAFE_BLOCKED`, `E_SQL_SYNTAX`, `E_TIMEOUT`,
  `E_DRIVER`, `E_IO`, `E_SSH`, `E_CRYPTO`, `E_INTERNAL`.

---

## 5) Tauri Commands (API Contracts)

_All commands are **idempotent** where practical, return JSON, and never leak secrets in errors._

### 5.1 Connection Management

- `list_connections() -> Vec<ConnProfile>`
- `upsert_connection(profile: ConnProfile, secret: Option<SecretRef>) -> ()`

  - Encrypt & persist; secrets go to **encrypted store** or OS keychain.

- `test_connection(profile: ConnProfile, secret: Option<SecretRef>) -> TestReport`
- `open_connection(id: String) -> DbRef`
- `close_connection(id: String) -> ()`

**`TestReport`**

```rust
#[derive(serde::Serialize)]
pub struct TestReport {
  pub ok: bool,
  pub latency_ms: u32,
  pub server_version: String,
  pub ssl: Option<String>,
  pub ssh_chain: Vec<String>, // hops traversed
}
```

### 5.2 Query & Paging

- `open_query(db: DbRef, sql: String) -> QueryHandle`

  - Validates against **Safe Mode** before executing.
  - Starts cursor/portal/stream depending on DB.

- `fetch_page(qid: String, max_rows: u32) -> PageChunk`
- `cancel_query(qid: String) -> ()`

### 5.3 Metadata & ERD

- `schemas(db: DbRef) -> Vec<String>`
- `tables(db: DbRef, schema: String) -> Vec<TableMeta>`
- `columns(db: DbRef, schema: String, table: String) -> Vec<ColumnMeta>`
- `erd(db: DbRef, schemas: Vec<String>) -> ErdGraph`

```rust
#[derive(serde::Serialize)]
pub struct TableMeta { pub schema: String, pub name: String, pub kind: String }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ErdGraph {
  pub nodes: Vec<ErdNode>, pub edges: Vec<ErdEdge>
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ErdNode { pub id: String, pub label: String, pub cols: Vec<ColumnMeta>, pub pk: Vec<String> }
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ErdEdge { pub from: String, pub to: String, pub cols_from: Vec<String>, pub cols_to: Vec<String>, pub delete: String, pub update: String }
```

### 5.4 Schema Diff & Apply

- `schema_diff(a: DbRef, b: DbRef) -> DiffPlan`
- `apply_diff(target: DbRef, plan: DiffPlan, force: bool) -> ApplyResult`

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DiffPlan {
  pub statements: Vec<PlannedStmt>,   // ordered
  pub destructive: bool,              // any DROP/TRUNCATE?
}
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PlannedStmt { pub ddl: String, pub object: String, pub kind: String } // kind: CREATE/ALTER/DROP
#[derive(serde::Serialize)]
pub struct ApplyResult { pub applied: usize, pub errors: Vec<String> }
```

### 5.5 Explain / Import / Export

- `explain(db: DbRef, sql: String, analyze: bool) -> serde_json::Value`
- `export_csv(db: DbRef, sql: String, path: String) -> ExportStats`
- `import_csv(db: DbRef, table: String, path: String, opts: ImportOpts) -> ImportStats`

```rust
#[derive(serde::Serialize)]
pub struct ExportStats { pub rows: u64, pub elapsed_ms: u64 }
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ImportOpts { pub header: bool, pub delimiter: char, pub null: Option<String>, pub batch_size: u32, pub upsert_key: Option<Vec<String>> }
#[derive(serde::Serialize)]
pub struct ImportStats { pub rows_ok: u64, pub rows_err: u64, pub elapsed_ms: u64, pub error_report: Option<String> }
```

---

## 6) Connection Manager (multi-DB, idle reaping)

Responsibilities:

- Keep **LiveConn** instances for each opened profile.
- Manage **SSH tunnels** lifecycle per connection.
- Provide **idle timeout** (default 10 minutes): close DB client + tunnel.
- Thread-safe via `DashMap`; internal tasks on Tokio.

```rust
pub struct LiveConn {
  pub id: String,
  pub kind: DbKind,
  pub adapter: Box<dyn DbAdapter + Send + Sync>,
  pub last_used: std::time::Instant,
}

pub struct ConnManager {
  conns: dashmap::DashMap<String, LiveConn>,
  idle_secs: u64,
}
impl ConnManager {
  pub async fn get(&self, id: &str) -> Result<LiveConnRef, AppError>;
  pub async fn open(&self, profile: &ConnProfile, secret: Option<SecretRef>) -> Result<DbRef, AppError>;
  pub async fn close(&self, id: &str) -> Result<(), AppError>;
  pub fn reap_task(self: Arc<Self>) { /* spawn loop to close idle */ }
}
```

---

## 7) SSH Tunneling (direct + ProxyJump)

- Use `ssh2::Session`:

  - **known_hosts**: load `~/.ssh/known_hosts`, verify on connect; mismatch prompts UI.
  - **auth**: agent (if available), keyfile (PEM/OpenSSH), or password.

- **ProxyJump chain**: build a cascade:

  - Local → Hop1 (`Session::set_tcp_stream` + `connect`)
  - Forward through Hop1 with `channel_direct_tcpip` to Hop2, etc.
  - Final `channel_direct_tcpip` to DB host\:port → produce a **local `TcpStream`** adapter for drivers.

- Reuse a tunnel per open connection; close on idle reap.

**Tunnel handle**

```rust
pub struct Tunnel {
  pub local_addr: std::net::SocketAddr, // bound localhost port
  // keep sessions/channels alive here
}
```

---

## 8) DbAdapter Trait & Implementations

```rust
// adapters/mod.rs
#[async_trait::async_trait]
pub trait DbAdapter {
  async fn connect(&mut self) -> Result<(), AppError>;
  async fn test(&self) -> Result<TestReport, AppError>;

  // query lifecycle
  async fn open_query(&self, sql: &str) -> Result<QueryHandle, AppError>;
  async fn fetch_page(&self, qid: &str, max: u32) -> Result<PageChunk, AppError>;
  async fn cancel(&self, qid: &str) -> Result<(), AppError>;

  // metadata
  async fn schemas(&self) -> Result<Vec<String>, AppError>;
  async fn tables(&self, schema: &str) -> Result<Vec<TableMeta>, AppError>;
  async fn columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError>;
  async fn snapshot(&self, schemas: &[String]) -> Result<SchemaSnapshot, AppError>;

  // features
  async fn explain(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, AppError>;
  async fn export_csv(&self, sql: &str, path: &str) -> Result<ExportStats, AppError>;
  async fn import_csv(&self, table: &str, path: &str, opts: &ImportOpts) -> Result<ImportStats, AppError>;

  // schema management
  async fn apply(&self, plan: &DiffPlan) -> Result<ApplyResult, AppError>;
}
```

### 8.1 Postgres Adapter (primary)

- **Connection**: `tokio_postgres` with TLS (native-tls/rustls selectable).
- **Paging**: **Portals**
  `Transaction::prepare` → `bind` → `query_portal(portal, n)` until empty.
- **Cancel**: `Client::cancel_query(token)` or cancel via separate connection.
- **Export**: `COPY ( <sql> ) TO STDOUT WITH CSV ...` streamed to file.
- **Import**: `COPY schema.table FROM STDIN WITH CSV ...` streaming reader.
- **Explain**: `EXPLAIN (ANALYZE, FORMAT JSON) ...`.
- **Metadata**: `pg_catalog` / `information_schema`.
- **Snapshot**: fills normalized `SchemaSnapshot`.

**Notes**:

- Start v1 in **text mode** decode; add binary row mode later behind a flag.
- Use `tokio_postgres::types::ToSql` for binds when needed.

### 8.2 MySQL/MariaDB Adapter

- **Connection**: `mysql_async::Pool`.
- **Paging**: stream rows; if server-side cursors enabled, use prepared `COM_STMT_FETCH`; otherwise keyset pagination hints (for “Open Table” views).
- **Cancel**: drop statement/connection; automatic reconnect on next action.
- **Export**: stream `SELECT` to CSV writer.
- **Import**: try `LOAD DATA LOCAL INFILE` if allowed; else batch INSERTs in txn.
- **Explain**: `EXPLAIN FORMAT=JSON` (fallback to classic table).
- **Metadata**: `information_schema` tables → normalized snapshot.

### 8.3 SQLite Adapter

- **Connection**: `rusqlite` (or `tokio_rusqlite` to run on blocking threadpool).
- **Paging**: for arbitrary SQL, use `LIMIT/OFFSET` with warning after large offsets; for table browsing, prefer keyset (`WHERE id > ? ORDER BY id LIMIT ?`).
- **Cancel**: `Connection::interrupt()`.
- **Export/Import**: stream rows; transaction batch for import.
- **Explain**: `EXPLAIN QUERY PLAN ...` (return text/rows).
- **Metadata**: `PRAGMA table_info`, `foreign_key_list`, `index_list`, `index_info`.

---

## 9) ERD & Snapshot Normalization

**Normalized types (adapters/snapshot.rs)**

```rust
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SchemaSnapshot { pub db: String, pub schemas: Vec<Schema> }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Schema { pub name: String, pub tables: Vec<Table>, pub views: Vec<View> }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Table {
  pub schema: String, pub name: String, pub columns: Vec<Column>,
  pub pk: Vec<String>, pub fks: Vec<ForeignKey>, pub indexes: Vec<Index>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Column { pub name: String, pub data_type: String, pub nullable: bool, pub default: Option<String> }
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ForeignKey {
  pub from_table: String, pub from_cols: Vec<String>,
  pub to_table: String,   pub to_cols: Vec<String>,
  pub on_update: String,  pub on_delete: String,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Index { pub name: String, pub unique: bool, pub cols: Vec<String>, pub where_: Option<String> }
```

**PG Introspection (sketch, safe & performant)**

- Tables/Views: `information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`
- Columns: `information_schema.columns`
- PK: join `pg_index` (indisprimary) → column names via `pg_attribute`
- FKs: `pg_constraint` (contype='f') join `pg_class`/`pg_attribute`
- Indexes: `pg_index`/`pg_class`/`pg_namespace`; partial index `pg_get_expr(indpred, indrelid)`

**MySQL Introspection**

- `information_schema.tables`, `columns`, `key_column_usage`, `statistics`
- Note engine/charset but normalize away unless relevant to diff.

**SQLite Introspection**

- `PRAGMA table_info(<tbl>)`, `PRAGMA foreign_key_list(<tbl>)`, `PRAGMA index_list(<tbl>)` + `PRAGMA index_info(<idx>)`

---

## 10) Schema Diff Algorithm

1. **Normalize snapshots**:

   - Lowercase or quoted-identifier aware canonical names.
   - Strip volatile defaults (e.g., `now()` vs `CURRENT_TIMESTAMP`) behind an **ignore rules** set.
   - Ignore storage params by default (vacuum/autovacuum, fillfactor, etc.) unless user opts in.

2. **Compare**:

   - Set diff on (tables, columns, constraints, indexes).
   - Column change classification: type change / nullability / default / rename (heuristic with identical `attnum` where available; else user resolves manually).

3. **Plan**:

   - Order: CREATE SCHEMAS → CREATE TABLES → ADD COLUMNS → KEYS/CONSTRAINTS → INDEXES → **drops last**.
   - For destructive ops, mark `destructive = true`.

4. **Apply**:

   - Wrap in a **single transaction** where supported.
   - For PG, add `SET lock_timeout`/`statement_timeout` options (plan-provided).
   - On error, rollback and return partial apply report.

---

## 11) Safe Mode

- **Policy**: `Off | Warn | Block` per connection (default **Warn**; **Block** if tagged `prod`).
- **Detectors**:

  - `DROP DATABASE|SCHEMA|TABLE`
  - `TRUNCATE`
  - `DELETE|UPDATE` without `WHERE` (naive check + sqlparser fallback)

- **Flow**:

  - `Warn`: prompt typed object name; audit on override.
  - `Block`: error with `E_SAFE_BLOCKED`.

**Audit Log** (`security/audit.rs`):

```rust
#[derive(serde::Serialize)]
pub struct AuditEntry {
  ts: i64, conn_id: String, user: String,
  action: String, sql_sha256: String, // never store full SQL unless user opts in
  override_reason: Option<String>,
}
```

Stored as a small **JSONL file** under app data; rotate at 5 MB.

---

## 12) Encrypted Settings Store

- File: `<appdata>/settings.json.enc` (versioned).
- **Key hierarchy**:

  - Preferred: random 32-byte **master key** in OS keychain (`keyring`).
  - Fallback: **user master password** → Argon2id (salted) → key.

- **Cipher**: AES-256-GCM (random 96-bit nonce per write).
- **Rotation**: re-encrypt file when switching key source.

```rust
// security/crypto.rs (sketch)
pub fn encrypt_aead(key: &[u8;32], plaintext: &[u8]) -> Result<Vec<u8>, AppError> { /* ... */ }
pub fn decrypt_aead(key: &[u8;32], ciphertext: &[u8]) -> Result<Vec<u8>, AppError> { /* ... */ }
```

**What’s stored encrypted**: connection passwords, SSH key passphrases, license token, telemetry DSN.
**What’s not**: non-secret preferences, layout, MRU lists (separate plain JSON).

---

## 13) Import / Export

- **Export CSV** (all DBs):

  - Stream rows; configurable delimiter/quote/NULL; CRLF optional.
  - Backpressure to avoid memory spikes; flush periodically.

- **Import CSV**:

  - **Postgres**: `COPY table FROM STDIN WITH (FORMAT csv, HEADER ?, DELIMITER ?, NULL '...')`.
  - **MySQL**: `LOAD DATA LOCAL INFILE` if allowed; else batch `INSERT` with prepared statements.
  - **SQLite**: transaction batch (commit every `batch_size` rows).

- **Error handling**:

  - On row error, continue in “lenient” mode and write an **error report** CSV (row, reason).
  - Return `ImportStats { rows_ok, rows_err, error_report }`.

---

## 14) Explain

- **Postgres**: `EXPLAIN (FORMAT JSON, ANALYZE ?)` → pass JSON through.
- **MySQL**: `EXPLAIN FORMAT=JSON` (fallback to tabular if not supported).
- **SQLite**: `EXPLAIN QUERY PLAN ...` (return array of `(selectid, order, from, detail)` or text).

---

## 15) Results Paging & Serialization

- Default **page size** 200; grid may request any size (bounded max 1000).
- Adapters **decode to primitive JSON** in Rust; avoid stringifying numbers unnecessarily.
- Include `timings_ms` per page for UI perf display.
- `row_count_hint`:

  - Provide only if cheap (e.g., when using a cursor with known count or a `COUNT(*)` hint the adapter chose to compute); otherwise `null`.

---

## 16) Logging, Telemetry, Privacy

- **Log level**: info/warn/error; no SQL text in logs by default.
- **Telemetry**: **opt-in** only. If enabled, send:

  - anonymized event (feature used), platform/arch, durations; **no** SQL text or connection strings.

- **Redaction**: if user opts in to include SQL (for support), mark payloads as sensitive.

---

## 17) Performance Budgets & Backpressure

- **Budgets**:

  - First 200 rows: < 500ms local; < 1.5s over 1-hop SSH (typical pgbench).
  - Steady-state paging: sub-100ms decode on 200 rows.
  - Export 1M rows < memory spike 150 MB; streaming only.

- **Backpressure**:

  - If UI requests pages too fast, adapter **coalesces** overlapping reads and cancels stale qids.
  - Max concurrent queries per connection (default 4) to avoid server overload.

---

## 18) Security Hardening

- **TLS**:

  - PG: allow `sslmode=require/verify-ca/verify-full`.
  - MySQL: SSL mode toggles; CA bundle path may be configured.

- **Host key**: always verify; store fingerprint with connection profile; mismatches require explicit user approval.
- **SQL parsing**: use `sqlparser-rs` best-effort for Safe Mode (fallback to heuristics for dialect gaps).
- **Secrets**: zeroize in memory after use where feasible.

---

## 19) Example Command Implementations (sketches)

**open_query (PG)**

```rust
#[tauri::command]
pub async fn open_query(state: State<'_, AppState>, db: DbRef, sql: String)
  -> Result<QueryHandle, AppErrPayload>
{
  let cm = state.conn_mgr.clone();
  let conn = cm.get(&db.id).await.map_err(to_payload)?;
  // Safe Mode check
  safe_guard(&conn.profile, &sql).map_err(to_payload)?;

  // adapter returns qid + columns
  conn.adapter.open_query(&sql).await.map_err(to_payload)
}
```

**fetch_page (PG)**

```rust
#[tauri::command]
pub async fn fetch_page(state: State<'_, AppState>, qid: String, max_rows: u32)
  -> Result<PageChunk, AppErrPayload>
{
  let conn = state.conn_mgr.by_qid(&qid).await.map_err(to_payload)?;
  conn.adapter.fetch_page(&qid, max_rows).await.map_err(to_payload)
}
```

---

## 20) Testing & QA Harness

- **Unit tests**:

  - Crypto (encrypt/decrypt + rotation)
  - Safe Mode detectors (positive/negative cases)
  - Snapshot normalization & diff planner

- **Integration tests** (feature-gated, Docker or local):

  - PG 13–16, MySQL 5.7/8.0 (or MariaDB 10.6+), SQLite
  - Cursor paging (exhaustion condition), cancel, import/export 100k rows.

- **Chaos tests**:

  - Drop SSH mid-page → expect neat error + reconnect on next call.
  - Kill DB server mid-cursor → error mapping without panic.

---

## 21) Versioning & Compatibility

- **Command API**: bump **minor** when adding parameters/fields; bump **major** if breaking.
- Include `X-API-VERSION: 1` constant and expose `get_backend_version()`.

---

## 22) Future Extensions (non-blocking)

- Binary row mode for PG (higher throughput on numerics/JSON).
- SQL Server via `tiberius`.
- Secrets providers (1Password, AWS Secrets Manager).
- Job manager (background queue) for long imports/exports with resumable state.

---

### Appendix A — Safe Mode Detector (example)

```rust
pub fn safe_guard(profile: &ConnProfile, sql: &str) -> Result<(), AppError> {
  use SafePolicy::*;
  match profile.safe_mode {
    Off => Ok(()),
    _ => {
      let s = sql.to_ascii_lowercase();
      let destructive =
        s.contains("drop table") || s.contains("drop schema") || s.contains("drop database") ||
        s.contains("truncate");
      let dangerous_update =
        s.contains("update") && !s.contains(" where ");
      let dangerous_delete =
        s.contains("delete") && !s.contains(" where ");

      if destructive || dangerous_update || dangerous_delete {
        return Err(AppError::SafeBlocked);
      }
      Ok(())
    }
  }
}
```

(Production: wrap with `sqlparser-rs` to avoid false positives/negatives.)

---

### Appendix B — Example PG Snapshot Queries (compact)

- **Tables**

```sql
SELECT n.nspname AS schema, c.relname AS name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND c.relkind IN ('r','p','v','m'); -- table/partition/view/mview
```

- **Columns**

```sql
SELECT table_schema, table_name, column_name, is_nullable,
       data_type, column_default
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema');
```

- **Primary Keys**

```sql
SELECT n.nspname AS schema, c.relname AS table, a.attname AS col
FROM pg_index i
JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey)
WHERE i.indisprimary;
```

- **Foreign Keys**

```sql
SELECT
  sn.nspname AS schema, ct.relname AS table,
  array_agg(sa.attname ORDER BY u.attposition) AS from_cols,
  tn.nspname AS ref_schema, rt.relname AS ref_table,
  array_agg(ta.attname ORDER BY f.attposition) AS to_cols,
  confupdtype, confdeltype
FROM pg_constraint con
JOIN pg_class ct ON ct.oid = con.conrelid
JOIN pg_namespace sn ON sn.oid = ct.relnamespace
JOIN pg_class rt ON rt.oid = con.confrelid
JOIN pg_namespace tn ON tn.oid = rt.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
JOIN pg_attribute sa ON sa.attrelid=ct.oid AND sa.attnum=u.attnum
JOIN unnest(con.confkey) WITH ORDINALITY AS f(attnum, attposition) ON f.attposition=u.attposition
JOIN pg_attribute ta ON ta.attrelid=rt.oid AND ta.attnum=f.attnum
WHERE con.contype='f'
GROUP BY schema, table, ref_schema, ref_table, confupdtype, confdeltype;
```

- **Indexes**

```sql
SELECT
  ns.nspname AS schema, t.relname AS table, i.relname AS index,
  ix.indisunique AS unique,
  pg_get_indexdef(ix.indexrelid) AS def
FROM pg_index ix
JOIN pg_class t ON t.oid=ix.indrelid
JOIN pg_class i ON i.oid=ix.indexrelid
JOIN pg_namespace ns ON ns.oid=t.relnamespace
WHERE ns.nspname NOT IN ('pg_catalog','information_schema');
```

(Adapters convert raw rows → normalized `SchemaSnapshot`.)
