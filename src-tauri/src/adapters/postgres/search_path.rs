//! Shared helpers for applying per-query `search_path`.
//! See docs/superpowers/specs/2026-04-15-multi-schema-phase-1-foundation-design.md.

fn quote_identifier(identifier: &str) -> String {
    let clean = identifier.replace('\0', "");
    format!("\"{}\"", clean.replace('"', "\"\""))
}

/// Build `SET search_path TO "a", "b", ...` SQL. Returns empty string when list is empty.
pub fn build_set_search_path_sql(schemas: &[String]) -> String {
    if schemas.is_empty() {
        return String::new();
    }
    let quoted = schemas
        .iter()
        .map(|s| quote_identifier(s))
        .collect::<Vec<_>>()
        .join(", ");
    format!("SET search_path TO {}", quoted)
}

/// Always-cheap RESET. Idempotent.
pub const RESET_SEARCH_PATH_SQL: &str = "RESET search_path";
