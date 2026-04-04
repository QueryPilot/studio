export type VariableSyntax =
  | "mustache"
  | "colon"
  | "at"
  | "dollar_brace"
  | "dollar_num"
  | "question_mark";

export type VariableType = "text" | "number" | "date" | "datetime" | "boolean" | "list";

export type VariableScope = "global" | "per_statement";

/**
 * A single occurrence of a variable placeholder found by the parser.
 * Multiple ParsedVariables may map to the same QueryVariable (same name, different positions).
 */
export interface ParsedVariable {
  /** Display name: "region", "$1", "#1", etc. */
  name: string;
  syntax: VariableSyntax;
  /** 0-based index of the statement this occurrence belongs to */
  statementIndex: number;
  /** Character offset in the full SQL string */
  offset: number;
  /** Length of the full match text (e.g., `{{ region }}` = 14) */
  length: number;
  /** Whether this variable appears inside an IN (...) clause */
  inListContext?: boolean;
}

/**
 * A resolved variable with its user-assigned value and type.
 * Keyed in a Record by `variableKey()`.
 */
export interface QueryVariable {
  /** Display name: "region", "$1", "#1" */
  name: string;
  value: string;
  type: VariableType;
  syntax: VariableSyntax;
  /** Set when scope = "per_statement" */
  statementIndex?: number;
}

/**
 * Build the map key for a variable, accounting for scoping mode.
 *
 * Global: just the name ("region", "$1")
 * Per-statement: "stmt:0:region", "stmt:0:$1"
 */
export function variableKey(
  name: string,
  _syntax: VariableSyntax,
  scope: VariableScope,
  statementIndex?: number,
): string {
  if (scope === "per_statement" && statementIndex !== undefined) {
    return `stmt:${statementIndex}:${name}`;
  }
  return name;
}

/** Check whether a syntax produces positional (indexed) variables */
export function isPositionalSyntax(syntax: VariableSyntax): boolean {
  return syntax === "dollar_num" || syntax === "question_mark";
}
