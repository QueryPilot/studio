//! SQL Parser using sqlparser-rs.
//!
//! Parses SQL documents into individual statements with:
//! - Statement type detection (SELECT, INSERT, etc.)
//! - Table reference extraction
//! - Alias binding detection
//! - CTE (WITH clause) analysis
//! - Error position tracking

use serde::Serialize;
use sqlparser::ast::{self, Statement, TableFactor, SetExpr};
use sqlparser::parser::Parser;

use super::dialect::SqlDialect;

/// Parsed SQL document containing multiple statements.
#[derive(Debug, Clone, Serialize)]
pub struct ParsedDocument {
    pub statements: Vec<ParsedStatement>,
    pub errors: Vec<ParseError>,
    pub dialect: SqlDialect,
}

/// A single parsed SQL statement.
#[derive(Debug, Clone, Serialize)]
pub struct ParsedStatement {
    pub statement_type: Option<String>,
    pub range: (usize, usize),
    pub text: String,
    pub tables: Vec<TableReference>,
    pub aliases: Vec<AliasBinding>,
    pub columns: Vec<ColumnReference>,
    pub ctes: Vec<CteDefinition>,
}

/// Table reference in a statement.
#[derive(Debug, Clone, Serialize)]
pub struct TableReference {
    pub name: String,
    pub schema: Option<String>,
    pub alias: Option<String>,
    pub position: usize,
}

/// Alias binding (e.g., users AS u).
#[derive(Debug, Clone, Serialize)]
pub struct AliasBinding {
    pub alias: String,
    pub table: String,
}

/// Column reference.
#[derive(Debug, Clone, Serialize)]
pub struct ColumnReference {
    pub name: String,
    pub table: Option<String>,
}

/// CTE definition from WITH clause.
#[derive(Debug, Clone, Serialize)]
pub struct CteDefinition {
    pub name: String,
    pub columns: Vec<String>,
}

/// Parse error with position.
#[derive(Debug, Clone, Serialize)]
pub struct ParseError {
    pub message: String,
    pub position: usize,
    pub position_end: Option<usize>,
}

/// Parse a SQL document into statements.
pub fn parse_document(sql: &str, dialect: SqlDialect) -> ParsedDocument {
    let parser_dialect = dialect.to_sqlparser_dialect();
    let mut statements = Vec::new();
    let mut errors = Vec::new();

    // Split into individual statements
    let stmt_ranges = split_statements(sql);

    for (start, end, text) in stmt_ranges {
        match Parser::parse_sql(&*parser_dialect, &text) {
            Ok(ast) if !ast.is_empty() => {
                let stmt = &ast[0];
                let tables = extract_tables(stmt);
                let aliases = extract_aliases(stmt);
                let columns = extract_columns(stmt);
                let ctes = extract_ctes(stmt);

                statements.push(ParsedStatement {
                    statement_type: Some(get_statement_type(stmt)),
                    range: (start, end),
                    text,
                    tables,
                    aliases,
                    columns,
                    ctes,
                });
            }
            Ok(_) => {
                // Empty parse result
                statements.push(ParsedStatement {
                    statement_type: None,
                    range: (start, end),
                    text,
                    tables: vec![],
                    aliases: vec![],
                    columns: vec![],
                    ctes: vec![],
                });
            }
            Err(e) => {
                errors.push(ParseError {
                    message: e.to_string(),
                    position: start,
                    position_end: Some(end),
                });
            }
        }
    }

    ParsedDocument {
        statements,
        errors,
        dialect,
    }
}

/// Parse a single SQL statement.
pub fn parse_statement(sql: &str, dialect: SqlDialect) -> Result<ParsedStatement, ParseError> {
    let parser_dialect = dialect.to_sqlparser_dialect();

    match Parser::parse_sql(&*parser_dialect, sql) {
        Ok(ast) if !ast.is_empty() => {
            let stmt = &ast[0];
            Ok(ParsedStatement {
                statement_type: Some(get_statement_type(stmt)),
                range: (0, sql.len()),
                text: sql.to_string(),
                tables: extract_tables(stmt),
                aliases: extract_aliases(stmt),
                columns: extract_columns(stmt),
                ctes: extract_ctes(stmt),
            })
        }
        Ok(_) => Err(ParseError {
            message: "Empty statement".to_string(),
            position: 0,
            position_end: None,
        }),
        Err(e) => Err(ParseError {
            message: e.to_string(),
            position: 0,
            position_end: Some(sql.len()),
        }),
    }
}

