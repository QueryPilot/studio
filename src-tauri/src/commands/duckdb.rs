use std::sync::Arc;
use tauri::State;

use crate::adapters::duckdb::{
    DuckDbAddFileRequest, DuckDbAttachCatalogRequest, DuckDbAttachDatabaseRequest,
    DuckDbAttachedDatabase, DuckDbAutocompleteSuggestion, DuckDbCreateSecretRequest,
    DuckDbExportRequest, DuckDbExportResult, DuckDbExtensionInfo, DuckDbManagedObjectLineage,
    DuckDbManagedObjectSummary, DuckDbQueryPlan, DuckDbQueryProgress,
    DuckDbReplaceManagedObjectRequest, DuckDbSecretInfo, DuckDbSetting,
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
pub async fn duckdb_load_extension(
    conn_id: String,
    extension_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB load extension",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .load_extension(&extension_name)
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
pub async fn duckdb_attach_catalog(
    conn_id: String,
    request: DuckDbAttachCatalogRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB attach catalog",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .attach_catalog(request)
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
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB explain query",
    )?;
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
    duckdb.export_data(request).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_get_settings(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<DuckDbSetting>, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.get_settings().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_set_setting(
    conn_id: String,
    name: String,
    value: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB set setting",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .set_setting(&name, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_reset_setting(
    conn_id: String,
    name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB reset setting",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.reset_setting(&name).await.map_err(|e| e.to_string())
}

/// Build the effective connection key for a DuckDB operation. Streaming
/// queries run on `{conn_id}:{tab_id}` in non-pooler mode, so progress/
/// interrupt commands must target that same key or they'll hit a sibling
/// adapter that has nothing running.
fn duckdb_adapter_key(conn_id: &str, tab_id: Option<&str>) -> String {
    match tab_id {
        Some(t) if !t.is_empty() => format!("{}:{}", conn_id, t),
        _ => conn_id.to_string(),
    }
}

#[tauri::command]
pub async fn duckdb_query_progress(
    conn_id: String,
    tab_id: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DuckDbQueryProgress, String> {
    let key = duckdb_adapter_key(&conn_id, tab_id.as_deref());
    // Prefer the tab-scoped adapter; fall back to base if not live yet.
    let adapter = match manager.borrow_adapter(&key) {
        Some(a) => a,
        None => borrow_duckdb_adapter(&conn_id, manager.inner()).await?,
    };
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    Ok(duckdb.query_progress_snapshot().await)
}

#[tauri::command]
pub async fn duckdb_interrupt_query(
    conn_id: String,
    tab_id: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    // Interrupt must NEVER trigger a fresh connection — use the non-retry
    // borrow so a missing adapter is a silent no-op rather than a reconnect.
    let key = duckdb_adapter_key(&conn_id, tab_id.as_deref());
    if let Some(adapter) = manager.borrow_adapter(&key) {
        if let Some(duckdb) = adapter.as_duckdb() {
            duckdb.interrupt_query();
        }
    }
    // Also interrupt the base connection if the tab-scoped key differs, so a
    // cancel from a streaming tab also halts any sidebar query running on the
    // base adapter for the same logical connection.
    if key != conn_id {
        if let Some(adapter) = manager.borrow_adapter(&conn_id) {
            if let Some(duckdb) = adapter.as_duckdb() {
                duckdb.interrupt_query();
            }
        }
    }
    Ok(())
}

// ── Phase 3: DuckDB persistence commands ─────────────────────────────────────

#[tauri::command]
pub async fn duckdb_replay_setup(
    app: tauri::AppHandle,
    conn_id: String,
    secrets: Vec<crate::types::DecryptedSecretPayload>,
    attachments: Vec<crate::types::Attachment>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::types::DuckDbReplayResult, String> {
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    let (runtime_databases, errors) = duckdb
        .replay(Some(&app), &conn_id, secrets, attachments)
        .await;
    Ok(crate::types::DuckDbReplayResult {
        runtime_databases,
        errors,
    })
}

#[tauri::command]
pub async fn duckdb_run_attach(
    conn_id: String,
    attachment: crate::types::Attachment,
    secret: Option<crate::types::DecryptedSecretPayload>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB run attach",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    // If a secret is provided, issue it first so the ATTACH can reference it by name.
    if let Some(s) = secret {
        duckdb.issue_secret(s).await.map_err(|e| e.to_string())?;
    }
    let secret_name = attachment.secret_ref.clone();
    let alias = duckdb
        .attach(&attachment, secret_name.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    // Mirror the attachment onto the manager's profile cache so reconnects
    // (reaper, per-tab) replay it via `DuckDbAdapter::connect`. Failure here is
    // non-fatal — the attach itself already succeeded.
    if let Err(e) = manager.add_profile_attachment(&conn_id, attachment) {
        tracing::warn!("failed to sync attachment to profile cache: {}", e);
    }
    Ok(alias)
}

#[tauri::command]
pub async fn duckdb_run_detach(
    conn_id: String,
    alias: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB run detach",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .detach_database(alias.clone())
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = manager.remove_profile_attachment(&conn_id, &alias) {
        tracing::warn!("failed to drop attachment from profile cache: {}", e);
    }
    Ok(())
}

#[tauri::command]
pub async fn duckdb_install_load_extension(
    conn_id: String,
    extension: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB install/load extension",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb
        .install_extension(&extension)
        .await
        .map_err(|e| e.to_string())?;
    duckdb
        .load_extension(&extension)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_issue_secret(
    conn_id: String,
    secret: crate::types::DecryptedSecretPayload,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    check_safe_mode(
        manager.get_safe_mode(&conn_id),
        OperationKind::Ddl,
        "DuckDB issue secret",
    )?;
    let adapter = borrow_duckdb_adapter(&conn_id, manager.inner()).await?;
    let duckdb = adapter
        .as_duckdb()
        .ok_or_else(|| "Not a DuckDB connection".to_string())?;
    duckdb.issue_secret(secret).await.map_err(|e| e.to_string())
}
