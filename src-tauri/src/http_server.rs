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
