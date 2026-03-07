import { describe, it, expect } from "vitest";
import { MSSQLAdapter } from "../dialects/MSSQLAdapter";

describe("MSSQLAdapter.select", () => {
  it("should include rawWhere in SELECT query", () => {
    const adapter = new MSSQLAdapter("test-conn");
    const sql = adapter.select(
      { schema: "dbo", table: "users" },
      { rawWhere: "age > 18 AND status = 'active'" }
    );
    expect(sql).toContain("WHERE age > 18 AND status = 'active'");
  });

  it("should prefer rawWhere over structured where", () => {
    const adapter = new MSSQLAdapter("test-conn");
    const sql = adapter.select(
      { schema: "dbo", table: "users" },
      {
        rawWhere: "age > 18",
        where: { name: "John" },
      }
    );
    expect(sql).toContain("WHERE age > 18");
    expect(sql).not.toContain("John");
  });
});
