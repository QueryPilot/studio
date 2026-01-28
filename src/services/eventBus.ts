import mitt from "mitt";

/**
 * Event Bus for keyboard shortcut actions
 * 
 * Components subscribe to events and check their own focus state to determine
 * if they should handle the event. This creates a priority system where:
 * 1. Higher-level UI (dialogs, sheets) can intercept events first
 * 2. Lower-level components (data grids in panels) handle if they're focused
 * 
 * All components subscribe on mount, and each checks focus in the handler.
 */

export type KeyboardEventPayload = {
  mode?: "text" | "json";
  panelId?: string;
  tabId?: string;
  selection?: boolean;
  [key: string]: unknown;
};

type Events = {
  // Data Grid events
  "data-grid:copy": KeyboardEventPayload;
  "data-grid:insert-row-below": KeyboardEventPayload;
  "data-grid:insert-row-above": KeyboardEventPayload;
  "data-grid:delete-rows": KeyboardEventPayload;
  "data-grid:export-csv": KeyboardEventPayload;
  "data-grid:export-json": KeyboardEventPayload;
  "data-grid:copy-as-insert": KeyboardEventPayload;

  // Query Editor events
  "query-editor:format": KeyboardEventPayload;
  "query-editor:execute": KeyboardEventPayload;
  "query-editor:execute-background": KeyboardEventPayload;
  "query-editor:find": KeyboardEventPayload;
  "query-editor:replace": KeyboardEventPayload;
  "query-editor:go-to-line": KeyboardEventPayload;
  "query-editor:toggle-word-wrap": KeyboardEventPayload;
  "query-editor:toggle-comment": KeyboardEventPayload;
  "query-editor:explain": KeyboardEventPayload;
  "query-editor:cancel": KeyboardEventPayload;
  "query-editor:save": KeyboardEventPayload;
  "query-editor:clear": KeyboardEventPayload;

  // AI events
  "ai:explain-query": KeyboardEventPayload;
  "ai:generate-sql": KeyboardEventPayload;

  // Sidebar events
  "sidebar:switch-view": { view: "objects" | "queries" };

  // Query History events
  "query-history:focus-search": void;

  // Query Panel events
  "query-panel:toggle-results": KeyboardEventPayload;
};

export const eventBus = mitt<Events>();

