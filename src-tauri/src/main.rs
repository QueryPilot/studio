#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod error;
mod types;
mod core;
mod adapters;
mod commands;
mod storage;

use std::sync::Arc;

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into())
        )
        .init();
    
    // Create connection manager
    let manager = Arc::new(core::manager::ConnectionManager::new());
    
    // Create secure storage
    let storage = Arc::new(storage::SecureStorage::new());
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager)
        .manage(storage)
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::test_connection,
            commands::execute_query,
            commands::fetch_results,
            commands::get_databases,
            commands::get_schemas,
            commands::get_tables,
            commands::get_views,
            commands::get_functions,
            commands::get_indexes,
            commands::get_constraints,
            commands::get_columns,
            commands::get_triggers,
            commands::get_object_definition,
            commands::get_table_data,
            commands::get_table_count,
            commands::stream_query,
            commands::get_connection_health,
            commands::ping,
            // Storage commands
            commands::store_connection,
            commands::db_connect_by_id,
            commands::list_connections,
            commands::delete_connection,
            commands::update_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
