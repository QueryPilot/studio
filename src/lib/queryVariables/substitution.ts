import type { QueryVariable, VariableScope } from "./types";
import { parseVariables, type ParseVariablesOptions } from "./parser";

export interface SubstitutionResult {
  /** The SQL with all variables replaced by their values */
  sql: string;
  /** Names of variables that have empty/missing values */
  missingVariables: string[];
  /** Whether the substitution is complete (no missing values) */
  isComplete: boolean;
}

/**
 * Substitute all variable placeholders in SQL with their values.
 * Returns the resolved SQL and any missing variable names.
 *
 * Replacement is done right-to-left by offset so earlier offsets remain valid.
 */
export function substituteVariables(
  sql: string,
  variables: Record<string, QueryVariable>,
  options?: ParseVariablesOptions,
): SubstitutionResult {
  const scope = options?.scope ?? "global";
  const { variables: parsed } = parseVariables(sql, options);

  if (parsed.length === 0) {
    return { sql, missingVariables: [], isComplete: true };
  }

  const missing: string[] = [];

  // Process replacements right-to-left to preserve offsets
  const sorted = [...parsed].sort((a, b) => b.offset - a.offset);

  let result = sql;
  for (const occurrence of sorted) {
    const key = buildLookupKey(occurrence.name, occurrence.syntax, scope, occurrence.statementIndex);
    const variable = variables[key];

    if (!variable || variable.value === "") {
      if (!missing.includes(occurrence.name)) {
        missing.push(occurrence.name);
      }
      continue;
    }

    const replacement = formatValue(variable);
    result =
      result.slice(0, occurrence.offset) +
      replacement +
      result.slice(occurrence.offset + occurrence.length);
  }

  // Reverse missing so they appear in document order
  missing.reverse();

  return {
    sql: result,
    missingVariables: missing,
    isComplete: missing.length === 0,
  };
}

/**
 * Substitute variables in a single statement within a multi-statement context.
 * Used by batch execution in per-statement scope mode.
 */
export function substituteStatementVariables(
  statement: string,
  statementIndex: number,
  variables: Record<string, QueryVariable>,
  scope: VariableScope,
): SubstitutionResult {
  // For per-statement scope, we re-parse just this statement but use the
  // original keys with the statement index prefix
  const { variables: parsed } = parseVariables(statement, { scope });

  if (parsed.length === 0) {
    return { sql: statement, missingVariables: [], isComplete: true };
  }

  const missing: string[] = [];
  const sorted = [...parsed].sort((a, b) => b.offset - a.offset);

  let result = statement;
  for (const occurrence of sorted) {
    // When in per_statement scope, the parsed occurrence has statementIndex=0
    // (since we parsed a single statement), but we need to look up with the
    // real statementIndex from the batch
    const effectiveStmtIdx = scope === "per_statement" ? statementIndex : occurrence.statementIndex;
    const key = buildLookupKey(occurrence.name, occurrence.syntax, scope, effectiveStmtIdx);
    const variable = variables[key];

    if (!variable || variable.value === "") {
      if (!missing.includes(occurrence.name)) {
        missing.push(occurrence.name);
      }
      continue;
    }

    const replacement = formatValue(variable);
    result =
      result.slice(0, occurrence.offset) +
      replacement +
      result.slice(occurrence.offset + occurrence.length);
  }

  missing.reverse();
  return { sql: result, missingVariables: missing, isComplete: missing.length === 0 };
}

function buildLookupKey(
  name: string,
  syntax: string,
  scope: VariableScope,
  statementIndex: number,
): string {
  const isPositional = syntax === "dollar_num" || syntax === "question_mark";
  if (isPositional && scope === "per_statement") {
    return `stmt:${statementIndex}:${name}`;
  }
  return name;
}

const VALID_NUMBER_RE = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

function formatValue(variable: QueryVariable): string {
  const { value, type } = variable;
  switch (type) {
    case "number":
      return VALID_NUMBER_RE.test(value) ? value : escapeSqlString(value);
    case "boolean":
      return value.toLowerCase() === "true" ? "TRUE" : "FALSE";
    case "date":
    case "datetime":
    case "text":
    default:
      return escapeSqlString(value);
  }
}

function escapeSqlString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
