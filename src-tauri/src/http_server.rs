use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;

#[derive(Clone)]
pub struct AppState {
    pub app_handle: tauri::AppHandle,
}

#[derive(Deserialize)]
struct TauriInvokeRequest {
    cmd: String,
    args: serde_json::Value,
}

#[derive(Serialize)]
struct TauriInvokeResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Proxy endpoint that mimics Tauri's invoke mechanism
/// This allows the AI sidecar to call Tauri commands via HTTP
async fn proxy_tauri_invoke(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TauriInvokeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cmd = payload.cmd;
    let args = payload.args;

    tracing::info!("🔄 Proxying Tauri command: {}", cmd);
    tracing::debug!("Args: {:?}", args);

    // Route to appropriate handler based on command name
    let result = match cmd.as_str() {
        // Database info commands
        "get_tables" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_tauri_command(&state.app_handle, "get_tables", conn_id, schema).await
        }
        "get_columns" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(
                args.get("schema")
                    .cloned()
                    .unwrap_or(serde_json::json!("public")),
            )
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_columns(&state.app_handle, conn_id, schema, table).await
        }
        "get_constraints" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_constraints(&state.app_handle, conn_id, table).await
        }
        "get_indexes" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_indexes(&state.app_handle, conn_id, table).await
        }
        "get_schemas" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let database: String = serde_json::from_value(args["database"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_schemas(&state.app_handle, conn_id, database).await
        }
        "get_views" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_views(&state.app_handle, conn_id, schema).await
        }
        "get_table_count" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_table_count(&state.app_handle, conn_id, schema, table).await
        }
        "get_triggers" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_triggers(&state.app_handle, conn_id, schema, table).await
        }
        "get_functions" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_functions(&state.app_handle, conn_id, schema).await
        }
        "get_object_definition" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let database: String = serde_json::from_value(args["database"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let object_name: String = serde_json::from_value(args["object_name"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let object_type: String = serde_json::from_value(args["object_type"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_object_definition(&state.app_handle, conn_id, database, schema, object_name, object_type).await
        }
        "get_sample_data" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let schema: String = serde_json::from_value(args["schema"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let table: String = serde_json::from_value(args["table"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let limit: u32 = serde_json::from_value(args.get("limit").cloned().unwrap_or(serde_json::json!(10)))
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_get_sample_data(&state.app_handle, conn_id, schema, table, limit).await
        }
        "execute_query" => {
            let conn_id: String = serde_json::from_value(args["conn_id"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let sql: String = serde_json::from_value(args["sql"].clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            invoke_execute_query(&state.app_handle, conn_id, sql).await
        }
        _ => Err((StatusCode::NOT_FOUND, format!("Unknown command: {}", cmd))),
    }?;

    Ok(Json(result))
}

// Helper functions to call manager methods directly
async fn invoke_tauri_command(
    app: &tauri::AppHandle,
    _cmd: &str,
    conn_id: String,
    schema: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let tables = conn
        .adapter
        .get_tables(&schema)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&tables).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_columns(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let columns = conn
        .adapter
        .get_table_columns(&schema, &table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&columns).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_constraints(
    app: &tauri::AppHandle,
    conn_id: String,
    table: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let constraints = conn
        .adapter
        .get_constraints(&table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&constraints)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_indexes(
    app: &tauri::AppHandle,
    conn_id: String,
    table: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let indexes = conn
        .adapter
        .get_indexes(&table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&indexes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_schemas(
    app: &tauri::AppHandle,
    conn_id: String,
    database: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let schemas = conn
        .adapter
        .get_schemas(&database)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&schemas).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_views(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let views = conn
        .adapter
        .get_views(&schema)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&views).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_table_count(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let count = conn
        .adapter
        .get_table_count(&schema, &table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&count).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_triggers(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let triggers = conn
        .adapter
        .get_triggers(&schema, &table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&triggers).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_functions(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let functions = conn
        .adapter
        .get_functions(&schema)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&functions).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_object_definition(
    app: &tauri::AppHandle,
    conn_id: String,
    database: String,
    schema: String,
    object_name: String,
    object_type: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let definition = conn
        .adapter
        .get_object_definition(&database, &schema, &object_name, &object_type)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&definition).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_get_sample_data(
    app: &tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
    limit: u32,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;
    use tokio::time::{timeout, Duration};

    // Validate identifiers (alphanumeric + underscore only)
    let identifier_regex = regex::Regex::new(r"^[a-zA-Z0-9_]+$")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !identifier_regex.is_match(&schema) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid schema name: only alphanumeric and underscore allowed".to_string(),
        ));
    }

    if !identifier_regex.is_match(&table) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid table name: only alphanumeric and underscore allowed".to_string(),
        ));
    }

    // Cap limit at 100
    let safe_limit = limit.min(100);

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    // Validate connection exists
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| {
            if e.to_string().contains("not found") {
                (StatusCode::NOT_FOUND, format!("Connection '{}' not found", conn_id))
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    // Build safe query using validated identifiers
    let sql = format!(
        "SELECT * FROM \"{}\".\"{}\" LIMIT {}",
        schema, table, safe_limit
    );

    // Execute query with 30s timeout
    let query_future = conn.adapter.query(&sql);

    let result = timeout(Duration::from_secs(30), query_future)
        .await
        .map_err(|_| {
            (
                StatusCode::REQUEST_TIMEOUT,
                "Query execution timeout (30s limit)".to_string(),
            )
        })?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    serde_json::to_value(&result.rows)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn invoke_execute_query(
    app: &tauri::AppHandle,
    conn_id: String,
    sql: String,
) -> Result<serde_json::Value, (StatusCode, String)> {
    use crate::core::manager::ConnectionManager;
    use tokio::time::{timeout, Duration};

    // SECURITY: Validate that query is SELECT-only
    let trimmed_sql = sql.trim().to_lowercase();

    // Check for SELECT statement
    if !trimmed_sql.starts_with("select") && !trimmed_sql.starts_with("with") {
        return Err((
            StatusCode::FORBIDDEN,
            "Only SELECT queries are allowed. Use SELECT or WITH (CTE) statements.".to_string(),
        ));
    }

    // Block dangerous keywords (even in subqueries)
    let dangerous_keywords = [
        "insert", "update", "delete", "drop", "create", "alter",
        "truncate", "grant", "revoke", "exec", "execute"
    ];

    for keyword in &dangerous_keywords {
        if trimmed_sql.contains(keyword) {
            return Err((
                StatusCode::FORBIDDEN,
                format!("Query contains forbidden keyword: {}", keyword.to_uppercase()),
            ));
        }
    }

    let manager = app.state::<std::sync::Arc<ConnectionManager>>();

    // Validate connection exists
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| {
            if e.to_string().contains("not found") {
                (StatusCode::NOT_FOUND, format!("Connection '{}' not found", conn_id))
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    // Execute query with 30s timeout
    let query_future = conn.adapter.query(&sql);

    let result = timeout(Duration::from_secs(30), query_future)
        .await
        .map_err(|_| {
            (
                StatusCode::REQUEST_TIMEOUT,
                "Query execution timeout (30s limit). Consider optimizing your query or adding filters.".to_string(),
            )
        })?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // QueryResult already has rows as Vec<Vec<serde_json::Value>>
    serde_json::to_value(&result.rows).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn start_http_server(
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(AppState {
        app_handle: app_handle.clone(),
    });

    let app = Router::new()
        .route("/__tauri__/invoke", post(proxy_tauri_invoke))
        .with_state(state);

    let port = 14420; // Different from frontend (1420)
    let addr = format!("127.0.0.1:{}", port);

    tracing::info!("🚀 Starting HTTP API server on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("HTTP server error: {}", e);
        }
    });

    tracing::info!("✅ HTTP API server started successfully");

    Ok(())
}
