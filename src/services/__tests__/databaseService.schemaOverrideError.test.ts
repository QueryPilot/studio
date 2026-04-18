import { describe, it, expect, vi } from "vitest";
import useWorkbenchStore from "@/stores/workbenchStore";
import { appendOverrideHint } from "@/services/effectiveSchemas";

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({ getVisibleSchemas: () => ["public"] }),
  },
}));

describe("appendOverrideHint for tab override", () => {
  it("appends hint when override is in effect and backend reports missing schema", () => {
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
      .addTab(panelId, "t1", { connectionId: "c", database: "d" });
    useWorkbenchStore.getState().setTabSchemaOverride("t1", ["reporting"]);

    const err = new Error('schema "reporting" does not exist');
    expect(() => appendOverrideHint(err, "t1")).toThrow(
      /Tab overrides schema `reporting` which may not exist/,
    );
  });

  it("does not append hint when no override is set", () => {
    useWorkbenchStore.setState({
      layoutTree: null,
      panelContents: new Map(),
      layoutHistory: [],
      historyIndex: -1,
    });

    const err = new Error('schema "reporting" does not exist');
    expect(() => appendOverrideHint(err, undefined)).toThrow(/schema "reporting" does not exist/);
    // Verify it does NOT include the hint
    try {
      appendOverrideHint(err, undefined);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/Tab overrides schema/);
    }
  });
});
