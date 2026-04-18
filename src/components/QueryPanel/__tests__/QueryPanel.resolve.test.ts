import { describe, it, expect, vi, beforeEach } from "vitest";
import useWorkbenchStore from "@/stores/workbenchStore";
import { resolveEffective } from "@/services/effectiveSchemas";

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      getVisibleSchemas: () => ["public"],
    }),
  },
}));

describe("QueryPanel resolve path", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      layoutTree: null,
      panelContents: new Map(),
      layoutHistory: [],
      historyIndex: -1,
    });
    useWorkbenchStore.getState().initializeLayout();
    const panelId = Array.from(
      useWorkbenchStore.getState().panelContents.keys(),
    )[0]!;
    useWorkbenchStore
      .getState()
      .addTab(panelId, "qp-1", { connectionId: "c", database: "d" });
  });

  it("applies override when QueryPanel passes its tabId", () => {
    useWorkbenchStore.getState().setTabSchemaOverride("qp-1", ["x"]);
    expect(resolveEffective("c", "d", "qp-1").effectiveSchemas).toEqual(["x"]);
  });
});
