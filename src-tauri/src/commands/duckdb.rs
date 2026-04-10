use std::sync::Arc;
use tauri::State;

use crate::adapters::duckdb::{
    DuckDbAddFileRequest, DuckDbAttachDatabaseRequest, DuckDbAttachedDatabase,
    DuckDbAutocompleteSuggestion, DuckDbCreateSecretRequest, DuckDbExportRequest,
    DuckDbExportResult, DuckDbExtensionInfo, DuckDbManagedObjectLineage,
    DuckDbManagedObjectSummary, DuckDbQueryPlan, DuckDbReplaceManagedObjectRequest,
    DuckDbSecretInfo,
};
use crate::core::manager::AdapterHandle;
use crate::core::safe_mode::{check_safe_mode, OperationKind};
use crate::core::ConnectionManager;

async fn borrow_duckdb_adapter(
    conn_id: &str,
    manager: &Arc<ConnectionManager>,
) -> Result<AdapterHandle, String> {
    let adapter = manager
        .borrow_adapter_with_retry(conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    if adapter.as_duckdb().is_none() {
        return Err("Not a DuckDB connection".to_string());
    }

    Ok(adapter)
}

#[tauri::command]
pub async fn duckdb_add_file(
    conn_id: String,
    request: DuckDbAddFileRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DuckDbManagedObjectSummary, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB add file",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.add_file(request).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_replace_managed_object(
    conn_id: String,
    request: DuckDbReplaceManagedObjectRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DuckDbManagedObjectSummary, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB replace managed object",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .replace_managed_object(request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_list_managed_objects(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbManagedObjectSummary>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .list_managed_objects()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_get_object_lineage(
    conn_id: String,
    target_schema: String,
    target_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Option<DuckDbManagedObjectLineage>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .get_object_lineage(target_schema, target_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_list_extensions(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbExtensionInfo>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.list_extensions().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_install_extension(
    conn_id: String,
    extension_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .install_extension(&extension_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_attach_database(
    conn_id: String,
    request: DuckDbAttachDatabaseRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB attach database",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .attach_database(request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_detach_database(
    conn_id: String,
    alias: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB detach database",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .detach_database(alias)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_list_attached_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbAttachedDatabase>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .list_attached_databases()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_create_secret(
    conn_id: String,
    request: DuckDbCreateSecretRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB create secret",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .create_secret(request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_list_secrets(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbSecretInfo>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.list_secrets().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_drop_secret(
    conn_id: String,
    name: String,
    persistent: bool,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB drop secret",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .drop_secret(name, persistent)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_autocomplete(
    conn_id: String,
    partial_sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbAutocompleteSuggestion>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .autocomplete(&partial_sql)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_explain_query(
    conn_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DuckDbQueryPlan, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.explain_query(&sql).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_export_data(
    conn_id: String,
    request: DuckDbExportRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DuckDbExportResult, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB export data",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .export_data(request)
        .await
        .map_err(|e| e.to_string())
}
