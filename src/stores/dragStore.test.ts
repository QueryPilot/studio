import { beforeEach, describe, expect, it } from "vitest";
import { useDragStore } from "./dragStore";

describe("dragStore", () => {
  beforeEach(() => {
    useDragStore.getState().clearDrag();
  });

  it("tracks an active drag with primitive fields", () => {
    useDragStore.getState().setDrag("tab-1", "panel-1", "tab");

    expect(useDragStore.getState()).toMatchObject({
      isDragActive: true,
      draggedTabId: "tab-1",
      sourcePanelId: "panel-1",
      dragSourceKind: "tab",
    });
  });

  it("clears drag state back to idle", () => {
    const store = useDragStore.getState();
    store.setDrag("sidebar-table", "__sidebar__", "sidebar");
    store.clearDrag();

    expect(useDragStore.getState()).toMatchObject({
      isDragActive: false,
      draggedTabId: null,
      sourcePanelId: null,
      dragSourceKind: null,
    });
  });
});
