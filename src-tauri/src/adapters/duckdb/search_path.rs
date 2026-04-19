//! DuckDB-specific `SET search_path` helper.
//!
//! DuckDB requires a single scalar string value, not the Postgres-style
//! identifier list. `SET search_path TO "a", "b"` returns
//! "SET needs a single scalar value parameter".

/// Build `SET search_path = 'a,b,...'` SQL. Returns empty string when list is empty.
pub fn build_set_search_path_sql(schemas: &[String]) -> String {
    if schemas.is_empty() {
        return String::new();
    }
    let joined = schemas
        .iter()
        .map(|s| s.replace('\0', "").replace('\'', "''"))
        .collect::<Vec<_>>()
        .join(",");
    format!("SET search_path = '{}'", joined)
}
