import { describe, it, expect } from "vitest";
import { synthesizeDatabasesV1ToV2 } from "@/services/vaultStorage";
import { DbType } from "@/types/connection";
import type { ConnectionProfile } from "@/types/connection";

const base = (over: Partial<ConnectionProfile>): ConnectionProfile => ({
  id: "c1", name: "t", db_type: DbType.PostgreSQL, host: "h", port: 5432,
  database: "mydb", username: "u", options: {}, databases: [], ...over,
});

describe("synthesizeDatabasesV1ToV2", () => {
  it("PG with default_schema seeds visible_schemas from it", () => {
    const p = synthesizeDatabasesV1ToV2(base({ default_schema: "reporting" }));
    expect(p.databases).toEqual([{ name: "mydb", visible_schemas: ["reporting"] }]);
  });
  it("PG without default_schema defaults to public", () => {
    const p = synthesizeDatabasesV1ToV2(base({ default_schema: undefined }));
    expect(p.databases).toEqual([{ name: "mydb", visible_schemas: ["public"] }]);
  });
  it("MSSQL defaults to dbo", () => {
    const p = synthesizeDatabasesV1ToV2(base({ db_type: DbType.SQLServer }));
    const [first] = p.databases;
    expect(first?.visible_schemas).toEqual(["dbo"]);
  });
  it("SQLite defaults to main", () => {
    const p = synthesizeDatabasesV1ToV2(base({ db_type: DbType.SQLite }));
    const [first] = p.databases;
    expect(first?.visible_schemas).toEqual(["main"]);
  });
  it("DuckDB defaults to main", () => {
    const p = synthesizeDatabasesV1ToV2(base({ db_type: DbType.DuckDB }));
    const [first] = p.databases;
    expect(first?.visible_schemas).toEqual(["main"]);
  });
  it("MySQL seeds visible_schemas from options.database", () => {
    const p = synthesizeDatabasesV1ToV2(
      base({ db_type: DbType.MySQL, database: "appdb", options: { database: "appdb" } }),
    );
    expect(p.databases).toEqual([{ name: "appdb", visible_schemas: ["appdb"] }]);
  });
  it("does not mutate legacy default_schema on read", () => {
    const input = base({ default_schema: "reporting" });
    const p = synthesizeDatabasesV1ToV2(input);
    expect(p.default_schema).toBe("reporting");
  });
  it("Trino v1 seeds one DatabaseEntry per catalog", () => {
    const p = synthesizeDatabasesV1ToV2(base({
      db_type: DbType.Trino,
      trino_catalogs: ["hive", "iceberg"],
      trino_schema_filters: JSON.stringify({ hive: ["default"], iceberg: [] }),
    }));
    expect(p.databases.map((d) => d.name)).toEqual(["hive", "iceberg"]);
    const [hive, iceberg] = p.databases;
    expect(hive?.visible_schemas).toEqual(["default"]);
    expect(iceberg?.visible_schemas).toEqual([]);
  });
  it("keeps existing databases[] untouched when already v2", () => {
    const p = synthesizeDatabasesV1ToV2(base({
      databases: [{ name: "mydb", visible_schemas: ["x"] }],
    }));
    expect(p.databases).toEqual([{ name: "mydb", visible_schemas: ["x"] }]);
  });
});
