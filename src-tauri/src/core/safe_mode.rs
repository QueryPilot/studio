//! Per-connection safe mode enforcement.
//!
//! Classifies operations by kind and checks whether the connection's safe mode
//! level permits them. All enforcement happens here in the Rust backend so the
//! frontend cannot bypass it.

use crate::commands::document::DocumentOperation;
use crate::commands::keyvalue::KeyValueOperation;
use crate::types::SafeMode;

/// The kind of operation being attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationKind {
    Read,
    Insert,
    Update,
    Delete,
    Ddl,
}

impl SafeMode {
    /// Returns `true` if this safe mode level permits the given operation kind.
    pub fn allows(&self, op: OperationKind) -> bool {
        match self {
            SafeMode::ReadOnly => matches!(op, OperationKind::Read),
            SafeMode::ReadWrite => matches!(op, OperationKind::Read | OperationKind::Insert),
            SafeMode::ReadWriteUpdate => matches!(
                op,
                OperationKind::Read | OperationKind::Insert | OperationKind::Update
            ),
            SafeMode::FullAccess => true,
        }
    }
}

/// Check whether the connection's safe mode allows the given operation.
/// Returns `Ok(())` if allowed, or an `Err(String)` suitable for returning
/// from a Tauri command.
pub fn check_safe_mode(
    safe_mode: Option<SafeMode>,
    kind: OperationKind,
    _description: &str,
) -> Result<(), String> {
    let mode = safe_mode.unwrap_or_default();
    if mode.allows(kind) {
        Ok(())
    } else {
        let mode_label = match mode {
            SafeMode::ReadOnly => "Read Only",
            SafeMode::ReadWrite => "Read + Write",
            SafeMode::ReadWriteUpdate => "Read + Write + Update",
            SafeMode::FullAccess => "Full Access",
        };
        let op_label = match kind {
            OperationKind::Read => "Read",
            OperationKind::Insert => "Insert",
            OperationKind::Update => "Update",
            OperationKind::Delete => "Delete",
            OperationKind::Ddl => "DDL",
        };
        Err(format!(
            "Blocked by Safe Mode ({}): {} operations are not allowed.",
            mode_label, op_label
        ))
    }
}

// ============================================================================
// SQL classification
// ============================================================================

/// Classify a SQL string into an `OperationKind`.
///
/// For multi-statement batches (e.g. `BEGIN; UPDATE …; COMMIT;`) every
/// statement is classified and the **most restrictive** kind is returned.
/// This prevents write operations from being smuggled inside transaction
/// wrappers that would otherwise classify as `Read`.
///
/// Uses a keyword-based approach: strips comments, finds the first significant
/// token, and maps it. For CTEs (`WITH …`) the *main* statement keyword is
/// used. Unknown / unparseable SQL is treated as `Ddl` (fail-safe).
pub fn classify_sql(sql: &str) -> OperationKind {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return OperationKind::Read; // empty query is harmless
    }

    // Strip line comments (-- …)
    let without_line_comments: String = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");

    // Strip block comments (/* … */)
    let cleaned = strip_block_comments(&without_line_comments);

    // Split on semicolons (aware of string literals) and classify each
    // statement, keeping the most restrictive result.
    let mut worst = OperationKind::Read;
    for stmt in split_statements(&cleaned) {
        let kind = classify_single_statement(&stmt);
        if severity(kind) > severity(worst) {
            worst = kind;
        }
    }

    worst
}

