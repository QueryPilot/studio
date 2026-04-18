import { describe, it, expect, beforeEach } from "vitest";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";

beforeEach(() => {
  useRuntimeDatabasesStore.setState({ byConnection: {} });
});

describe("runtimeDatabasesStore", () => {
  it("sets runtime databases and errors for a connection", () => {
    useRuntimeDatabasesStore.getState().setRuntime("conn-1", {
      databases: [{ name: "lake", visible_schemas: ["main"] }],
      errors: [{ alias: "pg", message: "network" }],
    });
    const state = useRuntimeDatabasesStore.getState().get("conn-1");
    expect(state.databases.map((d) => d.name)).toEqual(["lake"]);
    expect(state.errors[0]!.alias).toBe("pg");
  });
  it("clears on disconnect", () => {
    useRuntimeDatabasesStore
      .getState()
      .setRuntime("conn-1", {
        databases: [{ name: "x", visible_schemas: [] }],
        errors: [],
      });
    useRuntimeDatabasesStore.getState().clear("conn-1");
    expect(useRuntimeDatabasesStore.getState().get("conn-1").databases).toEqual([]);
  });
  it("appendDatabase deduplicates by name", () => {
    useRuntimeDatabasesStore
      .getState()
      .setRuntime("conn-1", { databases: [{ name: "a", visible_schemas: [] }], errors: [] });
    useRuntimeDatabasesStore
      .getState()
      .appendDatabase("conn-1", { name: "a", visible_schemas: ["main"] });
    const s = useRuntimeDatabasesStore.getState().get("conn-1");
    expect(s.databases).toHaveLength(1);
    expect(s.databases[0]!.visible_schemas).toEqual(["main"]);
  });
  it("removeDatabase removes by name", () => {
    useRuntimeDatabasesStore
      .getState()
      .setRuntime("conn-1", {
        databases: [
          { name: "a", visible_schemas: [] },
          { name: "b", visible_schemas: [] },
        ],
        errors: [],
      });
    useRuntimeDatabasesStore.getState().removeDatabase("conn-1", "a");
    const s = useRuntimeDatabasesStore.getState().get("conn-1");
    expect(s.databases.map((d) => d.name)).toEqual(["b"]);
  });
  it("get returns empty entry for unknown connection", () => {
    const s = useRuntimeDatabasesStore.getState().get("unknown");
    expect(s.databases).toEqual([]);
    expect(s.errors).toEqual([]);
  });
});
