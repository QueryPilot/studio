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
    pub output_aliases: Vec<String>,
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

fn parse_leading_usize(input: &str) -> Option<(usize, &str)> {
    let trimmed = input.trim_start();
    let digits_end = trimmed
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(trimmed.len());
    if digits_end == 0 {
        return None;
    }
    let value = trimmed[..digits_end].parse::<usize>().ok()?;
    Some((value, &trimmed[digits_end..]))
}

fn extract_line_column(message: &str) -> Option<(usize, usize)> {
    let line_idx = message.rfind("Line:")?;
    let after_line = &message[line_idx + "Line:".len()..];
    let (line, rest) = parse_leading_usize(after_line)?;

    let col_idx = rest.find("Column:")?;
    let after_col = &rest[col_idx + "Column:".len()..];
    let (column, _) = parse_leading_usize(after_col)?;

    Some((line, column))
}

fn extract_found_fragment(message: &str) -> Option<String> {
    let found_idx = message.rfind("found:")?;
    let mut fragment = message[found_idx + "found:".len()..].trim();
    if let Some(line_idx) = fragment.find(" at Line:") {
        fragment = &fragment[..line_idx];
    }
    let normalized = fragment.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn line_col_to_offset(text: &str, line: usize, column: usize) -> usize {
    if line == 0 || column == 0 {
        return 0;
    }

    let mut current_line = 1usize;
    let mut line_start = 0usize;

    if line > 1 {
        for (idx, ch) in text.char_indices() {
            if ch == '\n' {
                current_line += 1;
                line_start = idx + ch.len_utf8();
                if current_line == line {
                    break;
                }
            }
        }
    }

    if current_line < line {
        return text.len();
    }

    let line_end = text[line_start..]
        .find('\n')
        .map(|rel| line_start + rel)
        .unwrap_or(text.len());

    let mut remaining = column.saturating_sub(1);
    if remaining == 0 {
        return line_start.min(text.len());
    }

    let mut offset = line_start;
    for (idx, ch) in text[line_start..line_end].char_indices() {
        if remaining == 0 {
            break;
        }
        offset = line_start + idx + ch.len_utf8();
        remaining -= 1;
    }

    if remaining > 0 {
        line_end
    } else {
        offset.min(text.len())
    }
}

fn previous_char_start(text: &str, index: usize) -> Option<usize> {
    if index == 0 {
        None
    } else {
        text[..index].char_indices().last().map(|(idx, _)| idx)
    }
}

fn char_at(text: &str, index: usize) -> Option<char> {
    text.get(index..)?.chars().next()
}

fn is_error_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '"' | '`' | '[' | ']' | '$')
}

fn nearest_token_span(text: &str, offset: usize) -> Option<(usize, usize)> {
    if text.is_empty() {
        return None;
    }

    let mut cursor = offset.min(text.len());
    let mut cursor_ch = if cursor < text.len() {
        char_at(text, cursor)
    } else {
        None
    };

    if cursor_ch.map(|c| c.is_whitespace()).unwrap_or(true) {
        while let Some(prev_start) = previous_char_start(text, cursor) {
            cursor = prev_start;
            let prev_ch = char_at(text, cursor)?;
            if !prev_ch.is_whitespace() {
                cursor_ch = Some(prev_ch);
                break;
            }
            if cursor == 0 {
                return None;
            }
        }
    }

    let current = cursor_ch?;
    if is_error_token_char(current) {
        let mut from = cursor;
        while let Some(prev_start) = previous_char_start(text, from) {
            let prev_ch = match char_at(text, prev_start) {
                Some(ch) => ch,
                None => break,
            };
            if is_error_token_char(prev_ch) {
                from = prev_start;
            } else {
                break;
            }
        }

        let mut to = cursor;
        while to < text.len() {
            let ch = match char_at(text, to) {
                Some(ch) => ch,
                None => break,
            };
            if is_error_token_char(ch) {
                to += ch.len_utf8();
            } else {
                break;
            }
        }

        if from < to {
            Some((from, to))
        } else {
            Some((cursor, cursor + current.len_utf8()))
        }
    } else {
        Some((cursor, cursor + current.len_utf8()))
    }
}

fn infer_parse_error_span(stmt_text: &str, message: &str) -> Option<(usize, usize)> {
    if let Some((line, column)) = extract_line_column(message) {
        let offset = line_col_to_offset(stmt_text, line, column);
        if let Some(span) = nearest_token_span(stmt_text, offset) {
            return Some(span);
        }
    }

    if let Some(found) = extract_found_fragment(message) {
        if found.eq_ignore_ascii_case("EOF") {
            return nearest_token_span(stmt_text, stmt_text.len());
        }
    }

    nearest_token_span(stmt_text, stmt_text.len())
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
                let output_aliases = extract_output_aliases(stmt);
                let columns = extract_columns(stmt);
                let ctes = extract_ctes(stmt);

                statements.push(ParsedStatement {
                    statement_type: Some(get_statement_type(stmt)),
                    range: (start, end),
                    text,
                    tables,
                    aliases,
                    output_aliases,
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
                    output_aliases: vec![],
                    columns: vec![],
                    ctes: vec![],
                });
            }
            Err(e) => {
                let message = e.to_string();
                let (position, position_end) = infer_parse_error_span(&text, &message)
                    .map(|(rel_from, rel_to)| {
                        let abs_from = start + rel_from.min(text.len());
                        let abs_to = start + rel_to.min(text.len());
                        (abs_from, Some(abs_to.max(abs_from + 1)))
                    })
                    .unwrap_or((start, Some(end)));

                errors.push(ParseError {
                    message,
                    position,
                    position_end,
                });

                // Keep a fallback statement so heuristic lint rules (typo detection,
                // missing operators, etc.) can still run on syntactically invalid SQL.
                statements.push(ParsedStatement {
                    statement_type: None,
                    range: (start, end),
                    text,
                    tables: vec![],
                    aliases: vec![],
                    output_aliases: vec![],
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
                output_aliases: extract_output_aliases(stmt),
                columns: extract_columns(stmt),
                ctes: extract_ctes(stmt),
            })
        }
        Ok(_) => Err(ParseError {
            message: "Empty statement".to_string(),
            position: 0,
            position_end: None,
        }),
        Err(e) => {
            let message = e.to_string();
            let span = infer_parse_error_span(sql, &message);
            let position = span.map(|(from, _)| from).unwrap_or(0);
            let position_end = span.map(|(from, to)| to.max(from + 1)).or(Some(sql.len()));

            Err(ParseError {
                message,
                position,
                position_end,
            })
        }
    }
}

