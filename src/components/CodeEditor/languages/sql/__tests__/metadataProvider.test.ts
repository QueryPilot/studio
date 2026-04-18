import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/schemaCache", () => ({
  schemaCache: {
    getTables: vi.fn((_c: string, schema: string) => {
      if (schema === "public") return Promise.resolve([{ name: "users", schema: "public", kind: "Regular" }]);
      if (schema === "reporting") return Promise.resolve([
        { name: "users", schema: "reporting", kind: "Regular" },
        { name: "metrics", schema: "reporting", kind: "Regular" },
      ]);
      return Promise.resolve([]);
    }),
    getTablesForCatalogSchema: vi.fn(() => Promise.resolve([])),
  },
}));

import { SqlMetadataProvider, createSqlMetadataProvider } from "@/components/CodeEditor/languages/sql/metadataProvider";

describe("SqlMetadataProvider multi-schema", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listEntities without schema unions and dedups primary-wins", async () => {
    const p = new SqlMetadataProvider("c1", ["public", "reporting"], "postgresql");
    const entities = await p.listEntities();
    const users = entities.filter((e) => e.name === "users");
    expect(users).toHaveLength(1);
    expect(users[0]?.schema).toBe("public"); // primary wins
    expect(entities.map((e) => e.name).sort()).toEqual(["metrics", "users"]);
  });

  it("cache key includes joined visibleSchemas", () => {
    const a = createSqlMetadataProvider("c1", ["public"], "postgresql");
    const b = createSqlMetadataProvider("c1", ["public", "reporting"], "postgresql");
    expect(a).not.toBe(b);
  });
});