/// Split SQL into individual statements handling strings and comments.
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

        // Skip dollar quotes (PostgreSQL)
        if chars[i] == '$' {
            let rest: String = chars[i..].iter().collect();
            if let Some(m) = regex::Regex::new(r"^\$([a-zA-Z_]*)\$").ok().and_then(|r| r.find(&rest)) {
                let tag = m.as_str();
                if let Some(end_pos) = rest[tag.len()..].find(tag) {
                    i += tag.len() + end_pos + tag.len();
                    continue;
                }
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

fn extract_tables(stmt: &Statement) -> Vec<TableReference> {
    let mut tables = Vec::new();

    match stmt {
        Statement::Query(query) => {
            if let SetExpr::Select(select) = query.body.as_ref() {
                for table_with_joins in &select.from {
                    extract_table_factor(&table_with_joins.relation, &mut tables);
                    for join in &table_with_joins.joins {
                        extract_table_factor(&join.relation, &mut tables);
                    }
                }
            }
        }
        Statement::Insert(insert) => {
            tables.push(TableReference {
                name: insert.table_name.to_string(),
                schema: None,
                alias: None,
                position: 0,
            });
        }
        Statement::Update { table, .. } => {
            extract_table_factor(&table.relation, &mut tables);
        }
        Statement::Delete(delete) => {
            // FromTable is an enum with WithFromKeyword(Vec<TableWithJoins>) or WithoutKeyword(Vec<TableWithJoins>)
            let tables_vec = match &delete.from {
                ast::FromTable::WithFromKeyword(t) | ast::FromTable::WithoutKeyword(t) => t,
            };
            for table in tables_vec {
                extract_table_factor(&table.relation, &mut tables);
            }
        }
        _ => {}
    }

    tables
}

fn extract_table_factor(factor: &TableFactor, tables: &mut Vec<TableReference>) {
    match factor {
        TableFactor::Table { name, alias, .. } => {
            let parts: Vec<_> = name.0.iter().map(|i| i.value.clone()).collect();
            let (schema, table_name) = if parts.len() >= 2 {
                (Some(parts[parts.len() - 2].clone()), parts.last().unwrap().clone())
            } else {
                (None, parts.last().cloned().unwrap_or_default())
            };
            tables.push(TableReference {
                name: table_name,
                schema,
                alias: alias.as_ref().map(|a| a.name.value.clone()),
                position: 0,
            });
        }
        TableFactor::Derived { alias, .. } => {
            if let Some(a) = alias {
                tables.push(TableReference {
                    name: a.name.value.clone(),
                    schema: None,
                    alias: Some(a.name.value.clone()),
                    position: 0,
                });
            }
        }
        _ => {}
    }
}

fn extract_aliases(stmt: &Statement) -> Vec<AliasBinding> {
    let mut aliases = Vec::new();

    if let Statement::Query(query) = stmt {
        if let SetExpr::Select(select) = query.body.as_ref() {
            for table_with_joins in &select.from {
                extract_alias_from_factor(&table_with_joins.relation, &mut aliases);
                for join in &table_with_joins.joins {
                    extract_alias_from_factor(&join.relation, &mut aliases);
                }
            }
        }
    }

    aliases
}

fn extract_alias_from_factor(factor: &TableFactor, aliases: &mut Vec<AliasBinding>) {
    if let TableFactor::Table { name, alias: Some(alias), .. } = factor {
        aliases.push(AliasBinding {
            alias: alias.name.value.clone(),
            table: name.to_string(),
        });
    }
}

fn extract_columns(_stmt: &Statement) -> Vec<ColumnReference> {
    // TODO: Implement column extraction from SELECT list
    Vec::new()
}

fn extract_ctes(stmt: &Statement) -> Vec<CteDefinition> {
    let mut ctes = Vec::new();

    if let Statement::Query(query) = stmt {
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                ctes.push(CteDefinition {
                    name: cte.alias.name.value.clone(),
                    columns: cte.alias.columns.iter().map(|c| c.value.clone()).collect(),
                });
            }
        }
    }

    ctes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_select() {
        let doc = parse_document("SELECT * FROM users", SqlDialect::PostgreSQL);
        assert!(doc.errors.is_empty());
        assert_eq!(doc.statements.len(), 1);
        assert_eq!(doc.statements[0].statement_type, Some("SELECT".to_string()));
        assert_eq!(doc.statements[0].tables[0].name, "users");
    }

    #[test]
    fn test_parse_multiple_statements() {
        let doc = parse_document("SELECT 1; SELECT 2;", SqlDialect::PostgreSQL);
        assert_eq!(doc.statements.len(), 2);
    }

    #[test]
    fn test_parse_with_alias() {
        let doc = parse_document("SELECT u.id FROM users u", SqlDialect::PostgreSQL);
        assert!(!doc.statements[0].aliases.is_empty());
        assert_eq!(doc.statements[0].aliases[0].alias, "u");
    }

    #[test]
    fn test_parse_cte() {
        let doc = parse_document(
            "WITH active AS (SELECT * FROM users WHERE active) SELECT * FROM active",
            SqlDialect::PostgreSQL
        );
        assert_eq!(doc.statements[0].ctes.len(), 1);
        assert_eq!(doc.statements[0].ctes[0].name, "active");
    }
}
