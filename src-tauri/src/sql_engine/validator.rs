//! SQL Validation for syntax and semantic errors.

use super::parser::{ParsedDocument, ParsedStatement};
use super::schema_store::CachedSchema;
use serde::{Deserialize, Serialize};

// =============================================================================
// String Similarity for Fuzzy Matching
// =============================================================================

/// Calculate Levenshtein distance between two strings (edit distance).
/// Used for detecting typos in table names, column names, etc.
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    for i in 0..=a_len {
        matrix[i][0] = i;
    }
    for j in 0..=b_len {
        matrix[0][j] = j;
    }

    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i - 1][j] + 1) // deletion
                .min(matrix[i][j - 1] + 1) // insertion
                .min(matrix[i - 1][j - 1] + cost); // substitution
        }
    }

    matrix[a_len][b_len]
}

/// Check if two strings are similar enough (potential typo).
/// Returns true if the strings are close but not identical.
fn is_similar(a: &str, b: &str, threshold: usize) -> bool {
    if a == b {
        return false; // Identical, not a typo
    }
    
    let distance = levenshtein_distance(&a.to_lowercase(), &b.to_lowercase());
    distance <= threshold && distance > 0
}

/// Find the closest match to a target string from a list of candidates.
/// Returns (closest_match, distance) if a close match is found.
fn find_closest_match<'a>(
    target: &str,
    candidates: &'a [String],
    max_distance: usize,
) -> Option<(&'a String, usize)> {
    let target_lower = target.to_lowercase();
    let mut best_match: Option<(&String, usize)> = None;
    let mut best_distance = usize::MAX;

    for candidate in candidates {
        let distance = levenshtein_distance(&target_lower, &candidate.to_lowercase());
        if distance > 0 && distance <= max_distance && distance < best_distance {
            best_distance = distance;
            best_match = Some((candidate, distance));
        }
    }

    best_match
}

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

    validate_common_issues(stmt, schema, &mut result);

    result
}

fn is_cte_reference(name: &str, ctes: &[super::parser::CteDefinition]) -> bool {
    ctes.iter()
        .any(|cte| cte.name.to_lowercase() == name.to_lowercase())
}

// =============================================================================
// Extensible Linting Rule System
// =============================================================================

/// Trait for implementing linting rules.
/// Each rule can inspect a statement and add errors/warnings to the result.
trait LintRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult);
}

/// Context passed to rules that need schema information.
struct RuleContext<'a> {
    schema: Option<&'a CachedSchema>,
}

// =============================================================================
// Rule Implementations
// =============================================================================

/// Check for common SQL keyword typos.
struct KeywordTypoRule;

impl LintRule for KeywordTypoRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        let text_lower = stmt.text.to_lowercase();
        
        let typos = vec![
            ("wher ", "WHERE"),
            ("selct ", "SELECT"),
            ("form ", "FROM"),
            ("ordre ", "ORDER"),
            ("gropu ", "GROUP"),
            ("havin ", "HAVING"),
            ("jion ", "JOIN"),
            ("inser ", "INSERT"),
            ("updat ", "UPDATE"),
            ("delet ", "DELETE"),
            ("crete ", "CREATE"),
            ("tabel ", "TABLE"),
            ("colum ", "COLUMN"),
            ("wehere ", "WHERE"),
        ];

        for (typo, correct) in typos {
            if text_lower.contains(typo) {
                // Find position of typo for better error reporting
                if let Some(pos) = text_lower.find(typo) {
                    result.add_error(SqlError {
                        from: stmt.range.0 + pos,
                        to: stmt.range.0 + pos + typo.len(),
                        message: format!("Possible typo: did you mean '{}'?", correct),
                        severity: ErrorSeverity::Error,
                        source: ErrorSource::Syntax,
                    });
                }
            }
        }
    }
}

/// Check for invalid * usage (like *sd, *foo).
struct InvalidStarUsageRule;

impl LintRule for InvalidStarUsageRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        let text_lower = stmt.text.to_lowercase();
        
        // Pattern: * followed immediately by alphanumeric (not space/comma/FROM)
        // Example: "select *sd from" or "select *foo,"
        let chars: Vec<char> = text_lower.chars().collect();
        for i in 0..chars.len().saturating_sub(1) {
            if chars[i] == '*' {
                let next_char = chars[i + 1];
                // Check if next char is alphanumeric (invalid)
                if next_char.is_alphanumeric() && next_char != ' ' {
                    // Make sure it's not part of a valid pattern like "table.*col"
                    let prev_char = if i > 0 { Some(chars[i - 1]) } else { None };
                    let is_qualified_star = prev_char == Some('.');
                    
                    if !is_qualified_star {
                        result.add_error(SqlError {
                            from: stmt.range.0 + i,
                            to: stmt.range.0 + i + 2,
                            message: "Invalid use of '*'. Did you mean to separate this from the identifier?".to_string(),
                            severity: ErrorSeverity::Error,
                            source: ErrorSource::Syntax,
                        });
                    }
                }
            }
        }
    }
}

