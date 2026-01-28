/**
 * Core Smart Editor engine exports.
 * These are language-agnostic interfaces used across all language implementations.
 */

export type {
  EntityMeta,
  FieldMeta,
  EntityDetails,
  MetadataProvider,
  EditorContextAnalysis,
  JoinConditionSuggestion,
  FunctionMeta,
} from "./types";

export type { StatementBoundary } from "./query-utils";

export {
  getQueryAtCursor,
  getQueryAtCursorFromState,
  getAllStatements,
  getStatementAtPosition,
  getStatementsInRange,
  isDestructiveQuery,
} from "./query-utils";
