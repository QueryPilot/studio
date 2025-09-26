#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod adapters;
mod commands;
mod core;
mod error;
mod state;
mod storage;
mod types;
mod window_state;

use state::AppState;
use std::sync::Arc;
use tauri::{Listener, Manager, RunEvent};

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    // Create connection manager
    let manager = Arc::new(core::manager::ConnectionManager::new());

    // Create secure storage
    let storage = Arc::new(storage::SecureStorage::new());

    // Create window state manager
    let window_states = Arc::new(window_state::WindowStateManager::new());

    // Create shared AI state
    let ai_opencode_stdin = std::sync::Arc::new(tokio::sync::Mutex::new(None));
    let ai_opencode_server = std::sync::Arc::new(tokio::sync::Mutex::new(None));
    let ai_opencode_server_url = std::sync::Arc::new(tokio::sync::Mutex::new(None));

    // Create app state
    let app_state = AppState {
        window_states: window_states.clone(),
        ai_opencode_stdin: ai_opencode_stdin.clone(),
        ai_opencode_server: ai_opencode_server.clone(),
        ai_opencode_server_url: ai_opencode_server_url.clone(),
    };

    let server_for_exit = ai_opencode_server.clone();
    let url_for_exit = ai_opencode_server_url.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(manager)
        .manage(storage)
        .manage(app_state)
        .setup(move |app| {
            let server_handle = server_for_exit.clone();
            let url_handle = url_for_exit.clone();
            let app_handle = app.handle().clone();

            // Set up cleanup on window close events
            app_handle.listen("tauri://destroyed", move |_event| {
                let server = server_handle.clone();
                let url = url_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Clean up opencode server
                    {
                        let mut server_guard = server.lock().await;
                        if let Some(mut child) = server_guard.take() {
                            tracing::info!(target: "devdb.ai", "Cleaning up opencode server on window close");
                            let _ = child.kill().await;
                        }
                    }
                    // Clear the URL
                    {
                        let mut url_guard = url.lock().await;
                        *url_guard = None;
                    }
                });
            });

            Ok(())
        })
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
            commands::get_supported_index_types,
            commands::get_supported_column_types,
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
            // AI utilities
            commands::get_ai_sidecar_versions,
            commands::ai_opencode_is_authenticated,
            commands::ai_opencode_login_claude,
            commands::ai_opencode_submit_code,
            commands::ai_open_system_url,
            commands::ai_opencode_start_server,
            commands::ai_opencode_auth_ls,
            commands::ai_anthropic_exchange_code,
            commands::ai_init_opencode_configs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run the app with proper cleanup on exit
    app.run(move |app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            tracing::info!("Application exiting, cleaning up sidecar processes...");

            // Get the app state to access sidecar handles
            if let Some(state) = app_handle.try_state::<AppState>() {
                // Block on async cleanup to ensure it completes before exit
                tauri::async_runtime::block_on(async {
                    // Clean up opencode server
                    {
                        let mut server_guard = state.ai_opencode_server.lock().await;
                        if let Some(mut child) = server_guard.take() {
                            tracing::info!(target: "devdb.ai", "Killing opencode (devdb-opencode) server process");
                            let _ = child.kill().await;
                        }
                    }

                    // Clear the URL
                    {
                        let mut url_guard = state.ai_opencode_server_url.lock().await;
                        *url_guard = None;
                    }

                    // Also kill any orphaned processes by name (macOS specific)
                    #[cfg(target_os = "macos")]
                    {
                        let _ = std::process::Command::new("pkill")
                            .args(&["-f", "devdb-opencode"])
                            .output();
                        let _ = std::process::Command::new("pkill")
                            .args(&["-f", "devdb-openai-codex"])
                            .output();
                    }
                });
            }

            tracing::info!("Cleanup completed");
        }
        _ => {}
    });
}
