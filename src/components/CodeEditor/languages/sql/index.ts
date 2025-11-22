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

// High-performance worker-based linter
export {
  createWorkerLinter,
  terminateLinterWorker,
} from "./linter-worker-manager";

// PostgreSQL parser (uses libpg_query for 100% PostgreSQL compatibility)
export {
  createPgParserLinter,
  parsePgSQL,
  isInitialized as isPgParserReady,
  preInitPgParser,
} from "./pg-parser-linter";

// Metadata provider
export {
  SqlMetadataProvider,
  createSqlMetadataProvider,
} from "./metadataProvider";

// Dialect validators
export { getDialectValidator } from "./dialect-validators";
export type { SyntaxError } from "./dialect-validators";

// SQL Functions database
export { SQL_FUNCTIONS, getFunction, searchFunctions, getFunctionsByCategory } from "./functions";
export type { SqlFunction } from "./functions";

// Code actions
export { createExpandStarExtension, expandStarAtPosition } from "./code-actions";

// Symbol table
export {
  buildSymbolTable,
  resolveSymbol,
  getSymbolsInScope,
  getTablesInScope,
  resolveQualifier,
} from "./symbol-table";
export type { Symbol, SymbolTable, SymbolType } from "./symbol-table";
