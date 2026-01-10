//! SQL Outline Tree generation for Query Outline panel.
//!
//! Converts parsed SQL AST into a structured OutlineTree with:
//! - Statement type and span
//! - CTE definitions with reference tracking
//! - Table references with join types
//! - Nested subquery support (recursive)
//!
//! Span calculation uses text search since sqlparser 0.52 doesn't expose
//! source positions. This is "best effort" with graceful degradation.

use serde::Serialize;
use sqlparser::ast::{self, Query, SetExpr, Statement, TableFactor};
use sqlparser::parser::Parser;
use std::collections::HashSet;

use super::dialect::SqlDialect;

/// Outline tree representing the structure of a SQL document.
#[derive(Serialize, Clone, Debug)]
pub struct OutlineTree {
    pub statements: Vec<StatementOutline>,
    pub parse_status: ParseStatus,
}

/// Parse status indicating completeness of the outline.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub enum ParseStatus {
    Full,    // Complete AST available
    Partial, // Some statements parsed
    Failed,  // Parse failed completely
}

/// Outline of a single SQL statement.
#[derive(Serialize, Clone, Debug)]
pub struct StatementOutline {
    pub kind: String, // "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE TABLE", etc.
    pub span: TextSpan,
    pub ctes: Vec<CteOutline>,
    pub tables: Vec<TableOutline>,
    pub subqueries: Vec<StatementOutline>, // Recursive for nested subqueries
}

/// CTE (Common Table Expression) outline.
#[derive(Serialize, Clone, Debug)]
pub struct CteOutline {
    pub name: String,
    pub span: TextSpan,
    pub name_span: TextSpan,       // Just the CTE name location
    pub references: Vec<TextSpan>, // Where this CTE is used
}

/// Table reference outline.
#[derive(Serialize, Clone, Debug)]
pub struct TableOutline {
    pub name: String,        // Schema-qualified if present (e.g., "public.users")
    pub alias: Option<String>,
    pub span: TextSpan,
    pub alias_span: Option<TextSpan>,
    pub join_type: Option<String>, // "INNER", "LEFT", "RIGHT", "FULL", "CROSS", or None for FROM
}

/// Text span with byte offsets.
#[derive(Serialize, serde::Deserialize, Clone, Debug, Copy, PartialEq)]
pub struct TextSpan {
    pub start: usize,
    pub end: usize,
}

impl TextSpan {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }

    pub fn empty() -> Self {
        Self { start: 0, end: 0 }
    }
}

/// Builder for creating OutlineTree from SQL source.
pub struct OutlineBuilder<'a> {
    source: &'a str,
    /// Tracks byte positions already used for span matches to avoid duplicates
    used_positions: HashSet<usize>,
}

impl<'a> OutlineBuilder<'a> {
    /// Build outline from successfully parsed AST.
    ///
    /// This is the spec-compliant signature for callers who already have parsed statements.
    /// Always returns `ParseStatus::Full` since statements are already successfully parsed.
    pub fn build(statements: &[Statement], source: &str) -> OutlineTree {
        let mut result_statements = Vec::new();
        let stmt_ranges = split_statements(source);

        // Match parsed statements to their source ranges
        for (i, stmt) in statements.iter().enumerate() {
            let (start, end) = if i < stmt_ranges.len() {
                (stmt_ranges[i].0, stmt_ranges[i].1)
            } else {
                (0, source.len())
            };

            let mut builder = OutlineBuilder {
                source,
                used_positions: HashSet::new(),
            };
            let outline = builder.build_statement_outline(stmt, start, end);
            result_statements.push(outline);
        }

        OutlineTree {
            statements: result_statements,
            parse_status: ParseStatus::Full,
        }
    }

