import { describe, it, expect } from "vitest";
import { MySQLAdapter } from "../dialects/MySQLAdapter";

describe("MySQLAdapter.dropConstraint", () => {
  const adapter = new MySQLAdapter("test-conn");
  const target = { schema: "mydb", table: "users" };

  it("should emit DROP PRIMARY KEY for primary key constraints", () => {
    const sql = adapter.dropConstraint(
      target,
      "PRIMARY",
      false,
      false,
      "PRIMARY KEY",
    );
    expect(sql).toContain("DROP PRIMARY KEY");
  });

  it("should emit DROP FOREIGN KEY for FK constraints", () => {
    const sql = adapter.dropConstraint(
      target,
      "fk_user_org",
      false,
      false,
      "FOREIGN KEY",
    );
    expect(sql).toContain("DROP FOREIGN KEY");
    expect(sql).toContain("`fk_user_org`");
  });

  it("should emit DROP INDEX for unique constraints", () => {
    const sql = adapter.dropConstraint(
      target,
      "uq_email",
      false,
      false,
      "UNIQUE",
    );
    expect(sql).toContain("DROP INDEX");
    expect(sql).toContain("`uq_email`");
  });

  it("should emit DROP CHECK for check constraints", () => {
    const sql = adapter.dropConstraint(
      target,
      "chk_age",
      false,
      false,
      "CHECK",
    );
    expect(sql).toContain("DROP CHECK");
    expect(sql).toContain("`chk_age`");
  });

  it("should default to DROP CHECK when constraintType is not provided", () => {
    const sql = adapter.dropConstraint(target, "some_constraint");
    expect(sql).toContain("DROP CHECK");
  });
});
