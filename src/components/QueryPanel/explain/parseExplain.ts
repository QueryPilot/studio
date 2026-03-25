import type { ParsedExplain } from "./types";
import { parsePostgresExplain } from "./parsers/postgres";
import { parseSQLiteExplainQueryPlan } from "./parsers/sqlite";
import { parseMySqlExplain } from "./parsers/mysql";
import { parseSqlServerExplain } from "./parsers/sqlserver";
import { parseSqlServerTextShowplan } from "./parsers/sqlserverText";
import { parseOracleExplain } from "./parsers/oracle";

export interface ParseExplainInput {
  columns: string[];
  rows: unknown[][];
  databaseType?: string;
}

export function parseExplain(input: ParseExplainInput): ParsedExplain {
  const normalizedType = input.databaseType?.toLowerCase().trim() || "";
  if (normalizedType.includes("sqlite")) {
    return parseSQLiteExplainQueryPlan(input);
  }
  if (normalizedType.includes("mysql") || normalizedType.includes("mariadb")) {
    return parseMySqlExplain(input);
  }
  if (normalizedType.includes("sqlserver") || normalizedType.includes("mssql")) {
    return parseSqlServerExplain(input);
  }
  if (normalizedType.includes("oracle")) {
    return parseOracleExplain(input);
  }

  const normalizedColumns = input.columns.map((column) =>
    column.toLowerCase().trim(),
  );
  const looksLikeSqliteEqp =
    normalizedColumns.includes("id") &&
    normalizedColumns.includes("parent") &&
    normalizedColumns.some((column) => column.endsWith("detail"));
  if (looksLikeSqliteEqp) {
    return parseSQLiteExplainQueryPlan(input);
  }

  const looksLikeMySqlTraditional =
    normalizedColumns.includes("table") &&
    normalizedColumns.includes("type") &&
    (normalizedColumns.includes("select_type") ||
      normalizedColumns.includes("possible_keys"));
  if (looksLikeMySqlTraditional) {
    return parseMySqlExplain(input);
  }

  const looksLikeSqlServerShowplan =
    normalizedColumns.includes("nodeid") &&
    normalizedColumns.includes("parent") &&
    normalizedColumns.includes("physicalop");
  if (looksLikeSqlServerShowplan) {
    return parseSqlServerExplain(input);
  }

  const looksLikeSqlServerText =
    normalizedColumns.length === 1 &&
    normalizedColumns[0] === "stmttext";
  if (looksLikeSqlServerText) {
    return parseSqlServerTextShowplan(input);
  }

  // Oracle DBMS_XPLAN.DISPLAY: single "plan_table_output" column
  const looksLikeOraclePlan =
    normalizedColumns.length === 1 &&
    normalizedColumns[0] === "plan_table_output";
  if (looksLikeOraclePlan) {
    return parseOracleExplain(input);
  }

  return parsePostgresExplain(input.rows);
}
