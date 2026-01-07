//! CTE (Common Table Expression) column inference.
//!
//! Infers column types and names from CTE definitions.

use serde::{Deserialize, Serialize};
use sqlparser::ast::{self, SetExpr, Statement};
use super::parser::ParsedStatement;

/// Source of an inferred CTE column.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum CteColumnSource {
    /// Column from a table reference
    Table { table: String, column: String },
    /// Literal value
    Literal { value_type: String },
    /// Expression result
    Expression,
    /// Alias from SELECT
    Alias { name: String },
    /// Unknown source
    Unknown,
}

/// Inferred CTE column information.
#[derive(Debug, Clone, Serialize)]
pub struct InferredCteColumn {
    pub name: String,
    pub source: CteColumnSource,
    pub data_type: Option<String>,
}

/// Infer columns from a CTE based on its SELECT query.
pub fn infer_cte_columns(cte_name: &str, stmt: &ParsedStatement) -> Vec<String> {
    // Find the CTE definition
    let cte = stmt.ctes.iter().find(|c| c.name.to_lowercase() == cte_name.to_lowercase());

    if let Some(cte) = cte {
        if !cte.columns.is_empty() {
            // Explicit column list provided
            return cte.columns.clone();
        }
    }

    // TODO: Parse the CTE query to extract columns
    Vec::new()
}

/// Infer columns with detailed source information.
pub fn infer_cte_columns_detailed(
    cte_name: &str,
    sql: &str,
    dialect: super::dialect::SqlDialect,
) -> Vec<InferredCteColumn> {
    let parser_dialect = dialect.to_sqlparser_dialect();

    let ast = match sqlparser::parser::Parser::parse_sql(&*parser_dialect, sql) {
        Ok(ast) => ast,
        Err(_) => return Vec::new(),
    };

    for stmt in ast {
        if let Statement::Query(query) = stmt {
            if let Some(with) = &query.with {
                for cte in &with.cte_tables {
                    if cte.alias.name.value.to_lowercase() == cte_name.to_lowercase() {
                        return analyze_cte_query(&cte.query);
                    }
                }
            }
        }
    }

    Vec::new()
}

/// Analyze a CTE SELECT to extract column info.
pub fn analyze_cte_select(query: &ast::Query) -> Vec<InferredCteColumn> {
    analyze_cte_query(query)
}

fn analyze_cte_query(query: &ast::Query) -> Vec<InferredCteColumn> {
    let mut columns = Vec::new();

    if let SetExpr::Select(select) = query.body.as_ref() {
        for item in &select.projection {
            match item {
                ast::SelectItem::UnnamedExpr(expr) => {
                    let (name, source) = analyze_expr(expr);
                    columns.push(InferredCteColumn {
                        name,
                        source,
                        data_type: None,
                    });
                }
                ast::SelectItem::ExprWithAlias { expr, alias } => {
                    let (_, source) = analyze_expr(expr);
                    columns.push(InferredCteColumn {
                        name: alias.value.clone(),
                        source,
                        data_type: None,
                    });
                }
                ast::SelectItem::QualifiedWildcard(name, _) => {
                    columns.push(InferredCteColumn {
                        name: format!("{}.*", name),
                        source: CteColumnSource::Table {
                            table: name.to_string(),
                            column: "*".to_string(),
                        },
                        data_type: None,
                    });
                }
                ast::SelectItem::Wildcard(_) => {
                    columns.push(InferredCteColumn {
                        name: "*".to_string(),
                        source: CteColumnSource::Unknown,
                        data_type: None,
                    });
                }
            }
        }
    }

    columns
}

fn analyze_expr(expr: &ast::Expr) -> (String, CteColumnSource) {
    match expr {
        ast::Expr::Identifier(ident) => {
            (ident.value.clone(), CteColumnSource::Alias { name: ident.value.clone() })
        }
        ast::Expr::CompoundIdentifier(parts) => {
            let name = parts.last().map(|i| i.value.clone()).unwrap_or_default();
            let table = if parts.len() >= 2 {
                parts[parts.len() - 2].value.clone()
            } else {
                String::new()
            };
            (name.clone(), CteColumnSource::Table { table, column: name })
        }
        ast::Expr::Value(val) => {
            let type_str = match val {
                ast::Value::Number(_, _) => "number",
                ast::Value::SingleQuotedString(_) => "string",
                ast::Value::Boolean(_) => "boolean",
                ast::Value::Null => "null",
                _ => "unknown",
            };
            ("?column?".to_string(), CteColumnSource::Literal { value_type: type_str.to_string() })
        }
        ast::Expr::Function(func) => {
            let name = func.name.to_string();
            (name.clone(), CteColumnSource::Expression)
        }
        ast::Expr::BinaryOp { .. } | ast::Expr::UnaryOp { .. } => {
            ("?column?".to_string(), CteColumnSource::Expression)
        }
        ast::Expr::Case { .. } => {
            ("?column?".to_string(), CteColumnSource::Expression)
        }
        _ => ("?column?".to_string(), CteColumnSource::Unknown),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_simple_cte() {
        let sql = "WITH active AS (SELECT id, name FROM users) SELECT * FROM active";
        let columns = infer_cte_columns_detailed("active", sql, super::super::dialect::SqlDialect::PostgreSQL);

        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0].name, "id");
        assert_eq!(columns[1].name, "name");
    }

    #[test]
    fn test_infer_cte_with_alias() {
        let sql = "WITH totals AS (SELECT SUM(amount) as total FROM orders) SELECT * FROM totals";
        let columns = infer_cte_columns_detailed("totals", sql, super::super::dialect::SqlDialect::PostgreSQL);

        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].name, "total");
    }
}
