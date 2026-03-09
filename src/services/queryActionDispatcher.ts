import { usePanelFocusStore } from "@/stores/panelFocusStore";

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
  private handlers = new Map<string, QueryActionHandlers>();

  register(panelId: string, handlers: QueryActionHandlers): void {
    this.handlers.set(panelId, handlers);
  }

  unregister(panelId: string): void {
    this.handlers.delete(panelId);
  }

  async dispatch(action: QueryAction): Promise<boolean> {
    const focusedPanelId = usePanelFocusStore.getState().focusedPanelId;
    if (!focusedPanelId) {
      return false;
    }

    const handler = this.handlers.get(focusedPanelId)?.[action];
    if (!handler) {
      return false;
    }

    await handler();
    return true;
  }
}

export const queryActionDispatcher = new QueryActionDispatcher();