    /// Build outline from SQL source string.
    ///
    /// Convenience method that parses the SQL first, then builds the outline.
    /// Returns appropriate `ParseStatus` based on parse success/failure.
    pub fn build_from_sql(sql: &str, dialect: SqlDialect) -> OutlineTree {
        let parser_dialect = dialect.to_sqlparser_dialect();
        let mut statements = Vec::new();
        let mut had_errors = false;
        let mut had_success = false;

        // Split into individual statements
        let stmt_ranges = split_statements(sql);

        for (start, end, text) in stmt_ranges {
            match Parser::parse_sql(&*parser_dialect, &text) {
                Ok(ast) if !ast.is_empty() => {
                    had_success = true;
                    let stmt = &ast[0];
                    let mut builder = OutlineBuilder {
                        source: sql,
                        used_positions: HashSet::new(),
                    };
                    let outline = builder.build_statement_outline(stmt, start, end);
                    statements.push(outline);
                }
                Ok(_) => {
                    // Empty parse result - skip
                }
                Err(_) => {
                    had_errors = true;
                }
            }
        }

        let parse_status = if had_errors && had_success {
            ParseStatus::Partial
        } else if had_errors {
            ParseStatus::Failed
        } else {
            ParseStatus::Full
        };

        OutlineTree {
            statements,
            parse_status,
        }
    }

    /// Build partial outline when parsing fails (best effort).
    #[allow(dead_code)]
    pub fn build_partial(_source: &str) -> OutlineTree {
        OutlineTree {
            statements: Vec::new(),
            parse_status: ParseStatus::Failed,
        }
    }

    /// Build outline for a single statement.
    fn build_statement_outline(
        &mut self,
        stmt: &Statement,
        stmt_start: usize,
        stmt_end: usize,
    ) -> StatementOutline {
        let kind = get_statement_type(stmt);
        let span = TextSpan::new(stmt_start, stmt_end);

        let mut ctes = Vec::new();
        let mut tables = Vec::new();
        let mut subqueries = Vec::new();

        // Extract CTEs, tables, and subqueries based on statement type
        match stmt {
            Statement::Query(query) => {
                self.extract_from_query(
                    query,
                    stmt_start,
                    &mut ctes,
                    &mut tables,
                    &mut subqueries,
                );
            }
            Statement::Insert(insert) => {
                let table_name = insert.table_name.to_string();
                let table_span = self.find_identifier_span(&table_name, stmt_start);
                tables.push(TableOutline {
                    name: table_name,
                    alias: None,
                    span: table_span,
                    alias_span: None,
                    join_type: None,
                });
            }
            Statement::Update { table, .. } => {
                self.extract_table_factor(&table.relation, stmt_start, &mut tables, None);
            }
            Statement::Delete(delete) => {
                let tables_vec = match &delete.from {
                    ast::FromTable::WithFromKeyword(t) | ast::FromTable::WithoutKeyword(t) => t,
                };
                for table in tables_vec {
                    self.extract_table_factor(&table.relation, stmt_start, &mut tables, None);
                }
            }
            _ => {}
        }

        // Find CTE references in the main query body
        for cte in &mut ctes {
            self.find_cte_references(cte);
        }

        StatementOutline {
            kind,
            span,
            ctes,
            tables,
            subqueries,
        }
    }

