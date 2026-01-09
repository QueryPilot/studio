//! Stored Procedure and Function parameter handling.

use serde::Serialize;
use super::dialect::SqlDialect;
use super::schema_store::{FunctionInfo, FunctionParam, ParamMode};

/// Parameter suggestion for function calls.
#[derive(Debug, Clone, Serialize)]
pub struct ParamSuggestion {
    pub name: Option<String>,
    pub data_type: String,
    pub mode: ParamMode,
    pub position: usize,
    pub description: Option<String>,
}

/// Function overload information.
#[derive(Debug, Clone, Serialize)]
pub struct FunctionOverload {
    pub parameters: Vec<FunctionParam>,
    pub return_type: Option<String>,
}

/// Built-in function help.
#[derive(Debug, Clone, Serialize)]
pub struct BuiltinFunctionHelp {
    pub name: String,
    pub signature: String,
    pub description: String,
    pub examples: Vec<String>,
}

/// Suggest parameters for a function call.
pub fn suggest_sp_params(
    function_name: &str,
    arg_index: usize,
    functions: &[FunctionInfo],
) -> Vec<ParamSuggestion> {
    let matching: Vec<_> = functions.iter()
        .filter(|f| f.name.to_lowercase() == function_name.to_lowercase())
        .collect();

    matching.iter().filter_map(|f| {
        f.parameters.get(arg_index).map(|p| ParamSuggestion {
            name: p.name.clone(),
            data_type: p.data_type.clone(),
            mode: p.mode,
            position: arg_index,
            description: None,
        })
    }).collect()
}

/// Get function signature string.
pub fn get_function_signature(func: &FunctionInfo) -> String {
    let params: Vec<String> = func.parameters.iter().map(|p| {
        let mode_str = match p.mode {
            ParamMode::Out => "OUT ",
            ParamMode::InOut => "INOUT ",
            ParamMode::Variadic => "VARIADIC ",
            ParamMode::In => "",
        };
        let name_str = p.name.as_ref().map(|n| format!("{} ", n)).unwrap_or_default();
        format!("{}{}{}", mode_str, name_str, p.data_type)
    }).collect();

    let return_str = func.return_type.as_ref()
        .map(|r| format!(" -> {}", r))
        .unwrap_or_default();

    format!("{}({}){}", func.name, params.join(", "), return_str)
}

/// Get function overloads.
pub fn get_function_overloads(
    function_name: &str,
    functions: &[FunctionInfo],
) -> Vec<FunctionOverload> {
    functions.iter()
        .filter(|f| f.name.to_lowercase() == function_name.to_lowercase())
        .map(|f| FunctionOverload {
            parameters: f.parameters.clone(),
            return_type: f.return_type.clone(),
        })
        .collect()
}

/// Generate function call template.
pub fn generate_function_call(func: &FunctionInfo) -> String {
    let params: Vec<String> = func.parameters.iter()
        .filter(|p| p.mode != ParamMode::Out)
        .enumerate()
        .map(|(i, p)| format!("${{{}: {}}}", i + 1, p.name.as_deref().unwrap_or(&p.data_type)))
        .collect();

    format!("{}({})", func.name, params.join(", "))
}

/// Get help for built-in functions.
pub fn get_builtin_function_help(name: &str, dialect: SqlDialect) -> Option<BuiltinFunctionHelp> {
    let name_lower = name.to_lowercase();

    let builtin_functions = match dialect {
        SqlDialect::PostgreSQL => get_postgres_builtins(),
        SqlDialect::MySQL => get_mysql_builtins(),
        _ => get_generic_builtins(),
    };

    builtin_functions.into_iter()
        .find(|f| f.name.to_lowercase() == name_lower)
}

fn get_postgres_builtins() -> Vec<BuiltinFunctionHelp> {
    vec![
        BuiltinFunctionHelp {
            name: "COALESCE".to_string(),
            signature: "COALESCE(value1, value2, ...)".to_string(),
            description: "Returns the first non-null argument".to_string(),
            examples: vec![
                "SELECT COALESCE(null, 'default')".to_string(),
                "SELECT COALESCE(nullable_col, 0)".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "NULLIF".to_string(),
            signature: "NULLIF(value1, value2)".to_string(),
            description: "Returns null if value1 equals value2".to_string(),
            examples: vec![
                "SELECT NULLIF(col, '')".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "ARRAY_AGG".to_string(),
            signature: "ARRAY_AGG(expression [ORDER BY ...])".to_string(),
            description: "Aggregates values into an array".to_string(),
            examples: vec![
                "SELECT ARRAY_AGG(name ORDER BY name)".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "STRING_AGG".to_string(),
            signature: "STRING_AGG(expression, delimiter [ORDER BY ...])".to_string(),
            description: "Concatenates strings with delimiter".to_string(),
            examples: vec![
                "SELECT STRING_AGG(name, ', ')".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "ROW_NUMBER".to_string(),
            signature: "ROW_NUMBER() OVER (...)".to_string(),
            description: "Assigns sequential row numbers".to_string(),
            examples: vec![
                "SELECT ROW_NUMBER() OVER (ORDER BY id)".to_string(),
            ],
        },
    ]
}

fn get_mysql_builtins() -> Vec<BuiltinFunctionHelp> {
    vec![
        BuiltinFunctionHelp {
            name: "IFNULL".to_string(),
            signature: "IFNULL(expr1, expr2)".to_string(),
            description: "Returns expr2 if expr1 is NULL".to_string(),
            examples: vec![
                "SELECT IFNULL(col, 'default')".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "GROUP_CONCAT".to_string(),
            signature: "GROUP_CONCAT(expr [ORDER BY ...] [SEPARATOR str])".to_string(),
            description: "Concatenates values from a group".to_string(),
            examples: vec![
                "SELECT GROUP_CONCAT(name SEPARATOR ', ')".to_string(),
            ],
        },
    ]
}

fn get_generic_builtins() -> Vec<BuiltinFunctionHelp> {
    vec![
        BuiltinFunctionHelp {
            name: "COUNT".to_string(),
            signature: "COUNT(*) | COUNT(expression)".to_string(),
            description: "Counts rows or non-null values".to_string(),
            examples: vec![
                "SELECT COUNT(*)".to_string(),
                "SELECT COUNT(DISTINCT col)".to_string(),
            ],
        },
        BuiltinFunctionHelp {
            name: "SUM".to_string(),
            signature: "SUM(expression)".to_string(),
            description: "Sums numeric values".to_string(),
            examples: vec!["SELECT SUM(amount)".to_string()],
        },
        BuiltinFunctionHelp {
            name: "AVG".to_string(),
            signature: "AVG(expression)".to_string(),
            description: "Calculates average of numeric values".to_string(),
            examples: vec!["SELECT AVG(price)".to_string()],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_help() {
        let help = get_builtin_function_help("COALESCE", SqlDialect::PostgreSQL);
        assert!(help.is_some());
        assert_eq!(help.unwrap().name, "COALESCE");
    }

    #[test]
    fn test_function_signature() {
        let func = FunctionInfo {
            name: "my_func".to_string(),
            schema: None,
            parameters: vec![
                FunctionParam {
                    name: Some("p1".to_string()),
                    data_type: "integer".to_string(),
                    mode: ParamMode::In,
                    default_value: None,
                },
            ],
            return_type: Some("text".to_string()),
            description: None,
        };

        let sig = get_function_signature(&func);
        assert!(sig.contains("my_func"));
        assert!(sig.contains("p1 integer"));
        assert!(sig.contains("-> text"));
    }
}
