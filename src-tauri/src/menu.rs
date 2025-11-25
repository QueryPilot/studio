use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, AboutMetadata};
use tauri::{AppHandle, Manager, Wry, Emitter};
use chrono::{Utc, Datelike};

/// Build the application menu with platform-specific handling
pub fn build_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let menu = Menu::new(app)?;

    // macOS App Menu
    #[cfg(target_os = "macos")]
    {
        let app_menu = build_app_menu(app)?;
        menu.append(&app_menu)?;
    }

    // File Menu
    let file_menu = build_file_menu(app)?;
    menu.append(&file_menu)?;

    // Edit Menu
    let edit_menu = build_edit_menu(app)?;
    menu.append(&edit_menu)?;

    // View Menu
    let view_menu = build_view_menu(app)?;
    menu.append(&view_menu)?;

    // Database Menu
    let database_menu = build_database_menu(app)?;
    menu.append(&database_menu)?;

    // Window Menu
    let window_menu = build_window_menu(app)?;
    menu.append(&window_menu)?;

    // Help Menu
    let help_menu = build_help_menu(app)?;
    menu.append(&help_menu)?;

    Ok(menu)
}

/// macOS App Menu with About, Check for Updates, Preferences, Quit
#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "Query Pilot", true)?;

    // About - icon will be automatically picked up from app bundle
    let about = PredefinedMenuItem::about(
        app,
        Some("Query Pilot"),
        Some(AboutMetadata {
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            authors: Some(vec!["Query Pilot Team".to_string()]),
            comments: Some("A modern, local-first database IDE for PostgreSQL, MySQL, SQLite, SQL Server, and Oracle.\n\nBuilt with Rust and React.".to_string()),
            copyright: Some(format!("Copyright © {} Query Pilot", Utc::now().year())),
            license: Some("MIT License".to_string()),
            website: Some("https://querypilot.dev".to_string()),
            website_label: Some("querypilot.dev".to_string()),
            ..Default::default()
        }),
    )?;
    submenu.append(&about)?;

    // Check for Updates
    let check_updates = MenuItem::with_id(app, "app_check_updates", "Check for Updates...", true, None::<&str>)?;
    submenu.append(&check_updates)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Preferences
    let preferences = MenuItem::with_id(app, "app_preferences", "Preferences...", true, Some("CmdOrCtrl+,"))?;
    submenu.append(&preferences)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Hide, Hide Others, Show All
    submenu.append(&PredefinedMenuItem::hide(app, Some("Query Pilot"))?)?;
    submenu.append(&PredefinedMenuItem::hide_others(app, None::<&str>)?)?;
    submenu.append(&PredefinedMenuItem::show_all(app, None::<&str>)?)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Quit
    submenu.append(&PredefinedMenuItem::quit(app, Some("Query Pilot"))?)?;

    Ok(submenu)
}

/// File Menu
fn build_file_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "File", true)?;

    // New Connection
    let new_connection = MenuItem::with_id(app, "file_new_connection", "New Connection", true, Some("CmdOrCtrl+N"))?;
    submenu.append(&new_connection)?;

    // New Query Tab
    let new_query = MenuItem::with_id(app, "file_new_query", "New Query Tab", true, Some("CmdOrCtrl+T"))?;
    submenu.append(&new_query)?;

    // New ERD Workspace
    let new_erd = MenuItem::with_id(app, "file_new_erd", "New ERD Workspace", true, None::<&str>)?;
    submenu.append(&new_erd)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Recent Connections (placeholder for dynamic submenu)
    let recent = Submenu::new(app, "Recent Connections", true)?;
    submenu.append(&recent)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Close Tab
    let close_tab = MenuItem::with_id(app, "file_close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    submenu.append(&close_tab)?;

    // Close Window
    let close_window = MenuItem::with_id(app, "file_close_window", "Close Window", true, Some("CmdOrCtrl+Shift+W"))?;
    submenu.append(&close_window)?;

    // Windows/Linux: Add Preferences and Quit here
    #[cfg(not(target_os = "macos"))]
    {
        submenu.append(&PredefinedMenuItem::separator(app)?)?;
        let preferences = MenuItem::with_id(app, "file_preferences", "Settings...", true, Some("CmdOrCtrl+,"))?;
        submenu.append(&preferences)?;

        submenu.append(&PredefinedMenuItem::separator(app)?)?;
        submenu.append(&PredefinedMenuItem::quit(app, Some("Query Pilot"))?)?;
    }

    Ok(submenu)
}

