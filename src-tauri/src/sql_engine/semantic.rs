//! Semantic analysis for SQL validation.
//!
//! Validates SQL against schema metadata.

use super::parser::{ParsedStatement, TableReference};
use super::schema_store::CachedSchema;
use super::validator::{ErrorSeverity, ErrorSource, SqlError};
use std::collections::{HashMap, HashSet};

fn normalize_table_name(name: &str) -> String {
    name.rsplit('.')
        .next()
        .unwrap_or(name)
        .trim_matches('"')
        .to_string()
}

fn resolve_table_name_in_statement(stmt: &ParsedStatement, qualifier: &str) -> String {
    let normalized = normalize_table_name(qualifier);

    if let Some(alias) = stmt
        .aliases
        .iter()
        .find(|a| a.alias.eq_ignore_ascii_case(&normalized))
    {
        return normalize_table_name(&alias.table);
    }

    if let Some(table_ref) = stmt.tables.iter().find(|t| {
        t.alias
            .as_ref()
            .map(|a| a.eq_ignore_ascii_case(&normalized))
            .unwrap_or(false)
            || t.name.eq_ignore_ascii_case(&normalized)
    }) {
        return table_ref.name.clone();
    }

    normalized
}

fn get_existing_statement_tables(stmt: &ParsedStatement, schema: &CachedSchema) -> Vec<String> {
    let mut seen = HashSet::new();
    let cte_names: HashSet<String> = stmt.ctes.iter().map(|c| c.name.to_lowercase()).collect();

    stmt.tables
        .iter()
        .filter_map(|t| {
            if cte_names.contains(&t.name.to_lowercase()) {
                return None;
            }
            let normalized = normalize_table_name(&t.name);
            let key = normalized.to_lowercase();
            if seen.contains(&key) {
                return None;
            }
            if table_exists(&normalized, schema) {
                seen.insert(key);
                Some(normalized)
            } else {
                None
            }
        })
        .collect()
}

fn loaded_schema_names(schema: &CachedSchema) -> HashSet<String> {
    schema
        .tables
        .iter()
        .filter_map(|t| t.schema.as_ref())
        .map(|name| name.to_lowercase())
        .collect()
}

fn is_reference_outside_loaded_schemas(table_ref: &TableReference, schema: &CachedSchema) -> bool {
    // 3-part catalog.schema.table references are always treated as out-of-scope:
    // we can't validate cross-catalog references without loading all catalog schemas.
    if table_ref.catalog.is_some() {
        return true;
    }

    let Some(ref_schema) = table_ref.schema.as_ref() else {
        return false;
    };

    let loaded = loaded_schema_names(schema);
    if loaded.is_empty() {
        return false;
    }

    !loaded.contains(&ref_schema.to_lowercase())
}

fn is_identifier_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'"'
}

fn find_identifier_span(stmt: &ParsedStatement, identifier: &str) -> Option<(usize, usize)> {
    if identifier.is_empty() {
        return None;
    }

    let text_lower = stmt.text.to_lowercase();
    let needle_lower = identifier.to_lowercase();
    let mut search_from = 0usize;

    while search_from <= text_lower.len() {
        let rel_idx = text_lower[search_from..].find(&needle_lower)?;
        let idx = search_from + rel_idx;
        let end = idx + needle_lower.len();
        let bytes = text_lower.as_bytes();

        let before_ok = if idx == 0 {
            true
        } else {
            !is_identifier_char(bytes[idx - 1])
        };
        let after_ok = if end >= bytes.len() {
            true
        } else {
            !is_identifier_char(bytes[end])
        };

        if before_ok && after_ok {
            return Some((stmt.range.0 + idx, stmt.range.0 + end));
        }

        search_from = if idx >= text_lower.len() {
            text_lower.len()
        } else {
            text_lower[idx..]
                .char_indices()
                .nth(1)
                .map(|(offset, _)| idx + offset)
                .unwrap_or(text_lower.len())
        };
    }

    None
}

fn find_reference_span(stmt: &ParsedStatement, candidates: &[String]) -> Option<(usize, usize)> {
    for candidate in candidates {
        if let Some(span) = find_identifier_span(stmt, candidate) {
            return Some(span);
        }

        // Try quoted variant (common for case-sensitive identifiers)
        if !candidate.starts_with('"') && !candidate.ends_with('"') {
            let quoted = format!("\"{}\"", candidate);
            if let Some(span) = find_identifier_span(stmt, &quoted) {
                return Some(span);
            }
        }
    }

    None
}