    /// Extract CTEs, tables, and subqueries from a Query.
    fn extract_from_query(
        &mut self,
        query: &Query,
        base_offset: usize,
        ctes: &mut Vec<CteOutline>,
        tables: &mut Vec<TableOutline>,
        subqueries: &mut Vec<StatementOutline>,
    ) {
        // Extract CTEs from WITH clause
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                let cte_name = cte.alias.name.value.clone();
                let name_span = self.find_identifier_span(&cte_name, base_offset);

                // CTE span currently only captures the CTE name, not the full definition.
                // Full definition spans would require tracking the closing paren position,
                // which sqlparser 0.52 doesn't expose. Using name_span for now.
                let cte_span = name_span;

                ctes.push(CteOutline {
                    name: cte_name,
                    span: cte_span,
                    name_span,
                    references: Vec::new(),
                });
            }
        }

        // Extract from body
        self.extract_from_set_expr(query.body.as_ref(), base_offset, tables, subqueries);
    }

    /// Extract tables and subqueries from SetExpr.
    fn extract_from_set_expr(
        &mut self,
        set_expr: &SetExpr,
        base_offset: usize,
        tables: &mut Vec<TableOutline>,
        subqueries: &mut Vec<StatementOutline>,
    ) {
        match set_expr {
            SetExpr::Select(select) => {
                // Extract tables from FROM clause
                for table_with_joins in &select.from {
                    // First table (FROM)
                    self.extract_table_factor(
                        &table_with_joins.relation,
                        base_offset,
                        tables,
                        None,
                    );

                    // Extract subqueries from the primary table
                    self.extract_subqueries_from_factor(
                        &table_with_joins.relation,
                        base_offset,
                        subqueries,
                    );

                    // JOIN tables
                    for join in &table_with_joins.joins {
                        let join_type = get_join_type(&join.join_operator);
                        self.extract_table_factor(
                            &join.relation,
                            base_offset,
                            tables,
                            Some(join_type),
                        );
                        self.extract_subqueries_from_factor(
                            &join.relation,
                            base_offset,
                            subqueries,
                        );
                    }
                }
            }
            SetExpr::Query(query) => {
                self.extract_from_query(
                    query,
                    base_offset,
                    &mut Vec::new(),
                    tables,
                    subqueries,
                );
            }
            SetExpr::SetOperation { left, right, .. } => {
                self.extract_from_set_expr(left.as_ref(), base_offset, tables, subqueries);
                self.extract_from_set_expr(right.as_ref(), base_offset, tables, subqueries);
            }
            _ => {}
        }
    }

    /// Extract table information from TableFactor.
    fn extract_table_factor(
        &mut self,
        factor: &TableFactor,
        base_offset: usize,
        tables: &mut Vec<TableOutline>,
        join_type: Option<String>,
    ) {
        match factor {
            TableFactor::Table { name, alias, .. } => {
                let parts: Vec<_> = name.0.iter().map(|i| i.value.clone()).collect();
                let table_name = if parts.len() >= 2 {
                    format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
                } else {
                    parts.last().cloned().unwrap_or_default()
                };

                // For span, search for the last part (table name) in source
                let search_name = parts.last().cloned().unwrap_or_default();
                let table_span = self.find_identifier_span(&search_name, base_offset);

                let (alias_str, alias_span) = if let Some(a) = alias {
                    let alias_name = a.name.value.clone();
                    let span = self.find_identifier_span(&alias_name, table_span.end);
                    (Some(alias_name), Some(span))
                } else {
                    (None, None)
                };

                tables.push(TableOutline {
                    name: table_name,
                    alias: alias_str,
                    span: table_span,
                    alias_span,
                    join_type,
                });
            }
            TableFactor::Derived { alias: Some(a), .. } => {
                // Derived table (subquery) - the alias is the "table name"
                let alias_name = a.name.value.clone();
                let span = self.find_identifier_span(&alias_name, base_offset);
                tables.push(TableOutline {
                    name: alias_name.clone(),
                    alias: Some(alias_name),
                    span,
                    alias_span: Some(span),
                    join_type,
                });
            }
            _ => {}
        }
    }

    /// Extract subqueries from TableFactor.
    fn extract_subqueries_from_factor(
        &mut self,
        factor: &TableFactor,
        base_offset: usize,
        subqueries: &mut Vec<StatementOutline>,
    ) {
        if let TableFactor::Derived { subquery, .. } = factor {
            let subquery_outline = self.build_subquery_outline(subquery, base_offset);
            subqueries.push(subquery_outline);
        }
    }

    /// Build outline for a subquery.
    fn build_subquery_outline(&mut self, query: &Query, base_offset: usize) -> StatementOutline {
        let mut tables = Vec::new();
        let mut subqueries = Vec::new();

        self.extract_from_query(query, base_offset, &mut Vec::new(), &mut tables, &mut subqueries);

        StatementOutline {
            kind: "SELECT".to_string(),
            span: TextSpan::empty(), // Subquery spans are complex to calculate
            ctes: Vec::new(),
            tables,
            subqueries,
        }
    }

    /// Find CTE references in the source after the CTE definition.
    /// Note: CTE references intentionally overlap with table references - they track
    /// where the CTE is used in the query, which is exactly the table references.
    fn find_cte_references(&mut self, cte: &mut CteOutline) {
        // Search for CTE name usage after its definition
        // We need to search case-insensitively and find word boundaries
        let search_start = cte.name_span.end;
        let name_lower = cte.name.to_lowercase();

        let source_slice = &self.source[search_start..];
        let source_lower = source_slice.to_lowercase();

        let mut pos = 0;
        while let Some(found) = source_lower[pos..].find(&name_lower) {
            let abs_pos = search_start + pos + found;
            let end_pos = abs_pos + cte.name.len();

            // Check word boundaries
            let before_ok = abs_pos == 0
                || !self.source[..abs_pos]
                    .chars()
                    .last()
                    .map(|c| c.is_alphanumeric() || c == '_')
                    .unwrap_or(false);

            let after_ok = end_pos >= self.source.len()
                || !self.source[end_pos..]
                    .chars()
                    .next()
                    .map(|c| c.is_alphanumeric() || c == '_')
                    .unwrap_or(false);

            // Don't check used_positions here - CTE references intentionally track
            // the same positions as table references
            if before_ok && after_ok {
                cte.references.push(TextSpan::new(abs_pos, end_pos));
            }

            pos += found + 1;
        }
    }

    /// Find the span of an identifier in the source, starting from offset.
    fn find_identifier_span(&mut self, name: &str, start_from: usize) -> TextSpan {
        let source_slice = &self.source[start_from..];
        let name_lower = name.to_lowercase();
        let source_lower = source_slice.to_lowercase();

        // Search for the identifier, checking word boundaries
        let mut pos = 0;
        while let Some(found) = source_lower[pos..].find(&name_lower) {
            let abs_pos = start_from + pos + found;
            let end_pos = abs_pos + name.len();

            // Check if already used
            if self.used_positions.contains(&abs_pos) {
                pos += found + 1;
                continue;
            }

            // Check word boundaries
            let before_ok = abs_pos == 0
                || !self.source[..abs_pos]
                    .chars()
                    .last()
                    .map(|c| c.is_alphanumeric() || c == '_')
                    .unwrap_or(false);

            let after_ok = end_pos >= self.source.len()
                || !self.source[end_pos..]
                    .chars()
                    .next()
                    .map(|c| c.is_alphanumeric() || c == '_')
                    .unwrap_or(false);

            if before_ok && after_ok {
                self.used_positions.insert(abs_pos);
                return TextSpan::new(abs_pos, end_pos);
            }

            pos += found + 1;
        }

        // Fallback: return empty span if not found
        TextSpan::empty()
    }
}

