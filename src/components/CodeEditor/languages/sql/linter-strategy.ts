/**
 * SQL Linter Strategy
 *
 * Provides a unified interface for creating dialect-specific linters.
 * All dialects use a local fast pass plus the Rust backend for semantic validation.
 *
 * Note: lintGutter() is provided separately by run-gutter extension or SqlEditor
 *
 * Usage:
 *   const linter = createDialectLinter("postgresql", { connectionId, schema });
 *   extensions.push(...linter);
 */

import type { Extension } from "@codemirror/state";
import type { EditorDiagnosticsStatus, SqlDialect } from "../../types";
import {
  createFastSqlLinter,
  createSemanticSqlLinter,
} from "./unified-linter";

/**
 * Optional configuration for dialect linters.
 */
export interface DialectLinterConfig {
  /** Connection ID for schema-aware validation */
  connectionId?: string;
  /** Schema name for schema-aware validation */
  schema?: string;
  /** Reports lint lifecycle status for editor UI */
  onDiagnosticsStatusChange?: (status: EditorDiagnosticsStatus) => void;
}

/**
 * Linter strategy configuration per dialect.
 */
interface LinterStrategy {
  /** The linter extensions for this dialect */
  linter: (config?: DialectLinterConfig) => Extension[];
  /** Human-readable description */
  description: string;
}

function createTwoStageLinter(
  dialect: SqlDialect,
  config?: DialectLinterConfig,
): Extension[] {
  return [
    createFastSqlLinter({
      dialect,
      connectionId: config?.connectionId,
      schema: config?.schema,
      onDiagnosticsStatusChange: config?.onDiagnosticsStatusChange,
    }),
    createSemanticSqlLinter({
      dialect,
      connectionId: config?.connectionId,
      schema: config?.schema,
      onDiagnosticsStatusChange: config?.onDiagnosticsStatusChange,
    }),
  ];
}

/**
 * Strategy registry mapping dialects to their linter implementations.
 */
const LINTER_STRATEGIES: Record<SqlDialect, LinterStrategy> = {
  postgresql: {
    linter: (config) => createTwoStageLinter("postgresql", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  mysql: {
    linter: (config) => createTwoStageLinter("mysql", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  sqlite: {
    linter: (config) => createTwoStageLinter("sqlite", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  mssql: {
    linter: (config) => createTwoStageLinter("mssql", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  oracle: {
    linter: (config) => createTwoStageLinter("oracle", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  plsql: {
    linter: (config) => createTwoStageLinter("plsql", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
  },
  trino: {
    linter: (config) => createTwoStageLinter("trino", config),
    description: "Two-stage SQL linter (fast pass + Rust semantic validation)",
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
 * @returns A CodeMirror extension array with dialect-specific linters (without gutter)
 */
export function createDialectLinter(
  dialect: SqlDialect = "postgresql",
  config?: DialectLinterConfig,
): Extension[] {
  const strategy = LINTER_STRATEGIES[dialect];
  return strategy.linter(config);
}

/**
 * Check if a dialect uses the worker-based linter.
 * All dialects now use the Tauri/Rust semantic linter plus a local fast pass.
 */
export function usesWorkerLinter(_dialect: SqlDialect): boolean {
  return true;
}

/**
 * Get description of which linter is used for a dialect.
 */
export function getLinterDescription(dialect: SqlDialect): string {
  return LINTER_STRATEGIES[dialect].description;
}
