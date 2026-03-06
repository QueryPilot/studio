export const menuActionCommandMap: Record<string, string> = {
  open_preferences: "preferences.open",
  new_connection: "connection.open",
  new_query: "workbench.action.newQueryTab",
  new_erd: "workbench.action.openErd",
  erd: "workbench.action.openErd",
  close_tab: "workbench.action.closeActiveTab",

  toggle_sidebar: "workbench.action.toggleLeftSidebar",
  toggle_ai: "ai.action.openWithContext",

  "set_theme:light": "appearance.setThemeLight",
  "set_theme:dark": "appearance.setThemeDark",
  "set_theme:system": "appearance.setThemeSystem",

  zoom_in: "appearance.zoomIn",
  zoom_out: "appearance.zoomOut",
  zoom_reset: "appearance.resetZoom",

  execute: "query.execute",
  execute_selection: "query.executeSelection",
  execute_all: "query.executeAll",
  find: "editor.action.find",
  replace: "editor.action.replace",

  report_issue: "help.action.reportIssue",
  open_docs: "help.action.openDocs",
  backup_restore: "database.action.backupRestore",
};