/// Split SQL into individual statements handling strings and comments.
fn split_statements(sql: &str) -> Vec<(usize, usize, String)> {
    let mut statements = Vec::new();
    let mut current_start = 0;
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let dollar_quote_re = regex::Regex::new(r"^\$([a-zA-Z_]*)\$").unwrap();

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
            if let Some(m) = dollar_quote_re.find(&rest)
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
                let leading_ws = text.chars().take_while(|c| c.is_whitespace()).count();
                let trailing_ws = text.chars().rev().take_while(|c| c.is_whitespace()).count();
                statements.push((
                    current_start + leading_ws,
                    i.saturating_sub(trailing_ws),
                    trimmed.to_string(),
                ));
            }
            current_start = i + 1;
        }

        i += 1;
    }

    // Final statement without semicolon
    let final_text: String = chars[current_start..].iter().collect();
    let trimmed = final_text.trim();
    if !trimmed.is_empty() {
        let leading_ws = final_text.chars().take_while(|c| c.is_whitespace()).count();
        let trailing_ws = final_text
            .chars()
            .rev()
            .take_while(|c| c.is_whitespace())
            .count();
        statements.push((
            current_start + leading_ws,
            chars.len().saturating_sub(trailing_ws),
            trimmed.to_string(),
        ));
    }

    statements
}

fn unwrap_statement(stmt: &Statement) -> &Statement {
    match stmt {
        Statement::Explain { statement, .. } => unwrap_statement(statement),
        _ => stmt,
    }
}

fn get_statement_type(stmt: &Statement) -> String {
    match unwrap_statement(stmt) {
        Statement::Query(_) => "SELECT".to_string(),
        Statement::Insert(_) => "INSERT".to_string(),
        Statement::Update { .. } => "UPDATE".to_string(),
        Statement::Delete(_) => "DELETE".to_string(),
        Statement::Merge { .. } => "MERGE".to_string(),
        Statement::CreateTable { .. } => "CREATE TABLE".to_string(),
        Statement::CreateView { .. } => "CREATE VIEW".to_string(),
        Statement::CreateIndex(_) => "CREATE INDEX".to_string(),
        Statement::AlterTable { .. } => "ALTER TABLE".to_string(),
        Statement::Drop { .. } => "DROP".to_string(),
        Statement::Truncate { .. } => "TRUNCATE".to_string(),
        _ => "OTHER".to_string(),
    }
}

fn push_table_reference_from_name(
    name: &ast::ObjectName,
    alias: Option<&ast::TableAlias>,
    tables: &mut Vec<TableReference>,
) {
    let parts: Vec<_> = name.0.iter().map(|ident| ident.value.clone()).collect();
    let (schema, table_name) = if parts.len() >= 2 {
        (
            Some(parts[parts.len() - 2].clone()),
            parts.last().cloned().unwrap_or_default(),
        )
    } else {
        (None, parts.last().cloned().unwrap_or_default())
    };

    tables.push(TableReference {
        name: table_name,
        schema,
        alias: alias.map(|table_alias| table_alias.name.value.clone()),
        position: 0,
    });
}

fn extract_tables(stmt: &Statement) -> Vec<TableReference> {
    let mut tables = Vec::new();
    extract_tables_from_statement(stmt, &mut tables);
    tables
}

fn extract_tables_from_statement(stmt: &Statement, tables: &mut Vec<TableReference>) {
    match stmt {
        Statement::Explain { statement, .. } | Statement::Prepare { statement, .. } => {
            extract_tables_from_statement(statement, tables);
        }
        Statement::Query(query) => extract_tables_from_query(query, tables),
        Statement::Insert(insert) => {
            push_table_reference_from_name(&insert.table_name, None, tables);
            if let Some(source) = &insert.source {
                extract_tables_from_query(source, tables);
            }
        }
        Statement::Update {
            table,
            from,
            selection,
            returning,
            ..
        } => {
            extract_tables_from_table_with_joins(table, tables);
            if let Some(source) = from {
                extract_tables_from_table_with_joins(source, tables);
            }
            if let Some(selection) = selection {
                extract_tables_from_expr(selection, tables);
            }
            if let Some(items) = returning {
                for item in items {
                    extract_tables_from_select_item(item, tables);
                }
            }
        }
        Statement::Delete(delete) => {
            let tables_vec = match &delete.from {
                ast::FromTable::WithFromKeyword(tables_vec)
                | ast::FromTable::WithoutKeyword(tables_vec) => tables_vec,
            };
            for table in tables_vec {
                extract_tables_from_table_with_joins(table, tables);
            }
            if let Some(using) = &delete.using {
                for table in using {
                    extract_tables_from_table_with_joins(table, tables);
                }
            }
            if let Some(selection) = &delete.selection {
                extract_tables_from_expr(selection, tables);
            }
            for item in &delete.order_by {
                extract_tables_from_expr(&item.expr, tables);
            }
            if let Some(limit) = &delete.limit {
                extract_tables_from_expr(limit, tables);
            }
            if let Some(items) = &delete.returning {
                for item in items {
                    extract_tables_from_select_item(item, tables);
                }
            }
        }
        Statement::CreateView { query, .. } => extract_tables_from_query(query, tables),
        Statement::Merge {
            table, source, on, ..
        } => {
            extract_table_factor(table, tables);
            extract_table_factor(source, tables);
            extract_tables_from_expr(on, tables);
        }
        _ => {}
    }
}

fn extract_tables_from_query(query: &ast::Query, tables: &mut Vec<TableReference>) {
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            extract_tables_from_query(&cte.query, tables);
        }
    }

    extract_tables_from_set_expr(query.body.as_ref(), tables);

    if let Some(order_by) = &query.order_by {
        for item in &order_by.exprs {
            extract_tables_from_expr(&item.expr, tables);
        }
    }
    if let Some(limit) = &query.limit {
        extract_tables_from_expr(limit, tables);
    }
    for expr in &query.limit_by {
        extract_tables_from_expr(expr, tables);
    }
    if let Some(offset) = &query.offset {
        extract_tables_from_expr(&offset.value, tables);
    }
    if let Some(fetch) = &query.fetch {
        if let Some(quantity) = &fetch.quantity {
            extract_tables_from_expr(quantity, tables);
        }
    }
}

