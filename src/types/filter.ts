export type LogicalOperator = "AND" | "OR";

export interface FilterCondition {
  id: string;
  column: string;
  operator: string;
  value?: unknown;
  /** If true, cast column to text before comparison (for searching non-text columns) */
  castToText?: boolean;
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