fn cte_column_exists(columns: &[String], column_name: &str) -> bool {
    columns
        .iter()
        .any(|col| col.eq_ignore_ascii_case(column_name))
}

fn suggest_similar_cte_columns(column_name: &str, columns: &[String]) -> Vec<String> {
    let column_lower = column_name.to_lowercase();

    columns
        .iter()
        .filter(|candidate| {
            let candidate_lower = candidate.to_lowercase();
            candidate_lower.contains(&column_lower)
                || column_lower.contains(&candidate_lower)
                || levenshtein_distance(&column_lower, &candidate_lower) <= 2
        })
        .take(5)
        .cloned()
        .collect()
}

/// Check if a table exists in the schema.
pub fn table_exists(table_name: &str, schema: &CachedSchema) -> bool {
    schema
        .tables
        .iter()
        .any(|t| t.name.to_lowercase() == table_name.to_lowercase())
}

/// Check if a column exists in a table.
pub fn column_exists(table_name: &str, column_name: &str, schema: &CachedSchema) -> bool {
    if let Some(columns) = schema.get_columns(table_name) {
        columns
            .iter()
            .any(|c| c.name.to_lowercase() == column_name.to_lowercase())
    } else {
        false
    }
}

/// Validate table references in a statement.
pub fn validate_table_references(stmt: &ParsedStatement, schema: &CachedSchema) -> Vec<SqlError> {
    let mut errors = Vec::new();

    for table_ref in &stmt.tables {
        // When schema cache is scoped to a schema (for example `public`), references to
        // other explicit schemas (for example `pg_catalog.*`) are out-of-scope for strict
        // existence checks and should not be flagged as missing.
        if is_reference_outside_loaded_schemas(table_ref, schema) {
            continue;
        }

        // Skip if it's a CTE reference
        if stmt
            .ctes
            .iter()
            .any(|c| c.name.to_lowercase() == table_ref.name.to_lowercase())
        {
            continue;
        }

        // Skip if it's an alias (subquery result)
        if stmt
            .aliases
            .iter()
            .any(|a| a.alias.to_lowercase() == table_ref.name.to_lowercase())
        {
            continue;
        }

        let normalized = normalize_table_name(&table_ref.name);
        if !table_exists(&normalized, schema) {
            let span = find_reference_span(stmt, &[table_ref.name.clone(), normalized.clone()])
                .unwrap_or((stmt.range.0, stmt.range.1));
            let suggestions = suggest_similar_tables(&normalized, schema);
            let message = if let Some(suggestion) = suggestions.first() {
                format!(
                    "Table '{}' does not exist. Did you mean '{}'?",
                    table_ref.name, suggestion
                )
            } else {
                format!("Table '{}' does not exist", table_ref.name)
            };

            errors.push(SqlError {
                from: span.0,
                to: span.1,
                message,
                severity: ErrorSeverity::Error,
                source: ErrorSource::Semantic,
            });
        }
    }

    errors
}

