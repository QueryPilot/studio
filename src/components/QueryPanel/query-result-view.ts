import type { ViewMode } from "@/types/viewMode";
import type { QueryResult } from "@/stores/tabStateStore";
import { isExplainResult } from "./ExplainViewer";

export interface ResultViewPresentation {
  mode: ViewMode;
  supportedModes: ViewMode[];
  isExplainLike: boolean;
}

const STANDARD_VIEW_MODES: ViewMode[] = ["table", "json"];
const EXPLAIN_VIEW_MODES: ViewMode[] = ["explain", "raw", "stats"];

export function createEmptyResultViewPresentation(): ResultViewPresentation {
  return {
    mode: "table",
    supportedModes: [],
    isExplainLike: false,
  };
}

const LEADING_SQL_COMMENT = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/;

export function isExplainStatement(sql: string): boolean {
  const withoutLeadingComments = sql.replace(LEADING_SQL_COMMENT, "");
  return /^EXPLAIN\b/i.test(withoutLeadingComments);
}

export function buildResultViewPresentation({
  sql,
  result,
  previousMode,
}: {
  sql: string;
  result: QueryResult;
  previousMode?: ViewMode;
}): ResultViewPresentation {
  const explainLike =
    isExplainStatement(sql) || isExplainResult(result.columns, result.rows);

  if (result.error || result.columns.length === 0) {
    return {
      mode: "table",
      supportedModes: [],
      isExplainLike: explainLike,
    };
  }

  const supportedModes = explainLike ? EXPLAIN_VIEW_MODES : STANDARD_VIEW_MODES;
  const defaultMode: ViewMode = explainLike ? "explain" : "table";
  const mode =
    previousMode && supportedModes.includes(previousMode)
      ? previousMode
      : defaultMode;

  return {
    mode,
    supportedModes,
    isExplainLike: explainLike,
  };
}