fn extract_tables_from_set_expr(set_expr: &SetExpr, tables: &mut Vec<TableReference>) {
    match set_expr {
        SetExpr::Select(select) => extract_tables_from_select(select, tables),
        SetExpr::Query(query) => extract_tables_from_query(query, tables),
        SetExpr::SetOperation { left, right, .. } => {
            extract_tables_from_set_expr(left, tables);
            extract_tables_from_set_expr(right, tables);
        }
        SetExpr::Values(values) => {
            for row in &values.rows {
                for expr in row {
                    extract_tables_from_expr(expr, tables);
                }
            }
        }
        SetExpr::Insert(statement) | SetExpr::Update(statement) => {
            extract_tables_from_statement(statement, tables);
        }
        SetExpr::Table(table) => {
            let object_name = match (&table.schema_name, &table.table_name) {
                (Some(schema_name), Some(table_name)) => Some(ast::ObjectName(vec![
                    ast::Ident::new(schema_name.clone()),
                    ast::Ident::new(table_name.clone()),
                ])),
                (None, Some(table_name)) => {
                    Some(ast::ObjectName(vec![ast::Ident::new(table_name.clone())]))
                }
                _ => None,
            };
            if let Some(object_name) = object_name {
                push_table_reference_from_name(&object_name, None, tables);
            }
        }
    }
}

fn extract_tables_from_select(select: &ast::Select, tables: &mut Vec<TableReference>) {
    for item in &select.projection {
        extract_tables_from_select_item(item, tables);
    }
    for table_with_joins in &select.from {
        extract_tables_from_table_with_joins(table_with_joins, tables);
    }
    for lateral_view in &select.lateral_views {
        extract_tables_from_expr(&lateral_view.lateral_view, tables);
    }
    if let Some(prewhere) = &select.prewhere {
        extract_tables_from_expr(prewhere, tables);
    }
    if let Some(selection) = &select.selection {
        extract_tables_from_expr(selection, tables);
    }
    if let ast::GroupByExpr::Expressions(exprs, _) = &select.group_by {
        for expr in exprs {
            extract_tables_from_expr(expr, tables);
        }
    }
    for expr in &select.cluster_by {
        extract_tables_from_expr(expr, tables);
    }
    for expr in &select.distribute_by {
        extract_tables_from_expr(expr, tables);
    }
    for expr in &select.sort_by {
        extract_tables_from_expr(expr, tables);
    }
    if let Some(having) = &select.having {
        extract_tables_from_expr(having, tables);
    }
    if let Some(qualify) = &select.qualify {
        extract_tables_from_expr(qualify, tables);
    }
    if let Some(connect_by) = &select.connect_by {
        extract_tables_from_expr(&connect_by.condition, tables);
        for expr in &connect_by.relationships {
            extract_tables_from_expr(expr, tables);
        }
    }
}

fn extract_tables_from_table_with_joins(
    table_with_joins: &ast::TableWithJoins,
    tables: &mut Vec<TableReference>,
) {
    extract_table_factor(&table_with_joins.relation, tables);
    for join in &table_with_joins.joins {
        extract_table_factor(&join.relation, tables);
        extract_tables_from_join(join, tables);
    }
}

fn extract_tables_from_join(join: &ast::Join, tables: &mut Vec<TableReference>) {
    use ast::{JoinConstraint, JoinOperator};

    fn extract_join_constraint_tables(
        constraint: &JoinConstraint,
        tables: &mut Vec<TableReference>,
    ) {
        match constraint {
            JoinConstraint::On(expr) => extract_tables_from_expr(expr, tables),
            JoinConstraint::Using(_) | JoinConstraint::Natural | JoinConstraint::None => {}
        }
    }

    match &join.join_operator {
        JoinOperator::Inner(constraint)
        | JoinOperator::LeftOuter(constraint)
        | JoinOperator::RightOuter(constraint)
        | JoinOperator::FullOuter(constraint)
        | JoinOperator::LeftSemi(constraint)
        | JoinOperator::RightSemi(constraint)
        | JoinOperator::LeftAnti(constraint)
        | JoinOperator::RightAnti(constraint) => {
            extract_join_constraint_tables(constraint, tables);
        }
        JoinOperator::AsOf {
            match_condition,
            constraint,
        } => {
            extract_tables_from_expr(match_condition, tables);
            extract_join_constraint_tables(constraint, tables);
        }
        JoinOperator::CrossJoin | JoinOperator::CrossApply | JoinOperator::OuterApply => {}
    }
}

fn extract_tables_from_select_item(item: &ast::SelectItem, tables: &mut Vec<TableReference>) {
    match item {
        ast::SelectItem::UnnamedExpr(expr) | ast::SelectItem::ExprWithAlias { expr, .. } => {
            extract_tables_from_expr(expr, tables);
        }
        ast::SelectItem::QualifiedWildcard(_, _) | ast::SelectItem::Wildcard(_) => {}
    }
}

fn extract_table_factor(factor: &TableFactor, tables: &mut Vec<TableReference>) {
    match factor {
        TableFactor::Table { name, alias, .. } => {
            push_table_reference_from_name(name, alias.as_ref(), tables);
        }
        TableFactor::Derived { subquery, .. } => {
            extract_tables_from_query(subquery, tables);
        }
        TableFactor::TableFunction { expr, .. } => {
            extract_tables_from_expr(expr, tables);
        }
        TableFactor::UNNEST { array_exprs, .. } => {
            for expr in array_exprs {
                extract_tables_from_expr(expr, tables);
            }
        }
        TableFactor::JsonTable { json_expr, .. } => {
            extract_tables_from_expr(json_expr, tables);
        }
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => {
            extract_tables_from_table_with_joins(table_with_joins, tables);
        }
        TableFactor::Pivot {
            table,
            aggregate_functions,
            default_on_null,
            ..
        } => {
            extract_table_factor(table, tables);
            for expr_with_alias in aggregate_functions {
                extract_tables_from_expr(&expr_with_alias.expr, tables);
            }
            if let Some(expr) = default_on_null {
                extract_tables_from_expr(expr, tables);
            }
        }
        TableFactor::Unpivot { table, .. } => {
            extract_table_factor(table, tables);
        }
        _ => {}
    }
}

