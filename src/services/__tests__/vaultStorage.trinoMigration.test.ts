import { describe, it, expect } from "vitest";
import { migrateTrinoLegacyFields } from "@/services/vaultStorage";
import { DbType, type ConnectionProfile } from "@/types/connection";

const base = (over: Partial<ConnectionProfile>): ConnectionProfile => ({
  id: "c1", name: "p", db_type: DbType.Trino, host: "", port: 8080,
  database: "hive", username: "u", options: {}, databases: [], ...over,
} as ConnectionProfile);

describe("migrateTrinoLegacyFields", () => {
  it("synthesizes databases[] from trino_catalogs + trino_schema_filters order", () => {
    const profile = base({
      trino_catalogs: ["hive", "iceberg"],
      trino_schema_filters: JSON.stringify({
        hive: ["default", "logs"],
        iceberg: ["analytics"],
      }),
      databases: [{ name: "hive", visible_schemas: ["default"] }], // Phase 1 stub
    });

    const migrated = migrateTrinoLegacyFields(profile);

    expect(migrated.databases).toEqual([
      { name: "hive", visible_schemas: ["default", "logs"] },
      { name: "iceberg", visible_schemas: ["analytics"] },
    ]);
    expect(migrated.trino_catalogs).toBeUndefined();
    expect(migrated.trino_schema_filters).toBeUndefined();
  });

  it("is a no-op for non-Trino profiles", () => {
    const pg = base({ db_type: DbType.PostgreSQL, databases: [{ name: "postgres", visible_schemas: ["public"] }] });
    expect(migrateTrinoLegacyFields(pg)).toBe(pg);
  });

  it("is idempotent when legacy fields are absent", () => {
    const clean = base({
      databases: [{ name: "hive", visible_schemas: ["default"] }],
    });
    const r = migrateTrinoLegacyFields(clean);
    expect(r.databases).toEqual(clean.databases);
    expect(r.trino_catalogs).toBeUndefined();
  });

  it("allows empty visible_schemas per catalog (Trino-only exception)", () => {
    const profile = base({
      trino_catalogs: ["memory"],
      trino_schema_filters: JSON.stringify({}),
      databases: [],
    });
    expect(migrateTrinoLegacyFields(profile).databases).toEqual([
      { name: "memory", visible_schemas: [] },
    ]);
  });

  it("derives catalogs from trino_schema_filters keys when trino_catalogs absent", () => {
    const profile = base({
      trino_catalogs: undefined,
      trino_schema_filters: JSON.stringify({ tpch: ["tiny", "sf1"] }),
      databases: [],
    });
    const result = migrateTrinoLegacyFields(profile);
    expect(result.databases).toEqual([
      { name: "tpch", visible_schemas: ["tiny", "sf1"] },
    ]);
  });
});