/// Edit Menu
fn build_edit_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "Edit", true)?;

    submenu.append(&PredefinedMenuItem::undo(app, None::<&str>)?)?;
    submenu.append(&PredefinedMenuItem::redo(app, None::<&str>)?)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    submenu.append(&PredefinedMenuItem::cut(app, None::<&str>)?)?;
    submenu.append(&PredefinedMenuItem::copy(app, None::<&str>)?)?;
    submenu.append(&PredefinedMenuItem::paste(app, None::<&str>)?)?;
    submenu.append(&PredefinedMenuItem::select_all(app, None::<&str>)?)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Find
    let find = MenuItem::with_id(app, "edit_find", "Find", true, Some("CmdOrCtrl+F"))?;
    submenu.append(&find)?;

    // Replace
    let replace = MenuItem::with_id(app, "edit_replace", "Replace", true, Some("CmdOrCtrl+R"))?;
    submenu.append(&replace)?;

    // Find in Files
    let find_in_files = MenuItem::with_id(app, "edit_find_in_files", "Find in Files", true, Some("CmdOrCtrl+Shift+F"))?;
    submenu.append(&find_in_files)?;

    Ok(submenu)
}

/// View Menu
fn build_view_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "View", true)?;

    // Toggle Sidebar
    let toggle_sidebar = MenuItem::with_id(app, "view_toggle_sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))?;
    submenu.append(&toggle_sidebar)?;

    // Toggle AI Assistant
    let toggle_ai = MenuItem::with_id(app, "view_toggle_ai", "Toggle AI Assistant", true, Some("CmdOrCtrl+Shift+A"))?;
    submenu.append(&toggle_ai)?;

    // Toggle Fullscreen
    let toggle_fullscreen = MenuItem::with_id(app, "view_toggle_fullscreen", "Toggle Fullscreen", true, Some("Ctrl+Cmd+F"))?;
    submenu.append(&toggle_fullscreen)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Appearance submenu
    let appearance = Submenu::new(app, "Appearance", true)?;
    let light = MenuItem::with_id(app, "view_theme_light", "Light Theme", true, None::<&str>)?;
    let dark = MenuItem::with_id(app, "view_theme_dark", "Dark Theme", true, None::<&str>)?;
    let system = MenuItem::with_id(app, "view_theme_system", "System Theme", true, None::<&str>)?;
    appearance.append(&light)?;
    appearance.append(&dark)?;
    appearance.append(&system)?;
    submenu.append(&appearance)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Zoom
    let zoom_in = MenuItem::with_id(app, "view_zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?;
    let zoom_out = MenuItem::with_id(app, "view_zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(app, "view_zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?;
    submenu.append(&zoom_in)?;
    submenu.append(&zoom_out)?;
    submenu.append(&zoom_reset)?;

    Ok(submenu)
}

/// Database Menu
fn build_database_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "Database", true)?;

    // Connect
    let connect = MenuItem::with_id(app, "db_connect", "Connect", true, Some("CmdOrCtrl+K"))?;
    submenu.append(&connect)?;

    // Disconnect
    let disconnect = MenuItem::with_id(app, "db_disconnect", "Disconnect", true, Some("CmdOrCtrl+Shift+K"))?;
    submenu.append(&disconnect)?;

    // Refresh Schema
    let refresh = MenuItem::with_id(app, "db_refresh", "Refresh Schema", true, Some("CmdOrCtrl+R"))?;
    submenu.append(&refresh)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Execute Query
    let execute = MenuItem::with_id(app, "db_execute", "Execute Query", true, Some("CmdOrCtrl+Enter"))?;
    submenu.append(&execute)?;

    // Execute Selection
    let execute_sel = MenuItem::with_id(app, "db_execute_selection", "Execute Selection", true, Some("CmdOrCtrl+Shift+Enter"))?;
    submenu.append(&execute_sel)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Export Data
    let export = MenuItem::with_id(app, "db_export", "Export Data...", true, None::<&str>)?;
    submenu.append(&export)?;

    // Import Data
    let import = MenuItem::with_id(app, "db_import", "Import Data...", true, None::<&str>)?;
    submenu.append(&import)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Show ERD
    let erd = MenuItem::with_id(app, "db_erd", "Show ERD", true, Some("CmdOrCtrl+E"))?;
    submenu.append(&erd)?;

    Ok(submenu)
}

