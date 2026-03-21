import type { ViewMode } from "@/types/viewMode";
import type { QueryResult } from "@/stores/tabStateStore";
import type { ShowplanFormat } from "./showplan-state-tracker";
import { isExplainResult } from "./ExplainViewer";

export interface ResultViewPresentation {
  mode: ViewMode;
  supportedModes: ViewMode[];
  isExplainLike: boolean;
}

const STANDARD_VIEW_MODES: ViewMode[] = ["table", "json"];
const EXPLAIN_VIEW_MODES: ViewMode[] = ["explain", "raw", "stats"];
const SHOWPLAN_TEXT_VIEW_MODES: ViewMode[] = ["raw"];

export function createEmptyResultViewPresentation(): ResultViewPresentation {
  return {
    mode: "table",
    supportedModes: [],
    isExplainLike: false,
  };
}

const LEADING_SQL_COMMENT = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/;

export function isExplainStatement(sql: string): boolean {
  const withoutLeadingComments = sql.replace(LEADING_SQL_COMMENT, "").trimStart();
  return /^EXPLAIN\b/i.test(withoutLeadingComments);
}

export function buildResultViewPresentation({
  sql,
  result,
  previousMode,
  showplanFormat,
}: {
  sql: string;
  result: QueryResult;
  previousMode?: ViewMode;
  showplanFormat?: ShowplanFormat | null;
}): ResultViewPresentation {
  const isShowplan = showplanFormat != null;
  const explainLike =
    isShowplan ||
    isExplainStatement(sql) ||
    isExplainResult(result.columns, result.rows);

  if (result.error || result.columns.length === 0) {
    return {
      mode: "table",
      supportedModes: [],
      isExplainLike: explainLike,
    };
  }

  let supportedModes: ViewMode[];
  let defaultMode: ViewMode;

  if (showplanFormat === "text") {
    supportedModes = SHOWPLAN_TEXT_VIEW_MODES;
    defaultMode = "raw";
  } else if (explainLike) {
    supportedModes = EXPLAIN_VIEW_MODES;
    defaultMode = "explain";
  } else {
    supportedModes = STANDARD_VIEW_MODES;
    defaultMode = "table";
  }

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