/// Check for missing operators in WHERE clauses (like "id 19" instead of "id = 19").
struct MissingOperatorRule;

impl LintRule for MissingOperatorRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        let text_lower = stmt.text.to_lowercase();
        
        // Look for WHERE clause
        if !text_lower.contains("where") {
            return;
        }
        
        // Pattern: identifier followed by space and number/negative number
        // without an operator (=, <, >, <=, >=, !=, <>)
        let operators = vec!["=", "<", ">", "<=", ">=", "!=", "<>", "in", "like", "between"];
        
        // Split by WHERE and check the condition part
        if let Some(where_idx) = text_lower.find("where") {
            let condition = &text_lower[where_idx + 5..]; // Skip "where"
            
            // Look for patterns like "id -19" or "id 123" (missing operator)
            // This is a simplified check - a full implementation would use regex
            let words: Vec<&str> = condition.split_whitespace().collect();
            for i in 0..words.len().saturating_sub(1) {
                let current = words[i];
                let next = words.get(i + 1);
                
                // Check if current looks like an identifier and next is a number
                if let Some(next_word) = next {
                    let is_number = next_word.parse::<i64>().is_ok() 
                        || (next_word.starts_with('-') && next_word[1..].parse::<i64>().is_ok());
                    
                    let has_operator = operators.iter().any(|op| current.ends_with(op));
                    
                    if is_number && !has_operator && !current.contains(|c: char| !c.is_alphanumeric() && c != '_') {
                        result.add_error(SqlError {
                            from: stmt.range.0,
                            to: stmt.range.1,
                            message: format!("Missing comparison operator between '{}' and '{}'. Did you mean '{} = {}'?", current, next_word, current, next_word),
                            severity: ErrorSeverity::Error,
                            source: ErrorSource::Syntax,
                        });
                    }
                }
            }
        }
    }
}

/// Check for UPDATE/DELETE without WHERE clause.
struct MissingWhereClauseRule;

impl LintRule for MissingWhereClauseRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        let text_upper = stmt.text.to_uppercase();
        
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
    }
}

/// Check for SELECT *.
struct SelectStarRule;

impl LintRule for SelectStarRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
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
    }
}

/// Check for unused CTEs.
struct UnusedCteRule;

impl LintRule for UnusedCteRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
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
}

/// Check for ambiguous columns in multi-table queries.
struct AmbiguousColumnRule;

impl LintRule for AmbiguousColumnRule {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        validate_ambiguous_columns(stmt, result);
    }
}

/// Check for potential typos in table names, column names, and CTEs using fuzzy matching.
struct FuzzyReferenceRule<'a> {
    schema: Option<&'a CachedSchema>,
}

