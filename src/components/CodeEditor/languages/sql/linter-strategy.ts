/**
 * SQL Linter Strategy
 *
 * Provides a unified interface for creating dialect-specific linters.
 * All dialects use the Rust backend for validation (via Tauri IPC).
 *
 * Note: lintGutter() is provided separately by run-gutter extension or SqlEditor
 *
 * Usage:
 *   const linter = createDialectLinter("postgresql", { connectionId, schema });
 *   extensions.push(linter);
 */

import type { Extension } from "@codemirror/state";
import type { SqlDialect } from "../../types";
import { createUnifiedLinter } from "./unified-linter";

/**
 * Optional configuration for dialect linters.
 */
export interface DialectLinterConfig {
  /** Connection ID for schema-aware validation */
  connectionId?: string;
  /** Schema name for schema-aware validation */
  schema?: string;
}

/**
 * Linter strategy configuration per dialect.
 */
interface LinterStrategy {
  /** The primary linter extension for this dialect */
  linter: (config?: DialectLinterConfig) => Extension;
  /** Human-readable description */
  description: string;
}

/**
 * Strategy registry mapping dialects to their linter implementations.
 */
const LINTER_STRATEGIES: Record<SqlDialect, LinterStrategy> = {
  postgresql: {
    linter: (config) =>
      createUnifiedLinter({
        dialect: "postgresql",
        connectionId: config?.connectionId,
        schema: config?.schema,
      }),
    description: "Rust backend linter (500ms debounce)",
  },
  mysql: {
    linter: (config) =>
      createUnifiedLinter({
        dialect: "mysql",
        connectionId: config?.connectionId,
        schema: config?.schema,
      }),
    description: "Rust backend linter (500ms debounce)",
  },
  sqlite: {
    linter: (config) =>
      createUnifiedLinter({
        dialect: "sqlite",
        connectionId: config?.connectionId,
        schema: config?.schema,
      }),
    description: "Rust backend linter (500ms debounce)",
  },
  mssql: {
    linter: (config) =>
      createUnifiedLinter({
        dialect: "mssql",
        connectionId: config?.connectionId,
        schema: config?.schema,
      }),
    description: "Rust backend linter (500ms debounce)",
  },
  plsql: {
    linter: (config) =>
      createUnifiedLinter({
        dialect: "plsql",
        connectionId: config?.connectionId,
        schema: config?.schema,
      }),
    description: "Rust backend linter (500ms debounce)",
  },
};

/**
 * Create the appropriate linter extension for a SQL dialect.
 * This provides a unified interface that abstracts away the implementation details.
 *
 * Note: lintGutter() is provided separately (by run-gutter extension or SqlEditor)
 *
 * @param dialect - The SQL dialect to lint for
 * @param config - Optional configuration with connectionId and schema for schema-aware validation
 * @returns A CodeMirror extension array with dialect-specific linter (without gutter)
 */
export function createDialectLinter(
  dialect: SqlDialect = "postgresql",
  config?: DialectLinterConfig,
): Extension[] {
  const strategy = LINTER_STRATEGIES[dialect];

  return [
    // Note: lintGutter() removed - provided by run-gutter or SqlEditor
    strategy.linter(config),
  ];
}

/**
 * Check if a dialect uses the worker-based linter.
 * All dialects now use the unified linter (Rust backend in Tauri).
 */
export function usesWorkerLinter(_dialect: SqlDialect): boolean {
  return true;
}

/**
 * Get description of which linter is used for a dialect.
 */
export function getLinterDescription(dialect: SqlDialect): string {
  return LINTER_STRATEGIES[dialect]?.description ?? "Unknown";
}
