import { describe, expect, it } from "vitest";
import { DbType } from "@/types/connection";
import {
  buildRunAllPlan,
  buildTransactionCommands,
  extractStatementsForRunAll,
  hasManualTransactionControl,
} from "./query-execution-plan";

describe("extractStatementsForRunAll", () => {
  it("extracts multiple statements while preserving string semicolons", () => {
    const sql = "SELECT 'a;b';\nUPDATE users SET name = 'x';";
    expect(extractStatementsForRunAll(sql)).toEqual([
      "SELECT 'a;b'",
      "UPDATE users SET name = 'x'",
    ]);
  });

  it("removes comment-only statements", () => {
    const sql = "-- just a comment;\n/* block comment */;\nSELECT 1;";
    expect(extractStatementsForRunAll(sql)).toEqual(["SELECT 1"]);
  });
});

describe("hasManualTransactionControl", () => {
  it("detects explicit transaction control statements", () => {
    expect(
      hasManualTransactionControl([
        "BEGIN TRANSACTION",
        "UPDATE users SET name = 'a' WHERE id = 1",
        "COMMIT",
      ]),
    ).toBe(true);
  });

  it("does not treat regular DML as manual transaction control", () => {
    expect(
      hasManualTransactionControl([
        "UPDATE users SET name = 'a' WHERE id = 1",
        "SELECT * FROM users",
      ]),
    ).toBe(false);
  });
});

describe("buildTransactionCommands", () => {
  it("uses MSSQL transaction syntax", () => {
    expect(buildTransactionCommands(DbType.SQLServer)).toEqual({
      begin: "BEGIN TRANSACTION",
      commit: "COMMIT TRANSACTION",
      rollback: "ROLLBACK TRANSACTION",
    });
  });

  it("uses default SQL transaction syntax for PostgreSQL", () => {
    expect(buildTransactionCommands(DbType.PostgreSQL)).toEqual({
      begin: "BEGIN",
      commit: "COMMIT",
      rollback: "ROLLBACK",
    });
  });
});

describe("buildRunAllPlan", () => {
  it("enables auto-wrap when no manual transaction control exists", () => {
    const plan = buildRunAllPlan({
      statements: ["SELECT 1", "UPDATE users SET name = 'x' WHERE id = 1"],
      dbType: DbType.PostgreSQL,
      autoTransaction: true,
    });

    expect(plan.shouldAutoWrap).toBe(true);
    expect(plan.hasManualTransaction).toBe(false);
    expect(plan.transactionCommands).toEqual({
      begin: "BEGIN",
      commit: "COMMIT",
      rollback: "ROLLBACK",
    });
  });

  it("disables auto-wrap when manual transaction control exists", () => {
    const plan = buildRunAllPlan({
      statements: ["BEGIN", "UPDATE users SET name = 'x' WHERE id = 1", "COMMIT"],
      dbType: DbType.PostgreSQL,
      autoTransaction: true,
    });

    expect(plan.shouldAutoWrap).toBe(false);
    expect(plan.hasManualTransaction).toBe(true);
    expect(plan.transactionCommands).toBeNull();
  });
});
