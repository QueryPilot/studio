import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelFocusStore } from "@/stores/panelFocusStore";

const workbenchState = vi.hoisted(() => ({
  panelContents: new Map<string, { activeTabId: string }>(),
}));

vi.mock("@/stores/workbenchStore", () => ({
  default: Object.assign(() => undefined, {
    getState: () => workbenchState,
  }),
}));

import { queryActionDispatcher } from "./queryActionDispatcher";

describe("queryActionDispatcher", () => {
  beforeEach(() => {
    usePanelFocusStore.getState().clearFocus();
    workbenchState.panelContents = new Map();
  });

  afterEach(() => {
    const dispatcher = queryActionDispatcher as unknown as {
      unregister: (panelId: string, tabId?: string) => void;
    };
    dispatcher.unregister("panel-a", "tab-1");
    dispatcher.unregister("panel-a", "tab-2");
    dispatcher.unregister("panel-b", "tab-9");
    vi.restoreAllMocks();
  });

  it("dispatches query actions only to the active tab in the focused panel", async () => {
    const panelATabOneExecute = vi.fn();
    const panelATabTwoExecute = vi.fn();
    const panelBExecute = vi.fn();
    const dispatcher = queryActionDispatcher as unknown as {
      register: (
        panelId: string,
        tabId: string,
        handlers: { execute?: () => void | Promise<void> },
      ) => void;
    };

    dispatcher.register("panel-a", "tab-1", {
      execute: panelATabOneExecute,
    });
    dispatcher.register("panel-a", "tab-2", {
      execute: panelATabTwoExecute,
    });
    dispatcher.register("panel-b", "tab-9", {
      execute: panelBExecute,
    });

    workbenchState.panelContents = new Map([
      ["panel-a", { activeTabId: "tab-2" }],
      ["panel-b", { activeTabId: "tab-9" }],
    ]);
    usePanelFocusStore.getState().focusPanel("panel-a");

    await queryActionDispatcher.dispatch("execute");

    expect(panelATabOneExecute).not.toHaveBeenCalled();
    expect(panelATabTwoExecute).toHaveBeenCalledTimes(1);
    expect(panelBExecute).not.toHaveBeenCalled();
  });

  it("ignores query actions when the focused panel has no handler for its active tab", async () => {
    const handler = vi.fn();
    const dispatcher = queryActionDispatcher as unknown as {
      register: (
        panelId: string,
        tabId: string,
        handlers: { format?: () => void | Promise<void> },
      ) => void;
    };

    dispatcher.register("panel-a", "tab-1", {
      format: handler,
    });

    workbenchState.panelContents = new Map([["panel-a", { activeTabId: "tab-2" }]]);
    usePanelFocusStore.getState().focusPanel("panel-a");

    await expect(queryActionDispatcher.dispatch("format")).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
