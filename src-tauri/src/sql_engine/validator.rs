//! SQL Validation for syntax and semantic errors.

use super::parser::{ParsedDocument, ParsedStatement};
use super::schema_store::CachedSchema;
use serde::{Deserialize, Serialize};

/// Error severity level.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ErrorSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

/// Error source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ErrorSource {
    Syntax,
    Semantic,
    Validation,
    Version,
}

/// SQL error with position.
#[derive(Debug, Clone, Serialize)]
pub struct SqlError {
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub severity: ErrorSeverity,
    pub source: ErrorSource,
}

/// Validation result.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ValidationResult {
    pub errors: Vec<SqlError>,
    pub warnings: Vec<SqlError>,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn add_error(&mut self, error: SqlError) {
        if error.severity == ErrorSeverity::Error {
            self.errors.push(error);
        } else {
            self.warnings.push(error);
        }
    }

    pub fn merge(&mut self, other: ValidationResult) {
        self.errors.extend(other.errors);
        self.warnings.extend(other.warnings);
    }
}

/// Version-specific SQL features.
#[derive(Debug, Clone, Serialize, Default)]
pub struct VersionFeatures {
    pub min_version: Option<String>,
    pub features: Vec<String>,
}

/// Validate a parsed document.
pub fn validate_document(
    doc: &ParsedDocument,
    schema: Option<&CachedSchema>,
    version_features: Option<&VersionFeatures>,
) -> ValidationResult {
    let mut result = ValidationResult::new();

    for error in &doc.errors {
        result.add_error(SqlError {
            from: error.position,
            to: error.position_end.unwrap_or(error.position + 1),
            message: error.message.clone(),
            severity: ErrorSeverity::Error,
            source: ErrorSource::Syntax,
        });
    }

    for stmt in &doc.statements {
        let stmt_result = validate_statement(stmt, schema, version_features);
        result.merge(stmt_result);
    }

    result
}

/// Validate a single statement.
pub fn validate_statement(
    stmt: &ParsedStatement,
    schema: Option<&CachedSchema>,
    _version_features: Option<&VersionFeatures>,
) -> ValidationResult {
    let mut result = ValidationResult::new();

    if let Some(schema) = schema {
        for table_ref in &stmt.tables {
            let table_exists = schema
                .tables
                .iter()
                .any(|t| t.name.to_lowercase() == table_ref.name.to_lowercase());

            if !table_exists && !is_cte_reference(&table_ref.name, &stmt.ctes) {
                result.add_error(SqlError {
                    from: stmt.range.0,
                    to: stmt.range.1,
                    message: format!("Table '{}' does not exist", table_ref.name),
                    severity: ErrorSeverity::Warning,
                    source: ErrorSource::Semantic,
                });
            }
        }
    }

    validate_common_issues(stmt, &mut result);

    result
}

fn is_cte_reference(name: &str, ctes: &[super::parser::CteDefinition]) -> bool {
    ctes.iter()
        .any(|cte| cte.name.to_lowercase() == name.to_lowercase())
}

fn validate_common_issues(stmt: &ParsedStatement, result: &mut ValidationResult) {
    let text_upper = stmt.text.to_uppercase();

    if stmt.statement_type == Some("SELECT".to_string()) && text_upper.contains("SELECT *") {
        result.add_error(SqlError {
            from: stmt.range.0,
            to: stmt.range.1,
            message: "Consider specifying columns instead of SELECT *".to_string(),
            severity: ErrorSeverity::Info,
            source: ErrorSource::Validation,
        });
    }

    if matches!(
        stmt.statement_type.as_deref(),
        Some("UPDATE") | Some("DELETE")
    ) && !text_upper.contains("WHERE")
    {
        result.add_error(SqlError {
            from: stmt.range.0,
            to: stmt.range.1,
            message: format!(
                "{} without WHERE clause will affect all rows",
                stmt.statement_type.as_deref().unwrap_or("Statement")
            ),
            severity: ErrorSeverity::Warning,
            source: ErrorSource::Validation,
        });
    }

    for cte in &stmt.ctes {
        let cte_name_lower = cte.name.to_lowercase();
        let is_referenced = stmt
            .tables
            .iter()
            .any(|t| t.name.to_lowercase() == cte_name_lower);
        if !is_referenced {
            result.add_error(SqlError {
                from: stmt.range.0,
                to: stmt.range.1,
                message: format!("CTE '{}' is defined but never referenced", cte.name),
                severity: ErrorSeverity::Warning,
                source: ErrorSource::Validation,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql_engine::dialect::SqlDialect;
    use crate::sql_engine::parser::parse_document;

    #[test]
    fn test_validate_valid_query() {
        let doc = parse_document("SELECT id FROM users WHERE id = 1", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, None, None);
        assert!(result.is_valid());
    }

    #[test]
    fn test_validate_syntax_error() {
        let doc = parse_document("SELECT FROM WHERE", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, None, None);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_validate_delete_without_where() {
        let doc = parse_document("DELETE FROM users", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, None, None);
        assert!(!result.warnings.is_empty());
        assert!(result.warnings.iter().any(|w| w.message.contains("WHERE")));
    }

    #[test]
    fn test_validate_update_without_where() {
        let doc = parse_document("UPDATE users SET name = 'test'", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, None, None);
        assert!(!result.warnings.is_empty());
        assert!(result.warnings.iter().any(|w| w.message.contains("WHERE")));
    }

    #[test]
    fn test_validate_unused_cte() {
        let doc = parse_document(
            "WITH unused AS (SELECT 1) SELECT * FROM users",
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.message.contains("unused") && w.message.contains("never referenced")));
    }

    #[test]
    fn test_validate_used_cte_no_warning() {
        let doc = parse_document(
            "WITH active AS (SELECT * FROM users) SELECT * FROM active",
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result
            .warnings
            .iter()
            .any(|w| w.message.contains("never referenced")));
    }
}
