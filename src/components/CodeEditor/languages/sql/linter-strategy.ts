/**
 * SQL Linter Strategy
 *
 * Provides a unified interface for creating dialect-specific linters.
 * Each dialect gets the most appropriate linter implementation:
 * - PostgreSQL: pg-parser WASM (most accurate for PL/pgSQL)
 * - Other dialects: Web Worker-based validation
 *
 * Note: lintGutter() is provided separately by run-gutter extension or SqlEditor
 *
 * Usage:
 *   const linter = createDialectLinter("postgresql");
 *   extensions.push(linter);
 */

import type { Extension } from "@codemirror/state";
import type { SqlDialect } from "../../types";
import { createPgParserLinter } from "./pg-parser-linter";
import { createWorkerLinter } from "./linter-worker-manager";

/**
 * Linter strategy configuration per dialect.
 */
interface LinterStrategy {
  /** The primary linter extension for this dialect */
  linter: () => Extension;
  /** Human-readable description */
  description: string;
}

/**
 * Strategy registry mapping dialects to their linter implementations.
 */
const LINTER_STRATEGIES: Record<SqlDialect, LinterStrategy> = {
  postgresql: {
    linter: () => createPgParserLinter(),
    description: "pg-parser WASM (PL/pgSQL support)",
  },
  mysql: {
    linter: () => createWorkerLinter("mysql"),
    description: "Web Worker validation",
  },
  sqlite: {
    linter: () => createWorkerLinter("sqlite"),
    description: "Web Worker validation",
  },
  mssql: {
    linter: () => createWorkerLinter("mssql"),
    description: "Web Worker validation",
  },
  plsql: {
    linter: () => createWorkerLinter("plsql"),
    description: "Web Worker validation (Oracle PL/SQL)",
  },
};

/**
 * Create the appropriate linter extension for a SQL dialect.
 * This provides a unified interface that abstracts away the implementation details.
 *
 * Note: lintGutter() is provided separately (by run-gutter extension or SqlEditor)
 *
 * @param dialect - The SQL dialect to lint for
 * @returns A CodeMirror extension array with dialect-specific linter (without gutter)
 */
export function createDialectLinter(
  dialect: SqlDialect = "postgresql",
): Extension[] {
  const strategy = LINTER_STRATEGIES[dialect];

  return [
    // Note: lintGutter() removed - provided by run-gutter or SqlEditor
    strategy.linter(),
  ];
}

/**
 * Check if a dialect uses the worker-based linter.
 * Useful for managing worker lifecycle.
 */
export function usesWorkerLinter(dialect: SqlDialect): boolean {
  return dialect !== "postgresql";
}

/**
 * Get description of which linter is used for a dialect.
 */
export function getLinterDescription(dialect: SqlDialect): string {
  return LINTER_STRATEGIES[dialect]?.description ?? "Unknown";
}