/// Window Menu with dynamic window list
fn build_window_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "Window", true)?;

    submenu.append(&PredefinedMenuItem::minimize(app, None::<&str>)?)?;

    #[cfg(target_os = "macos")]
    {
        submenu.append(&PredefinedMenuItem::maximize(app, None::<&str>)?)?;
    }

    #[cfg(target_os = "macos")]
    {
        submenu.append(&PredefinedMenuItem::separator(app)?)?;
        let bring_all = MenuItem::with_id(app, "window_bring_all", "Bring All to Front", true, None::<&str>)?;
        submenu.append(&bring_all)?;
    }

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Main Window
    let main_window = MenuItem::with_id(app, "window_main", "Main Window", true, Some("CmdOrCtrl+1"))?;
    submenu.append(&main_window)?;

    // Dynamic workspace windows will be added here via update_window_list

    Ok(submenu)
}

/// Help Menu
fn build_help_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, "Help", true)?;

    // Documentation
    let docs = MenuItem::with_id(app, "help_docs", "Documentation", true, None::<&str>)?;
    submenu.append(&docs)?;

    // Check for Updates (Windows/Linux only)
    #[cfg(not(target_os = "macos"))]
    {
        let check_updates = MenuItem::with_id(app, "help_check_updates", "Check for Updates...", true, None::<&str>)?;
        submenu.append(&check_updates)?;
    }

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // Report Issue
    let report = MenuItem::with_id(app, "help_report", "Report Issue", true, None::<&str>)?;
    submenu.append(&report)?;

    submenu.append(&PredefinedMenuItem::separator(app)?)?;

    // About (Windows/Linux only)
    #[cfg(not(target_os = "macos"))]
    {
        let about = PredefinedMenuItem::about(
            app,
            Some("Query Pilot"),
            Some(AboutMetadata {
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
                authors: Some(vec!["Query Pilot Team".to_string()]),
                comments: Some("A modern, local-first database IDE for PostgreSQL, MySQL, SQLite, SQL Server, and Oracle.\n\nBuilt with Rust and React.".to_string()),
                copyright: Some(format!("Copyright © {} Query Pilot", Utc::now().year())),
                license: Some("MIT License".to_string()),
                website: Some("https://querypilot.dev".to_string()),
                website_label: Some("querypilot.dev".to_string()),
                ..Default::default()
            }),
        )?;
        submenu.append(&about)?;
    }

    Ok(submenu)
}

