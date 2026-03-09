import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { queryActionDispatcher } from "./queryActionDispatcher";

describe("queryActionDispatcher", () => {
  beforeEach(() => {
    usePanelFocusStore.getState().clearFocus();
  });

  afterEach(() => {
    queryActionDispatcher.unregister("panel-a");
    queryActionDispatcher.unregister("panel-b");
    vi.restoreAllMocks();
  });

  it("dispatches query actions only to the focused panel", async () => {
    const panelAExecute = vi.fn();
    const panelBExecute = vi.fn();

    queryActionDispatcher.register("panel-a", {
      execute: panelAExecute,
    });
    queryActionDispatcher.register("panel-b", {
      execute: panelBExecute,
    });

    usePanelFocusStore.getState().focusPanel("panel-b");

    await queryActionDispatcher.dispatch("execute");

    expect(panelAExecute).not.toHaveBeenCalled();
    expect(panelBExecute).toHaveBeenCalledTimes(1);
  });

  it("ignores query actions when no focused panel handler is registered", async () => {
    const handler = vi.fn();
    queryActionDispatcher.register("panel-a", {
      format: handler,
    });

    usePanelFocusStore.getState().focusPanel("missing-panel");

    await expect(queryActionDispatcher.dispatch("format")).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
