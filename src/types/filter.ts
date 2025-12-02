export type LogicalOperator = "AND" | "OR";

/** Supported filter operators */
export type FilterOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "ILIKE"
  | "NOT LIKE"
  | "NOT ILIKE"
  | "REGEX"      // PostgreSQL: ~, MySQL: REGEXP BINARY
  | "REGEX_I"    // PostgreSQL: ~*, MySQL: REGEXP
  | "IN"
  | "NOT IN"
  | "IS NULL"
  | "IS NOT NULL";

export interface FilterCondition {
  id: string;
  column: string;
  operator: FilterOperator | string;
  value?: unknown;
  /** If true, cast column to text before comparison (for searching non-text columns) */
  castToText?: boolean;
  /** If true, this is a negated condition (NOT) */
  negated?: boolean;
}

export interface FilterGroup {
  id: string;
  type: "group";
  logical: LogicalOperator;
  conditions: Array<FilterCondition | FilterGroup>;
}

export interface FilterConfig {
  root: FilterGroup;
  /** Raw SQL WHERE clause - used for AI-generated filters that can't be parsed into conditions */
  rawWhereClause?: string;
}

export interface SortConfig {
  column: string;
  direction: "asc" | "desc";
}