/// Validate column references in a statement.
pub fn validate_column_references(stmt: &ParsedStatement, schema: &CachedSchema) -> Vec<SqlError> {
    let mut errors = Vec::new();
    let existing_tables = get_existing_statement_tables(stmt, schema);
    let cte_names: HashSet<String> = stmt.ctes.iter().map(|c| c.name.to_lowercase()).collect();
    let cte_columns_by_name: HashMap<String, Vec<String>> = stmt
        .ctes
        .iter()
        .filter(|cte| !cte.columns.is_empty())
        .map(|cte| (cte.name.to_lowercase(), cte.columns.clone()))
        .collect();
    let referenced_ctes: HashSet<String> = stmt
        .tables
        .iter()
        .map(|table_ref| normalize_table_name(&table_ref.name).to_lowercase())
        .filter(|table_name| cte_names.contains(table_name))
        .collect();
    let has_unknown_referenced_cte_columns = referenced_ctes
        .iter()
        .any(|cte_name| !cte_columns_by_name.contains_key(cte_name));
    let output_aliases: HashSet<String> = stmt
        .output_aliases
        .iter()
        .map(|alias| alias.to_lowercase())
        .collect();

    for col_ref in &stmt.columns {
        if col_ref.name == "*" {
            continue;
        }

        if let Some(table) = &col_ref.table {
            let actual_table = resolve_table_name_in_statement(stmt, table);
            let actual_table_lower = actual_table.to_lowercase();

            // Check CTE first
            if cte_names.contains(&actual_table_lower) {
                let Some(cte_columns) = cte_columns_by_name.get(&actual_table_lower) else {
                    // CTE output columns are unknown (for example wildcard expansion).
                    continue;
                };

                if !cte_column_exists(cte_columns, &col_ref.name) {
                    let span = find_reference_span(
                        stmt,
                        &[format!("{}.{}", table, col_ref.name), col_ref.name.clone()],
                    )
                    .unwrap_or((stmt.range.0, stmt.range.1));
                    let suggestions = suggest_similar_cte_columns(&col_ref.name, cte_columns);
                    let message = if let Some(suggestion) = suggestions.first() {
                        format!(
                            "Column '{}' does not exist in CTE '{}'. Did you mean '{}'?",
                            col_ref.name, actual_table, suggestion
                        )
                    } else {
                        format!(
                            "Column '{}' does not exist in CTE '{}'",
                            col_ref.name, actual_table
                        )
                    };

                    errors.push(SqlError {
                        from: span.0,
                        to: span.1,
                        message,
                        severity: ErrorSeverity::Error,
                        source: ErrorSource::Semantic,
                    });
                }

                continue;
            }

            // If the table itself doesn't exist, table validation will report it.
            if !table_exists(&actual_table, schema) {
                continue;
            }

            if !column_exists(&actual_table, &col_ref.name, schema) {
                let span = find_reference_span(
                    stmt,
                    &[format!("{}.{}", table, col_ref.name), col_ref.name.clone()],
                )
                .unwrap_or((stmt.range.0, stmt.range.1));
                let suggestions = suggest_similar_columns(&col_ref.name, &actual_table, schema);
                let message = if let Some(suggestion) = suggestions.first() {
                    format!(
                        "Column '{}' does not exist in table '{}'. Did you mean '{}'?",
                        col_ref.name, actual_table, suggestion
                    )
                } else {
                    format!(
                        "Column '{}' does not exist in table '{}'",
                        col_ref.name, actual_table
                    )
                };

                errors.push(SqlError {
                    from: span.0,
                    to: span.1,
                    message,
                    severity: ErrorSeverity::Error,
                    source: ErrorSource::Semantic,
                });
            }
        } else {
            if output_aliases.contains(&col_ref.name.to_lowercase()) {
                continue;
            }

            if existing_tables.is_empty() && referenced_ctes.is_empty() {
                continue;
            }

            let exists_in_any_table = existing_tables
                .iter()
                .any(|table| column_exists(table, &col_ref.name, schema));
            let exists_in_any_cte = referenced_ctes.iter().any(|cte_name| {
                cte_columns_by_name
                    .get(cte_name)
                    .map(|columns| cte_column_exists(columns, &col_ref.name))
                    .unwrap_or(false)
            });

            if !exists_in_any_table && !exists_in_any_cte {
                // Unknown CTE projections (for example SELECT *) could still provide this column.
                if has_unknown_referenced_cte_columns {
                    continue;
                }

                let span = find_reference_span(stmt, std::slice::from_ref(&col_ref.name))
                    .unwrap_or((stmt.range.0, stmt.range.1));
                let message = if referenced_ctes.is_empty() {
                    format!(
                        "Column '{}' does not exist in any referenced table",
                        col_ref.name
                    )
                } else {
                    format!(
                        "Column '{}' does not exist in any referenced table or CTE",
                        col_ref.name
                    )
                };

                errors.push(SqlError {
                    from: span.0,
                    to: span.1,
                    message,
                    severity: ErrorSeverity::Error,
                    source: ErrorSource::Semantic,
                });
            }
        }
    }

    errors
}

/// Get suggestions for similar table names (fuzzy matching).
pub fn suggest_similar_tables(name: &str, schema: &CachedSchema) -> Vec<String> {
    let name_lower = name.to_lowercase();

    schema
        .tables
        .iter()
        .filter(|t| {
            let t_lower = t.name.to_lowercase();
            // Simple fuzzy match: contains or starts with
            t_lower.contains(&name_lower)
                || name_lower.contains(&t_lower)
                || levenshtein_distance(&name_lower, &t_lower) <= 2
        })
        .take(5)
        .map(|t| t.name.clone())
        .collect()
}