/// Split SQL on semicolons, skipping semicolons inside single-quoted strings
/// and PostgreSQL dollar-quoted strings (`$$…$$`, `$tag$…$tag$`).
fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        if c == '\'' {
            // Single-quoted string — consume until closing unescaped quote
            current.push(c);
            i += 1;
            while i < len {
                let sc = chars[i];
                current.push(sc);
                if sc == '\'' {
                    // Check for escaped quote ('')
                    if i + 1 < len && chars[i + 1] == '\'' {
                        current.push(chars[i + 1]);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
        } else if c == '$' {
            // Possible dollar-quoted string ($$ or $tag$)
            if let Some(tag_end) = find_dollar_tag(&chars, i) {
                let tag: String = chars[i..=tag_end].iter().collect();
                // Push the opening tag
                for &tc in &chars[i..=tag_end] {
                    current.push(tc);
                }
                i = tag_end + 1;
                // Consume until we find the matching closing tag
                while i < len {
                    if chars[i] == '$' {
                        if let Some(close_end) = find_dollar_tag(&chars, i) {
                            let close_tag: String = chars[i..=close_end].iter().collect();
                            if close_tag == tag {
                                for &tc in &chars[i..=close_end] {
                                    current.push(tc);
                                }
                                i = close_end + 1;
                                break;
                            }
                        }
                    }
                    current.push(chars[i]);
                    i += 1;
                }
            } else {
                current.push(c);
                i += 1;
            }
        } else if c == ';' {
            statements.push(std::mem::take(&mut current));
            i += 1;
        } else {
            current.push(c);
            i += 1;
        }
    }

    // Push any trailing content
    if !current.trim().is_empty() {
        statements.push(current);
    }

    statements
}

/// Try to find a dollar-quote tag starting at position `start`.
/// Returns the index of the closing `$` if found, or None.
/// Matches `$$` or `$identifier$`.
fn find_dollar_tag(chars: &[char], start: usize) -> Option<usize> {
    if start >= chars.len() || chars[start] != '$' {
        return None;
    }
    let mut i = start + 1;
    // $$ case
    if i < chars.len() && chars[i] == '$' {
        return Some(i);
    }
    // $tag$ case — tag must be [a-zA-Z_][a-zA-Z0-9_]*
    if i < chars.len() && (chars[i].is_ascii_alphabetic() || chars[i] == '_') {
        i += 1;
        while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
            i += 1;
        }
        if i < chars.len() && chars[i] == '$' {
            return Some(i);
        }
    }
    None
}

/// Classify a single SQL statement (no semicolons).
fn classify_single_statement(sql: &str) -> OperationKind {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return OperationKind::Read;
    }

    let mut words = trimmed.split_whitespace().filter(|w| !w.is_empty());
    let first_keyword = words.next().unwrap_or("").to_uppercase();

    // CTEs: look at the main statement after WITH … AS (…)
    if first_keyword == "WITH" {
        return find_main_statement_keyword_for_classify(trimmed)
            .map(|kw| keyword_to_op_kind(&kw))
            .unwrap_or(OperationKind::Ddl);
    }

    // EXPLAIN ANALYZE actually executes the statement on PostgreSQL/MySQL,
    // so classify based on the underlying statement, not as Read.
    if first_keyword == "EXPLAIN" {
        let second = words.next().unwrap_or("").to_uppercase();
        if second == "ANALYZE" || second == "ANALYSE" {
            // The underlying statement keyword follows ANALYZE
            let third = words.next().unwrap_or("").to_uppercase();
            return keyword_to_op_kind(&third);
        }
        // Also handle EXPLAIN (ANALYZE, ...) form — parenthesized options
        if second.starts_with('(') {
            let rest = trimmed.to_uppercase();
            if rest.contains("ANALYZE") || rest.contains("ANALYSE") {
                // Find the closing paren, then get the next keyword
                if let Some(paren_end) = trimmed.find(')') {
                    let after_opts = trimmed[paren_end + 1..].trim();
                    let underlying_keyword = after_opts
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_uppercase();
                    return keyword_to_op_kind(&underlying_keyword);
                }
            }
        }
        // Plain EXPLAIN (no ANALYZE) is always Read
        return OperationKind::Read;
    }

    keyword_to_op_kind(&first_keyword)
}

/// Numeric severity for comparing operation kinds.
/// Higher = more restrictive.
fn severity(kind: OperationKind) -> u8 {
    match kind {
        OperationKind::Read => 0,
        OperationKind::Insert => 1,
        OperationKind::Update => 2,
        OperationKind::Delete => 3,
        OperationKind::Ddl => 4,
    }
}

/// Map a SQL keyword to an OperationKind.
fn keyword_to_op_kind(keyword: &str) -> OperationKind {
    match keyword {
        "SELECT" | "EXPLAIN" | "SHOW" | "DESCRIBE" | "DESC" | "TABLE" | "VALUES" | "PRAGMA" => {
            OperationKind::Read
        }
        // Transaction control is Read (the statements inside are checked individually)
        "BEGIN" | "START" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" | "SET" => {
            OperationKind::Read
        }
        "INSERT" => OperationKind::Insert,
        "UPDATE" | "MERGE" => OperationKind::Update,
        "DELETE" => OperationKind::Delete,
        "CREATE" | "ALTER" | "DROP" | "TRUNCATE" | "GRANT" | "REVOKE" | "RENAME" | "COMMENT" => {
            OperationKind::Ddl
        }
        // Unknown → fail-safe to DDL (most restrictive non-read category)
        _ => OperationKind::Ddl,
    }
}

