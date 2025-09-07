use crate::error::Result;
use crate::types::{FilterConfig, FilterNode, FilterCondition, FilterGroup, FilterOperator, LogicOperator, SortConfig, SortDirection, NullsPosition};
use std::collections::HashSet;

pub struct PostgresQueryBuilder {
    params: Vec<serde_json::Value>,
    param_counter: usize,
    allowed_columns: HashSet<String>,
}

impl PostgresQueryBuilder {
    pub fn new() -> Self {
        Self {
            params: Vec::new(),
            param_counter: 0,
            allowed_columns: HashSet::new(),
        }
    }

    pub fn with_allowed_columns(mut self, columns: Vec<String>) -> Self {
        self.allowed_columns = columns.into_iter().collect();
        self
    }

    pub fn build_table_query(
        &mut self,
        schema: &str,
        table: &str,
        filters: Option<&FilterConfig>,
        sorts: Option<&[SortConfig]>,
        limit: usize,
        offset: usize,
    ) -> Result<(String, Vec<serde_json::Value>)> {
        let mut query = format!(
            "SELECT * FROM {}.{}",
            self.quote_identifier(schema),
            self.quote_identifier(table)
        );
        
        if let Some(filters) = filters {
            let where_clause = self.build_filter_clause(&filters.root)?;
            if !where_clause.is_empty() {
                query.push_str(" WHERE ");
                query.push_str(&where_clause);
            }
        }
        
        if let Some(sorts) = sorts {
            if !sorts.is_empty() {
                let order_clause = self.build_sort_clause(sorts)?;
                query.push_str(" ORDER BY ");
                query.push_str(&order_clause);
            }
        }
        
        query.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));
        
        Ok((query, self.params.clone()))
    }
    
    fn build_filter_clause(&mut self, node: &FilterNode) -> Result<String> {
        match node {
            FilterNode::Condition(cond) => self.build_condition(cond),
            FilterNode::Group(group) => self.build_group(group),
        }
    }
    
    fn build_group(&mut self, group: &FilterGroup) -> Result<String> {
        if group.conditions.is_empty() {
            return Ok(String::new());
        }
        
        let conditions: Vec<String> = group.conditions
            .iter()
            .filter_map(|c| self.build_filter_clause(c).ok())
            .filter(|s| !s.is_empty())
            .collect();
        
        if conditions.is_empty() {
            return Ok(String::new());
        }
        
        let logic = match group.logic {
            LogicOperator::And => " AND ",
            LogicOperator::Or => " OR ",
        };
        
        Ok(format!("({})", conditions.join(logic)))
    }
    
    fn build_condition(&mut self, cond: &FilterCondition) -> Result<String> {
        // Validate column name if whitelist is set
        if !self.allowed_columns.is_empty() && !self.allowed_columns.contains(&cond.column) {
            return Err(crate::error::AppError::InvalidInput(
                format!("Invalid column name: {}", cond.column)
            ));
        }
        
        let column = self.quote_identifier(&cond.column);
        
        match cond.operator {
            FilterOperator::Equals => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} = ${}", column, self.param_counter))
            },
            FilterOperator::NotEquals => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} != ${}", column, self.param_counter))
            },
            FilterOperator::Contains => {
                let pattern = format!("%{}%", 
                    cond.value.as_str().unwrap_or("")
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_"));
                self.param_counter += 1;
                self.params.push(serde_json::Value::String(pattern));
                
                if cond.case_sensitive {
                    Ok(format!("{} LIKE ${}", column, self.param_counter))
                } else {
                    Ok(format!("{} ILIKE ${}", column, self.param_counter))
                }
            },
            FilterOperator::NotContains => {
                let pattern = format!("%{}%", 
                    cond.value.as_str().unwrap_or("")
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_"));
                self.param_counter += 1;
                self.params.push(serde_json::Value::String(pattern));
                
                if cond.case_sensitive {
                    Ok(format!("{} NOT LIKE ${}", column, self.param_counter))
                } else {
                    Ok(format!("{} NOT ILIKE ${}", column, self.param_counter))
                }
            },
            FilterOperator::StartsWith => {
                let pattern = format!("{}%", 
                    cond.value.as_str().unwrap_or("")
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_"));
                self.param_counter += 1;
                self.params.push(serde_json::Value::String(pattern));
                
                if cond.case_sensitive {
                    Ok(format!("{} LIKE ${}", column, self.param_counter))
                } else {
                    Ok(format!("{} ILIKE ${}", column, self.param_counter))
                }
            },
            FilterOperator::EndsWith => {
                let pattern = format!("%{}", 
                    cond.value.as_str().unwrap_or("")
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_"));
                self.param_counter += 1;
                self.params.push(serde_json::Value::String(pattern));
                
                if cond.case_sensitive {
                    Ok(format!("{} LIKE ${}", column, self.param_counter))
                } else {
                    Ok(format!("{} ILIKE ${}", column, self.param_counter))
                }
            },
            FilterOperator::GreaterThan => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} > ${}", column, self.param_counter))
            },
            FilterOperator::LessThan => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} < ${}", column, self.param_counter))
            },
            FilterOperator::GreaterThanOrEqual => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} >= ${}", column, self.param_counter))
            },
            FilterOperator::LessThanOrEqual => {
                self.param_counter += 1;
                self.params.push(cond.value.clone());
                Ok(format!("{} <= ${}", column, self.param_counter))
            },
            FilterOperator::Between => {
                if let Some(arr) = cond.value.as_array() {
                    if arr.len() == 2 {
                        self.param_counter += 1;
                        let param1 = self.param_counter;
                        self.params.push(arr[0].clone());
                        
                        self.param_counter += 1;
                        let param2 = self.param_counter;
                        self.params.push(arr[1].clone());
                        
                        return Ok(format!("{} BETWEEN ${} AND ${}", column, param1, param2));
                    }
                }
                Err(crate::error::AppError::InvalidInput(
                    "Between operator requires array with 2 values".to_string()
                ))
            },
            FilterOperator::In => {
                if let Some(arr) = cond.value.as_array() {
                    if !arr.is_empty() {
                        self.param_counter += 1;
                        self.params.push(cond.value.clone());
                        return Ok(format!("{} = ANY(${})", column, self.param_counter));
                    }
                }
                Ok(format!("FALSE")) // Empty IN always false
            },
            FilterOperator::NotIn => {
                if let Some(arr) = cond.value.as_array() {
                    if !arr.is_empty() {
                        self.param_counter += 1;
                        self.params.push(cond.value.clone());
                        return Ok(format!("{} != ALL(${})", column, self.param_counter));
                    }
                }
                Ok(format!("TRUE")) // Empty NOT IN always true
            },
            FilterOperator::IsNull => {
                Ok(format!("{} IS NULL", column))
            },
            FilterOperator::IsNotNull => {
                Ok(format!("{} IS NOT NULL", column))
            },
        }
    }
    
    fn build_sort_clause(&self, sorts: &[SortConfig]) -> Result<String> {
        let sort_parts: Vec<String> = sorts
            .iter()
            .map(|sort| {
                let column = self.quote_identifier(&sort.column);
                let direction = match sort.direction {
                    SortDirection::Asc => "ASC",
                    SortDirection::Desc => "DESC",
                };
                let nulls = match sort.nulls_position {
                    NullsPosition::First => " NULLS FIRST",
                    NullsPosition::Last => " NULLS LAST",
                };
                format!("{} {}{}", column, direction, nulls)
            })
            .collect();
        
        Ok(sort_parts.join(", "))
    }
    
    fn quote_identifier(&self, name: &str) -> String {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    
    #[test]
    fn test_simple_equals_filter() {
        let mut builder = PostgresQueryBuilder::new();
        let filter = FilterConfig {
            root: FilterNode::Condition(FilterCondition {
                column: "name".to_string(),
                operator: FilterOperator::Equals,
                value: json!("John"),
                case_sensitive: false,
            }),
        };
        
        let (query, params) = builder.build_table_query(
            "public", "users", Some(&filter), None, 10, 0
        ).unwrap();
        
        assert_eq!(query, "SELECT * FROM \"public\".\"users\" WHERE \"name\" = $1 LIMIT 10 OFFSET 0");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0], json!("John"));
    }
    
    #[test]
    fn test_like_filter() {
        let mut builder = PostgresQueryBuilder::new();
        let filter = FilterConfig {
            root: FilterNode::Condition(FilterCondition {
                column: "email".to_string(),
                operator: FilterOperator::Contains,
                value: json!("gmail"),
                case_sensitive: false,
            }),
        };
        
        let (query, params) = builder.build_table_query(
            "public", "users", Some(&filter), None, 10, 0
        ).unwrap();
        
        assert_eq!(query, "SELECT * FROM \"public\".\"users\" WHERE \"email\" ILIKE $1 LIMIT 10 OFFSET 0");
        assert_eq!(params[0], json!("%gmail%"));
    }
    
    #[test]
    fn test_sort_clause() {
        let builder = PostgresQueryBuilder::new();
        let sorts = vec![
            SortConfig {
                column: "created_at".to_string(),
                direction: SortDirection::Desc,
                nulls_position: NullsPosition::Last,
            },
            SortConfig {
                column: "name".to_string(),
                direction: SortDirection::Asc,
                nulls_position: NullsPosition::First,
            },
        ];
        
        let result = builder.build_sort_clause(&sorts).unwrap();
        assert_eq!(result, "\"created_at\" DESC NULLS LAST, \"name\" ASC NULLS FIRST");
    }
}