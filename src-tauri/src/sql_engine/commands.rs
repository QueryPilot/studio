//! Tauri IPC commands for SQL Engine.
//!
//! Exposes SQL parsing, validation, and completion to the frontend.
//! Schema data is pushed FROM frontend via sql_set_schema (TypeScript adapters are source of truth).

use serde::{Deserialize, Serialize};

use super::{
    complete, parse_document,
    schema_store::{
        CacheKey, CachedSchemaBuilder, ColumnInfo, EnumInfo, ForeignKeyInfo, FunctionInfo,
        FunctionParam, ParamMode, TableInfo, TableType,
    },
    CompletionRequest, SqlDialect, SCHEMA_STORE,
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
    pub database: Option<String>,
    pub schema: Option<String>,
    pub include_heuristics: Option<bool>,
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
        "oracle" => SqlDialect::Oracle,
        "plsql" => SqlDialect::PlSQL,
        "trino" => SqlDialect::Trino,
        _ => SqlDialect::PostgreSQL, // Default
    }
}

fn default_schema_name(dialect: &SqlDialect) -> Option<&'static str> {
    match dialect {
        SqlDialect::SQLite | SqlDialect::DuckDB => Some("main"),
        SqlDialect::MsSQL => Some("dbo"),
        SqlDialect::PostgreSQL | SqlDialect::PlSQL => Some("public"),
        SqlDialect::Oracle => None,
        SqlDialect::MySQL => None,
        SqlDialect::Trino => None,
    }
}

