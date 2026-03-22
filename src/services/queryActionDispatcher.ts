import { usePanelFocusStore } from "@/stores/panelFocusStore";
import useWorkbenchStore from "@/stores/workbenchStore";

export type QueryAction =
  | "execute"
  | "executeAll"
  | "executeSelection"
  | "format"
  | "toggleResults"
  | "save"
  | "cancel";

export interface QueryActionHandlers {
  execute?: () => void | Promise<void>;
  executeAll?: () => void | Promise<void>;
  executeSelection?: () => void | Promise<void>;
  format?: () => void | Promise<void>;
  toggleResults?: () => void | Promise<void>;
  save?: () => void | Promise<void>;
  cancel?: () => void | Promise<void>;
}

class QueryActionDispatcher {
  private handlers = new Map<string, Map<string, QueryActionHandlers>>();

  register(panelId: string, tabId: string, handlers: QueryActionHandlers): void {
    const panelHandlers = this.handlers.get(panelId) ?? new Map<string, QueryActionHandlers>();
    panelHandlers.set(tabId, handlers);
    this.handlers.set(panelId, panelHandlers);
  }

  unregister(panelId: string, tabId: string): void {
    const panelHandlers = this.handlers.get(panelId);
    if (!panelHandlers) {
      return;
    }

    panelHandlers.delete(tabId);
    if (panelHandlers.size === 0) {
      this.handlers.delete(panelId);
    }
  }

  async dispatch(action: QueryAction): Promise<boolean> {
    const focusedPanelId = usePanelFocusStore.getState().focusedPanelId;
    if (!focusedPanelId) {
      return false;
    }

    const activeTabId =
      useWorkbenchStore.getState().panelContents.get(focusedPanelId)?.activeTabId;
    if (!activeTabId) {
      return false;
    }

    const handler = this.handlers.get(focusedPanelId)?.get(activeTabId)?.[action];
    if (!handler) {
      return false;
    }

    await handler();
    return true;
  }
}

export const queryActionDispatcher = new QueryActionDispatcher();
