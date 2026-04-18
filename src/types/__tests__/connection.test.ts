import { describe, it, expect } from "vitest";
import type { ConnectionProfile, DatabaseEntry } from "@/types/connection";
import { DbType } from "@/types/connection";

describe("ConnectionProfile v2 shape", () => {
  it("accepts databases[] with visible_schemas", () => {
    const entry: DatabaseEntry = {
      name: "mydb",
      visible_schemas: ["public", "reporting"],
    };
    const profile: ConnectionProfile = {
      id: "c1",
      name: "t",
      db_type: DbType.PostgreSQL,
      host: "localhost",
      port: 5432,
      database: "mydb",
      username: "u",
      options: {},
      databases: [entry],
    };
    expect(profile.databases[0]?.visible_schemas[0]).toBe("public");
  });
});
