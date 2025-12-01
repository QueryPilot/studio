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
} from "./types";

export { getQueryAtCursor, getQueryAtCursorFromState } from "./query-utils";
