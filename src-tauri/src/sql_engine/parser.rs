//! SQL Parser using sqlparser-rs.
//!
//! Parses SQL documents into individual statements with:
//! - Statement type detection (SELECT, INSERT, etc.)
//! - Table reference extraction
//! - Alias binding detection
//! - CTE (WITH clause) analysis
//! - Error position tracking

use serde::Serialize;
use sqlparser::ast::{self, SetExpr, Statement, TableFactor};
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

                // Keep a fallback statement so heuristic lint rules (typo detection,
                // missing operators, etc.) can still run on syntactically invalid SQL.
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
            if let Some(m) = regex::Regex::new(r"^\$([a-zA-Z_]*)\$")
                .ok()
                .and_then(|r| r.find(&rest))
            {
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
                (
                    Some(parts[parts.len() - 2].clone()),
                    parts.last().unwrap().clone(),
                )
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
    if let TableFactor::Table {
        name,
        alias: Some(alias),
        ..
    } = factor
    {
        aliases.push(AliasBinding {
            alias: alias.name.value.clone(),
            table: name.to_string(),
        });
    }
}

fn extract_columns(stmt: &Statement) -> Vec<ColumnReference> {
    let mut columns = Vec::new();

    match stmt {
        Statement::Query(query) => {
            if let SetExpr::Select(select) = query.body.as_ref() {
                for item in &select.projection {
                    extract_columns_from_select_item(item, &mut columns);
                }
                if let Some(selection) = &select.selection {
                    extract_columns_from_expr(selection, &mut columns);
                }
                if let ast::GroupByExpr::Expressions(exprs, _) = &select.group_by {
                    for expr in exprs {
                        extract_columns_from_expr(expr, &mut columns);
                    }
                }
                if let Some(having) = &select.having {
                    extract_columns_from_expr(having, &mut columns);
                }
            }
            if let Some(order_by) = &query.order_by {
                for item in &order_by.exprs {
                    extract_columns_from_expr(&item.expr, &mut columns);
                }
            }
        }
        Statement::Update {
            assignments,
            selection,
            ..
        } => {
            for assignment in assignments {
                extract_columns_from_expr(&assignment.value, &mut columns);
            }
            if let Some(selection) = selection {
                extract_columns_from_expr(selection, &mut columns);
            }
        }
        Statement::Delete(delete) => {
            if let Some(selection) = &delete.selection {
                extract_columns_from_expr(selection, &mut columns);
            }
        }
        Statement::Insert(insert) => {
            if let Some(source) = &insert.source {
                if let SetExpr::Select(select) = source.body.as_ref() {
                    for item in &select.projection {
                        extract_columns_from_select_item(item, &mut columns);
                    }
                }
            }
        }
        _ => {}
    }

    columns
}

fn extract_columns_from_select_item(item: &ast::SelectItem, columns: &mut Vec<ColumnReference>) {
    match item {
        ast::SelectItem::UnnamedExpr(expr) | ast::SelectItem::ExprWithAlias { expr, .. } => {
            extract_columns_from_expr(expr, columns);
        }
        ast::SelectItem::QualifiedWildcard(name, _) => {
            let parts: Vec<_> = name.0.iter().map(|i| i.value.clone()).collect();
            if !parts.is_empty() {
                columns.push(ColumnReference {
                    name: "*".to_string(),
                    table: Some(parts.join(".")),
                });
            }
        }
        ast::SelectItem::Wildcard(_) => {
            columns.push(ColumnReference {
                name: "*".to_string(),
                table: None,
            });
        }
    }
}

