#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod adapters;
mod ai;
mod commands;
mod core;
mod error;
mod keychain;
mod state;
mod storage;
mod types;
mod vault;
mod window_state;

use ai::manager::AIManager;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;

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

    // Create AI manager with default provider
    let ai_manager = Arc::new(AIManager::new());

    // Create window state manager
    let window_states = Arc::new(window_state::WindowStateManager::new());

    // Create app state
    let app_state = AppState {
        window_states: window_states.clone(),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(manager)
        .manage(ai_manager.clone())
        .manage(app_state)
        .setup(|app| {
            // Register default global shortcut to show/activate main window
            #[cfg(target_os = "macos")]
            let default_shortcut = "CommandOrControl+Shift+Space";
            #[cfg(not(target_os = "macos"))]
            let default_shortcut = "CommandOrControl+Shift+Space";

            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            if let Err(e) =
                app.global_shortcut()
                    .on_shortcut(default_shortcut, |app, _shortcut, _event| {
                        // Try to find main window or any existing window
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        } else {
                            // If no main window, try to get any window
                            for (_, window) in app.webview_windows() {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                                break;
                            }
                        }
                    })
            {
                tracing::warn!("Failed to register default global shortcut: {}", e);
            } else {
                tracing::info!("Registered global shortcut: {}", default_shortcut);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App window helpers
            app_show_main_window,
            crate::vault::vault_write,
            crate::vault::vault_read,
            crate::vault::vault_reset,
            commands::connect,
            commands::disconnect,
            commands::disconnect_all,
            commands::test_connection,
            commands::get_databases,
            commands::get_schemas,
            commands::get_tables,
            commands::get_views,
            commands::get_functions,
            commands::get_indexes,
            commands::get_index_usage_stats,
            commands::get_supported_index_types,
            commands::get_supported_column_types,
            commands::get_type_info,
            commands::get_constraints,
            commands::get_columns,
            commands::get_triggers,
            commands::get_object_definition,
            commands::get_table_count,
            commands::stream_query,
            commands::prewarm_query,
            commands::prewarm_schema_tables,
            commands::get_connection_health,
            commands::ping,
            ai::commands::create_ai_session,
            ai::commands::list_ai_sessions,
            ai::commands::get_ai_session_history,
            ai::commands::send_ai_message_streaming,
            // Keychain commands (used by TypeScript)
            keychain::get_vault_password,
            keychain::delete_vault_password,
            // Index operations
            commands::create_index,
            commands::drop_index,
            commands::rename_index,
            // Column operations
            commands::alter_table_add_column,
            commands::alter_table_drop_column,
            commands::alter_table_modify_column,
            commands::alter_table_rename_column,
            // Foreign key operations
            commands::alter_table_add_foreign_key,
            commands::alter_table_drop_foreign_key,
            // Trigger operations
            commands::create_trigger,
            commands::drop_trigger,
            commands::enable_disable_trigger,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run the app
    app.run(|_app_handle, _event| {});
}

#[tauri::command]
fn app_show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    // If a splash window exists, hide it; then show main window
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}
