import { describe, it, expect, beforeEach } from "vitest";
import { DbType } from "@/types/connection";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { resolveEffective } from "@/services/effectiveSchemas";
import useWorkbenchStore from "@/stores/workbenchStore";

describe("resolveEffective", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "c1", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
          database: "mydb", username: "u", options: {},
          databases: [{ name: "mydb", visible_schemas: ["reporting", "public"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
  });

  it("returns visible schemas and database from store", () => {
    const r = resolveEffective("c1", "mydb");
    expect(r.effectiveSchemas).toEqual(["reporting", "public"]);
    expect(r.effectiveDatabase).toBe("mydb");
  });
});

describe("resolveEffective with tabId override", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [{
        profile: {
          id: "conn-1", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
          database: "app", username: "u", options: {},
          databases: [{ name: "app", visible_schemas: ["public"] }],
        },
        metadata: { created_at: "", last_used: null, use_count: 0, tags: [], is_favorite: false },
      }],
      loading: false, error: null,
    });
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
    useWorkbenchStore.getState().addTab(panelId, "tab-1", {
      connectionId: "conn-1",
      database: "app",
    });
  });

  it("override wins when tabId is provided", () => {
    useWorkbenchStore
      .getState()
      .setTabSchemaOverride("tab-1", ["reporting", "public"], "warehouse");
    expect(resolveEffective("conn-1", "app", "tab-1")).toEqual({
      effectiveSchemas: ["reporting", "public"],
      effectiveDatabase: "warehouse",
    });
  });

  it("override without effectiveDatabase falls back to databaseName", () => {
    useWorkbenchStore.getState().setTabSchemaOverride("tab-1", ["reporting"]);
    expect(resolveEffective("conn-1", "app", "tab-1")).toEqual({
      effectiveSchemas: ["reporting"],
      effectiveDatabase: "app",
    });
  });

  it("no override falls through to connection store", () => {
    expect(resolveEffective("conn-1", "app", "tab-1")).toEqual({
      effectiveSchemas: ["public"],
      effectiveDatabase: "app",
    });
  });

  it("no tabId arg falls through to connection store", () => {
    useWorkbenchStore.getState().setTabSchemaOverride("tab-1", ["reporting"]);
    expect(resolveEffective("conn-1", "app")).toEqual({
      effectiveSchemas: ["public"],
      effectiveDatabase: "app",
    });
  });
});
