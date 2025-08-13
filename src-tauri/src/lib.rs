use tauri_plugin_sql::{Migration, MigrationKind};

mod database;

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
        .invoke_handler(tauri::generate_handler![
            database::test_connection,
            database::get_databases,
            database::get_tables,
            database::get_columns,
            database::get_indexes,
            database::get_views,
            database::get_functions,
            database::execute_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
