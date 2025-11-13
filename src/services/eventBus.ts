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
};

type Events = {
  // Data Grid events
  "data-grid:copy": KeyboardEventPayload;
  "data-grid:insert-row-below": KeyboardEventPayload;
  "data-grid:insert-row-above": KeyboardEventPayload;
  "data-grid:delete-rows": KeyboardEventPayload;

  // Query Editor events
  "query-editor:format": KeyboardEventPayload;
  "query-editor:toggle-history": KeyboardEventPayload;
  "query-editor:execute": KeyboardEventPayload;
};

export const eventBus = mitt<Events>();

