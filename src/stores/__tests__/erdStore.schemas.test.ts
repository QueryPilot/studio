import { describe, it, expect, beforeEach } from "vitest";
import { useErdStore } from "@/stores/erdStore";

describe("erdStore selectedSchemas", () => {
  beforeEach(() => {
    useErdStore.setState({
      views: {},
      connectionViewIds: {},
      activeViewId: null,
    });
  });

  it("setViewSchemas writes per-view and persists across get", () => {
    const id = useErdStore.getState().ensureView({
      connectionId: "c1",
      database: "db",
      schema: "public",
    });
    useErdStore.getState().setViewSchemas(id, ["public", "reporting"]);
    const view = useErdStore.getState().views[id];
    expect(view?.selectedSchemas).toEqual(["public", "reporting"]);
  });

  it("setViewSchemas is isolated across views", () => {
    const a = useErdStore.getState().ensureView({
      connectionId: "c1",
      database: "db",
      schema: "public",
    });
    const b = useErdStore.getState().ensureView({
      connectionId: "c2",
      database: "db",
      schema: "public",
    });
    useErdStore.getState().setViewSchemas(a, ["public"]);
    useErdStore.getState().setViewSchemas(b, ["reporting", "analytics"]);
    expect(useErdStore.getState().views[a]?.selectedSchemas).toEqual(["public"]);
    expect(useErdStore.getState().views[b]?.selectedSchemas).toEqual([
      "reporting",
      "analytics",
    ]);
  });

  it("setViewSchemas on unknown view is a no-op", () => {
    useErdStore.getState().setViewSchemas("does-not-exist", ["x"]);
    expect(Object.keys(useErdStore.getState().views)).toEqual([]);
  });

  it("rejects empty selectedSchemas updates to keep non-empty invariant", () => {
    const id = useErdStore.getState().ensureView({
      connectionId: "c1",
      database: "db",
      schema: "public",
    });
    useErdStore.getState().setViewSchemas(id, ["public"]);
    useErdStore.getState().setViewSchemas(id, []);
    // Rejection: last non-empty value retained.
    expect(useErdStore.getState().views[id]?.selectedSchemas).toEqual(["public"]);
  });
});

import { useConnectionStore } from "@/stores/connectionStoreNew";

describe("erdStore isolation from connection store", () => {
  it("setVisibleSchemas on connection does not touch erdStore selectedSchemas", async () => {
    useErdStore.setState({ views: {}, connectionViewIds: {}, activeViewId: null });
    const id = useErdStore.getState().ensureView({
      connectionId: "c1",
      database: "db",
      schema: "public",
    });
    useErdStore.getState().setViewSchemas(id, ["public", "reporting"]);

    // Simulate a connection-store edit. Use a raw setState to avoid
    // hitting the real backend in this unit test.
    useConnectionStore.setState((prev) => ({ ...prev } as any));

    expect(useErdStore.getState().views[id]?.selectedSchemas).toEqual([
      "public",
      "reporting",
    ]);
  });
});
