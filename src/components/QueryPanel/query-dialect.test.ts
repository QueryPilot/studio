import { describe, expect, it } from "vitest";
import { resolveDialectFromDbType } from "./query-dialect";

describe("query dialect resolution", () => {
  it("maps db type to expected SQL dialect", () => {
    expect(resolveDialectFromDbType("PostgreSQL")).toBe("postgresql");
    expect(resolveDialectFromDbType("MySQL")).toBe("mysql");
    expect(resolveDialectFromDbType("MariaDB")).toBe("mysql");
    expect(resolveDialectFromDbType("SQLServer")).toBe("mssql");
    expect(resolveDialectFromDbType("SQLite")).toBe("sqlite");
  });

  it("defaults to postgresql for unknown db types", () => {
    expect(resolveDialectFromDbType("unknown")).toBe("postgresql");
  });
});