/// Strip block comments `/* … */` from SQL (non-nested).
fn strip_block_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next(); // consume '*'
                          // Skip until */
            loop {
                match chars.next() {
                    Some('*') if chars.peek() == Some(&'/') => {
                        chars.next();
                        break;
                    }
                    Some(_) => continue,
                    None => break,
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Find the main statement keyword in a CTE query (after `WITH … AS (…)`).
/// Same logic as `commands::sql::find_main_statement_keyword` but returns the
/// keyword for classify purposes.
fn find_main_statement_keyword_for_classify(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();
    let keywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "TABLE", "VALUES"];
    let mut first_keyword_pos: Option<(usize, &str)> = None;

    for keyword in &keywords {
        let mut search_start = 0;
        while let Some(pos) = upper[search_start..].find(keyword) {
            let abs_pos = search_start + pos;
            let before_ok = abs_pos == 0 || !upper.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let after_ok = abs_pos + keyword.len() >= upper.len()
                || !upper.as_bytes()[abs_pos + keyword.len()].is_ascii_alphanumeric();

            if before_ok && after_ok {
                let depth = sql[..abs_pos].chars().fold(0i32, |d, c| match c {
                    '(' => d + 1,
                    ')' => d - 1,
                    _ => d,
                });
                if depth == 0 {
                    if first_keyword_pos.map_or(true, |(p, _)| abs_pos < p) {
                        first_keyword_pos = Some((abs_pos, keyword));
                    }
                }
            }
            search_start = abs_pos + 1;
        }
    }

    first_keyword_pos.map(|(_, kw)| kw.to_string())
}

// ============================================================================
// Document operation classification
// ============================================================================

/// Classify a MongoDB aggregation pipeline by inspecting stages for writes.
///
/// Pipelines containing `$out` (replaces collection) or `$merge` (upserts into
/// a collection) are write operations. Everything else is Read.
pub fn classify_aggregation_pipeline(pipeline: &[serde_json::Value]) -> OperationKind {
    for stage in pipeline {
        if let Some(obj) = stage.as_object() {
            if obj.contains_key("$out") {
                return OperationKind::Ddl; // $out replaces the target collection
            }
            if obj.contains_key("$merge") {
                return OperationKind::Insert; // $merge upserts documents
            }
        }
    }
    OperationKind::Read
}

/// Classify a MongoDB `DocumentOperation` into an `OperationKind`.
pub fn classify_document_op(op: &DocumentOperation) -> OperationKind {
    match op {
        DocumentOperation::Find { .. }
        | DocumentOperation::FindPage { .. }
        | DocumentOperation::Aggregate { .. }
        | DocumentOperation::Count { .. }
        | DocumentOperation::SampleSchema { .. }
        | DocumentOperation::ListCollections => OperationKind::Read,

        DocumentOperation::Insert { .. } | DocumentOperation::InsertMany { .. } => {
            OperationKind::Insert
        }

        DocumentOperation::Update { .. } => OperationKind::Update,

        DocumentOperation::Delete { .. } => OperationKind::Delete,

        DocumentOperation::RunCommand { command } => classify_mongo_run_command(command),
    }
}

/// Classify a MongoDB `runCommand` by inspecting the first key of the command object.
///
/// Read-only commands (buildInfo, explain, serverStatus, etc.) are classified as
/// `Read` so they work in safe mode. Write/delete/admin commands are classified
/// appropriately. Unknown commands default to `Ddl` (fail-safe).
fn classify_mongo_run_command(command: &serde_json::Value) -> OperationKind {
    let cmd_name = command
        .as_object()
        .and_then(|obj| obj.keys().next())
        .map(|k| k.to_lowercase());

    match cmd_name.as_deref() {
        // Read-only / diagnostic
        Some(
            "buildinfo" | "explain" | "serverstatus" | "dbstats" | "collstats" | "connectionstatus"
            | "hostinfo" | "features" | "listcommands" | "ping" | "whatsmyuri" | "ismaster"
            | "hello" | "getlog" | "top" | "validate" | "datasize" | "count" | "distinct" | "find"
            | "aggregate" | "listcollections" | "listindexes" | "listdatabases" | "currentop"
            | "getmore" | "collmod" | "profile" | "replsetgetstatus" | "replsetgetconfig",
        ) => OperationKind::Read,

        // Insert
        Some("insert") => OperationKind::Insert,

        // Update
        Some("update" | "findandmodify") => OperationKind::Update,

        // Delete
        Some("delete") => OperationKind::Delete,

        // DDL / admin — drop, create, reIndex, etc.
        _ => OperationKind::Ddl,
    }
}

// ============================================================================
// Key-value operation classification
// ============================================================================

/// Classify a Redis `KeyValueOperation` into an `OperationKind`.
pub fn classify_keyvalue_op(op: &KeyValueOperation) -> OperationKind {
    match op {
        // Read operations
        KeyValueOperation::Get { .. }
        | KeyValueOperation::Exists { .. }
        | KeyValueOperation::Scan { .. }
        | KeyValueOperation::ScanWithPreviews { .. }
        | KeyValueOperation::Type { .. }
        | KeyValueOperation::Ttl { .. }
        | KeyValueOperation::DbSize
        | KeyValueOperation::SelectDb { .. }
        | KeyValueOperation::ServerInfo { .. }
        | KeyValueOperation::HashGetAll { .. }
        | KeyValueOperation::ListRange { .. }
        | KeyValueOperation::ListLen { .. }
        | KeyValueOperation::SetMembers { .. }
        | KeyValueOperation::ZSetRange { .. }
        | KeyValueOperation::StreamRange { .. }
        | KeyValueOperation::StreamLen { .. } => OperationKind::Read,

        // Write (insert) operations
        KeyValueOperation::Set { .. }
        | KeyValueOperation::HashSet { .. }
        | KeyValueOperation::ListPush { .. }
        | KeyValueOperation::SetAdd { .. }
        | KeyValueOperation::ZSetAdd { .. } => OperationKind::Insert,

        // Update operations
        KeyValueOperation::SetTtl { .. } => OperationKind::Update,

        // Delete operations
        KeyValueOperation::Delete { .. }
        | KeyValueOperation::HashDelete { .. }
        | KeyValueOperation::SetRemove { .. } => OperationKind::Delete,

        // Raw commands: sub-classify by command name
        KeyValueOperation::ExecuteRaw { command, .. } => classify_redis_raw_command(command),
    }
}

/// Classify a raw Redis command name into an `OperationKind`.
///
/// Read-only commands (INFO, GET, SCAN, etc.) are classified as `Read` so they
/// are permitted in safe mode. Write/delete/admin commands are classified
/// appropriately. Unknown commands default to `Ddl` (fail-safe).
fn classify_redis_raw_command(command: &str) -> OperationKind {
    match command.to_ascii_uppercase().as_str() {
        // Read-only
        "PING"
        | "ECHO"
        | "INFO"
        | "DBSIZE"
        | "TIME"
        | "COMMAND"
        | "GET"
        | "MGET"
        | "KEYS"
        | "SCAN"
        | "RANDOMKEY"
        | "OBJECT"
        | "TYPE"
        | "TTL"
        | "PTTL"
        | "EXISTS"
        | "STRLEN"
        | "DUMP"
        | "HGET"
        | "HMGET"
        | "HGETALL"
        | "HKEYS"
        | "HVALS"
        | "HLEN"
        | "HEXISTS"
        | "HSCAN"
        | "LRANGE"
        | "LLEN"
        | "LINDEX"
        | "LPOS"
        | "SMEMBERS"
        | "SCARD"
        | "SISMEMBER"
        | "SMISMEMBER"
        | "SRANDMEMBER"
        | "SSCAN"
        | "ZRANGE"
        | "ZRANGEBYSCORE"
        | "ZRANGEBYLEX"
        | "ZREVRANGE"
        | "ZREVRANGEBYSCORE"
        | "ZCARD"
        | "ZSCORE"
        | "ZMSCORE"
        | "ZRANK"
        | "ZREVRANK"
        | "ZCOUNT"
        | "ZLEXCOUNT"
        | "ZSCAN"
        | "XLEN"
        | "XRANGE"
        | "XREVRANGE"
        | "XINFO"
        | "XREAD"
        | "XPENDING"
        | "MEMORY"
        | "CLUSTER"
        | "LATENCY"
        | "GEORADIUS_RO"
        | "GEORADIUSBYMEMBER_RO"
        | "GEOSEARCH"
        | "GEOPOS"
        | "GEODIST"
        | "PFCOUNT"
        | "BITCOUNT"
        | "BITPOS"
        | "GETBIT"
        | "GETRANGE"
        | "PUBSUB"
        | "SUBSCRIBE"
        | "PSUBSCRIBE"
        | "SSUBSCRIBE" => OperationKind::Read,

        // Write/insert
        "SET" | "MSET" | "MSETNX" | "SETNX" | "SETEX" | "PSETEX" | "APPEND" | "INCR" | "INCRBY"
        | "INCRBYFLOAT" | "DECR" | "DECRBY" | "SETRANGE" | "SETBIT" | "HSET" | "HMSET"
        | "HSETNX" | "HINCRBY" | "HINCRBYFLOAT" | "LPUSH" | "LPUSHX" | "RPUSH" | "RPUSHX"
        | "LSET" | "LINSERT" | "SADD" | "SMOVE" | "SUNIONSTORE" | "SINTERSTORE" | "SDIFFSTORE"
        | "ZADD" | "ZINCRBY" | "ZUNIONSTORE" | "ZINTERSTORE" | "ZDIFFSTORE" | "XADD" | "XGROUP"
        | "XCLAIM" | "XAUTOCLAIM" | "XACK" | "GEOADD" | "PFADD" | "PFMERGE" | "COPY"
        | "PUBLISH" | "RPOPLPUSH" | "LMOVE" | "BRPOPLPUSH" | "BLMOVE" => OperationKind::Insert,

        // Update (TTL/expiry/rename)
        // SORT is read-only without STORE, but we can't inspect args here
        "EXPIRE" | "PEXPIRE" | "EXPIREAT" | "PEXPIREAT" | "PERSIST" | "RENAME" | "RENAMENX"
        | "SORT" | "MOVE" | "GETSET" => OperationKind::Update,

        // Delete
        "DEL" | "UNLINK" | "GETDEL" | "HDEL" | "LPOP" | "RPOP" | "BLPOP" | "BRPOP" | "LREM"
        | "LTRIM" | "SREM" | "SPOP" | "ZREM" | "ZREMRANGEBYSCORE" | "ZREMRANGEBYRANK"
        | "ZREMRANGEBYLEX" | "ZPOPMIN" | "ZPOPMAX" | "XTRIM" | "XDEL" | "UNSUBSCRIBE"
        | "PUNSUBSCRIBE" => OperationKind::Delete,

        // DDL / dangerous — includes compound commands with destructive subcommands
        // (CONFIG SET, CLIENT KILL, SLOWLOG RESET) that we can't distinguish here
        "CONFIG" | "CLIENT" | "SLOWLOG" | "FLUSHDB" | "FLUSHALL" | "SWAPDB" | "DEBUG"
        | "SHUTDOWN" | "BGSAVE" | "BGREWRITEAOF" | "SCRIPT" | "EVAL" | "EVALSHA" | "MODULE"
        | "ACL" | "REPLICAOF" | "SLAVEOF" | "FAILOVER" | "WAIT" | "RESET" => OperationKind::Ddl,

        // Unknown commands default to DDL (fail-safe)
        _ => OperationKind::Ddl,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- SafeMode::allows ----

    #[test]
    fn test_read_only_allows() {
        let m = SafeMode::ReadOnly;
        assert!(m.allows(OperationKind::Read));
        assert!(!m.allows(OperationKind::Insert));
        assert!(!m.allows(OperationKind::Update));
        assert!(!m.allows(OperationKind::Delete));
        assert!(!m.allows(OperationKind::Ddl));
    }

    #[test]
    fn test_read_write_allows() {
        let m = SafeMode::ReadWrite;
        assert!(m.allows(OperationKind::Read));
        assert!(m.allows(OperationKind::Insert));
        assert!(!m.allows(OperationKind::Update));
        assert!(!m.allows(OperationKind::Delete));
        assert!(!m.allows(OperationKind::Ddl));
    }

    #[test]
    fn test_read_write_update_allows() {
        let m = SafeMode::ReadWriteUpdate;
        assert!(m.allows(OperationKind::Read));
        assert!(m.allows(OperationKind::Insert));
        assert!(m.allows(OperationKind::Update));
        assert!(!m.allows(OperationKind::Delete));
        assert!(!m.allows(OperationKind::Ddl));
    }

    #[test]
    fn test_full_access_allows() {
        let m = SafeMode::FullAccess;
        assert!(m.allows(OperationKind::Read));
        assert!(m.allows(OperationKind::Insert));
        assert!(m.allows(OperationKind::Update));
        assert!(m.allows(OperationKind::Delete));
        assert!(m.allows(OperationKind::Ddl));
    }

    // ---- classify_sql ----

    #[test]
    fn test_classify_select() {
        assert_eq!(classify_sql("SELECT * FROM users"), OperationKind::Read);
        assert_eq!(classify_sql("  select 1"), OperationKind::Read);
    }

    #[test]
    fn test_classify_explain() {
        assert_eq!(
            classify_sql("EXPLAIN SELECT * FROM users"),
            OperationKind::Read
        );
        assert_eq!(
            classify_sql("EXPLAIN DELETE FROM users"),
            OperationKind::Read
        );
    }

    #[test]
    fn test_classify_show() {
        assert_eq!(classify_sql("SHOW TABLES"), OperationKind::Read);
        assert_eq!(classify_sql("DESCRIBE users"), OperationKind::Read);
    }

    #[test]
    fn test_classify_insert() {
        assert_eq!(
            classify_sql("INSERT INTO users (name) VALUES ('a')"),
            OperationKind::Insert
        );
    }

    #[test]
    fn test_classify_update() {
        assert_eq!(
            classify_sql("UPDATE users SET name = 'b'"),
            OperationKind::Update
        );
    }

    #[test]
    fn test_classify_delete() {
        assert_eq!(
            classify_sql("DELETE FROM users WHERE id = 1"),
            OperationKind::Delete
        );
    }

    #[test]
    fn test_classify_ddl() {
        assert_eq!(classify_sql("CREATE TABLE t (id INT)"), OperationKind::Ddl);
        assert_eq!(classify_sql("DROP TABLE t"), OperationKind::Ddl);
        assert_eq!(
            classify_sql("ALTER TABLE t ADD COLUMN c INT"),
            OperationKind::Ddl
        );
        assert_eq!(classify_sql("TRUNCATE TABLE t"), OperationKind::Ddl);
    }

    #[test]
    fn test_classify_cte_select() {
        assert_eq!(
            classify_sql("WITH cte AS (SELECT 1) SELECT * FROM cte"),
            OperationKind::Read
        );
    }

    #[test]
    fn test_classify_cte_delete() {
        assert_eq!(
            classify_sql("WITH cte AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM cte)"),
            OperationKind::Delete
        );
    }

    #[test]
    fn test_classify_with_comments() {
        assert_eq!(classify_sql("-- comment\nSELECT 1"), OperationKind::Read);
        assert_eq!(
            classify_sql("/* block */ INSERT INTO t VALUES (1)"),
            OperationKind::Insert
        );
    }

    #[test]
    fn test_classify_transaction_control() {
        assert_eq!(classify_sql("BEGIN"), OperationKind::Read);
        assert_eq!(classify_sql("COMMIT"), OperationKind::Read);
        assert_eq!(classify_sql("ROLLBACK"), OperationKind::Read);
    }

    #[test]
    fn test_classify_unknown_is_ddl() {
        assert_eq!(classify_sql("VACUUM"), OperationKind::Ddl);
    }

    // ---- Multi-statement batch classification ----

    #[test]
    fn test_classify_batch_begin_update_commit() {
        // This is exactly what CRUD executor sends
        let sql = "BEGIN;\nUPDATE \"public\".\"categories\" SET \"name\" = 'test' WHERE \"id\" = 1 RETURNING *;\nCOMMIT;";
        assert_eq!(classify_sql(sql), OperationKind::Update);
    }

    #[test]
    fn test_classify_batch_begin_insert_commit() {
        let sql = "BEGIN; INSERT INTO users (name) VALUES ('a'); COMMIT;";
        assert_eq!(classify_sql(sql), OperationKind::Insert);
    }

    #[test]
    fn test_classify_batch_begin_delete_commit() {
        let sql = "BEGIN; DELETE FROM users WHERE id = 1; COMMIT;";
        assert_eq!(classify_sql(sql), OperationKind::Delete);
    }

    #[test]
    fn test_classify_batch_multiple_writes_returns_worst() {
        let sql = "BEGIN; INSERT INTO t VALUES (1); DELETE FROM t WHERE id = 2; COMMIT;";
        assert_eq!(classify_sql(sql), OperationKind::Delete);
    }

    #[test]
    fn test_classify_batch_only_reads() {
        let sql = "BEGIN; SELECT 1; SELECT 2; COMMIT;";
        assert_eq!(classify_sql(sql), OperationKind::Read);
    }

    // ---- check_safe_mode ----

    #[test]
    fn test_check_safe_mode_none_defaults_full() {
        assert!(check_safe_mode(None, OperationKind::Ddl, "DDL").is_ok());
    }

    #[test]
    fn test_check_safe_mode_blocks() {
        let result = check_safe_mode(Some(SafeMode::ReadOnly), OperationKind::Insert, "INSERT");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("Blocked by Safe Mode"));
        assert!(msg.contains("Read Only"));
        assert!(msg.contains("Insert"));
        assert!(!msg.contains("{")); // no debug formatting leaking through
    }

    // ---- classify_document_op ----

    #[test]
    fn test_classify_document_find() {
        let op = DocumentOperation::Find {
            collection: "test".into(),
            filter: serde_json::json!({}),
            options: Default::default(),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Read);
    }

    #[test]
    fn test_classify_document_insert() {
        let op = DocumentOperation::Insert {
            collection: "test".into(),
            document: serde_json::json!({}),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Insert);
    }

    #[test]
    fn test_classify_document_delete() {
        let op = DocumentOperation::Delete {
            collection: "test".into(),
            filter: serde_json::json!({}),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Delete);
    }

    // ---- classify_document_op: RunCommand sub-classification ----

    #[test]
    fn test_classify_document_run_command_read() {
        for cmd_name in [
            "buildInfo",
            "explain",
            "serverStatus",
            "dbStats",
            "collStats",
            "ping",
            "listCollections",
            "count",
            "find",
        ] {
            let op = DocumentOperation::RunCommand {
                command: serde_json::json!({ cmd_name: 1 }),
            };
            assert_eq!(
                classify_document_op(&op),
                OperationKind::Read,
                "Expected Read for {}",
                cmd_name
            );
        }
    }

    #[test]
    fn test_classify_document_run_command_insert() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "insert": "users", "documents": [{"name": "test"}] }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Insert);
    }

    #[test]
    fn test_classify_document_run_command_update() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "update": "users", "updates": [] }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Update);
    }

    #[test]
    fn test_classify_document_run_command_findandmodify() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "findAndModify": "users", "query": {}, "update": {} }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Update);
    }

    #[test]
    fn test_classify_document_run_command_delete() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "delete": "users", "deletes": [] }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Delete);
    }

    #[test]
    fn test_classify_document_run_command_ddl() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "dropDatabase": 1 }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Ddl);
    }

    #[test]
    fn test_classify_document_run_command_unknown_is_ddl() {
        let op = DocumentOperation::RunCommand {
            command: serde_json::json!({ "customCommand": 1 }),
        };
        assert_eq!(classify_document_op(&op), OperationKind::Ddl);
    }

    // ---- classify_keyvalue_op ----

    #[test]
    fn test_classify_kv_get() {
        let op = KeyValueOperation::Get { key: "k".into() };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Read);
    }

    #[test]
    fn test_classify_kv_set() {
        let op = KeyValueOperation::Set {
            key: "k".into(),
            value: crate::core::capabilities::RedisValue::String("v".into()),
            options: Default::default(),
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Insert);
    }

    #[test]
    fn test_classify_kv_delete() {
        let op = KeyValueOperation::Delete {
            keys: vec!["k".into()],
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Delete);
    }

    #[test]
    fn test_classify_kv_set_ttl() {
        let op = KeyValueOperation::SetTtl {
            key: "k".into(),
            seconds: 60,
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Update);
    }

    #[test]
    fn test_classify_kv_execute_raw_ddl() {
        let op = KeyValueOperation::ExecuteRaw {
            command: "FLUSHALL".into(),
            args: vec![],
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Ddl);
    }

    #[test]
    fn test_classify_kv_execute_raw_read() {
        for cmd in [
            "INFO", "DBSIZE", "PING", "GET", "SCAN", "KEYS", "HGETALL", "LRANGE", "SMEMBERS",
            "ZRANGE",
        ] {
            let op = KeyValueOperation::ExecuteRaw {
                command: cmd.into(),
                args: vec![],
            };
            assert_eq!(
                classify_keyvalue_op(&op),
                OperationKind::Read,
                "Expected Read for {}",
                cmd
            );
        }
    }

    #[test]
    fn test_classify_kv_execute_raw_read_case_insensitive() {
        let op = KeyValueOperation::ExecuteRaw {
            command: "info".into(),
            args: vec![],
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Read);
    }

    #[test]
    fn test_classify_kv_execute_raw_insert() {
        for cmd in ["SET", "HSET", "LPUSH", "SADD", "ZADD", "XADD"] {
            let op = KeyValueOperation::ExecuteRaw {
                command: cmd.into(),
                args: vec![],
            };
            assert_eq!(
                classify_keyvalue_op(&op),
                OperationKind::Insert,
                "Expected Insert for {}",
                cmd
            );
        }
    }

    #[test]
    fn test_classify_kv_execute_raw_update() {
        for cmd in ["EXPIRE", "RENAME", "PERSIST"] {
            let op = KeyValueOperation::ExecuteRaw {
                command: cmd.into(),
                args: vec![],
            };
            assert_eq!(
                classify_keyvalue_op(&op),
                OperationKind::Update,
                "Expected Update for {}",
                cmd
            );
        }
    }

    #[test]
    fn test_classify_kv_execute_raw_delete() {
        for cmd in ["DEL", "UNLINK", "HDEL", "LPOP", "SREM", "ZREM"] {
            let op = KeyValueOperation::ExecuteRaw {
                command: cmd.into(),
                args: vec![],
            };
            assert_eq!(
                classify_keyvalue_op(&op),
                OperationKind::Delete,
                "Expected Delete for {}",
                cmd
            );
        }
    }

    #[test]
    fn test_classify_kv_execute_raw_unknown_is_ddl() {
        let op = KeyValueOperation::ExecuteRaw {
            command: "CUSTOMCMD".into(),
            args: vec![],
        };
        assert_eq!(classify_keyvalue_op(&op), OperationKind::Ddl);
    }

    // ---- EXPLAIN ANALYZE ----

    #[test]
    fn test_classify_explain_analyze_delete() {
        assert_eq!(
            classify_sql("EXPLAIN ANALYZE DELETE FROM users WHERE id = 1"),
            OperationKind::Delete
        );
    }

    #[test]
    fn test_classify_explain_analyze_update() {
        assert_eq!(
            classify_sql("EXPLAIN ANALYZE UPDATE users SET name = 'x'"),
            OperationKind::Update
        );
    }

    #[test]
    fn test_classify_explain_analyze_select() {
        assert_eq!(
            classify_sql("EXPLAIN ANALYZE SELECT * FROM users"),
            OperationKind::Read
        );
    }

    #[test]
    fn test_classify_explain_parenthesized_analyze() {
        // PostgreSQL format: EXPLAIN (ANALYZE, FORMAT TEXT) DELETE FROM users
        assert_eq!(
            classify_sql("EXPLAIN (ANALYZE, FORMAT TEXT) DELETE FROM users"),
            OperationKind::Delete
        );
    }

    #[test]
    fn test_classify_plain_explain_delete_is_read() {
        // Plain EXPLAIN without ANALYZE does not execute the statement
        assert_eq!(
            classify_sql("EXPLAIN DELETE FROM users"),
            OperationKind::Read
        );
    }

    // ---- String-literal-aware splitting ----

    #[test]
    fn test_semicolon_inside_string_literal() {
        // Semicolon inside a string should NOT split — this is a single SELECT
        let sql = "SELECT 'a;b' FROM users";
        assert_eq!(classify_sql(sql), OperationKind::Read);
    }

    #[test]
    fn test_semicolon_inside_dollar_quoted_string() {
        // PostgreSQL dollar-quoted string
        let sql = "SELECT $$hello; world$$ FROM t";
        assert_eq!(classify_sql(sql), OperationKind::Read);
    }

    #[test]
    fn test_semicolon_inside_tagged_dollar_quote() {
        let sql = "SELECT $tag$hello; world$tag$ FROM t";
        assert_eq!(classify_sql(sql), OperationKind::Read);
    }

    #[test]
    fn test_escaped_single_quote() {
        let sql = "SELECT 'it''s ; tricky' FROM t";
        assert_eq!(classify_sql(sql), OperationKind::Read);
    }

    // ---- Aggregation pipeline classification ----

    #[test]
    fn test_classify_pipeline_read() {
        let pipeline = vec![
            serde_json::json!({"$match": {"status": "active"}}),
            serde_json::json!({"$group": {"_id": "$type"}}),
        ];
        assert_eq!(
            classify_aggregation_pipeline(&pipeline),
            OperationKind::Read
        );
    }

    #[test]
    fn test_classify_pipeline_out() {
        let pipeline = vec![
            serde_json::json!({"$match": {"status": "active"}}),
            serde_json::json!({"$out": "results"}),
        ];
        assert_eq!(classify_aggregation_pipeline(&pipeline), OperationKind::Ddl);
    }

    #[test]
    fn test_classify_pipeline_merge() {
        let pipeline = vec![
            serde_json::json!({"$match": {"status": "active"}}),
            serde_json::json!({"$merge": {"into": "results"}}),
        ];
        assert_eq!(
            classify_aggregation_pipeline(&pipeline),
            OperationKind::Insert
        );
    }
}