/// Get suggestions for similar column names.
pub fn suggest_similar_columns(
    column_name: &str,
    table_name: &str,
    schema: &CachedSchema,
) -> Vec<String> {
    let col_lower = column_name.to_lowercase();

    if let Some(columns) = schema.get_columns(table_name) {
        columns
            .iter()
            .filter(|c| {
                let c_lower = c.name.to_lowercase();
                c_lower.contains(&col_lower)
                    || col_lower.contains(&c_lower)
                    || levenshtein_distance(&col_lower, &c_lower) <= 2
            })
            .take(5)
            .map(|c| c.name.clone())
            .collect()
    } else {
        Vec::new()
    }
}

/// Simple Levenshtein distance for fuzzy matching.
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let m = a_chars.len();
    let n = b_chars.len();

    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }

    let mut dp = vec![vec![0; n + 1]; m + 1];

    for (i, row) in dp.iter_mut().enumerate().take(m + 1) {
        row[0] = i;
    }
    for (j, val) in dp[0].iter_mut().enumerate().take(n + 1) {
        *val = j;
    }

    for i in 1..=m {
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }

    dp[m][n]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql_engine::schema_store::{CachedSchemaBuilder, ColumnInfo, TableInfo, TableType};
    use crate::sql_engine::{SqlDialect, parse_document};

    fn test_schema() -> CachedSchema {
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "users".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_table(TableInfo {
                name: "orders".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();

        schema.columns.insert(
            "users".to_string(),
            vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: true,
                    is_unique: true,
                    comment: None,
                    enum_values: None,
                    ordinal: 1,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "name".to_string(),
                    data_type: "varchar".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 2,
                    precision: None,
                    scale: None,
                },
            ],
        );

        schema
    }

    fn review_schema() -> CachedSchema {
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "reviews".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_table(TableInfo {
                name: "customers".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_table(TableInfo {
                name: "products".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();

        schema.columns.insert(
            "reviews".to_string(),
            vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: true,
                    is_unique: true,
                    comment: None,
                    enum_values: None,
                    ordinal: 1,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "title".to_string(),
                    data_type: "varchar".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 2,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "customer_id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 3,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "product_id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 4,
                    precision: None,
                    scale: None,
                },
            ],
        );

        schema.columns.insert(
            "customers".to_string(),
            vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: true,
                    is_unique: true,
                    comment: None,
                    enum_values: None,
                    ordinal: 1,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "last_name".to_string(),
                    data_type: "varchar".to_string(),
                    nullable: true,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 2,
                    precision: None,
                    scale: None,
                },
            ],
        );

        schema.columns.insert(
            "products".to_string(),
            vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: true,
                    is_unique: true,
                    comment: None,
                    enum_values: None,
                    ordinal: 1,
                    precision: None,
                    scale: None,
                },
                ColumnInfo {
                    name: "name".to_string(),
                    data_type: "varchar".to_string(),
                    nullable: false,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: false,
                    comment: None,
                    enum_values: None,
                    ordinal: 2,
                    precision: None,
                    scale: None,
                },
            ],
        );

        schema
    }

    #[test]
    fn test_table_exists() {
        let schema = test_schema();
        assert!(table_exists("users", &schema));
        assert!(!table_exists("nonexistent", &schema));
    }

    #[test]
    fn test_column_exists() {
        let schema = test_schema();
        assert!(column_exists("users", "id", &schema));
        assert!(!column_exists("users", "nonexistent", &schema));
    }

    #[test]
    fn test_suggest_similar() {
        let schema = test_schema();
        let suggestions = suggest_similar_tables("user", &schema);
        assert!(suggestions.contains(&"users".to_string()));
    }

    #[test]
    fn test_levenshtein() {
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("", "abc"), 3);
        assert_eq!(levenshtein_distance("abc", "abc"), 0);
    }

    #[test]
    fn test_missing_table_reports_identifier_span_and_error_severity() {
        let schema = test_schema();
        let doc = parse_document("SELECT * FROM missing_table", SqlDialect::PostgreSQL);
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_table_references(stmt, &schema);
        let missing = errors
            .iter()
            .find(|e| e.message.contains("missing_table"))
            .expect("expected missing table error");

        let start = stmt.range.0
            + stmt
                .text
                .to_lowercase()
                .find("missing_table")
                .expect("missing table token should be present");
        let end = start + "missing_table".len();

        assert_eq!(missing.from, start);
        assert_eq!(missing.to, end);
        assert_eq!(missing.severity, ErrorSeverity::Error);
    }

    #[test]
    fn test_create_view_cte_definition_is_not_reported_as_missing_table() {
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "sales".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();
        let doc = parse_document(
            "CREATE OR REPLACE VIEW vw_sales_data_comparison AS \
             WITH old_codes AS (SELECT s.code FROM sales s) \
             SELECT code FROM old_codes",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_table_references(stmt, &schema);

        assert!(
            !errors
                .iter()
                .any(|e| e.message.contains("old_codes") && e.message.contains("does not exist")),
            "CTE name should not be treated as a missing physical table: {:?}",
            errors
        );
    }

    #[test]
    fn test_derived_table_output_alias_is_not_reported_as_missing_column() {
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "sales_info".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_columns(
                "sales_info",
                vec![
                    ColumnInfo {
                        name: "id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: false,
                        default_value: None,
                        is_primary_key: true,
                        is_unique: true,
                        comment: None,
                        enum_values: None,
                        ordinal: 1,
                        precision: None,
                        scale: None,
                    },
                    ColumnInfo {
                        name: "client_info_id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: true,
                        default_value: None,
                        is_primary_key: false,
                        is_unique: false,
                        comment: None,
                        enum_values: None,
                        ordinal: 2,
                        precision: None,
                        scale: None,
                    },
                    ColumnInfo {
                        name: "created_at".to_string(),
                        data_type: "timestamp".to_string(),
                        nullable: false,
                        default_value: None,
                        is_primary_key: false,
                        is_unique: false,
                        comment: None,
                        enum_values: None,
                        ordinal: 3,
                        precision: None,
                        scale: None,
                    },
                ],
            )
            .build();
        let doc = parse_document(
            "DELETE FROM sales_info \
             WHERE id IN ( \
               SELECT id \
               FROM ( \
                 SELECT id, client_info_id, ROW_NUMBER() OVER (PARTITION BY client_info_id ORDER BY created_at DESC, id DESC) AS row_num \
                 FROM sales_info \
                 WHERE client_info_id IS NOT NULL \
               ) ranked \
               WHERE row_num > 1 \
             )",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);

        assert!(
            !errors
                .iter()
                .any(|e| e.message.contains("row_num") && e.message.contains("does not exist")),
            "Derived table output alias should be visible in its outer query: {:?}",
            errors
        );
    }

    #[test]
    fn test_missing_qualified_column_reports_identifier_span_and_error_severity() {
        let schema = test_schema();
        let doc = parse_document("SELECT u.nonexistent FROM users u", SqlDialect::PostgreSQL);
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        let missing = errors
            .iter()
            .find(|e| e.message.contains("nonexistent"))
            .expect("expected missing column error");

        let start = stmt.range.0
            + stmt
                .text
                .to_lowercase()
                .find("u.nonexistent")
                .expect("missing qualified column token should be present");
        let end = start + "u.nonexistent".len();

        assert_eq!(missing.from, start);
        assert_eq!(missing.to, end);
        assert_eq!(missing.severity, ErrorSeverity::Error);
    }

    #[test]
    fn test_missing_join_column_reports_identifier_span_and_error_severity() {
        let schema = test_schema();
        let doc = parse_document(
            "SELECT * FROM users u LEFT JOIN users c ON u.id = c.vuiver",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        let missing = errors
            .iter()
            .find(|e| e.message.contains("vuiver"))
            .expect("expected missing join column error");

        let start = stmt.range.0
            + stmt
                .text
                .to_lowercase()
                .find("c.vuiver")
                .expect("missing qualified join column token should be present");
        let end = start + "c.vuiver".len();

        assert_eq!(missing.from, start);
        assert_eq!(missing.to, end);
        assert_eq!(missing.severity, ErrorSeverity::Error);
    }

    #[test]
    fn test_select_alias_reference_is_not_treated_as_missing_table_column() {
        let schema = test_schema();
        let doc = parse_document(
            "SELECT COUNT(*) AS item_count FROM users ORDER BY item_count",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(
            !errors
                .iter()
                .any(|e| e.message.contains("item_count") && e.message.contains("does not exist"))
        );
    }

    #[test]
    fn test_missing_qualified_column_on_cte_is_reported() {
        let schema = test_schema();
        let doc = parse_document(
            "WITH user_view AS (SELECT u.id AS user_id, u.name FROM users u) SELECT user_view.email FROM user_view",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(errors.iter().any(|e| {
            e.message
                .contains("Column 'email' does not exist in CTE 'user_view'")
        }));
    }

    #[test]
    fn test_unqualified_column_on_cte_is_valid_when_column_exists() {
        let schema = test_schema();
        let doc = parse_document(
            "WITH user_view AS (SELECT u.id AS user_id, u.name FROM users u) SELECT user_id FROM user_view",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(!errors.iter().any(|e| e.message.contains("user_id")));
    }

    #[test]
    fn test_unqualified_missing_column_on_cte_is_reported() {
        let schema = test_schema();
        let doc = parse_document(
            "WITH user_view AS (SELECT u.id AS user_id, u.name FROM users u) SELECT email FROM user_view",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(errors.iter().any(|e| {
            e.message
                .contains("Column 'email' does not exist in any referenced table or CTE")
        }));
    }

    #[test]
    fn test_missing_column_on_cte_with_explicit_alias_list_is_reported() {
        let schema = test_schema();
        let doc = parse_document(
            "WITH user_view(user_id, user_name) AS (SELECT u.id, u.name FROM users u) SELECT uv.email FROM user_view uv",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(errors.iter().any(|e| {
            e.message
                .contains("Column 'email' does not exist in CTE 'user_view'")
        }));
    }

    #[test]
    fn test_missing_joined_table_column_in_select_list_is_reported() {
        let schema = review_schema();
        let doc = parse_document(
            "SELECT r.id, r.title, p.name, c.bepomap, c.last_name FROM reviews r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN products p ON r.product_id = p.id",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_column_references(stmt, &schema);
        assert!(errors.iter().any(|e| {
            e.message
                .contains("Column 'bepomap' does not exist in table 'customers'")
        }));
    }

    #[test]
    fn test_explicit_table_from_out_of_scope_schema_is_not_reported_missing() {
        let schema = test_schema();
        let doc = parse_document(
            "SELECT relid FROM pg_catalog.pg_statio_user_tables",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_table_references(stmt, &schema);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_explicit_table_from_loaded_schema_still_validates_existence() {
        let schema = test_schema();
        let doc = parse_document("SELECT * FROM public.missing_table", SqlDialect::PostgreSQL);
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");

        let errors = validate_table_references(stmt, &schema);
        assert!(!errors.is_empty());
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("missing_table") && e.severity == ErrorSeverity::Error)
        );
    }

    #[test]
    fn test_table_valued_functions_not_flagged_as_missing() {
        let schema = test_schema();
        // DuckDB table-valued functions should not be flagged as missing tables
        let doc = parse_document(
            "SELECT * FROM duckdb_tables() WHERE schema_name = 'main'",
            SqlDialect::DuckDB,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");
        let errors = validate_table_references(stmt, &schema);
        assert!(
            errors.is_empty(),
            "Table-valued function duckdb_tables() should not be flagged: {:?}",
            errors
        );

        // Also test generate_series (PostgreSQL)
        let doc = parse_document(
            "SELECT * FROM generate_series(1, 10)",
            SqlDialect::PostgreSQL,
        );
        let stmt = doc
            .statements
            .first()
            .expect("expected one parsed statement");
        let errors = validate_table_references(stmt, &schema);
        assert!(
            errors.is_empty(),
            "Table-valued function generate_series() should not be flagged: {:?}",
            errors
        );
    }

    #[test]
    fn test_column_exists_case_insensitive_table_name() {
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "Users".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();

        schema.columns.insert(
            "Users".to_string(),
            vec![ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                nullable: false,
                default_value: None,
                is_primary_key: true,
                is_unique: true,
                comment: None,
                enum_values: None,
                ordinal: 1,
                precision: None,
                scale: None,
            }],
        );

        // Query uses lowercase, schema stores uppercase — should still find columns
        assert!(column_exists("users", "id", &schema));
    }
}
