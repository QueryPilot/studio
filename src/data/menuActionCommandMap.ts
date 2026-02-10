export const menuActionCommandMap: Record<string, string> = {
  open_preferences: "preferences.open",
  new_connection: "connection.open",
  new_query: "workbench.action.newQueryTab",
  close_tab: "workbench.action.closeActiveTab",

  toggle_sidebar: "workbench.action.toggleLeftSidebar",
  toggle_ai: "workbench.action.toggleRightSidebar",

  "set_theme:light": "appearance.setThemeLight",
  "set_theme:dark": "appearance.setThemeDark",
  "set_theme:system": "appearance.setThemeSystem",

  execute: "query.execute",
  execute_selection: "query.executeSelection",
  find: "editor.action.find",
  replace: "editor.action.replace",

  report_issue: "help.action.reportIssue",
  open_docs: "help.action.openDocs",
  backup_restore: "database.action.backupRestore",
};
