/**
 * SQL Language Support for the Smart Editor
 *
 * Exports all SQL-specific functionality including:
 * - Context analysis (the "Brain")
 * - Autocomplete
 * - Hover tooltips
 * - Semantic linting
 * - Metadata provider
 */

// Context analyzer
export { analyzeSqlContext } from "./context";
export type { SqlIntent, TableRef, SqlContextAnalysis } from "./context";

// Completion source
export { createSqlCompletionSource, clearCompletionCache } from "./completion";

// Hover tooltips
export { createSqlHoverExtension } from "./hover";

// Linting
export {
  createSqlLinter,
  createSemanticLinter,
  clearSemanticLinterCache,
} from "./sql-linter";

// Metadata provider
export {
  SqlMetadataProvider,
  createSqlMetadataProvider,
} from "./metadataProvider";

// Dialect validators
export { getDialectValidator } from "./dialect-validators";
export type { SyntaxError } from "./dialect-validators";