impl<'a> LintRule for FuzzyReferenceRule<'a> {
    fn check(&self, stmt: &ParsedStatement, result: &mut ValidationResult) {
        let Some(schema) = self.schema else {
            return;
        };

        // Check for table name typos
        let existing_table_names: Vec<String> = schema
            .tables
            .iter()
            .map(|t| t.name.clone())
            .collect();

        for table_ref in &stmt.tables {
            let table_exists = existing_table_names
                .iter()
                .any(|t| t.to_lowercase() == table_ref.name.to_lowercase());
            
            let is_cte = stmt
                .ctes
                .iter()
                .any(|cte| cte.name.to_lowercase() == table_ref.name.to_lowercase());

            // If table doesn't exist and it's not a CTE, check for typos
            if !table_exists && !is_cte {
                // Check against table names
                if let Some((closest, distance)) = 
                    find_closest_match(&table_ref.name, &existing_table_names, 2)
                {
                    result.add_error(SqlError {
                        from: stmt.range.0,
                        to: stmt.range.1,
                        message: format!(
                            "Table '{}' not found. Did you mean '{}'?",
                            table_ref.name, closest
                        ),
                        severity: ErrorSeverity::Warning,
                        source: ErrorSource::Semantic,
                    });
                    continue; // Skip checking CTEs if we found a table match
                }

                // Check against CTE names
                let cte_names: Vec<String> = stmt.ctes.iter().map(|c| c.name.clone()).collect();
                if let Some((closest, _distance)) = 
                    find_closest_match(&table_ref.name, &cte_names, 2)
                {
                    result.add_error(SqlError {
                        from: stmt.range.0,
                        to: stmt.range.1,
                        message: format!(
                            "Reference '{}' not found. Did you mean the CTE '{}'?",
                            table_ref.name, closest
                        ),
                        severity: ErrorSeverity::Warning,
                        source: ErrorSource::Semantic,
                    });
                }
            }
        }

        // Check for column name typos
        for col in &stmt.columns {
            // Skip wildcard and qualified columns (we only check unqualified ones)
            if col.name == "*" || col.table.is_some() {
                continue;
            }

            // Get all column names from referenced tables
            let mut all_column_names: Vec<String> = Vec::new();
            for table_ref in &stmt.tables {
                // Use get_columns method to retrieve columns for this table
                if let Some(columns) = schema.get_columns(&table_ref.name) {
                    all_column_names.extend(
                        columns
                            .iter()
                            .map(|c| c.name.clone())
                    );
                }
            }

            // Check if column exists in any table
            let column_exists = all_column_names
                .iter()
                .any(|c| c.to_lowercase() == col.name.to_lowercase());

            if !column_exists && !all_column_names.is_empty() {
                // Check for typos
                if let Some((closest, _distance)) = 
                    find_closest_match(&col.name, &all_column_names, 2)
                {
                    result.add_error(SqlError {
                        from: stmt.range.0,
                        to: stmt.range.1,
                        message: format!(
                            "Column '{}' not found. Did you mean '{}'?",
                            col.name, closest
                        ),
                        severity: ErrorSeverity::Warning,
                        source: ErrorSource::Semantic,
                    });
                }
            }
        }

        // Check for CTE reference typos (when using WITH clause)
        let cte_names: Vec<String> = stmt.ctes.iter().map(|c| c.name.clone()).collect();
        
        // Check if a table reference looks like a misspelled CTE
        for table_ref in &stmt.tables {
            let is_real_table = existing_table_names
                .iter()
                .any(|t| t.to_lowercase() == table_ref.name.to_lowercase());
            
            let is_cte = cte_names
                .iter()
                .any(|c| c.to_lowercase() == table_ref.name.to_lowercase());

            // If it's neither a real table nor a CTE, but close to a CTE name
            if !is_real_table && !is_cte && !cte_names.is_empty() {
                if let Some((closest, _distance)) = 
                    find_closest_match(&table_ref.name, &cte_names, 2)
                {
                    result.add_error(SqlError {
                        from: stmt.range.0,
                        to: stmt.range.1,
                        message: format!(
                            "Reference '{}' not found. Did you mean the CTE '{}'?",
                            table_ref.name, closest
                        ),
                        severity: ErrorSeverity::Warning,
                        source: ErrorSource::Semantic,
                    });
                }
            }
        }
    }
}

fn validate_common_issues(
    stmt: &ParsedStatement,
    schema: Option<&CachedSchema>,
    result: &mut ValidationResult,
) {
    // Run all validation rules
    let rules: Vec<Box<dyn LintRule>> = vec![
        Box::new(KeywordTypoRule),
        Box::new(InvalidStarUsageRule),
        Box::new(MissingOperatorRule),
        Box::new(MissingWhereClauseRule),
        Box::new(SelectStarRule),
        Box::new(UnusedCteRule),
        Box::new(AmbiguousColumnRule),
        Box::new(FuzzyReferenceRule { schema }),
    ];

    for rule in rules {
        rule.check(stmt, result);
    }
}

