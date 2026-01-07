/**
 * SQL Engine Service
 *
 * TypeScript interface to the Rust SQL Engine (sqlparser-rs).
 * Provides parsing, validation, and completion for SQL queries.
 */

import { invoke } from "@tauri-apps/api/core";

// =============================================================================
// SQL Dialect Types
// =============================================================================

export type SqlDialect =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mssql"
  | "plsql";

// =============================================================================
// Parse Types
// =============================================================================

export interface ParseRequest {
  sql: string;
  dialect: SqlDialect;
}

export interface ParseResponse {
  statements: StatementInfo[];
  errors: ErrorInfo[];
}

export interface StatementInfo {
  statementType: string | null;
  range: [number, number];
  tables: string[];
  aliases: AliasInfo[];
}

export interface AliasInfo {
  alias: string;
  table: string;
}

export interface ErrorInfo {
  from: number;
  to: number;
  message: string;
  severity: "error" | "warning" | "hint";
  source: "syntax" | "semantic" | "validation";
}

// =============================================================================
// Validation Types
// =============================================================================

export interface ValidateRequest {
  sql: string;
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
}

export interface ValidateResponse {
  valid: boolean;
  errors: ErrorInfo[];
  warnings: ErrorInfo[];
}

// =============================================================================
// Completion Types
// =============================================================================

export interface CompleteRequest {
  sql: string;
  position: number;
  dialect: SqlDialect;
  connectionId?: string;
  database?: string;
  schema?: string;
  explicit: boolean;
}

export interface CompleteResponse {
  items: CompletionItemInfo[];
  from: number;
  to: number;
}

export interface CompletionItemInfo {
  label: string;
  kind: CompletionKind;
  detail: string | null;
  insertText: string | null;
  sortOrder: number;
}

export type CompletionKind =
  | "keyword"
  | "table"
  | "column"
  | "function"
  | "schema"
  | "alias"
  | "cte"
  | "snippet"
  | "database";

// =============================================================================
// SQL Engine Service
// =============================================================================

export const SqlEngineService = {
  /**
   * Parse SQL document and extract statement info.
   * Returns parsed statements with table/alias references and any syntax errors.
   */
  async parse(sql: string, dialect: SqlDialect): Promise<ParseResponse> {
    return invoke<ParseResponse>("sql_parse", {
      request: { sql, dialect },
    });
  },

  /**
   * Validate SQL document.
   * Performs syntax and semantic validation, returns errors and warnings.
   */
  async validate(
    sql: string,
    dialect: SqlDialect,
    connectionId?: string,
    schema?: string
  ): Promise<ValidateResponse> {
    return invoke<ValidateResponse>("sql_validate", {
      request: { sql, dialect, connectionId, schema },
    });
  },

  /**
   * Get completions at a cursor position.
   * Returns context-aware completion suggestions.
   */
  async complete(
    sql: string,
    position: number,
    dialect: SqlDialect,
    options?: {
      connectionId?: string;
      database?: string;
      schema?: string;
      explicit?: boolean;
    }
  ): Promise<CompleteResponse> {
    return invoke<CompleteResponse>("sql_complete", {
      request: {
        sql,
        position,
        dialect,
        connectionId: options?.connectionId,
        database: options?.database,
        schema: options?.schema,
        explicit: options?.explicit ?? true,
      },
    });
  },

  /**
   * Parse SQL and extract tables referenced in the query.
   * Convenience method for getting just table names.
   */
  async extractTables(sql: string, dialect: SqlDialect): Promise<string[]> {
    const result = await this.parse(sql, dialect);
    const tables = new Set<string>();
    for (const stmt of result.statements) {
      for (const table of stmt.tables) {
        tables.add(table);
      }
    }
    return Array.from(tables);
  },

  /**
   * Check if SQL has any syntax errors.
   * Quick check without full validation.
   */
  async hasSyntaxErrors(sql: string, dialect: SqlDialect): Promise<boolean> {
    const result = await this.parse(sql, dialect);
    return result.errors.length > 0;
  },

  /**
   * Get the statement type(s) in the SQL.
   * Returns array of statement types (SELECT, INSERT, UPDATE, etc.)
   */
  async getStatementTypes(sql: string, dialect: SqlDialect): Promise<string[]> {
    const result = await this.parse(sql, dialect);
    return result.statements
      .map((s) => s.statementType)
      .filter((t): t is string => t !== null);
  },
};

export default SqlEngineService;