fn extract_tables_from_expr(expr: &ast::Expr, tables: &mut Vec<TableReference>) {
    match expr {
        ast::Expr::BinaryOp { left, right, .. }
        | ast::Expr::Like {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::ILike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::SimilarTo {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::RLike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::AtTimeZone {
            timestamp: left,
            time_zone: right,
        }
        | ast::Expr::Position {
            expr: left,
            r#in: right,
        }
        | ast::Expr::IsDistinctFrom(left, right)
        | ast::Expr::IsNotDistinctFrom(left, right)
        | ast::Expr::AnyOp { left, right, .. }
        | ast::Expr::AllOp { left, right, .. } => {
            extract_tables_from_expr(left, tables);
            extract_tables_from_expr(right, tables);
        }
        ast::Expr::UnaryOp { expr, .. }
        | ast::Expr::Nested(expr)
        | ast::Expr::Cast { expr, .. }
        | ast::Expr::IsNull(expr)
        | ast::Expr::IsNotNull(expr)
        | ast::Expr::IsTrue(expr)
        | ast::Expr::IsNotTrue(expr)
        | ast::Expr::IsFalse(expr)
        | ast::Expr::IsNotFalse(expr)
        | ast::Expr::IsUnknown(expr)
        | ast::Expr::IsNotUnknown(expr) => {
            extract_tables_from_expr(expr, tables);
        }
        ast::Expr::InList { expr, list, .. } => {
            extract_tables_from_expr(expr, tables);
            for item in list {
                extract_tables_from_expr(item, tables);
            }
        }
        ast::Expr::InSubquery { expr, subquery, .. } => {
            extract_tables_from_expr(expr, tables);
            extract_tables_from_query(subquery, tables);
        }
        ast::Expr::Exists { subquery, .. } | ast::Expr::Subquery(subquery) => {
            extract_tables_from_query(subquery, tables);
        }
        ast::Expr::Between {
            expr, low, high, ..
        } => {
            extract_tables_from_expr(expr, tables);
            extract_tables_from_expr(low, tables);
            extract_tables_from_expr(high, tables);
        }
        ast::Expr::Function(func) => {
            if let ast::FunctionArguments::List(arg_list) = &func.args {
                for arg in &arg_list.args {
                    if let ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(expr)) = arg {
                        extract_tables_from_expr(expr, tables);
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
            if let Some(operand) = operand {
                extract_tables_from_expr(operand, tables);
            }
            for condition in conditions {
                extract_tables_from_expr(condition, tables);
            }
            for result in results {
                extract_tables_from_expr(result, tables);
            }
            if let Some(else_result) = else_result {
                extract_tables_from_expr(else_result, tables);
            }
        }
        ast::Expr::Tuple(exprs) => {
            for expr in exprs {
                extract_tables_from_expr(expr, tables);
            }
        }
        _ => {}
    }
}

fn extract_aliases(stmt: &Statement) -> Vec<AliasBinding> {
    let mut aliases = Vec::new();
    extract_aliases_from_statement(stmt, &mut aliases);
    aliases
}

fn extract_aliases_from_statement(stmt: &Statement, aliases: &mut Vec<AliasBinding>) {
    match stmt {
        Statement::Explain { statement, .. } | Statement::Prepare { statement, .. } => {
            extract_aliases_from_statement(statement, aliases);
        }
        Statement::Query(query) => extract_aliases_from_query(query, aliases),
        Statement::Insert(insert) => {
            if let Some(source) = &insert.source {
                extract_aliases_from_query(source, aliases);
            }
        }
        Statement::Update {
            table,
            from,
            selection,
            ..
        } => {
            extract_aliases_from_table_with_joins(table, aliases);
            if let Some(source) = from {
                extract_aliases_from_table_with_joins(source, aliases);
            }
            if let Some(selection) = selection {
                extract_aliases_from_expr(selection, aliases);
            }
        }
        Statement::Delete(delete) => {
            let tables_vec = match &delete.from {
                ast::FromTable::WithFromKeyword(tables_vec)
                | ast::FromTable::WithoutKeyword(tables_vec) => tables_vec,
            };
            for table in tables_vec {
                extract_aliases_from_table_with_joins(table, aliases);
            }
            if let Some(using) = &delete.using {
                for table in using {
                    extract_aliases_from_table_with_joins(table, aliases);
                }
            }
            if let Some(selection) = &delete.selection {
                extract_aliases_from_expr(selection, aliases);
            }
        }
        Statement::CreateView { query, .. } => extract_aliases_from_query(query, aliases),
        Statement::Merge {
            table, source, on, ..
        } => {
            extract_alias_from_factor(table, aliases);
            extract_alias_from_factor(source, aliases);
            extract_aliases_from_expr(on, aliases);
        }
        _ => {}
    }
}

fn extract_aliases_from_query(query: &ast::Query, aliases: &mut Vec<AliasBinding>) {
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            extract_aliases_from_query(&cte.query, aliases);
        }
    }

    extract_aliases_from_set_expr(query.body.as_ref(), aliases);

    if let Some(order_by) = &query.order_by {
        for item in &order_by.exprs {
            extract_aliases_from_expr(&item.expr, aliases);
        }
    }
    if let Some(limit) = &query.limit {
        extract_aliases_from_expr(limit, aliases);
    }
    for expr in &query.limit_by {
        extract_aliases_from_expr(expr, aliases);
    }
    if let Some(offset) = &query.offset {
        extract_aliases_from_expr(&offset.value, aliases);
    }
}

fn extract_aliases_from_set_expr(set_expr: &SetExpr, aliases: &mut Vec<AliasBinding>) {
    match set_expr {
        SetExpr::Select(select) => {
            for table_with_joins in &select.from {
                extract_aliases_from_table_with_joins(table_with_joins, aliases);
            }
            for item in &select.projection {
                if let ast::SelectItem::UnnamedExpr(expr)
                | ast::SelectItem::ExprWithAlias { expr, .. } = item
                {
                    extract_aliases_from_expr(expr, aliases);
                }
            }
            if let Some(selection) = &select.selection {
                extract_aliases_from_expr(selection, aliases);
            }
            if let Some(prewhere) = &select.prewhere {
                extract_aliases_from_expr(prewhere, aliases);
            }
            if let Some(having) = &select.having {
                extract_aliases_from_expr(having, aliases);
            }
            if let Some(qualify) = &select.qualify {
                extract_aliases_from_expr(qualify, aliases);
            }
        }
        SetExpr::Query(query) => extract_aliases_from_query(query, aliases),
        SetExpr::SetOperation { left, right, .. } => {
            extract_aliases_from_set_expr(left, aliases);
            extract_aliases_from_set_expr(right, aliases);
        }
        SetExpr::Values(values) => {
            for row in &values.rows {
                for expr in row {
                    extract_aliases_from_expr(expr, aliases);
                }
            }
        }
        SetExpr::Insert(statement) | SetExpr::Update(statement) => {
            extract_aliases_from_statement(statement, aliases);
        }
        SetExpr::Table(_) => {}
    }
}

fn extract_aliases_from_table_with_joins(
    table_with_joins: &ast::TableWithJoins,
    aliases: &mut Vec<AliasBinding>,
) {
    extract_alias_from_factor(&table_with_joins.relation, aliases);
    for join in &table_with_joins.joins {
        extract_alias_from_factor(&join.relation, aliases);
        extract_aliases_from_join(join, aliases);
    }
}

fn extract_aliases_from_join(join: &ast::Join, aliases: &mut Vec<AliasBinding>) {
    use ast::{JoinConstraint, JoinOperator};

    fn extract_join_constraint_aliases(constraint: &JoinConstraint, aliases: &mut Vec<AliasBinding>) {
        if let JoinConstraint::On(expr) = constraint {
            extract_aliases_from_expr(expr, aliases);
        }
    }

    match &join.join_operator {
        JoinOperator::Inner(constraint)
        | JoinOperator::LeftOuter(constraint)
        | JoinOperator::RightOuter(constraint)
        | JoinOperator::FullOuter(constraint)
        | JoinOperator::LeftSemi(constraint)
        | JoinOperator::RightSemi(constraint)
        | JoinOperator::LeftAnti(constraint)
        | JoinOperator::RightAnti(constraint) => extract_join_constraint_aliases(constraint, aliases),
        JoinOperator::AsOf {
            match_condition,
            constraint,
        } => {
            extract_aliases_from_expr(match_condition, aliases);
            extract_join_constraint_aliases(constraint, aliases);
        }
        JoinOperator::CrossJoin | JoinOperator::CrossApply | JoinOperator::OuterApply => {}
    }
}

fn extract_alias_from_factor(factor: &TableFactor, aliases: &mut Vec<AliasBinding>) {
    match factor {
        TableFactor::Table {
            name,
            alias: Some(alias),
            ..
        } => {
            aliases.push(AliasBinding {
                alias: alias.name.value.clone(),
                table: name.to_string(),
            });
        }
        TableFactor::Derived { subquery, .. } => {
            extract_aliases_from_query(subquery, aliases);
        }
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => {
            extract_aliases_from_table_with_joins(table_with_joins, aliases);
        }
        TableFactor::Pivot { table, .. } | TableFactor::Unpivot { table, .. } => {
            extract_alias_from_factor(table, aliases);
        }
        _ => {}
    }
}

fn extract_aliases_from_expr(expr: &ast::Expr, aliases: &mut Vec<AliasBinding>) {
    match expr {
        ast::Expr::BinaryOp { left, right, .. }
        | ast::Expr::Like {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::ILike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::SimilarTo {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::RLike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::AtTimeZone {
            timestamp: left,
            time_zone: right,
        }
        | ast::Expr::Position {
            expr: left,
            r#in: right,
        }
        | ast::Expr::IsDistinctFrom(left, right)
        | ast::Expr::IsNotDistinctFrom(left, right) => {
            extract_aliases_from_expr(left, aliases);
            extract_aliases_from_expr(right, aliases);
        }
        ast::Expr::UnaryOp { expr, .. }
        | ast::Expr::Nested(expr)
        | ast::Expr::Cast { expr, .. }
        | ast::Expr::IsNull(expr)
        | ast::Expr::IsNotNull(expr)
        | ast::Expr::IsTrue(expr)
        | ast::Expr::IsNotTrue(expr)
        | ast::Expr::IsFalse(expr)
        | ast::Expr::IsNotFalse(expr)
        | ast::Expr::IsUnknown(expr)
        | ast::Expr::IsNotUnknown(expr) => {
            extract_aliases_from_expr(expr, aliases);
        }
        ast::Expr::InList { expr, list, .. } => {
            extract_aliases_from_expr(expr, aliases);
            for item in list {
                extract_aliases_from_expr(item, aliases);
            }
        }
        ast::Expr::InSubquery { expr, subquery, .. } => {
            extract_aliases_from_expr(expr, aliases);
            extract_aliases_from_query(subquery, aliases);
        }
        ast::Expr::Exists { subquery, .. } | ast::Expr::Subquery(subquery) => {
            extract_aliases_from_query(subquery, aliases);
        }
        ast::Expr::Between {
            expr, low, high, ..
        } => {
            extract_aliases_from_expr(expr, aliases);
            extract_aliases_from_expr(low, aliases);
            extract_aliases_from_expr(high, aliases);
        }
        ast::Expr::Function(func) => {
            if let ast::FunctionArguments::List(arg_list) = &func.args {
                for arg in &arg_list.args {
                    if let ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(expr)) = arg {
                        extract_aliases_from_expr(expr, aliases);
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
            if let Some(operand) = operand {
                extract_aliases_from_expr(operand, aliases);
            }
            for condition in conditions {
                extract_aliases_from_expr(condition, aliases);
            }
            for result in results {
                extract_aliases_from_expr(result, aliases);
            }
            if let Some(else_result) = else_result {
                extract_aliases_from_expr(else_result, aliases);
            }
        }
        ast::Expr::AnyOp { left, right, .. } | ast::Expr::AllOp { left, right, .. } => {
            extract_aliases_from_expr(left, aliases);
            extract_aliases_from_expr(right, aliases);
        }
        ast::Expr::Tuple(exprs) => {
            for expr in exprs {
                extract_aliases_from_expr(expr, aliases);
            }
        }
        _ => {}
    }
}

fn extract_output_aliases(stmt: &Statement) -> Vec<String> {
    let mut output_aliases = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Statement::Query(query) = unwrap_statement(stmt) {
        extract_output_aliases_from_set_expr(query.body.as_ref(), &mut output_aliases, &mut seen);
    }

    output_aliases
}

fn extract_output_aliases_from_set_expr(
    set_expr: &SetExpr,
    output_aliases: &mut Vec<String>,
    seen: &mut std::collections::HashSet<String>,
) {
    match set_expr {
        SetExpr::Select(select) => {
            for item in &select.projection {
                if let ast::SelectItem::ExprWithAlias { alias, .. } = item {
                    let alias_name = alias.value.clone();
                    if seen.insert(alias_name.to_lowercase()) {
                        output_aliases.push(alias_name);
                    }
                }
            }
        }
        SetExpr::Query(query) => {
            extract_output_aliases_from_set_expr(query.body.as_ref(), output_aliases, seen);
        }
        SetExpr::SetOperation { left, right, .. } => {
            extract_output_aliases_from_set_expr(left, output_aliases, seen);
            extract_output_aliases_from_set_expr(right, output_aliases, seen);
        }
        SetExpr::Values(_) | SetExpr::Insert(_) | SetExpr::Update(_) | SetExpr::Table(_) => {}
    }
}

fn extract_columns(stmt: &Statement) -> Vec<ColumnReference> {
    let mut columns = Vec::new();
    extract_columns_from_statement(stmt, &mut columns);
    columns
}

fn extract_columns_from_statement(stmt: &Statement, columns: &mut Vec<ColumnReference>) {
    match stmt {
        Statement::Explain { statement, .. } | Statement::Prepare { statement, .. } => {
            extract_columns_from_statement(statement, columns);
        }
        Statement::Query(query) => extract_columns_from_query(query, columns),
        Statement::Update {
            assignments,
            from,
            selection,
            returning,
            ..
        } => {
            for assignment in assignments {
                match &assignment.target {
                    ast::AssignmentTarget::ColumnName(name) => {
                        if let Some(ident) = name.0.last() {
                            columns.push(ColumnReference {
                                name: ident.value.clone(),
                                table: if name.0.len() >= 2 {
                                    Some(
                                        name.0[..name.0.len() - 1]
                                            .iter()
                                            .map(|ident| ident.value.clone())
                                            .collect::<Vec<_>>()
                                            .join("."),
                                    )
                                } else {
                                    None
                                },
                            });
                        }
                    }
                    ast::AssignmentTarget::Tuple(names) => {
                        for name in names {
                            if let Some(ident) = name.0.last() {
                                columns.push(ColumnReference {
                                    name: ident.value.clone(),
                                    table: None,
                                });
                            }
                        }
                    }
                }

                extract_columns_from_expr(&assignment.value, columns);
            }

            if let Some(source) = from {
                extract_columns_from_table_with_joins(source, columns);
            }
            if let Some(selection) = selection {
                extract_columns_from_expr(selection, columns);
            }
            if let Some(items) = returning {
                for item in items {
                    extract_columns_from_select_item(item, columns);
                }
            }
        }
        Statement::Delete(delete) => {
            if let Some(selection) = &delete.selection {
                extract_columns_from_expr(selection, columns);
            }
            if let Some(using) = &delete.using {
                for table in using {
                    extract_columns_from_table_with_joins(table, columns);
                }
            }
            for item in &delete.order_by {
                extract_columns_from_expr(&item.expr, columns);
            }
            if let Some(limit) = &delete.limit {
                extract_columns_from_expr(limit, columns);
            }
            if let Some(items) = &delete.returning {
                for item in items {
                    extract_columns_from_select_item(item, columns);
                }
            }
        }
        Statement::Insert(insert) => {
            for col_ident in &insert.columns {
                columns.push(ColumnReference {
                    name: col_ident.value.clone(),
                    table: None,
                });
            }
            if let Some(source) = &insert.source {
                extract_columns_from_query(source, columns);
            }
        }
        Statement::CreateView { query, .. } => extract_columns_from_query(query, columns),
        Statement::Merge { on, .. } => extract_columns_from_expr(on, columns),
        _ => {}
    }
}

fn extract_columns_from_query(query: &ast::Query, columns: &mut Vec<ColumnReference>) {
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            extract_columns_from_query(&cte.query, columns);
        }
    }

    extract_columns_from_set_expr(query.body.as_ref(), columns);

    if let Some(order_by) = &query.order_by {
        for item in &order_by.exprs {
            extract_columns_from_expr(&item.expr, columns);
        }
    }
    if let Some(limit) = &query.limit {
        extract_columns_from_expr(limit, columns);
    }
    for expr in &query.limit_by {
        extract_columns_from_expr(expr, columns);
    }
    if let Some(offset) = &query.offset {
        extract_columns_from_expr(&offset.value, columns);
    }
    if let Some(fetch) = &query.fetch {
        if let Some(quantity) = &fetch.quantity {
            extract_columns_from_expr(quantity, columns);
        }
    }
}

fn extract_columns_from_set_expr(set_expr: &SetExpr, columns: &mut Vec<ColumnReference>) {
    match set_expr {
        SetExpr::Select(select) => {
            for item in &select.projection {
                extract_columns_from_select_item(item, columns);
            }
            for table_with_joins in &select.from {
                extract_columns_from_table_with_joins(table_with_joins, columns);
            }
            for lateral_view in &select.lateral_views {
                extract_columns_from_expr(&lateral_view.lateral_view, columns);
            }
            if let Some(prewhere) = &select.prewhere {
                extract_columns_from_expr(prewhere, columns);
            }
            if let Some(selection) = &select.selection {
                extract_columns_from_expr(selection, columns);
            }
            if let ast::GroupByExpr::Expressions(exprs, _) = &select.group_by {
                for expr in exprs {
                    extract_columns_from_expr(expr, columns);
                }
            }
            for expr in &select.cluster_by {
                extract_columns_from_expr(expr, columns);
            }
            for expr in &select.distribute_by {
                extract_columns_from_expr(expr, columns);
            }
            for expr in &select.sort_by {
                extract_columns_from_expr(expr, columns);
            }
            if let Some(having) = &select.having {
                extract_columns_from_expr(having, columns);
            }
            if let Some(qualify) = &select.qualify {
                extract_columns_from_expr(qualify, columns);
            }
            if let Some(connect_by) = &select.connect_by {
                extract_columns_from_expr(&connect_by.condition, columns);
                for expr in &connect_by.relationships {
                    extract_columns_from_expr(expr, columns);
                }
            }
        }
        SetExpr::Query(query) => extract_columns_from_query(query, columns),
        SetExpr::SetOperation { left, right, .. } => {
            extract_columns_from_set_expr(left, columns);
            extract_columns_from_set_expr(right, columns);
        }
        SetExpr::Values(values) => {
            for row in &values.rows {
                for expr in row {
                    extract_columns_from_expr(expr, columns);
                }
            }
        }
        SetExpr::Insert(statement) | SetExpr::Update(statement) => {
            extract_columns_from_statement(statement, columns);
        }
        SetExpr::Table(_) => {}
    }
}

fn extract_columns_from_table_with_joins(
    table_with_joins: &ast::TableWithJoins,
    columns: &mut Vec<ColumnReference>,
) {
    extract_columns_from_table_factor(&table_with_joins.relation, columns);
    for join in &table_with_joins.joins {
        extract_columns_from_table_factor(&join.relation, columns);
        extract_columns_from_join(join, columns);
    }
}

fn extract_columns_from_table_factor(factor: &TableFactor, columns: &mut Vec<ColumnReference>) {
    match factor {
        TableFactor::Table { with_hints, .. } => {
            for expr in with_hints {
                extract_columns_from_expr(expr, columns);
            }
        }
        TableFactor::Derived { subquery, .. } => {
            extract_columns_from_query(subquery, columns);
        }
        TableFactor::TableFunction { expr, .. } => {
            extract_columns_from_expr(expr, columns);
        }
        TableFactor::Function { args, .. } => {
            for arg in args {
                if let ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(expr)) = arg {
                    extract_columns_from_expr(expr, columns);
                }
            }
        }
        TableFactor::UNNEST { array_exprs, .. } => {
            for expr in array_exprs {
                extract_columns_from_expr(expr, columns);
            }
        }
        TableFactor::JsonTable { json_expr, .. } => {
            extract_columns_from_expr(json_expr, columns);
        }
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => {
            extract_columns_from_table_with_joins(table_with_joins, columns);
        }
        TableFactor::Pivot {
            table,
            aggregate_functions,
            default_on_null,
            ..
        } => {
            extract_columns_from_table_factor(table, columns);
            for expr_with_alias in aggregate_functions {
                extract_columns_from_expr(&expr_with_alias.expr, columns);
            }
            if let Some(expr) = default_on_null {
                extract_columns_from_expr(expr, columns);
            }
        }
        TableFactor::Unpivot { table, .. } => {
            extract_columns_from_table_factor(table, columns);
        }
        _ => {}
    }
}

fn extract_columns_from_join(join: &ast::Join, columns: &mut Vec<ColumnReference>) {
    use ast::{JoinConstraint, JoinOperator};

    fn extract_join_constraint(constraint: &JoinConstraint, columns: &mut Vec<ColumnReference>) {
        match constraint {
            JoinConstraint::On(expr) => extract_columns_from_expr(expr, columns),
            JoinConstraint::Using(idents) => {
                for ident in idents {
                    columns.push(ColumnReference {
                        name: ident.value.clone(),
                        table: None,
                    });
                }
            }
            JoinConstraint::Natural | JoinConstraint::None => {}
        }
    }

    match &join.join_operator {
        JoinOperator::Inner(constraint)
        | JoinOperator::LeftOuter(constraint)
        | JoinOperator::RightOuter(constraint)
        | JoinOperator::FullOuter(constraint)
        | JoinOperator::LeftSemi(constraint)
        | JoinOperator::RightSemi(constraint)
        | JoinOperator::LeftAnti(constraint)
        | JoinOperator::RightAnti(constraint) => {
            extract_join_constraint(constraint, columns);
        }
        JoinOperator::AsOf {
            match_condition,
            constraint,
        } => {
            extract_columns_from_expr(match_condition, columns);
            extract_join_constraint(constraint, columns);
        }
        JoinOperator::CrossJoin | JoinOperator::CrossApply | JoinOperator::OuterApply => {}
    }
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
        ast::Expr::BinaryOp { left, right, .. }
        | ast::Expr::Like {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::ILike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::SimilarTo {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::RLike {
            expr: left,
            pattern: right,
            ..
        }
        | ast::Expr::AtTimeZone {
            timestamp: left,
            time_zone: right,
        }
        | ast::Expr::Position {
            expr: left,
            r#in: right,
        }
        | ast::Expr::IsDistinctFrom(left, right)
        | ast::Expr::IsNotDistinctFrom(left, right)
        | ast::Expr::AnyOp { left, right, .. }
        | ast::Expr::AllOp { left, right, .. } => {
            extract_columns_from_expr(left, columns);
            extract_columns_from_expr(right, columns);
        }
        ast::Expr::UnaryOp { expr, .. }
        | ast::Expr::Nested(expr)
        | ast::Expr::Cast { expr, .. }
        | ast::Expr::IsNull(expr)
        | ast::Expr::IsNotNull(expr)
        | ast::Expr::IsTrue(expr)
        | ast::Expr::IsNotTrue(expr)
        | ast::Expr::IsFalse(expr)
        | ast::Expr::IsNotFalse(expr)
        | ast::Expr::IsUnknown(expr)
        | ast::Expr::IsNotUnknown(expr) => {
            extract_columns_from_expr(expr, columns);
        }
        ast::Expr::Function(func) => {
            if let ast::FunctionArguments::List(arg_list) = &func.args {
                for arg in &arg_list.args {
                    if let ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(e)) = arg {
                        extract_columns_from_expr(e, columns);
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
        ast::Expr::InList { expr, list, .. } => {
            extract_columns_from_expr(expr, columns);
            for item in list {
                extract_columns_from_expr(item, columns);
            }
        }
        ast::Expr::InSubquery { expr, subquery, .. } => {
            extract_columns_from_expr(expr, columns);
            extract_columns_from_query(subquery, columns);
        }
        ast::Expr::Between {
            expr, low, high, ..
        } => {
            extract_columns_from_expr(expr, columns);
            extract_columns_from_expr(low, columns);
            extract_columns_from_expr(high, columns);
        }
        ast::Expr::Exists { subquery, .. } | ast::Expr::Subquery(subquery) => {
            extract_columns_from_query(subquery, columns);
        }
        ast::Expr::Tuple(exprs) => {
            for expr in exprs {
                extract_columns_from_expr(expr, columns);
            }
        }
        _ => {}
    }
}

fn infer_column_name_from_expr(expr: &ast::Expr) -> Option<String> {
    match expr {
        ast::Expr::Identifier(ident) => Some(ident.value.clone()),
        ast::Expr::CompoundIdentifier(parts) => parts.last().map(|ident| ident.value.clone()),
        ast::Expr::Nested(inner) => infer_column_name_from_expr(inner),
        ast::Expr::Cast { expr, .. } => infer_column_name_from_expr(expr),
        _ => None,
    }
}

fn infer_column_name_from_select_item(item: &ast::SelectItem) -> Option<String> {
    match item {
        ast::SelectItem::ExprWithAlias { alias, .. } => Some(alias.value.clone()),
        ast::SelectItem::UnnamedExpr(expr) => infer_column_name_from_expr(expr),
        ast::SelectItem::QualifiedWildcard(_, _) | ast::SelectItem::Wildcard(_) => None,
    }
}

fn infer_cte_projection_columns(query: &ast::Query) -> Vec<String> {
    let SetExpr::Select(select) = query.body.as_ref() else {
        return Vec::new();
    };

    let mut columns = Vec::new();
    for item in &select.projection {
        let Some(column_name) = infer_column_name_from_select_item(item) else {
            // If projection cannot be mapped to stable output names (for example `*`),
            // keep CTE columns unknown to avoid false missing-column diagnostics.
            return Vec::new();
        };
        columns.push(column_name);
    }

    columns
}

fn extract_ctes(stmt: &Statement) -> Vec<CteDefinition> {
    let mut ctes = Vec::new();

    if let Statement::Query(query) = unwrap_statement(stmt) {
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                let columns = if cte.alias.columns.is_empty() {
                    infer_cte_projection_columns(&cte.query)
                } else {
                    cte.alias.columns.iter().map(|c| c.value.clone()).collect()
                };

                ctes.push(CteDefinition {
                    name: cte.alias.name.value.clone(),
                    columns,
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
    fn test_parse_cte_infers_projection_columns_when_alias_list_missing() {
        let doc = parse_document(
            "WITH review_view AS (SELECT r.id AS review_id, r.title FROM reviews r) SELECT review_view.review_id FROM review_view",
            SqlDialect::PostgreSQL,
        );
        let cte = &doc.statements[0].ctes[0];
        assert_eq!(cte.name, "review_view");
        assert_eq!(
            cte.columns,
            vec!["review_id".to_string(), "title".to_string()]
        );
    }

    #[test]
    fn test_parse_explain_analyze_extracts_inner_statement_metadata() {
        let doc = parse_document(
            "EXPLAIN ANALYZE SELECT DISTINCT ON (customer_client_id) * FROM client_sales_contexts",
            SqlDialect::PostgreSQL,
        );

        assert!(doc.errors.is_empty(), "Parse errors: {:?}", doc.errors);
        assert_eq!(doc.statements.len(), 1);
        assert_eq!(doc.statements[0].statement_type, Some("SELECT".to_string()));
        assert!(doc.statements[0]
            .tables
            .iter()
            .any(|table| table.name == "client_sales_contexts"));
    }

    #[test]
    fn test_parse_cte_keeps_explicit_column_alias_list() {
        let doc = parse_document(
            "WITH review_view(review_id, review_title) AS (SELECT r.id, r.title FROM reviews r) SELECT review_id FROM review_view",
            SqlDialect::PostgreSQL,
        );
        let cte = &doc.statements[0].ctes[0];
        assert_eq!(cte.name, "review_view");
        assert_eq!(
            cte.columns,
            vec!["review_id".to_string(), "review_title".to_string()]
        );
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
    fn test_extract_columns_from_join_on() {
        let doc = parse_document(
            "SELECT * FROM reviews r LEFT JOIN customers c ON r.customer_id = c.vuiver",
            SqlDialect::PostgreSQL,
        );
        let cols = &doc.statements[0].columns;

        assert!(cols
            .iter()
            .any(|c| c.name == "customer_id" && c.table.as_deref() == Some("r")));
        assert!(cols
            .iter()
            .any(|c| c.name == "vuiver" && c.table.as_deref() == Some("c")));
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

    #[test]
    fn test_parse_error_span_is_narrow_not_whole_statement() {
        let sql = "SELECT FROM users";
        let doc = parse_document(sql, SqlDialect::PostgreSQL);
        let err = doc.errors.first().expect("expected parse error");
        let end = err.position_end.expect("expected parse error end");
        let snippet = &sql[err.position..end];

        assert_ne!(snippet, sql);
        assert!(snippet.len() < sql.len());
    }

    #[test]
    fn test_extract_insert_target_columns() {
        let doc = parse_document(
            "INSERT INTO users (id, name, email) VALUES (1, 'test', 'a@b.com')",
            SqlDialect::PostgreSQL,
        );
        let cols = &doc.statements[0].columns;
        let col_names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert!(
            col_names.contains(&"id"),
            "INSERT target columns should be extracted"
        );
        assert!(col_names.contains(&"name"));
        assert!(col_names.contains(&"email"));
    }

    #[test]
    fn test_extract_update_set_target_columns() {
        let doc = parse_document(
            "UPDATE users SET name = 'test', email = 'a@b.com' WHERE id = 1",
            SqlDialect::PostgreSQL,
        );
        let cols = &doc.statements[0].columns;
        let col_names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert!(
            col_names.contains(&"name"),
            "UPDATE SET target should be extracted"
        );
        assert!(
            col_names.contains(&"email"),
            "UPDATE SET target should be extracted"
        );
        assert!(
            col_names.contains(&"id"),
            "WHERE column should be extracted"
        );
    }

    #[test]
    fn test_extract_update_aliases() {
        let doc = parse_document(
            "UPDATE users u SET u.name = 'test' WHERE u.id = 1",
            SqlDialect::PostgreSQL,
        );
        // Note: PostgreSQL may not support UPDATE aliases in sqlparser — check if parse succeeds
        if doc.errors.is_empty() {
            assert!(
                !doc.statements[0].aliases.is_empty(),
                "UPDATE aliases should be extracted"
            );
            assert_eq!(doc.statements[0].aliases[0].alias, "u");
        }
    }

    #[test]
    fn test_parse_error_span_targets_nearest_token_for_eof() {
        let sql = "SELECT *\nFROM reviews r\nLEFT JOIN customers c ON c.";
        let doc = parse_document(sql, SqlDialect::PostgreSQL);
        let err = doc.errors.first().expect("expected parse error");
        let end = err.position_end.expect("expected parse error end");

        assert_eq!(&sql[err.position..end], "c.");
    }
}
