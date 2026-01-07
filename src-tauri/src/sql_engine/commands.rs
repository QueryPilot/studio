//! Tauri IPC commands for SQL Engine.
//!
//! Exposes SQL parsing, validation, and completion to the frontend.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::ConnectionManager;
use super::{
    complete, parse_document, validate_document, CompletionContext, CompletionItem,
    CompletionRequest, CompletionResult, ParsedDocument, SqlDialect, ValidationResult,
};

/// Parse request from frontend
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseRequest {
    pub sql: String,
    pub dialect: String,
}

/// Parse response to frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResponse {
    pub statements: Vec<StatementInfo>,
    pub errors: Vec<ErrorInfo>,
}

/// Simplified statement info for frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementInfo {
    pub statement_type: Option<String>,
    pub range: (usize, usize),
    pub tables: Vec<String>,
    pub aliases: Vec<AliasInfo>,
}

/// Alias binding info
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasInfo {
    pub alias: String,
    pub table: String,
}

/// Error info for frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub severity: String,
    pub source: String,
}

/// Validation request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateRequest {
    pub sql: String,
    pub dialect: String,
    pub connection_id: Option<String>,
    pub schema: Option<String>,
}

/// Validation response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResponse {
    pub valid: bool,
    pub errors: Vec<ErrorInfo>,
    pub warnings: Vec<ErrorInfo>,
}

/// Completion request from frontend
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub sql: String,
    pub position: usize,
    pub dialect: String,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub explicit: bool,
}

/// Completion response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResponse {
    pub items: Vec<CompletionItemInfo>,
    pub from: usize,
    pub to: usize,
}

/// Completion item for frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItemInfo {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
    pub insert_text: Option<String>,
    pub sort_order: i32,
}

/// Parse dialect string to SqlDialect enum
fn parse_dialect(dialect: &str) -> SqlDialect {
    match dialect.to_lowercase().as_str() {
        "postgresql" | "postgres" | "pg" => SqlDialect::PostgreSQL,
        "mysql" | "mariadb" => SqlDialect::MySQL,
        "sqlite" => SqlDialect::SQLite,
        "mssql" | "sqlserver" | "transactsql" => SqlDialect::MsSQL,
        "plsql" | "oracle" => SqlDialect::PlSQL,
        _ => SqlDialect::PostgreSQL, // Default
    }
}

/// Parse SQL document
#[tauri::command]
pub async fn sql_parse(request: ParseRequest) -> Result<ParseResponse, String> {
    let dialect = parse_dialect(&request.dialect);
    let doc = parse_document(&request.sql, dialect);

    Ok(ParseResponse {
        statements: doc
            .statements
            .iter()
            .map(|s| StatementInfo {
                statement_type: s.statement_type.clone(),
                range: s.range,
                tables: s.tables.iter().map(|t| t.name.clone()).collect(),
                aliases: s
                    .aliases
                    .iter()
                    .map(|a| AliasInfo {
                        alias: a.alias.clone(),
                        table: a.table.clone(),
                    })
                    .collect(),
            })
            .collect(),
        errors: doc
            .errors
            .iter()
            .map(|e| ErrorInfo {
                from: e.position,
                to: e.position_end.unwrap_or(e.position + 1),
                message: e.message.clone(),
                severity: "error".to_string(),
                source: "syntax".to_string(),
            })
            .collect(),
    })
}

/// Validate SQL document
#[tauri::command]
pub async fn sql_validate(
    request: ValidateRequest,
    _manager: State<'_, ConnectionManager>,
) -> Result<ValidateResponse, String> {
    let dialect = parse_dialect(&request.dialect);
    let doc = parse_document(&request.sql, dialect);

    // TODO: When connection_id provided, fetch schema from cache and pass to validate_document
    // For now, validate without schema (syntax only)
    let result = validate_document(&doc, None, None);

    Ok(ValidateResponse {
        valid: result.is_valid(),
        errors: result
            .errors
            .iter()
            .map(|e| ErrorInfo {
                from: e.from,
                to: e.to,
                message: e.message.clone(),
                severity: format!("{:?}", e.severity).to_lowercase(),
                source: format!("{:?}", e.source).to_lowercase(),
            })
            .collect(),
        warnings: result
            .warnings
            .iter()
            .map(|e| ErrorInfo {
                from: e.from,
                to: e.to,
                message: e.message.clone(),
                severity: format!("{:?}", e.severity).to_lowercase(),
                source: format!("{:?}", e.source).to_lowercase(),
            })
            .collect(),
    })
}

/// Get completions for SQL
#[tauri::command]
pub async fn sql_complete(
    request: CompleteRequest,
    _manager: State<'_, ConnectionManager>,
) -> Result<CompleteResponse, String> {
    let dialect = parse_dialect(&request.dialect);
    let doc = parse_document(&request.sql, dialect);

    // Build completion request
    let completion_request = CompletionRequest {
        document: doc,
        position: request.position,
        dialect,
        explicit: request.explicit,
        schema: None, // TODO: Fetch from cache when connection_id provided
    };

    let result = complete(&completion_request);

    Ok(CompleteResponse {
        items: result
            .items
            .iter()
            .map(|item| CompletionItemInfo {
                label: item.label.clone(),
                kind: format!("{:?}", item.kind).to_lowercase(),
                detail: item.detail.clone(),
                insert_text: item.insert_text.clone(),
                sort_order: item.sort_order,
            })
            .collect(),
        from: result.from,
        to: result.to,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dialect() {
        assert_eq!(parse_dialect("postgresql"), SqlDialect::PostgreSQL);
        assert_eq!(parse_dialect("postgres"), SqlDialect::PostgreSQL);
        assert_eq!(parse_dialect("mysql"), SqlDialect::MySQL);
        assert_eq!(parse_dialect("sqlite"), SqlDialect::SQLite);
        assert_eq!(parse_dialect("mssql"), SqlDialect::MsSQL);
        assert_eq!(parse_dialect("plsql"), SqlDialect::PlSQL);
        assert_eq!(parse_dialect("unknown"), SqlDialect::PostgreSQL);
    }

    #[tokio::test]
    async fn test_sql_parse() {
        let request = ParseRequest {
            sql: "SELECT id, name FROM users WHERE id = 1".to_string(),
            dialect: "postgresql".to_string(),
        };

        let response = sql_parse(request).await.unwrap();

        assert_eq!(response.errors.len(), 0);
        assert_eq!(response.statements.len(), 1);
        assert_eq!(response.statements[0].statement_type, Some("SELECT".to_string()));
        assert!(response.statements[0].tables.contains(&"users".to_string()));
    }

    #[tokio::test]
    async fn test_sql_parse_error() {
        let request = ParseRequest {
            sql: "SELECT FROM WHERE".to_string(),
            dialect: "postgresql".to_string(),
        };

        let response = sql_parse(request).await.unwrap();

        assert!(!response.errors.is_empty());
    }
}
