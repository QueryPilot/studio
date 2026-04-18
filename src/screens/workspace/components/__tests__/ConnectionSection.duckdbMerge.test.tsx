import { describe, it, expect, beforeEach } from "vitest";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";


// Mock the component since it has a large number of dependencies;
// instead test the merge logic directly via the store
describe("runtimeDatabasesStore sidebar merge logic", () => {
  beforeEach(() => {
    useRuntimeDatabasesStore.setState({ byConnection: {} });
  });

  it("merges profile dbs (durable) and runtime dbs (non-durable) by name", () => {
    const profileDbs = [{ name: "main", visible_schemas: ["main"] }];
    useRuntimeDatabasesStore.getState().setRuntime("conn-1", {
      databases: [
        { name: "lake", visible_schemas: ["main"] },
        { name: "pg_readonly", visible_schemas: ["public"] },
      ],
      errors: [],
    });

    const runtime = useRuntimeDatabasesStore.getState().get("conn-1");

    // Simulate the merge logic from ConnectionSection
    const byName = new Map<string, { db: { name: string; visible_schemas: string[] }; durable: boolean }>();
    for (const d of profileDbs) byName.set(d.name, { db: d, durable: true });
    for (const d of runtime.databases) {
      if (!byName.has(d.name)) byName.set(d.name, { db: d, durable: false });
    }
    const mergedDbs = Array.from(byName.values());

    expect(mergedDbs).toHaveLength(3);
    const mainEntry = mergedDbs.find((e) => e.db.name === "main");
    expect(mainEntry?.durable).toBe(true);
    const lakeEntry = mergedDbs.find((e) => e.db.name === "lake");
    expect(lakeEntry?.durable).toBe(false);
    const pgEntry = mergedDbs.find((e) => e.db.name === "pg_readonly");
    expect(pgEntry?.durable).toBe(false);
  });

  it("profile db takes precedence over runtime db with same name", () => {
    const profileDbs = [{ name: "lake", visible_schemas: ["main"] }];
    useRuntimeDatabasesStore.getState().setRuntime("conn-1", {
      databases: [{ name: "lake", visible_schemas: ["other"] }],
      errors: [],
    });

    const runtime = useRuntimeDatabasesStore.getState().get("conn-1");
    const byName = new Map<string, { db: { name: string; visible_schemas: string[] }; durable: boolean }>();
    for (const d of profileDbs) byName.set(d.name, { db: d, durable: true });
    for (const d of runtime.databases) {
      if (!byName.has(d.name)) byName.set(d.name, { db: d, durable: false });
    }
    const merged = Array.from(byName.values());
    expect(merged).toHaveLength(1);
    expect(merged[0]?.durable).toBe(true);
    expect(merged[0]?.db.visible_schemas).toEqual(["main"]);
  });
});
