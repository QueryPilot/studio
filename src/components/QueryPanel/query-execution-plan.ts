import { splitStatements } from "@/components/CodeEditor/languages/sql/statement-splitter";
import { DbType } from "@/types/connection";

export interface TransactionCommands {
  begin: string;
  commit: string;
  rollback: string;
}

export interface RunAllPlanInput {
  statements: string[];
  dbType?: DbType | string;
  autoTransaction?: boolean;
}

export interface RunAllPlan {
  statements: string[];
  hasManualTransaction: boolean;
  shouldAutoWrap: boolean;
  transactionCommands: TransactionCommands | null;
}

const TXN_CONTROL_PATTERNS = [
  /^BEGIN(?:\s+TRANSACTION)?\b/i,
  /^START\s+TRANSACTION\b/i,
  /^COMMIT(?:\s+TRANSACTION)?\b/i,
  /^ROLLBACK(?:\s+TRANSACTION)?(?:\s+TO\b.*)?$/i,
  /^SAVEPOINT\b/i,
  /^RELEASE\s+SAVEPOINT\b/i,
];

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function isCommentOnly(sql: string): boolean {
  return stripComments(sql).trim().length === 0;
}

function normalizeStatements(statements: string[]): string[] {
  return statements
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => !isCommentOnly(statement));
}

export function extractStatementsForRunAll(
  sql: string,
  _editorState?: unknown,
): string[] {
  if (!sql.trim()) {
    return [];
  }

  const split = splitStatements(sql).map((statement) => statement.text);
  if (split.length === 0) {
    return isCommentOnly(sql) ? [] : [sql.trim()];
  }

  return normalizeStatements(split);
}

export function hasManualTransactionControl(statements: string[]): boolean {
  for (const statement of normalizeStatements(statements)) {
    const normalized = stripComments(statement).trim();
    if (!normalized) continue;
    if (TXN_CONTROL_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return true;
    }
  }
  return false;
}

/** Databases that do not support transaction wrapping. */
function supportsAutoTransaction(dbType?: DbType | string): boolean {
  const normalized = (dbType ?? "").toLowerCase();
  // Trino is read-only and has no transaction support in V1
  return normalized !== DbType.Trino.toLowerCase();
}

export function buildTransactionCommands(
  dbType?: DbType | string,
): TransactionCommands {
  const normalized = (dbType ?? "").toLowerCase();

  if (
    normalized === DbType.SQLServer.toLowerCase() ||
    normalized === "mssql"
  ) {
    return {
      begin: "BEGIN TRANSACTION",
      commit: "COMMIT TRANSACTION",
      rollback: "ROLLBACK TRANSACTION",
    };
  }

  if (normalized === DbType.SQLite.toLowerCase()) {
    return {
      begin: "BEGIN TRANSACTION",
      commit: "COMMIT",
      rollback: "ROLLBACK",
    };
  }

  if (normalized === DbType.Oracle.toLowerCase()) {
    return {
      begin: "",
      commit: "COMMIT",
      rollback: "ROLLBACK",
    };
  }

  return {
    begin: "BEGIN",
    commit: "COMMIT",
    rollback: "ROLLBACK",
  };
}

export function buildRunAllPlan({
  statements,
  dbType,
  autoTransaction = true,
}: RunAllPlanInput): RunAllPlan {
  const normalizedStatements = normalizeStatements(statements);
  const hasManualTransaction = hasManualTransactionControl(normalizedStatements);
  const shouldAutoWrap =
    autoTransaction &&
    normalizedStatements.length > 0 &&
    !hasManualTransaction &&
    supportsAutoTransaction(dbType);

  return {
    statements: normalizedStatements,
    hasManualTransaction,
    shouldAutoWrap,
    transactionCommands: shouldAutoWrap
      ? buildTransactionCommands(dbType)
      : null,
  };
}
