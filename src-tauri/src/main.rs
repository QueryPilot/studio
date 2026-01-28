#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// NOTE: window_state module removed - tracking now uses BroadcastChannel API on frontend

// Use library modules
use query_pilot::*;

use ssh::rate_limiter::RateLimiter;
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

    // Initialize Sentry (opt-in via user preferences)
    // Note: Sentry is initialized with enabled=false by default
    // User must opt-in via Preferences UI, which calls configure_telemetry command
    // The frontend will call configure_telemetry on startup to set the actual preference
    let _sentry_guard = sentry_integration::initialize_sentry(false, env!("CARGO_PKG_VERSION"));

    // Create connection manager
    let manager = Arc::new(core::manager::ConnectionManager::new());

    // Create app state
    let app_state = AppState {
        ssh_test_rate_limiter: RateLimiter::new(5),
    };

    let mut context = tauri::generate_context!();
    apply_macos_traffic_light_position(context.config_mut());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(manager)
        .manage(app_state)
        .setup(|app| {
            // Build and set the application menu
            let menu = query_pilot::menu::build_menu(&app.handle()).expect("Failed to build menu");
            app.set_menu(menu).expect("Failed to set menu");

            // Register menu event handler
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                query_pilot::menu::handle_menu_event(&app_handle, event);
            });

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
                        } else if let Some((_, window)) = app.webview_windows().into_iter().next() {
                            // If no main window, try to get any window
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
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
            crate::vault::vault_write,
            crate::vault::vault_read,
            crate::vault::vault_reset,
            commands::connect,
            commands::disconnect,
            commands::switch_database,
            commands::disconnect_all,
            commands::test_connection,
            commands::test_ssh_connection,
            // Query execution
            commands::query,
            commands::execute_query,
            commands::get_connection_health,
            commands::ping,
            // Updater commands (for private repo releases)
            updater::check_for_updates,
            updater::download_update,
            updater::install_update,
            // SQL Engine commands (parsing, validation, completion)
            sql_engine::commands::sql_parse,
            sql_engine::commands::sql_validate,
            sql_engine::commands::sql_complete,
            sql_engine::commands::sql_get_outline,
            // SQL Refactoring commands
            sql_engine::commands::sql_get_refactor_actions,
            sql_engine::commands::sql_apply_refactor,
            // Schema push commands (TypeScript is source of truth, pushes to Rust)
            sql_engine::commands::sql_set_schema,
            sql_engine::commands::sql_clear_schema,
            // Window menu management
            commands::update_window_menu,
            // MongoDB commands
            commands::mongo_list_databases,
            commands::mongo_list_collections,
            commands::mongo_find_documents,
            commands::mongo_insert_document,
            commands::mongo_update_document,
            commands::mongo_delete_document,
            commands::mongo_aggregate,
            commands::mongo_count_documents,
            commands::mongo_list_indexes,
            commands::mongo_create_index,
            commands::mongo_drop_index,
            // Redis commands
            commands::redis_get,
            commands::redis_set,
            commands::redis_delete,
            commands::redis_ttl,
            commands::redis_expire,
            commands::redis_exists,
            commands::redis_dbsize,
            commands::redis_info,
            commands::redis_hgetall,
            commands::redis_hset,
            commands::redis_lrange,
            commands::redis_smembers,
            commands::redis_type,
            // Streaming commands
            commands::mongo_find_documents_stream,
            commands::redis_scan_stream,
            // Paradigm-level IPC commands
            commands::document_execute,
            commands::keyvalue_execute,
            // Backup and restore commands
            commands::get_backup_capability,
            commands::get_tool_status,
            commands::get_backup_preview,
            commands::start_backup,
            commands::start_restore,
            // Tool download commands
            commands::get_tool_download_info,
            commands::search_tool_paths,
            commands::download_tool,
        ])
        .build(context)
        .expect("error while building tauri application");

    // Run the app with proper cleanup
    app.run(|app_handle, event| {
        // Handle both ExitRequested and Exit to ensure cleanup on Cmd+Q
        let should_cleanup = matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        );

        if should_cleanup {
            tracing::info!("🛑 Application exit requested, cleaning up resources...");

            // Run cleanup with overall timeout to prevent hanging
            let conn_manager_opt = app_handle
                .try_state::<Arc<core::manager::ConnectionManager>>()
                .map(|s| s.inner().clone());

            tauri::async_runtime::block_on(async move {
                // Overall 3 second timeout for all cleanup
                let cleanup_future = async {
                    // Disconnect all database connections and close tunnels
                    if let Some(manager) = conn_manager_opt {
                        if let Err(e) = manager.disconnect_all().await {
                            tracing::error!("Failed to disconnect all connections: {}", e);
                        } else {
                            tracing::info!("✅ All database connections closed");
                        }
                    }
                };

                match tokio::time::timeout(std::time::Duration::from_secs(3), cleanup_future).await
                {
                    Ok(()) => tracing::info!("✅ Cleanup completed, exiting..."),
                    Err(_) => tracing::warn!("⚠️ Cleanup timed out, forcing exit..."),
                }
            });
        }
    });
}

#[cfg(target_os = "macos")]
fn apply_macos_traffic_light_position(config: &mut tauri::Config) {
    if let Some(position) = macos_traffic_light_position() {
        for window in &mut config.app.windows {
            if window.label == "main" {
                window.traffic_light_position = Some(position.clone());
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_traffic_light_position(_config: &mut tauri::Config) {}

#[cfg(target_os = "macos")]
fn macos_traffic_light_position() -> Option<tauri::utils::config::LogicalPosition> {
    let version_string = tauri_plugin_os::version().to_string();
    let major_version = extract_leading_number(&version_string)?;

    let (x, y) = if major_version >= 26 {
        (10.0, 21.0)
    } else {
        (10.0, 14.0)
    };

    Some(tauri::utils::config::LogicalPosition { x, y })
}

#[cfg(target_os = "macos")]
fn extract_leading_number(value: &str) -> Option<u32> {
    let mut digits = String::new();
    let mut started = false;

    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            started = true;
        } else if started {
            break;
        }
    }

    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}
