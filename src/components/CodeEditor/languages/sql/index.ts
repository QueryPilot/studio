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

// NOTE: Legacy sql-linter.ts and version-linter.ts DELETED
// Validation is now handled by:
// - unified-linter.ts (uses Rust sql_validate for Tauri-only app)
// - linter-strategy.ts (routes dialects to appropriate linter)

// Unified linter strategy
export {
  createDialectLinter,
  usesWorkerLinter,
  getLinterDescription,
} from "./linter-strategy";
export type { DialectLinterConfig } from "./linter-strategy";

// Unified linter (uses Rust sql_validate for Tauri-only app)
export { createUnifiedLinter } from "./unified-linter";

// Rust completion bridge (Tauri environment)
export {
  createRustCompletionSource,
  isRustCompletionAvailable,
} from "./rust-completion";

// Metadata provider
export {
  SqlMetadataProvider,
  createSqlMetadataProvider,
  clearProviderCache,
} from "./metadataProvider";

// Dialect validators
export { getDialectValidator } from "./dialect-validators";
export type { SyntaxError } from "./dialect-validators";

// SQL Functions database
export {
  SQL_FUNCTIONS,
  getFunction,
  searchFunctions,
  getFunctionsByCategory,
} from "./functions";
export type { SqlFunction } from "./functions";

// Code actions
export {
  createExpandStarExtension,
  expandStarAtPosition,
} from "./code-actions";

// Symbol table
export {
  buildSymbolTable,
  resolveSymbol,
  getSymbolsInScope,
  getTablesInScope,
  resolveQualifier,
} from "./symbol-table";
export type { Symbol, SymbolTable, SymbolType } from "./symbol-table";