fn resolved_schema_name(dialect: &SqlDialect, schema: Option<&str>) -> Option<String> {
    schema
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| default_schema_name(dialect).map(ToOwned::to_owned))
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
pub async fn sql_validate(request: ValidateRequest) -> Result<ValidateResponse, String> {
    let dialect = parse_dialect(&request.dialect);
    let doc = parse_document(&request.sql, dialect);

    // Get schema from cache if connection_id provided (pushed via sql_set_schema)
    let schema = request.connection_id.as_ref().and_then(|conn_id| {
        let schema_name = resolved_schema_name(&dialect, request.schema.as_deref())?;
        let db = request.database.as_deref().unwrap_or("");
        let cache_key = CacheKey::new(conn_id, db, &schema_name);
        SCHEMA_STORE.get(&cache_key)
    });

    let result = super::validator::validate_document_with_options(
        &doc,
        schema.as_ref(),
        None,
        super::validator::ValidationOptions {
            include_editor_owned_rules: request.include_heuristics.unwrap_or(true),
        },
    );

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
pub async fn sql_complete(request: CompleteRequest) -> Result<CompleteResponse, String> {
    let dialect = parse_dialect(&request.dialect);
    let doc = parse_document(&request.sql, dialect);

    // Get schema from cache if connection_id provided (pushed via sql_set_schema)
    let schema = request.connection_id.as_ref().and_then(|conn_id| {
        let schema_name = resolved_schema_name(&dialect, request.schema.as_deref())?;
        let db = request.database.as_deref().unwrap_or("");
        let cache_key = CacheKey::new(conn_id, db, &schema_name);
        SCHEMA_STORE.get(&cache_key)
    });

    // Build completion request with schema from cache (owned)
    let completion_request = CompletionRequest {
        document: doc,
        position: request.position,
        dialect,
        explicit: request.explicit,
        schema,
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

// =============================================================================
// SQL Refactoring Commands
// =============================================================================

/// Get available refactoring actions at cursor position.
///
/// Returns actions like Rename and Extract to CTE based on what the cursor is on.
/// Called on cursor move (debounced) for lightbulb UI, or on right-click for context menu.
#[tauri::command]
pub async fn sql_get_refactor_actions(
    sql: String,
    dialect: String,
    cursor_offset: usize,
) -> Result<Vec<super::RefactorAction>, String> {
    use super::Refactor;
    use sqlparser::parser::Parser;

    let sql_dialect = parse_dialect(&dialect);
    let parser_dialect = sql_dialect.to_sqlparser_dialect();

    match Parser::parse_sql(&*parser_dialect, &sql) {
        Ok(statements) => {
            let refactor = Refactor::new(&sql, statements);
            Ok(refactor.get_actions(cursor_offset))
        }
        Err(e) => Err(format!("Failed to parse SQL: {}", e)),
    }
}

/// Apply a refactoring transformation and return the new SQL.
///
/// Called when user confirms a refactoring action (e.g., enters new name for rename).
#[tauri::command]
pub async fn sql_apply_refactor(
    sql: String,
    dialect: String,
    action: super::RefactorRequest,
) -> Result<super::RefactorResult, String> {
    use super::{Refactor, RefactorRequest};
    use sqlparser::parser::Parser;

    let sql_dialect = parse_dialect(&dialect);
    let parser_dialect = sql_dialect.to_sqlparser_dialect();

    let statements = Parser::parse_sql(&*parser_dialect, &sql)
        .map_err(|e| format!("Failed to parse SQL: {}", e))?;

    let refactor = Refactor::new(&sql, statements);

    match action {
        RefactorRequest::Rename {
            symbol_span,
            new_name,
        } => refactor.apply_rename(symbol_span, &new_name),
        RefactorRequest::ExtractCte {
            selection_span,
            cte_name,
        } => refactor.apply_extract_cte(selection_span, &cte_name),
    }
}

// =============================================================================
// Schema Push Commands (receives data from frontend - TypeScript is source of truth)
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInput {
    pub name: String,
    pub table_type: String, // "table" | "view" | "materialized_view"
    pub columns: Vec<ColumnInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInput {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInput {
    pub constraint_name: String,
    pub source_table: String,
    pub source_column: String,
    pub target_table: String,
    pub target_column: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumInput {
    pub name: String,
    pub values: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInput {
    pub name: String,
    pub return_type: String,
    pub arguments: Vec<String>,
}

/// Schema data pushed from frontend (TypeScript adapters are source of truth)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSchemaRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub tables: Vec<TableInput>,
    pub foreign_keys: Vec<ForeignKeyInput>,
    pub enums: Vec<EnumInput>,
    #[serde(default)]
    pub functions: Vec<FunctionInput>,
}

/// Response for set_schema
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSchemaResponse {
    pub success: bool,
    pub table_count: usize,
    pub column_count: usize,
}

/// Push schema data from frontend to Rust cache.
/// This is the ONLY way schema data enters Rust - no duplicate queries.
/// TypeScript adapters (via IntrospectionService) are the single source of truth.
#[tauri::command]
pub async fn sql_set_schema(request: SetSchemaRequest) -> Result<SetSchemaResponse, String> {
    let cache_key = CacheKey::new(&request.connection_id, &request.database, &request.schema);

    let mut builder = CachedSchemaBuilder::new();
    let mut total_columns = 0;

    // Add tables and their columns
    for table in &request.tables {
        let table_type = match table.table_type.as_str() {
            "view" => TableType::View,
            "materialized_view" => TableType::MaterializedView,
            _ => TableType::Table,
        };

        builder = builder.add_table(TableInfo {
            name: table.name.clone(),
            schema: Some(request.schema.clone()),
            table_type,
            comment: None,
            row_count: None,
        });

        // Add columns for this table
        let columns: Vec<ColumnInfo> = table
            .columns
            .iter()
            .enumerate()
            .map(|(idx, col)| ColumnInfo {
                name: col.name.clone(),
                data_type: col.data_type.clone(),
                nullable: col.nullable,
                default_value: None,
                is_primary_key: col.is_primary_key,
                is_unique: false,
                comment: None,
                enum_values: None,
                ordinal: idx as i32,
                precision: None,
                scale: None,
            })
            .collect();

        total_columns += columns.len();
        builder = builder.add_columns(&table.name, columns);
    }

    // Add foreign keys
    for fk in &request.foreign_keys {
        builder = builder.add_foreign_key(ForeignKeyInfo {
            constraint_name: fk.constraint_name.clone(),
            source_table: fk.source_table.clone(),
            source_schema: Some(request.schema.clone()),
            source_columns: vec![fk.source_column.clone()],
            target_table: fk.target_table.clone(),
            target_schema: Some(request.schema.clone()),
            target_columns: vec![fk.target_column.clone()],
            on_delete: None,
            on_update: None,
        });
    }

    // Add enums
    for e in &request.enums {
        builder = builder.add_enum(EnumInfo {
            name: e.name.clone(),
            values: e.values.clone(),
        });
    }

    // Add functions
    for f in &request.functions {
        let parameters: Vec<FunctionParam> = f
            .arguments
            .iter()
            .map(|arg| FunctionParam {
                name: None,
                data_type: arg.clone(),
                mode: ParamMode::In,
                default_value: None,
            })
            .collect();

        builder = builder.add_function(FunctionInfo {
            name: f.name.clone(),
            schema: Some(request.schema.clone()),
            parameters,
            return_type: Some(f.return_type.clone()),
            description: None,
        });
    }

    let table_count = request.tables.len();
    SCHEMA_STORE.put(cache_key, builder.build());

    Ok(SetSchemaResponse {
        success: true,
        table_count,
        column_count: total_columns,
    })
}

/// Clear schema cache for a connection.
/// Call when connection is closed or schema is refreshed.
#[tauri::command]
pub async fn sql_clear_schema(connection_id: String, schema: Option<String>) -> Result<(), String> {
    SCHEMA_STORE.invalidate(&connection_id, schema.as_deref());
    Ok(())
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
        assert_eq!(
            response.statements[0].statement_type,
            Some("SELECT".to_string())
        );
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

    #[tokio::test]
    async fn test_sql_set_schema() {
        let request = SetSchemaRequest {
            connection_id: "test-conn".to_string(),
            database: "testdb".to_string(),
            schema: "public".to_string(),
            tables: vec![TableInput {
                name: "users".to_string(),
                table_type: "table".to_string(),
                columns: vec![
                    ColumnInput {
                        name: "id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: false,
                        is_primary_key: true,
                    },
                    ColumnInput {
                        name: "name".to_string(),
                        data_type: "text".to_string(),
                        nullable: true,
                        is_primary_key: false,
                    },
                ],
            }],
            foreign_keys: vec![],
            enums: vec![],
            functions: vec![],
        };

        let response = sql_set_schema(request).await.unwrap();

        assert!(response.success);
        assert_eq!(response.table_count, 1);
        assert_eq!(response.column_count, 2);

        // Verify schema is cached
        let key = CacheKey::new("test-conn", "testdb", "public");
        let cached = SCHEMA_STORE.get(&key);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().tables.len(), 1);
    }
}