fn validate_ambiguous_columns(stmt: &ParsedStatement, result: &mut ValidationResult) {
    if stmt.tables.len() < 2 {
        return;
    }

    for col in &stmt.columns {
        if col.table.is_none() && col.name != "*" {
            result.add_error(SqlError {
                from: stmt.range.0,
                to: stmt.range.1,
                message: format!(
                    "Column '{}' should be qualified with table name (multiple tables in query)",
                    col.name
                ),
                severity: ErrorSeverity::Hint,
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

    #[test]
    fn test_validate_ambiguous_column() {
        let doc = parse_document(
            "SELECT id, name FROM users u JOIN orders o ON u.id = o.user_id",
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(result
            .warnings
            .iter()
            .any(|w| { w.message.contains("should be qualified") && w.message.contains("id") }));
    }

    #[test]
    fn test_validate_qualified_column_no_warning() {
        let doc = parse_document(
            "SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id",
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result
            .warnings
            .iter()
            .any(|w| w.message.contains("should be qualified")));
    }

    #[test]
    fn test_validate_single_table_no_ambiguous_warning() {
        let doc = parse_document("SELECT id, name FROM users", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, None, None);
        assert!(!result
            .warnings
            .iter()
            .any(|w| w.message.contains("should be qualified")));
    }

    // New rule tests
    #[test]
    fn test_keyword_typo_wher() {
        let doc = parse_document(
            r#"select * from "addresses" as wh wher id = 1"#,
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result.is_valid());
        assert!(result
            .errors
            .iter()
            .any(|e| e.message.contains("did you mean 'WHERE'")));
    }

    #[test]
    fn test_invalid_star_usage() {
        let doc = parse_document(
            r#"select *sd from "addresses""#,
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result.is_valid());
        assert!(result
            .errors
            .iter()
            .any(|e| e.message.contains("Invalid use of '*'")));
    }

    #[test]
    fn test_missing_operator() {
        let doc = parse_document(
            r#"select * from "addresses" where id -19"#,
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result.is_valid());
        assert!(result
            .errors
            .iter()
            .any(|e| e.message.contains("Missing comparison operator")));
    }

    #[test]
    fn test_valid_query_no_false_positives() {
        let doc = parse_document(
            r#"SELECT id, name FROM users WHERE id = 1 AND status = 'active'"#,
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        // Should only have SELECT * info warning, no errors
        assert!(result.is_valid());
    }

    #[test]
    fn test_multiple_typos() {
        let doc = parse_document(
            r#"selct * form users wher id = 1"#,
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        assert!(!result.is_valid());
        // Should catch multiple typos
        let error_messages: Vec<String> = result.errors.iter().map(|e| e.message.clone()).collect();
        assert!(error_messages.iter().any(|m| m.contains("SELECT") || m.contains("FROM") || m.contains("WHERE")));
    }

    // Fuzzy matching tests
    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("user", "users"), 1);
        assert_eq!(levenshtein_distance("email", "emal"), 1);
        assert_eq!(levenshtein_distance("address", "adress"), 1);
        assert_eq!(levenshtein_distance("orders", "order"), 1);
        assert_eq!(levenshtein_distance("same", "same"), 0);
    }

    #[test]
    fn test_is_similar() {
        // Distance 1 - should be similar
        assert!(is_similar("user", "users", 1));
        assert!(is_similar("email", "emal", 1));
        
        // Identical - not similar (not a typo)
        assert!(!is_similar("users", "users", 1));
        
        // Distance > threshold - not similar
        assert!(!is_similar("users", "customers", 1));
    }

    #[test]
    fn test_fuzzy_table_name_typo() {
        use crate::sql_engine::schema_store::{CachedSchemaBuilder, TableInfo, ColumnInfo, TableType};
        
        // Create schema with "users" and "orders" tables
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "users".to_string(),
                schema: None,
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_columns("users", vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
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
            ])
            .add_table(TableInfo {
                name: "orders".to_string(),
                schema: None,
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();

        // Test typo: "user" instead of "users"
        let doc = parse_document("SELECT * FROM user", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, Some(&schema), None);
        
        let warnings: Vec<String> = result.warnings.iter().map(|w| w.message.clone()).collect();
        assert!(warnings.iter().any(|m| m.contains("Did you mean 'users'")));
    }

    #[test]
    fn test_fuzzy_column_name_typo() {
        use crate::sql_engine::schema_store::{CachedSchemaBuilder, TableInfo, ColumnInfo, TableType};
        
        // Create schema with "users" table with "email" column
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "users".to_string(),
                schema: None,
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_columns("users", vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
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
                    name: "email".to_string(),
                    data_type: "VARCHAR".to_string(),
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
            ])
            .build();

        // Test typo: "emal" instead of "email"
        let doc = parse_document("SELECT emal FROM users", SqlDialect::PostgreSQL);
        let result = validate_document(&doc, Some(&schema), None);
        
        let warnings: Vec<String> = result.warnings.iter().map(|w| w.message.clone()).collect();
        assert!(warnings.iter().any(|m| m.contains("emal") && m.contains("Did you mean 'email'")));
    }

    #[test]
    fn test_fuzzy_cte_name_typo() {
        // Test typo in CTE reference: "active_user" instead of "active_users"
        let doc = parse_document(
            "WITH active_users AS (SELECT * FROM users) SELECT * FROM active_user",
            SqlDialect::PostgreSQL,
        );
        let result = validate_document(&doc, None, None);
        
        let warnings: Vec<String> = result.warnings.iter().map(|w| w.message.clone()).collect();
        assert!(warnings.iter().any(|m| m.contains("active_user") && m.contains("Did you mean")));
    }
}
