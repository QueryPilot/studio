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
mod window_state;
mod state;

use std::sync::Arc;
use state::AppState;

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
    
    // Create window state manager
    let window_states = Arc::new(window_state::WindowStateManager::new());
    
    // Create app state
    let app_state = AppState {
        window_states: window_states.clone(),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(manager)
        .manage(storage)
        .manage(app_state)
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
            commands::get_index_usage_stats,
            commands::get_constraints,
            commands::get_columns,
            commands::get_triggers,
            commands::get_object_definition,
            commands::get_table_data,
            commands::get_table_data_filtered,
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
            // Window-aware commands
            commands::set_active_connection,
            commands::get_active_connection,
            commands::switch_to_connection_window,
            commands::get_window_states,
            commands::remove_window_connection,
            // Enhanced storage commands with events
            commands::store_connection_with_event,
            commands::delete_connection_with_event,
            commands::update_connection_with_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
