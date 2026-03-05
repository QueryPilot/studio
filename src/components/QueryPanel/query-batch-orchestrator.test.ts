import { describe, expect, it } from "vitest";
import type { RunAllPlan } from "./query-execution-plan";
import { orchestrateRunAllExecution } from "./query-batch-orchestrator";

function createRunPlan(
  overrides: Partial<RunAllPlan> = {},
): RunAllPlan {
  return {
    statements: ["SELECT 1", "UPDATE users SET name = 'x'", "SELECT 2"],
    hasManualTransaction: false,
    shouldAutoWrap: true,
    transactionCommands: {
      begin: "BEGIN",
      commit: "COMMIT",
      rollback: "ROLLBACK",
    },
    ...overrides,
  };
}

function successResult(message?: string) {
  return {
    success: true as const,
    result: {
      columns: [],
      rows: [],
      rowCount: 0,
      message,
    },
  };
}

function errorResult(message: string) {
  return {
    success: false as const,
    result: {
      columns: [],
      rows: [],
      rowCount: 0,
      error: message,
    },
  };
}

describe("orchestrateRunAllExecution", () => {
  it("commits auto transaction when all statements succeed", async () => {
    const plan = createRunPlan();
    const calls: string[] = [];

    const result = await orchestrateRunAllExecution({
      runPlan: plan,
      executeStatement: (sql) => {
        calls.push(sql);
        return Promise.resolve(successResult());
      },
    });

    expect(calls).toEqual([
      "BEGIN",
      "SELECT 1",
      "UPDATE users SET name = 'x'",
      "SELECT 2",
      "COMMIT",
    ]);
    expect(result.statementResults.map((entry) => entry.status)).toEqual([
      "success",
      "success",
      "success",
    ]);
    expect(result.transactionOutcome).toBe("committed");
    expect(result.successCount).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });

  it("rolls back and skips remaining statements after first statement error in auto transaction mode", async () => {
    const plan = createRunPlan();
    const calls: string[] = [];

    const result = await orchestrateRunAllExecution({
      runPlan: plan,
      executeStatement: (sql) => {
        calls.push(sql);
        if (sql === "UPDATE users SET name = 'x'") {
          return Promise.resolve(errorResult("syntax error"));
        }
        return Promise.resolve(successResult());
      },
    });

    expect(calls).toEqual([
      "BEGIN",
      "SELECT 1",
      "UPDATE users SET name = 'x'",
      "ROLLBACK",
    ]);
    expect(result.statementResults.map((entry) => entry.status)).toEqual([
      "success",
      "error",
      "skipped",
    ]);
    expect(result.statementResults[2]?.result.message).toBe(
      "Skipped after earlier statement failure",
    );
    expect(result.transactionOutcome).toBe("rolled_back");
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it("continues after errors when auto transaction wrapping is disabled", async () => {
    const plan = createRunPlan({
      shouldAutoWrap: false,
      hasManualTransaction: true,
      transactionCommands: null,
    });
    const calls: string[] = [];

    const result = await orchestrateRunAllExecution({
      runPlan: plan,
      executeStatement: (sql) => {
        calls.push(sql);
        if (sql === "SELECT 1") {
          return Promise.resolve(errorResult("error"));
        }
        return Promise.resolve(successResult());
      },
    });

    expect(calls).toEqual(["SELECT 1", "UPDATE users SET name = 'x'", "SELECT 2"]);
    expect(result.statementResults.map((entry) => entry.status)).toEqual([
      "error",
      "success",
      "success",
    ]);
    expect(result.transactionOutcome).toBe("none");
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("skips remaining statements and rolls back when cancellation is requested during batch", async () => {
    const plan = createRunPlan();
    const calls: string[] = [];
    let cancelled = false;

    const result = await orchestrateRunAllExecution({
      runPlan: plan,
      isCancelRequested: () => cancelled,
      executeStatement: (sql) => {
        calls.push(sql);
        if (sql === "SELECT 1") {
          cancelled = true;
        }
        return Promise.resolve(successResult());
      },
    });

    expect(calls).toEqual(["BEGIN", "SELECT 1", "ROLLBACK"]);
    expect(result.statementResults.map((entry) => entry.status)).toEqual([
      "success",
      "skipped",
      "skipped",
    ]);
    expect(result.statementResults[1]?.result.message).toBe(
      "Skipped after cancellation",
    );
    expect(result.statementResults[2]?.result.message).toBe(
      "Skipped after cancellation",
    );
    expect(result.transactionOutcome).toBe("rolled_back");
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.skippedCount).toBe(2);
  });

  it("does not rollback when begin transaction fails", async () => {
    const plan = createRunPlan();
    const calls: string[] = [];

    const result = await orchestrateRunAllExecution({
      runPlan: plan,
      executeStatement: (sql) => {
        calls.push(sql);
        if (sql === "BEGIN") {
          return Promise.resolve(errorResult("begin failed"));
        }
        return Promise.resolve(successResult());
      },
    });

    expect(calls).toEqual(["BEGIN"]);
    expect(result.statementResults.map((entry) => entry.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.statementResults[0]?.result.message).toBe(
      "Skipped due transaction start failure",
    );
    expect(result.transactionOutcome).toBe("begin_failed");
    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.skippedCount).toBe(3);
  });
});
