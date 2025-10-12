export type LogicalOperator = "AND" | "OR";

export interface FilterCondition {
  id: string;
  column: string;
  operator: string;
  value?: unknown;
}

export interface FilterGroup {
  id: string;
  type: "group";
  logical: LogicalOperator;
  conditions: Array<FilterCondition | FilterGroup>;
}

export interface FilterConfig {
  root: FilterGroup;
}

export interface SortConfig {
  column: string;
  direction: "asc" | "desc";
}
