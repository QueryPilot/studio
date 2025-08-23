use crate::error::AppError;
use super::types::*;

pub struct SqlBuilder {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
    pub param_counter: usize,
}

impl SqlBuilder {
    pub fn new() -> Self {
        Self {
            sql: String::new(),
            params: Vec::new(),
            param_counter: 1,
        }
    }
    
    pub fn build_table_query(
        &mut self,
        request: &TableReadRequest,
        quote_char: &str,
        param_style: ParamStyle,
    ) -> Result<(usize, usize), AppError> {
        // SELECT clause
        self.sql.push_str("SELECT ");
        if let Some(ref columns) = request.select {
            let quoted_cols: Vec<String> = columns.iter()
                .map(|c| format!("{}{}{}", quote_char, c, quote_char))
                .collect();
            self.sql.push_str(&quoted_cols.join(", "));
        } else {
            self.sql.push_str("*");
        }
        
        // FROM clause
        self.sql.push_str(" FROM ");
        if let Some(ref schema) = request.schema {
            self.sql.push_str(&format!("{}{}{}.{}{}{}", 
                quote_char, schema, quote_char,
                quote_char, request.table, quote_char));
        } else {
            self.sql.push_str(&format!("{}{}{}", quote_char, request.table, quote_char));
        }
        
        // WHERE clause for filters
        let mut where_clauses = Vec::new();
        
        for filter in &request.filters {
            let column = format!("{}{}{}", quote_char, filter.column, quote_char);
            let clause = self.build_filter_clause(&column, &filter.operator, &filter.value, param_style)?;
            if !clause.is_empty() {
                where_clauses.push(clause);
            }
        }
        
        if !where_clauses.is_empty() {
            self.sql.push_str(" WHERE ");
            self.sql.push_str(&where_clauses.join(" AND "));
        }
        
        // ORDER BY clause
        if !request.sorts.is_empty() {
            let order_clauses: Vec<String> = request.sorts.iter()
                .map(|sort| {
                    let dir = match sort.direction {
                        SortDirection::Asc => "ASC",
                        SortDirection::Desc => "DESC",
                    };
                    format!("{}{}{} {}", quote_char, sort.column, quote_char, dir)
                })
                .collect();
            self.sql.push_str(" ORDER BY ");
            self.sql.push_str(&order_clauses.join(", "));
        }
        
        // Pagination
        let (limit, offset) = match &request.pagination {
            PaginationMode::Offset { offset, limit } => (*limit, *offset),
            PaginationMode::Cursor { cursor } => {
                if let Some(cursor_str) = cursor {
                    // Decode cursor
                    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
                    if let Ok(decoded) = URL_SAFE_NO_PAD.decode(cursor_str) {
                        if let Ok(cursor_data) = serde_json::from_slice::<TableDataCursor>(&decoded) {
                            (100, cursor_data.offset)
                        } else {
                            (100, 0)
                        }
                    } else {
                        (100, 0)
                    }
                } else {
                    (100, 0)
                }
            }
        };
        
        Ok((limit, offset))
    }
    
    fn build_filter_clause(
        &mut self, 
        column: &str, 
        operator: &FilterOperator, 
        value: &serde_json::Value,
        param_style: ParamStyle,
    ) -> Result<String, AppError> {
        let param_placeholder = self.get_param_placeholder(param_style);
        
        let clause = match operator {
            FilterOperator::Equal => {
                self.params.push(value.clone());
                format!("{} = {}", column, param_placeholder)
            },
            FilterOperator::NotEqual => {
                self.params.push(value.clone());
                format!("{} != {}", column, param_placeholder)
            },
            FilterOperator::LessThan => {
                self.params.push(value.clone());
                format!("{} < {}", column, param_placeholder)
            },
            FilterOperator::LessThanOrEqual => {
                self.params.push(value.clone());
                format!("{} <= {}", column, param_placeholder)
            },
            FilterOperator::GreaterThan => {
                self.params.push(value.clone());
                format!("{} > {}", column, param_placeholder)
            },
            FilterOperator::GreaterThanOrEqual => {
                self.params.push(value.clone());
                format!("{} >= {}", column, param_placeholder)
            },
            FilterOperator::Like => {
                self.params.push(value.clone());
                format!("{} LIKE {}", column, param_placeholder)
            },
            FilterOperator::ILike => {
                // For databases that don't support ILIKE, use LOWER()
                if param_style == ParamStyle::PostgresDollar {
                    self.params.push(value.clone());
                    format!("{} ILIKE {}", column, param_placeholder)
                } else {
                    self.params.push(value.clone());
                    format!("LOWER({}) LIKE LOWER({})", column, param_placeholder)
                }
            },
            FilterOperator::In => {
                if let serde_json::Value::Array(values) = value {
                    let mut placeholders = Vec::new();
                    for v in values {
                        self.params.push(v.clone());
                        placeholders.push(self.get_param_placeholder(param_style));
                        if param_style != ParamStyle::SqlServerAt {
                            self.param_counter += 1;
                        }
                    }
                    format!("{} IN ({})", column, placeholders.join(", "))
                } else {
                    return Ok(String::new());
                }
            },
            FilterOperator::IsNull => {
                format!("{} IS NULL", column)
            },
            FilterOperator::IsNotNull => {
                format!("{} IS NOT NULL", column)
            },
            FilterOperator::Between => {
                if let serde_json::Value::Array(values) = value {
                    if values.len() == 2 {
                        self.params.push(values[0].clone());
                        let first_param = param_placeholder.clone();
                        if param_style != ParamStyle::SqlServerAt {
                            self.param_counter += 1;
                        }
                        self.params.push(values[1].clone());
                        let second_param = self.get_param_placeholder(param_style);
                        format!("{} BETWEEN {} AND {}", column, first_param, second_param)
                    } else {
                        return Ok(String::new());
                    }
                } else {
                    return Ok(String::new());
                }
            },
        };
        
        if param_style != ParamStyle::SqlServerAt && 
           !matches!(operator, FilterOperator::IsNull | FilterOperator::IsNotNull) {
            self.param_counter += 1;
        }
        
        Ok(clause)
    }
    
    fn get_param_placeholder(&self, style: ParamStyle) -> String {
        match style {
            ParamStyle::PostgresDollar => format!("${}", self.param_counter),
            ParamStyle::MysqlQuestion => "?".to_string(),
            ParamStyle::SqliteQuestion => "?".to_string(),
            ParamStyle::SqlServerAt => format!("@p{}", self.param_counter),
            ParamStyle::OracleColon => format!(":{}", self.param_counter),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ParamStyle {
    PostgresDollar,  // $1, $2, ...
    MysqlQuestion,   // ?
    SqliteQuestion,  // ?
    SqlServerAt,     // @p1, @p2, ...
    OracleColon,     // :1, :2, ...
}