fn extract_columns_from_expr(expr: &ast::Expr, columns: &mut Vec<ColumnReference>) {
    match expr {
        ast::Expr::Identifier(ident) => {
            columns.push(ColumnReference {
                name: ident.value.clone(),
                table: None,
            });
        }
        ast::Expr::CompoundIdentifier(parts) => {
            if parts.len() >= 2 {
                let col_name = parts.last().unwrap().value.clone();
                let table_parts: Vec<_> = parts[..parts.len() - 1]
                    .iter()
                    .map(|i| i.value.clone())
                    .collect();
                columns.push(ColumnReference {
                    name: col_name,
                    table: Some(table_parts.join(".")),
                });
            }
        }
        ast::Expr::BinaryOp { left, right, .. } => {
            extract_columns_from_expr(left, columns);
            extract_columns_from_expr(right, columns);
        }
        ast::Expr::UnaryOp { expr, .. } => {
            extract_columns_from_expr(expr, columns);
        }
        ast::Expr::Nested(inner) => {
            extract_columns_from_expr(inner, columns);
        }
        ast::Expr::Function(func) => {
            if let ast::FunctionArguments::List(arg_list) = &func.args {
                for arg in &arg_list.args {
                    if let ast::FunctionArg::Unnamed(arg_expr) = arg {
                        if let ast::FunctionArgExpr::Expr(e) = arg_expr {
                            extract_columns_from_expr(e, columns);
                        }
                    }
                }
            }
        }
        ast::Expr::Case {
            operand,
            conditions,
            results,
            else_result,
            ..
        } => {
            if let Some(op) = operand {
                extract_columns_from_expr(op, columns);
            }
            for cond in conditions {
                extract_columns_from_expr(cond, columns);
            }
            for res in results {
                extract_columns_from_expr(res, columns);
            }
            if let Some(else_expr) = else_result {
                extract_columns_from_expr(else_expr, columns);
            }
        }
        ast::Expr::Cast { expr, .. } => {
            extract_columns_from_expr(expr, columns);
        }
        ast::Expr::InList { expr, list, .. } => {
            extract_columns_from_expr(expr, columns);
            for item in list {
                extract_columns_from_expr(item, columns);
            }
        }
        ast::Expr::InSubquery { expr, .. } => {
            extract_columns_from_expr(expr, columns);
        }
        ast::Expr::Between {
            expr, low, high, ..
        } => {
            extract_columns_from_expr(expr, columns);
            extract_columns_from_expr(low, columns);
            extract_columns_from_expr(high, columns);
        }
        ast::Expr::Like { expr, pattern, .. } | ast::Expr::ILike { expr, pattern, .. } => {
            extract_columns_from_expr(expr, columns);
            extract_columns_from_expr(pattern, columns);
        }
        ast::Expr::IsNull(e) | ast::Expr::IsNotNull(e) => {
            extract_columns_from_expr(e, columns);
        }
        ast::Expr::Subquery(_) => {}
        _ => {}
    }
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
            SqlDialect::PostgreSQL,
        );
        assert_eq!(doc.statements[0].ctes.len(), 1);
        assert_eq!(doc.statements[0].ctes[0].name, "active");
    }

    #[test]
    fn test_extract_unqualified_columns() {
        let doc = parse_document("SELECT id, name FROM users", SqlDialect::PostgreSQL);
        let cols = &doc.statements[0].columns;
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "id");
        assert!(cols[0].table.is_none());
        assert_eq!(cols[1].name, "name");
    }

    #[test]
    fn test_extract_qualified_columns() {
        let doc = parse_document("SELECT u.id, u.name FROM users u", SqlDialect::PostgreSQL);
        let cols = &doc.statements[0].columns;
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "id");
        assert_eq!(cols[0].table.as_deref(), Some("u"));
        assert_eq!(cols[1].name, "name");
        assert_eq!(cols[1].table.as_deref(), Some("u"));
    }

    #[test]
    fn test_extract_columns_from_where() {
        let doc = parse_document(
            "SELECT id FROM users WHERE active = true AND age > 18",
            SqlDialect::PostgreSQL,
        );
        let col_names: Vec<_> = doc.statements[0]
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect();
        assert!(col_names.contains(&"id"));
        assert!(col_names.contains(&"active"));
        assert!(col_names.contains(&"age"));
    }

    #[test]
    fn test_extract_wildcard() {
        let doc = parse_document("SELECT * FROM users", SqlDialect::PostgreSQL);
        assert_eq!(doc.statements[0].columns.len(), 1);
        assert_eq!(doc.statements[0].columns[0].name, "*");
        assert!(doc.statements[0].columns[0].table.is_none());
    }

    #[test]
    fn test_extract_qualified_wildcard() {
        let doc = parse_document("SELECT u.* FROM users u", SqlDialect::PostgreSQL);
        assert_eq!(doc.statements[0].columns.len(), 1);
        assert_eq!(doc.statements[0].columns[0].name, "*");
        assert_eq!(doc.statements[0].columns[0].table.as_deref(), Some("u"));
    }

    #[test]
    fn test_parse_error_keeps_fallback_statement_for_heuristics() {
        let doc = parse_document("selct * form users", SqlDialect::PostgreSQL);
        assert!(!doc.errors.is_empty());
        assert_eq!(doc.statements.len(), 1);
        assert_eq!(doc.statements[0].statement_type, None);
    }
}
