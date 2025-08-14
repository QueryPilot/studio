use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tauri::Manager;

mod database;
mod crypto;
mod storage;
mod commands;
mod cache;

use storage::SecureStorage;
use database::connection_manager::ConnectionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        // Add migrations here if needed
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:devdb.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Initialize secure storage on app startup
            let app_handle = app.handle().clone();
            let storage_state: Arc<Mutex<Option<SecureStorage>>> = Arc::new(Mutex::new(None));
            
            // Initialize storage in a blocking task
            let storage_result = tauri::async_runtime::block_on(async {
                SecureStorage::init(&app_handle).await
            });
            
            match storage_result {
                Ok(storage) => {
                    let mut state = storage_state.blocking_lock();
                    *state = Some(storage);
                    println!("Secure storage initialized successfully");
                }
                Err(e) => {
                    eprintln!("Failed to initialize secure storage: {}", e);
                }
            }
            
            // Initialize connection manager
            let connection_manager = Arc::new(RwLock::new(
                ConnectionManager::new(storage_state.clone())
            ));
            
            app.handle().manage(storage_state);
            app.handle().manage(connection_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Secure database commands
            database::create_db_connection,
            database::test_db_connection,
            database::execute_db_query,
            database::close_db_connection,
            database::get_db_connection_status,
            // Secure storage commands
            commands::secure_storage::store_connection,
            commands::secure_storage::get_connection,
            commands::secure_storage::list_connections,
            commands::secure_storage::update_connection,
            commands::secure_storage::delete_connection,
            commands::secure_storage::secure_set,
            commands::secure_storage::secure_get,
            commands::secure_storage::secure_delete,
            commands::secure_storage::secure_list_keys,
            commands::secure_storage::rotate_keys,
            commands::secure_storage::get_audit_log,
            commands::secure_storage::cleanup_test_connections,
            commands::secure_storage::delete_all_connections,
            commands::secure_storage::clear_all_storage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
