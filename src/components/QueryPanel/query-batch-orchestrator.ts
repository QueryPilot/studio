import type { QueryResult } from "@/stores/tabStateStore";
import type { RunAllPlan } from "./query-execution-plan";
import {
  buildResultViewPresentation,
  type ResultViewPresentation,
} from "./query-result-view";
import {
  createShowplanTracker,
  type ShowplanFormat,
} from "./showplan-state-tracker";

export interface BatchStatementResult {
  statementIndex: number;
  statement: string;
  status: "success" | "error" | "skipped";
  result: QueryResult;
  presentation: ResultViewPresentation;
  showplanLabel?: string | null;
}

export interface ExecuteBatchStatementOptions {
  internalTxnStep: boolean;
}

export interface ExecuteBatchStatementResult {
  success: boolean;
  cancelled?: boolean;
  result: QueryResult;
  presentation?: ResultViewPresentation;
}

export interface OrchestrateRunAllExecutionInput {
  runPlan: RunAllPlan;
  dbType?: string;
  executeStatement: (
    sql: string,
    options: ExecuteBatchStatementOptions,
  ) => Promise<ExecuteBatchStatementResult>;
  isCancelRequested?: () => boolean;
  onStatementResult?: (entry: BatchStatementResult) => void;
}

export interface OrchestrateRunAllExecutionResult {
  statementResults: BatchStatementResult[];
  successCount: number;
  errorCount: number;
  skippedCount: number;
  cancelled: boolean;
  transactionOutcome: "none" | "begin_failed" | "committed" | "rolled_back";
  finalShowplanState: ShowplanFormat | null;
}

function makeSkippedResult(message: string): QueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    message,
  };
}

export async function orchestrateRunAllExecution({
  runPlan,
  dbType,
  executeStatement,
  isCancelRequested,
  onStatementResult,
}: OrchestrateRunAllExecutionInput): Promise<OrchestrateRunAllExecutionResult> {
  const statementResults: BatchStatementResult[] = [];
  const appendResult = (entry: BatchStatementResult) => {
    statementResults.push(entry);
    onStatementResult?.(entry);
  };

  let batchFailed = false;
  let wasCancelled = false;
  let transactionStarted = false;
  let skipReason = "Skipped after earlier statement failure";
  let transactionOutcome: OrchestrateRunAllExecutionResult["transactionOutcome"] =
    "none";

  if (runPlan.shouldAutoWrap && runPlan.transactionCommands) {
    const beginResult = await executeStatement(runPlan.transactionCommands.begin, {
      internalTxnStep: true,
    });

    if (beginResult.success) {
      transactionStarted = true;
    } else {
      batchFailed = true;
      skipReason = "Skipped due transaction start failure";
      transactionOutcome = "begin_failed";
    }
  }

  const showplanTracker =
    dbType?.toLowerCase() === "sqlserver" ? createShowplanTracker() : null;

  for (const [index, statement] of runPlan.statements.entries()) {
    if (isCancelRequested?.()) {
      wasCancelled = true;
      appendResult({
        statementIndex: index + 1,
        statement,
        status: "skipped",
        result: makeSkippedResult("Skipped after cancellation"),
        presentation: buildResultViewPresentation({
          sql: statement,
          result: makeSkippedResult("Skipped after cancellation"),
        }),
      });
      if (runPlan.shouldAutoWrap) {
        batchFailed = true;
      }
      continue;
    }

    if (runPlan.shouldAutoWrap && batchFailed) {
      appendResult({
        statementIndex: index + 1,
        statement,
        status: "skipped",
        result: makeSkippedResult(skipReason),
        presentation: buildResultViewPresentation({
          sql: statement,
          result: makeSkippedResult(skipReason),
        }),
      });
      continue;
    }

    // MSSQL SHOWPLAN interception
    const showplanResult = showplanTracker?.processStatement(statement);

    if (showplanResult?.isShowplanSet) {
      appendResult({
        statementIndex: index + 1,
        statement,
        status: "success",
        result: {
          columns: [],
          rows: [],
          rowCount: 0,
          message: showplanResult.label ?? "OK",
        },
        presentation: {
          mode: "table",
          supportedModes: [],
          isExplainLike: false,
        },
        showplanLabel: showplanResult.label,
      });
      continue;
    }

    const sqlToExecute = showplanResult?.wrappedSql ?? statement;

    const statementResult = await executeStatement(sqlToExecute, {
      internalTxnStep: false,
    });

    if (statementResult.success) {
      appendResult({
        statementIndex: index + 1,
        statement,
        status: "success",
        result: statementResult.result,
        presentation:
          statementResult.presentation ??
          buildResultViewPresentation({
            sql: statement,
            result: statementResult.result,
            showplanFormat: showplanResult?.showplanFormat,
          }),
      });
      continue;
    }

    const cancelledResult = {
      ...statementResult.result,
      message: "Skipped due cancellation",
    };
    if (statementResult.cancelled) {
      wasCancelled = true;
      appendResult({
        statementIndex: index + 1,
        statement,
        status: "skipped",
        result: cancelledResult,
        presentation: buildResultViewPresentation({
          sql: statement,
          result: cancelledResult,
        }),
      });
      if (runPlan.shouldAutoWrap) {
        batchFailed = true;
      }
      continue;
    }

    appendResult({
      statementIndex: index + 1,
      statement,
      status: "error",
      result: statementResult.result,
      presentation:
        statementResult.presentation ??
        buildResultViewPresentation({
          sql: statement,
          result: statementResult.result,
        }),
    });
    if (runPlan.shouldAutoWrap) {
      batchFailed = true;
      skipReason = "Skipped after earlier statement failure";
    }
  }

  if (runPlan.shouldAutoWrap && runPlan.transactionCommands && transactionStarted) {
    const shouldRollback = batchFailed || Boolean(isCancelRequested?.());
    if (shouldRollback) {
      await executeStatement(runPlan.transactionCommands.rollback, {
        internalTxnStep: true,
      });
      transactionOutcome = "rolled_back";
    } else {
      await executeStatement(runPlan.transactionCommands.commit, {
        internalTxnStep: true,
      });
      transactionOutcome = "committed";
    }
  }

  const successCount = statementResults.filter(
    (entry) => entry.status === "success",
  ).length;
  const errorCount = statementResults.filter(
    (entry) => entry.status === "error",
  ).length;
  const skippedCount = statementResults.filter(
    (entry) => entry.status === "skipped",
  ).length;

  return {
    statementResults,
    successCount,
    errorCount,
    skippedCount,
    cancelled: wasCancelled,
    transactionOutcome,
    finalShowplanState: showplanTracker?.getState() ?? null,
  };
}
