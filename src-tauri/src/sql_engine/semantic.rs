//! Semantic analysis for SQL validation.
//!
//! Validates SQL against schema metadata.

use super::parser::ParsedStatement;
use super::schema_store::CachedSchema;
use super::validator::{SqlError, ErrorSeverity, ErrorSource};

/// Check if a table exists in the schema.
pub fn table_exists(table_name: &str, schema: &CachedSchema) -> bool {
    schema.tables.iter().any(|t|
        t.name.to_lowercase() == table_name.to_lowercase()
    )
}

/// Check if a column exists in a table.
pub fn column_exists(table_name: &str, column_name: &str, schema: &CachedSchema) -> bool {
    if let Some(columns) = schema.columns.get(table_name) {
        columns.iter().any(|c|
            c.name.to_lowercase() == column_name.to_lowercase()
        )
    } else {
        false
    }
}

/// Validate table references in a statement.
pub fn validate_table_references(
    stmt: &ParsedStatement,
    schema: &CachedSchema,
) -> Vec<SqlError> {
    let mut errors = Vec::new();

    for table_ref in &stmt.tables {
        // Skip if it's a CTE reference
        if stmt.ctes.iter().any(|c| c.name.to_lowercase() == table_ref.name.to_lowercase()) {
            continue;
        }

        // Skip if it's an alias (subquery result)
        if stmt.aliases.iter().any(|a| a.alias.to_lowercase() == table_ref.name.to_lowercase()) {
            continue;
        }

        if !table_exists(&table_ref.name, schema) {
            errors.push(SqlError {
                from: stmt.range.0,
                to: stmt.range.1,
                message: format!("Table '{}' does not exist", table_ref.name),
                severity: ErrorSeverity::Warning,
                source: ErrorSource::Semantic,
            });
        }
    }

    errors
}

/// Validate column references in a statement.
pub fn validate_column_references(
    stmt: &ParsedStatement,
    schema: &CachedSchema,
) -> Vec<SqlError> {
    let mut errors = Vec::new();

    for col_ref in &stmt.columns {
        if let Some(table) = &col_ref.table {
            // Resolve alias to table name
            let actual_table = stmt.aliases.iter()
                .find(|a| a.alias.to_lowercase() == table.to_lowercase())
                .map(|a| &a.table)
                .unwrap_or(table);

            // Check CTE first
            if stmt.ctes.iter().any(|c| c.name.to_lowercase() == actual_table.to_lowercase()) {
                // Can't validate CTE columns without deeper analysis
                continue;
            }

            if !column_exists(actual_table, &col_ref.name, schema) {
                errors.push(SqlError {
                    from: stmt.range.0,
                    to: stmt.range.1,
                    message: format!("Column '{}' does not exist in table '{}'", col_ref.name, actual_table),
                    severity: ErrorSeverity::Warning,
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

    schema.tables.iter()
        .filter(|t| {
            let t_lower = t.name.to_lowercase();
            // Simple fuzzy match: contains or starts with
            t_lower.contains(&name_lower) ||
            name_lower.contains(&t_lower) ||
            levenshtein_distance(&name_lower, &t_lower) <= 2
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

    if let Some(columns) = schema.columns.get(table_name) {
        columns.iter()
            .filter(|c| {
                let c_lower = c.name.to_lowercase();
                c_lower.contains(&col_lower) ||
                col_lower.contains(&c_lower) ||
                levenshtein_distance(&col_lower, &c_lower) <= 2
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

    if m == 0 { return n; }
    if n == 0 { return m; }

    let mut dp = vec![vec![0; n + 1]; m + 1];

    for i in 0..=m { dp[i][0] = i; }
    for j in 0..=n { dp[0][j] = j; }

    for i in 1..=m {
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
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
    use crate::sql_engine::schema_store::{CachedSchemaBuilder, TableInfo, TableType, ColumnInfo};

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

        schema.columns.insert("users".to_string(), vec![
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
        ]);

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
}
