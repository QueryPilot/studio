//! SQL Validation for syntax and semantic errors.

use serde::{Deserialize, Serialize};
use super::parser::{ParsedDocument, ParsedStatement};
use super::schema_store::CachedSchema;

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

    // Add syntax errors from parsing
    for error in &doc.errors {
        result.add_error(SqlError {
            from: error.position,
            to: error.position_end.unwrap_or(error.position + 1),
            message: error.message.clone(),
            severity: ErrorSeverity::Error,
            source: ErrorSource::Syntax,
        });
    }

    // Validate each statement
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

    // Semantic validation if schema is provided
    if let Some(schema) = schema {
        // Check if referenced tables exist
        for table_ref in &stmt.tables {
            let table_exists = schema.tables.iter().any(|t| {
                t.name.to_lowercase() == table_ref.name.to_lowercase()
            });

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

    // Check for common SQL issues
    validate_common_issues(stmt, &mut result);

    result
}

/// Check if a table name refers to a CTE.
fn is_cte_reference(name: &str, ctes: &[super::parser::CteDefinition]) -> bool {
    ctes.iter().any(|cte| cte.name.to_lowercase() == name.to_lowercase())
}

/// Validate common SQL issues.
fn validate_common_issues(stmt: &ParsedStatement, result: &mut ValidationResult) {
    let text_upper = stmt.text.to_uppercase();

    // Check for SELECT *
    if stmt.statement_type == Some("SELECT".to_string()) && text_upper.contains("SELECT *") {
        result.add_error(SqlError {
            from: stmt.range.0,
            to: stmt.range.1,
            message: "Consider specifying columns instead of SELECT *".to_string(),
            severity: ErrorSeverity::Info,
            source: ErrorSource::Validation,
        });
    }

    // Check for missing WHERE in UPDATE/DELETE
    if matches!(stmt.statement_type.as_deref(), Some("UPDATE") | Some("DELETE")) {
        if !text_upper.contains("WHERE") {
            result.add_error(SqlError {
                from: stmt.range.0,
                to: stmt.range.1,
                message: format!("{} without WHERE clause will affect all rows",
                    stmt.statement_type.as_deref().unwrap_or("Statement")),
                severity: ErrorSeverity::Warning,
                source: ErrorSource::Validation,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql_engine::parser::parse_document;
    use crate::sql_engine::dialect::SqlDialect;

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
    }
}