/// Handle menu events
pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    tracing::info!("Menu event: {}", id);

    match id {
        // App Menu (macOS)
        "app_check_updates" | "help_check_updates" => {
            if let Err(e) = app.emit("menu_action", "check_updates") {
                tracing::error!("Failed to emit check_updates event: {}", e);
            }
        }
        "app_preferences" | "file_preferences" => {
            if let Err(e) = app.emit("menu_action", "open_preferences") {
                tracing::error!("Failed to emit open_preferences event: {}", e);
            }
        }

        // File Menu
        "file_new_connection" => {
            if let Err(e) = app.emit("menu_action", "new_connection") {
                tracing::error!("Failed to emit new_connection event: {}", e);
            }
        }
        "file_new_query" => {
            if let Err(e) = app.emit("menu_action", "new_query") {
                tracing::error!("Failed to emit new_query event: {}", e);
            }
        }
        "file_new_erd" => {
            if let Err(e) = app.emit("menu_action", "new_erd") {
                tracing::error!("Failed to emit new_erd event: {}", e);
            }
        }
        "file_close_tab" => {
            if let Err(e) = app.emit("menu_action", "close_tab") {
                tracing::error!("Failed to emit close_tab event: {}", e);
            }
        }
        "file_close_window" => {
            // Close the focused window - iterate through all windows to find focused one
            for window in app.webview_windows().values() {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.close();
                    break;
                }
            }
        }

        // Edit Menu (most handled natively)
        "edit_find" => {
            if let Err(e) = app.emit("menu_action", "find") {
                tracing::error!("Failed to emit find event: {}", e);
            }
        }
        "edit_replace" => {
            if let Err(e) = app.emit("menu_action", "replace") {
                tracing::error!("Failed to emit replace event: {}", e);
            }
        }
        "edit_find_in_files" => {
            if let Err(e) = app.emit("menu_action", "find_in_files") {
                tracing::error!("Failed to emit find_in_files event: {}", e);
            }
        }

        // View Menu
        "view_toggle_sidebar" => {
            if let Err(e) = app.emit("menu_action", "toggle_sidebar") {
                tracing::error!("Failed to emit toggle_sidebar event: {}", e);
            }
        }
        "view_toggle_ai" => {
            if let Err(e) = app.emit("menu_action", "toggle_ai") {
                tracing::error!("Failed to emit toggle_ai event: {}", e);
            }
        }
        "view_toggle_fullscreen" => {
            // Toggle fullscreen on focused window
            for window in app.webview_windows().values() {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
                    break;
                }
            }
        }
        "view_theme_light" => {
            if let Err(e) = app.emit("menu_action", "set_theme:light") {
                tracing::error!("Failed to emit set_theme event: {}", e);
            }
        }
        "view_theme_dark" => {
            if let Err(e) = app.emit("menu_action", "set_theme:dark") {
                tracing::error!("Failed to emit set_theme event: {}", e);
            }
        }
        "view_theme_system" => {
            if let Err(e) = app.emit("menu_action", "set_theme:system") {
                tracing::error!("Failed to emit set_theme event: {}", e);
            }
        }
        "view_zoom_in" | "view_zoom_out" | "view_zoom_reset" => {
            let action = id.replace("view_zoom_", "zoom_");
            if let Err(e) = app.emit("menu_action", action) {
                tracing::error!("Failed to emit zoom event: {}", e);
            }
        }

        // Database Menu
        "db_connect" | "db_disconnect" | "db_refresh" | "db_execute" |
        "db_execute_selection" | "db_export" | "db_import" | "db_erd" => {
            let action = id.replace("db_", "");
            if let Err(e) = app.emit("menu_action", action) {
                tracing::error!("Failed to emit database event: {}", e);
            }
        }

        // Window Menu
        "window_main" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
        "window_bring_all" => {
            // Bring all windows to front
            for window in app.webview_windows().values() {
                let _ = window.set_focus();
            }
        }

        // Help Menu
        "help_docs" => {
            if let Err(e) = app.emit("menu_action", "open_docs") {
                tracing::error!("Failed to emit open_docs event: {}", e);
            }
        }
        "help_report" => {
            if let Err(e) = app.emit("menu_action", "report_issue") {
                tracing::error!("Failed to emit report_issue event: {}", e);
            }
        }

        // Dynamic window items
        id if id.starts_with("window_workspace_") => {
            let window_label = id.replace("window_workspace_", "workspace-");
            if let Some(window) = app.get_webview_window(&window_label) {
                let _ = window.set_focus();
            }
        }

        _ => {
            tracing::warn!("Unhandled menu event: {}", id);
        }
    }
}
