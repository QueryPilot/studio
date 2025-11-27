#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod http_server;
mod menu;
// NOTE: window_state module removed - tracking now uses BroadcastChannel API on frontend

// Use library modules
use query_pilot::*;

use ai::manager::AIManager;
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

    // Create AI manager with default provider
    let ai_manager = Arc::new(AIManager::new());

    // Create app state
    let app_state = AppState {
        ssh_test_rate_limiter: RateLimiter::new(5),
    };

    let mut context = tauri::generate_context!();
    apply_macos_traffic_light_position(context.config_mut());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(manager)
        .manage(ai_manager.clone())
        .manage(app_state)
        .setup(|app| {
            // Build and set the application menu
            let menu = menu::build_menu(&app.handle())
                .expect("Failed to build menu");
            app.set_menu(menu)
                .expect("Failed to set menu");

            // Register menu event handler
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                menu::handle_menu_event(&app_handle, event);
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
            crate::vault::vault_write,
            crate::vault::vault_read,
            crate::vault::vault_reset,
            commands::connect,
            commands::disconnect,
            commands::switch_database,
            commands::disconnect_all,
            commands::test_connection,
            commands::test_ssh_connection,
            commands::start_oauth_flow,
            commands::get_oauth_token_status,
            commands::clear_oauth_token,
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
            commands::execute_crud_transaction,
            ai::commands::get_ai_sidecar_url,
            ai::commands::reload_ai_api_keys,
            ai::commands::get_sidecar_status,
            ai::commands::configure_telemetry,
            ai::secure_storage::get_ai_api_key,
            ai::secure_storage::set_ai_api_key,
            ai::secure_storage::delete_ai_api_key,
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
            // Updater commands (for private repo releases)
            updater::check_for_updates,
            updater::download_update,
            updater::install_update,
            // NOTE: Window tracking now uses BroadcastChannel API on frontend
        ])
        .build(context)
        .expect("error while building tauri application");

    // Initialize AI sidecar
    let ai_manager = app.state::<Arc<ai::manager::AIManager>>();
    let ai_manager_clone = ai_manager.inner().clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = ai_manager_clone.initialize_sidecar(&app_handle).await {
            tracing::error!("Failed to initialize AI sidecar: {}", e);
        }
    });

    // Start HTTP API server for AI tools
    let app_handle_clone = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = http_server::start_http_server(app_handle_clone).await {
            tracing::error!("Failed to start HTTP API server: {}", e);
        }
    });

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
            let ai_manager_opt = app_handle.try_state::<Arc<AIManager>>().map(|s| s.inner().clone());
            let conn_manager_opt = app_handle.try_state::<Arc<core::manager::ConnectionManager>>().map(|s| s.inner().clone());

            tauri::async_runtime::block_on(async move {
                // Overall 3 second timeout for all cleanup
                let cleanup_future = async {
                    // Stop AI sidecar
                    if let Some(ai_manager) = ai_manager_opt {
                        if let Err(e) = ai_manager.sidecar_manager().stop().await {
                            tracing::error!("Failed to stop AI sidecar: {}", e);
                        }
                    }

                    // Disconnect all database connections and close tunnels
                    if let Some(manager) = conn_manager_opt {
                        if let Err(e) = manager.disconnect_all().await {
                            tracing::error!("Failed to disconnect all connections: {}", e);
                        } else {
                            tracing::info!("✅ All database connections closed");
                        }
                    }
                };

                match tokio::time::timeout(std::time::Duration::from_secs(3), cleanup_future).await {
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