/// Get statement type string.
fn get_statement_type(stmt: &Statement) -> String {
    match stmt {
        Statement::Query(_) => "SELECT".to_string(),
        Statement::Insert(_) => "INSERT".to_string(),
        Statement::Update { .. } => "UPDATE".to_string(),
        Statement::Delete(_) => "DELETE".to_string(),
        Statement::CreateTable { .. } => "CREATE TABLE".to_string(),
        Statement::CreateView { .. } => "CREATE VIEW".to_string(),
        Statement::CreateIndex(_) => "CREATE INDEX".to_string(),
        Statement::AlterTable { .. } => "ALTER TABLE".to_string(),
        Statement::Drop { .. } => "DROP".to_string(),
        Statement::Truncate { .. } => "TRUNCATE".to_string(),
        _ => "OTHER".to_string(),
    }
}

/// Get join type from JoinOperator.
fn get_join_type(op: &ast::JoinOperator) -> String {
    match op {
        ast::JoinOperator::Inner(_) => "INNER".to_string(),
        ast::JoinOperator::LeftOuter(_) | ast::JoinOperator::LeftSemi(_) | ast::JoinOperator::LeftAnti(_) => {
            "LEFT".to_string()
        }
        ast::JoinOperator::RightOuter(_) | ast::JoinOperator::RightSemi(_) | ast::JoinOperator::RightAnti(_) => {
            "RIGHT".to_string()
        }
        ast::JoinOperator::FullOuter(_) => "FULL".to_string(),
        ast::JoinOperator::CrossJoin => "CROSS".to_string(),
        ast::JoinOperator::CrossApply | ast::JoinOperator::OuterApply => "APPLY".to_string(),
        ast::JoinOperator::AsOf { .. } => "ASOF".to_string(),
    }
}

