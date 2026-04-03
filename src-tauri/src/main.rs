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
use window_vibrancy::NSVisualEffectMaterial;

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

    // Create auth manager for credential caching (Azure AD SAML, etc.)
    let auth_manager = Arc::new(crate::tunnel::auth::AuthManager::new());

    // Create tunnel manager (depends on auth_manager)
    let tunnel_manager = Arc::new(crate::tunnel::TunnelManager::new(auth_manager.clone()));

    // Create connection manager (with tunnel manager wired in)
    let mut manager = core::manager::ConnectionManager::new();
    manager.set_tunnel_manager(tunnel_manager.clone());
    let manager = Arc::new(manager);

    // Create shared AI context store for ACP/BYOK runtime context sync
    let ai_context = Arc::new(ai_context::AiContextStore::new());

    // Create ACP manager for AI agent integration
    let acp_manager = Arc::new(acp::manager::AcpManager::new());
    let acp_manager_for_cleanup = acp_manager.clone();

    // Create agent socket server for CLI communication
    let socket_server = Arc::new(acp::socket_server::AgentSocketServer::new());
    let socket_server_for_cleanup = socket_server.clone();

    // Clone dependencies for socket server (before they are moved into .manage())
    let ai_context_for_socket = Arc::clone(&ai_context);
    let manager_for_socket = Arc::clone(&manager);
    let socket_server_for_setup = Arc::clone(&socket_server);

    // Create tunnel state for auth/tunnel profile caching
    let tunnel_state = Arc::new(commands::TunnelState::new());

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(manager)
        .manage(acp_manager)
        .manage(acp::commands::PendingPermissions::default())
        .manage(app_state)
        .manage(tunnel_state)
        .manage(auth_manager)
        .manage(tunnel_manager)
        .manage(ai_context::AiContextState(Arc::clone(&ai_context)))
        .setup(|app| {
            // Set app handle on tunnel manager for webview auth
            if let Some(tm) = app.try_state::<Arc<crate::tunnel::TunnelManager>>() {
                let handle = app.handle().clone();
                let tm = tm.inner().clone();
                tauri::async_runtime::spawn(async move {
                    tm.set_app_handle(handle).await;
                });
            }

            // Build and set the application menu
            let menu = query_pilot::menu::build_menu(app.handle()).expect("Failed to build menu");
            app.set_menu(menu).expect("Failed to set menu");

            // Register menu event handler
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                query_pilot::menu::handle_menu_event(&app_handle, event);
            });

            // Start agent socket server for CLI communication
            let socket_srv = socket_server_for_setup;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = socket_srv
                    .start(ai_context_for_socket, manager_for_socket)
                    .await
                {
                    tracing::error!("Failed to start agent socket server: {}", e);
                }
            });

            Ok(())
        })
        .on_page_load(|webview, _payload| {
            let window = webview.window();
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::apply_vibrancy;
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    None,
                    None,
                );
            }
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                let _ = apply_mica(&window, Some(true));
            }
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
            commands::update_safe_mode,
            commands::update_active_schema,
            commands::duckdb_add_file,
            commands::duckdb_replace_managed_object,
            commands::duckdb_list_managed_objects,
            commands::duckdb_get_object_lineage,
            commands::duckdb_list_extensions,
            commands::duckdb_install_extension,
            // Query execution
            commands::query,
            commands::execute_query,
            commands::get_connection_health,
            commands::ping,
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
            commands::redis_key_patterns,
            commands::redis_get,
            commands::redis_set,
            commands::redis_delete,
            commands::redis_ttl,
            commands::redis_expire,
            commands::redis_exists,
            commands::redis_dbsize,
            commands::redis_info,
            commands::redis_max_databases,
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
            commands::install_tool_via_brew,
            // Integration probe commands
            commands::check_oracle_client,
            commands::install_oracle_client_dmg,
            // ACP (AI agent) commands
            acp::commands::acp_list_agents,
            acp::commands::acp_fetch_agent_models,
            acp::commands::acp_start_agent,
            acp::commands::acp_create_session,
            acp::commands::acp_set_session_model,
            acp::commands::acp_get_session_id,
            acp::commands::acp_send_prompt,
            acp::commands::acp_respond_permission,
            acp::commands::acp_cancel_session,
            acp::commands::acp_install_package,
            acp::commands::acp_check_package_updates,
            acp::commands::acp_upgrade_package,
            acp::commands::acp_stop_agent,
            acp::commands::acp_get_querypilot_cli_path,
            acp::commands::agent_capability,
            // AI Context commands (for syncing runtime context)
            ai_context::commands::sync_ai_context,
            ai_context::commands::track_query_execution,
            ai_context::commands::get_ai_query_history,
            ai_context::commands::get_ai_active_context,
            // Tunnel state commands
            commands::sync_tunnel_state,
            commands::get_auth_profile,
            commands::get_tunnel_profile,
            commands::get_system_arch,
            commands::check_session_manager_plugin,
            // SAML auth commands
            commands::build_saml_login_url,
            commands::handle_saml_response,
            commands::parse_saml_roles,
            commands::check_auth_status,
            commands::open_auth_webview,
        ])
        .build(context)
        .expect("error while building tauri application");

    // Run the app with proper cleanup
    app.run(move |app_handle, event| {
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
            let tunnel_manager_opt = app_handle
                .try_state::<Arc<crate::tunnel::TunnelManager>>()
                .map(|s| s.inner().clone());
            let acp_manager = acp_manager_for_cleanup.clone();

            // Stop agent socket server
            socket_server_for_cleanup.shutdown();
            tracing::info!("Agent socket server stopped");

            tauri::async_runtime::block_on(async move {
                // Overall 3 second timeout for all cleanup
                let cleanup_future = async {
                    // Stop ACP agent subprocesses
                    if let Err(e) = acp_manager.shutdown().await {
                        tracing::warn!("Failed to shutdown ACP agents cleanly: {}", e);
                    } else {
                        tracing::info!("✅ ACP agents stopped");
                    }

                    // Disconnect all database connections and close tunnels
                    if let Some(manager) = conn_manager_opt {
                        if let Err(e) = manager.disconnect_all().await {
                            tracing::error!("Failed to disconnect all connections: {}", e);
                        } else {
                            tracing::info!("✅ All database connections closed");
                        }
                    }

                    // Shutdown standalone tunnel manager (safety net)
                    if let Some(tm) = tunnel_manager_opt {
                        tm.shutdown_all().await;
                        tracing::info!("✅ Tunnel manager shut down");
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
