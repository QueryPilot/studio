use std::sync::Arc;
use tauri::State;

use crate::adapters::duckdb::{
    DuckDbAddFileRequest, DuckDbExtensionInfo, DuckDbManagedObjectLineage,
    DuckDbManagedObjectSummary, DuckDbReplaceManagedObjectRequest,
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