/// Split SQL into individual statements (handles strings and comments).
fn split_statements(sql: &str) -> Vec<(usize, usize, String)> {
    let mut statements = Vec::new();
    let mut current_start = 0;
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Skip single-quoted strings
        if chars[i] == '\'' {
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' && i + 1 < chars.len() && chars[i + 1] == '\'' {
                    i += 2;
                } else if chars[i] == '\'' {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        // Skip double-quoted identifiers
        if chars[i] == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            i += 1;
            continue;
        }

        // Skip backtick-quoted identifiers (MySQL)
        if chars[i] == '`' {
            i += 1;
            while i < chars.len() && chars[i] != '`' {
                i += 1;
            }
            i += 1;
            continue;
        }

        // Skip line comments
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Skip block comments
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }

        // Statement terminator
        if chars[i] == ';' {
            let text: String = chars[current_start..i].iter().collect();
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                statements.push((current_start, i, trimmed.to_string()));
            }
            current_start = i + 1;
        }

        i += 1;
    }

    // Final statement without semicolon
    let final_text: String = chars[current_start..].iter().collect();
    let trimmed = final_text.trim();
    if !trimmed.is_empty() {
        statements.push((current_start, chars.len(), trimmed.to_string()));
    }

    statements
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::dialect::PostgreSqlDialect;

    // Helper to parse and build outline
    fn build_outline(sql: &str, dialect: SqlDialect) -> OutlineTree {
        OutlineBuilder::build_from_sql(sql, dialect)
    }

    #[test]
    fn test_build_with_pre_parsed_statements() {
        // Test the spec-compliant build() function with pre-parsed AST
        let sql = "SELECT * FROM users";
        let dialect = PostgreSqlDialect {};
        let statements = Parser::parse_sql(&dialect, sql).unwrap();

        let outline = OutlineBuilder::build(&statements, sql);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].kind, "SELECT");
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_build_multi_statement_pre_parsed() {
        let sql = "SELECT 1; SELECT 2";
        let dialect = PostgreSqlDialect {};
        let statements = Parser::parse_sql(&dialect, sql).unwrap();

        let outline = OutlineBuilder::build(&statements, sql);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 2);
        assert_eq!(outline.statements[0].kind, "SELECT");
        assert_eq!(outline.statements[1].kind, "SELECT");
    }

    #[test]
    fn test_simple_select_with_from() {
        let sql = "SELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);

        let stmt = &outline.statements[0];
        assert_eq!(stmt.kind, "SELECT");
        assert_eq!(stmt.span.start, 0);
        assert_eq!(stmt.span.end, sql.len());

        assert_eq!(stmt.tables.len(), 1);
        assert_eq!(stmt.tables[0].name, "users");
        assert!(stmt.tables[0].join_type.is_none()); // FROM, not JOIN
    }

    #[test]
    fn test_select_with_joins() {
        let sql = "SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id LEFT JOIN items i ON o.id = i.order_id";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        let stmt = &outline.statements[0];

        assert_eq!(stmt.tables.len(), 3);

        // First table (FROM)
        assert_eq!(stmt.tables[0].name, "users");
        assert_eq!(stmt.tables[0].alias, Some("u".to_string()));
        assert!(stmt.tables[0].join_type.is_none());

        // INNER JOIN
        assert_eq!(stmt.tables[1].name, "orders");
        assert_eq!(stmt.tables[1].alias, Some("o".to_string()));
        assert_eq!(stmt.tables[1].join_type, Some("INNER".to_string()));

        // LEFT JOIN
        assert_eq!(stmt.tables[2].name, "items");
        assert_eq!(stmt.tables[2].alias, Some("i".to_string()));
        assert_eq!(stmt.tables[2].join_type, Some("LEFT".to_string()));
    }

    #[test]
    fn test_select_with_ctes() {
        let sql = "WITH active_users AS (SELECT * FROM users WHERE active = true) SELECT * FROM active_users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        let stmt = &outline.statements[0];

        assert_eq!(stmt.ctes.len(), 1);
        assert_eq!(stmt.ctes[0].name, "active_users");

        // CTE should have references where it's used
        assert!(!stmt.ctes[0].references.is_empty());
    }

    #[test]
    fn test_nested_subqueries() {
        let sql = "SELECT * FROM (SELECT id FROM users) AS subq";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        let stmt = &outline.statements[0];

        // Should have subquery
        assert_eq!(stmt.subqueries.len(), 1);
        assert_eq!(stmt.subqueries[0].kind, "SELECT");
    }

    #[test]
    fn test_multi_statement_query() {
        let sql = "SELECT 1; INSERT INTO users (name) VALUES ('test'); UPDATE users SET active = true";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 3);

        assert_eq!(outline.statements[0].kind, "SELECT");
        assert_eq!(outline.statements[1].kind, "INSERT");
        assert_eq!(outline.statements[2].kind, "UPDATE");
    }

    #[test]
    fn test_invalid_sql_returns_failed() {
        let sql = "SELEC * FORM users"; // Invalid SQL
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Failed);
        assert!(outline.statements.is_empty());
    }

    #[test]
    fn test_partial_parse() {
        let sql = "SELECT * FROM users; SELEC * FORM broken";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        // Should be Partial since first statement parsed but second failed
        assert_eq!(outline.parse_status, ParseStatus::Partial);
        assert_eq!(outline.statements.len(), 1);
    }

    #[test]
    fn test_schema_qualified_table() {
        let sql = "SELECT * FROM public.users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        assert_eq!(stmt.tables[0].name, "public.users");
    }

    #[test]
    fn test_right_join() {
        let sql = "SELECT * FROM a RIGHT JOIN b ON a.id = b.id";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        assert_eq!(stmt.tables[1].join_type, Some("RIGHT".to_string()));
    }

    #[test]
    fn test_full_join() {
        let sql = "SELECT * FROM a FULL OUTER JOIN b ON a.id = b.id";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        assert_eq!(stmt.tables[1].join_type, Some("FULL".to_string()));
    }

    #[test]
    fn test_cross_join() {
        let sql = "SELECT * FROM a CROSS JOIN b";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        assert_eq!(stmt.tables[1].join_type, Some("CROSS".to_string()));
    }

    #[test]
    fn test_table_span_calculation() {
        let sql = "SELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        // "users" should start at position 14
        let table_span = stmt.tables[0].span;
        assert_eq!(&sql[table_span.start..table_span.end], "users");
    }

    #[test]
    fn test_cte_name_span() {
        let sql = "WITH my_cte AS (SELECT 1) SELECT * FROM my_cte";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        let stmt = &outline.statements[0];
        let cte = &stmt.ctes[0];

        // CTE name span should point to "my_cte" after WITH
        assert_eq!(&sql[cte.name_span.start..cte.name_span.end], "my_cte");
    }

    #[test]
    fn test_mysql_dialect() {
        let sql = "SELECT * FROM `users` u";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        // MySQL uses backticks, name should still be "users"
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_create_table_statement() {
        let sql = "CREATE TABLE users (id INT PRIMARY KEY)";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.statements[0].kind, "CREATE TABLE");
    }

    #[test]
    fn test_delete_statement() {
        let sql = "DELETE FROM users WHERE id = 1";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.statements[0].kind, "DELETE");
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_update_statement() {
        let sql = "UPDATE users SET name = 'test' WHERE id = 1";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.statements[0].kind, "UPDATE");
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    // ========================================
    // PostgreSQL-specific syntax tests
    // ========================================

    #[test]
    fn test_postgres_double_quoted_identifier() {
        let sql = r#"SELECT * FROM "QuotedTable""#;
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].tables[0].name, "QuotedTable");
    }

    #[test]
    fn test_postgres_schema_qualified_table() {
        let sql = "SELECT * FROM public.users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "public.users");
    }

    #[test]
    fn test_postgres_schema_qualified_with_quotes() {
        let sql = r#"SELECT * FROM "MySchema"."MyTable""#;
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "MySchema.MyTable");
    }

    #[test]
    fn test_postgres_array_literal() {
        // Arrays in SELECT (no table reference)
        let sql = "SELECT ARRAY[1,2,3]";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].kind, "SELECT");
        assert!(outline.statements[0].tables.is_empty());
    }

    #[test]
    fn test_postgres_array_with_table() {
        let sql = "SELECT ARRAY[1,2,3], name FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_postgres_cte_with_schema_qualified() {
        let sql = "WITH cte AS (SELECT * FROM public.users) SELECT * FROM cte";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].ctes.len(), 1);
        assert_eq!(outline.statements[0].ctes[0].name, "cte");
        // CTE should have reference
        assert!(!outline.statements[0].ctes[0].references.is_empty());
    }

    // ========================================
    // MySQL-specific syntax tests
    // ========================================

    #[test]
    fn test_mysql_backtick_identifier() {
        let sql = "SELECT * FROM `backtick_table`";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].tables[0].name, "backtick_table");
    }

    #[test]
    fn test_mysql_database_qualified() {
        let sql = "SELECT * FROM mydb.users";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "mydb.users");
    }

    #[test]
    fn test_mysql_backtick_database_qualified() {
        let sql = "SELECT * FROM `my_db`.`my_table`";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "my_db.my_table");
    }

    #[test]
    fn test_mysql_use_and_select() {
        // USE is a separate statement, followed by SELECT
        let sql = "USE mydb; SELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::MySQL);

        // USE statement may or may not parse depending on sqlparser support
        // At minimum, the SELECT should parse
        assert!(outline.statements.iter().any(|s| s.kind == "SELECT"));
        // Check that we found the users table
        let select_stmt = outline.statements.iter().find(|s| s.kind == "SELECT");
        assert!(select_stmt.is_some());
        assert_eq!(select_stmt.unwrap().tables[0].name, "users");
    }

    #[test]
    fn test_mysql_limit_syntax() {
        let sql = "SELECT * FROM users LIMIT 10";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_mysql_join_with_backticks() {
        let sql = "SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables.len(), 2);
        assert_eq!(outline.statements[0].tables[0].name, "users");
        assert_eq!(outline.statements[0].tables[1].name, "orders");
        assert_eq!(
            outline.statements[0].tables[1].join_type,
            Some("INNER".to_string())
        );
    }

    // ========================================
    // SQLite-specific syntax tests
    // ========================================

    #[test]
    fn test_sqlite_bracket_identifier() {
        let sql = "SELECT * FROM [bracket_table]";
        let outline = build_outline(sql, SqlDialect::SQLite);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "bracket_table");
    }

    #[test]
    fn test_sqlite_bracket_with_schema() {
        let sql = "SELECT * FROM [main].[users]";
        let outline = build_outline(sql, SqlDialect::SQLite);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "main.users");
    }

    #[test]
    fn test_sqlite_attach_database() {
        let sql = "ATTACH DATABASE 'file.db' AS db";
        let outline = build_outline(sql, SqlDialect::SQLite);

        // ATTACH may parse as OTHER or a specific type
        // The main goal is it doesn't fail
        assert_ne!(outline.parse_status, ParseStatus::Failed);
    }

    #[test]
    fn test_sqlite_simple_select() {
        let sql = "SELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::SQLite);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_sqlite_insert_with_brackets() {
        let sql = "INSERT INTO [my_table] (id, name) VALUES (1, 'test')";
        let outline = build_outline(sql, SqlDialect::SQLite);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].kind, "INSERT");
        // Note: INSERT uses table_name.to_string() which includes brackets
        // This is consistent with how sqlparser represents the table name
        assert!(outline.statements[0].tables[0].name.contains("my_table"));
    }

    // ========================================
    // SQL Server-specific syntax tests
    // ========================================

    #[test]
    fn test_mssql_bracket_identifier() {
        let sql = "SELECT * FROM [Users]";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "Users");
    }

    #[test]
    fn test_mssql_schema_qualified_brackets() {
        let sql = "SELECT * FROM [dbo].[Users]";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "dbo.Users");
    }

    #[test]
    fn test_mssql_three_part_name() {
        let sql = "SELECT * FROM [MyDatabase].[dbo].[Users]";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        // Three-part names should show schema.table (last two parts)
        assert_eq!(outline.statements[0].tables[0].name, "dbo.Users");
    }

    #[test]
    fn test_mssql_top_clause() {
        let sql = "SELECT TOP 10 * FROM users";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].kind, "SELECT");
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_mssql_top_with_percent() {
        let sql = "SELECT TOP 10 PERCENT * FROM users";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_mssql_cte_style() {
        let sql = "WITH ActiveUsers AS (SELECT * FROM [dbo].[Users] WHERE Active = 1) SELECT * FROM ActiveUsers";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].ctes.len(), 1);
        assert_eq!(outline.statements[0].ctes[0].name, "ActiveUsers");
        // CTE references should be found
        assert!(!outline.statements[0].ctes[0].references.is_empty());
    }

    #[test]
    fn test_mssql_cross_apply() {
        let sql = "SELECT * FROM users u CROSS APPLY (SELECT * FROM orders WHERE user_id = u.id) o";
        let outline = build_outline(sql, SqlDialect::MsSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        // First table is users, second is the derived table from CROSS APPLY
        assert!(outline.statements[0].tables.len() >= 1);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    // ========================================
    // Edge case tests (all dialects)
    // ========================================

    #[test]
    fn test_empty_sql_string() {
        let sql = "";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        // Empty SQL should result in Failed (no statements to parse)
        assert!(outline.statements.is_empty());
        // Could be Failed or Full with no statements depending on implementation
        // The key is no statements are returned
    }

    #[test]
    fn test_whitespace_only_sql() {
        let sql = "   \n\t  ";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert!(outline.statements.is_empty());
    }

    #[test]
    fn test_mixed_validity_statements() {
        // First statement valid, second invalid
        let sql = "SELECT * FROM users; SELEC INVALID SYNTAX";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Partial);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_mixed_validity_multiple() {
        // Valid, invalid, valid pattern
        let sql = "SELECT 1; INVALID; SELECT 2";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Partial);
        // Should have 2 valid statements
        assert_eq!(outline.statements.len(), 2);
    }

    #[test]
    fn test_very_long_table_name() {
        let long_name = "a".repeat(200);
        let sql = format!("SELECT * FROM {}", long_name);
        let outline = build_outline(&sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, long_name);
    }

    #[test]
    fn test_unicode_identifiers_postgres() {
        // PostgreSQL supports unicode in quoted identifiers
        let sql = r#"SELECT * FROM "用户表""#;
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "用户表");
    }

    #[test]
    fn test_unicode_identifiers_mysql() {
        let sql = "SELECT * FROM `données`";
        let outline = build_outline(sql, SqlDialect::MySQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "données");
    }

    #[test]
    fn test_all_invalid_statements() {
        let sql = "INVALID SYNTAX; ALSO INVALID";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Failed);
        assert!(outline.statements.is_empty());
    }

    #[test]
    fn test_comments_preserved() {
        let sql = "-- Comment\nSELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_block_comment() {
        let sql = "/* Block comment */ SELECT * FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_multiple_ctes_all_dialects() {
        // Test multiple CTEs - should work across dialects
        for dialect in [
            SqlDialect::PostgreSQL,
            SqlDialect::MySQL,
            SqlDialect::SQLite,
            SqlDialect::MsSQL,
        ] {
            let sql = "WITH cte1 AS (SELECT 1), cte2 AS (SELECT 2) SELECT * FROM cte1, cte2";
            let outline = build_outline(sql, dialect);

            assert_eq!(
                outline.parse_status,
                ParseStatus::Full,
                "Failed for {:?}",
                dialect
            );
            assert_eq!(outline.statements[0].ctes.len(), 2, "Failed for {:?}", dialect);
        }
    }

    #[test]
    fn test_deeply_nested_subquery() {
        let sql = "SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert!(!outline.statements[0].subqueries.is_empty());
        // Check nested structure
        let outer_subquery = &outline.statements[0].subqueries[0];
        assert!(!outer_subquery.subqueries.is_empty());
    }

    #[test]
    fn test_union_query() {
        let sql = "SELECT * FROM users UNION SELECT * FROM admins";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        // Both tables should be extracted from UNION
        assert!(outline.statements[0].tables.len() >= 2);
    }

    #[test]
    fn test_case_insensitive_keywords() {
        let sql = "select * from users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].kind, "SELECT");
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_mixed_case_identifiers() {
        let sql = "SELECT * FROM UsErS";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        // PostgreSQL folds unquoted identifiers to lowercase
        // But the outline should preserve what was parsed
        assert_eq!(outline.statements[0].tables[0].name.to_lowercase(), "users");
    }

    #[test]
    fn test_special_characters_in_quoted_identifier() {
        let sql = r#"SELECT * FROM "table-with-dashes""#;
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "table-with-dashes");
    }

    #[test]
    fn test_semicolon_in_string_literal() {
        // The semicolon inside the string should not split statements
        let sql = "SELECT 'hello; world' FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements.len(), 1);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_escaped_quotes_in_string() {
        let sql = "SELECT 'It''s a test' FROM users";
        let outline = build_outline(sql, SqlDialect::PostgreSQL);

        assert_eq!(outline.parse_status, ParseStatus::Full);
        assert_eq!(outline.statements[0].tables[0].name, "users");
    }
}
