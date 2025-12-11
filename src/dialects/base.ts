/**
 * Base Dialect Implementation
 *
 * Provides default implementations and shared utilities for SQL dialects.
 * Specific dialects extend this class and override as needed.
 */

import type { DbType } from "@/services/backend";
import type { FilterConfig, SortConfig } from "@/types/filter";
import type {
  SqlDialect,
  CreateIndexParams,
  AddColumnParams,
  ModifyColumnParams,
  AddForeignKeyParams,
  CreateTriggerParams,
  SelectQueryParams,
} from "./types";

export abstract class BaseDialect implements SqlDialect {
  abstract readonly name: string;
  abstract readonly dbType: DbType;
  abstract readonly booleanLiterals: { true: string; false: string };
  abstract readonly supportsSchemas: boolean;
  abstract readonly supportsStreaming: boolean;

  // Identifier quoting character (override in subclasses)
  protected readonly identifierQuote: string = '"';

  // ============================================================================
  // Identifier & Literal Handling (can be overridden)
  // ============================================================================

  quoteIdentifier(name: string): string {
    const trimmed = name.trim();
    if (trimmed === "*") {
      return trimmed;
    }
    const escaped = trimmed.replace(new RegExp(this.identifierQuote, "g"), this.identifierQuote + this.identifierQuote);
    return `${this.identifierQuote}${escaped}${this.identifierQuote}`;
  }

  qualifyName(...segments: (string | undefined)[]): string {
    return segments
      .filter((s): s is string => Boolean(s))
      .map((s) => this.quoteIdentifier(s))
      .join(".");
  }

  escapeStringLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  formatLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return "NULL";
    }

    if (typeof value === "string") {
      return `'${this.escapeStringLiteral(value)}'`;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value.toString() : `'${value}'`;
    }

    if (typeof value === "boolean") {
      return value ? this.booleanLiterals.true : this.booleanLiterals.false;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Array.isArray(value) || typeof value === "object") {
      return `'${this.escapeStringLiteral(JSON.stringify(value))}'`;
    }

    return `'${this.escapeStringLiteral(String(value))}'`;
  }

  // ============================================================================
  // Data Query Building
  // ============================================================================

  buildSelectQuery(params: SelectQueryParams): string {
    const {
      schema,
      table,
      columns,
      filters,
      sorts,
      limit,
      offset,
      distinct,
    } = params;

    const parts: string[] = ["SELECT"];

    if (distinct) {
      parts.push("DISTINCT");
    }

    // Columns
    if (!columns || columns.length === 0) {
      parts.push("*");
    } else {
      parts.push(columns.map((c) => this.quoteIdentifier(c)).join(", "));
    }

    // FROM
    parts.push("FROM", this.qualifyName(schema, table));

    // WHERE
    if (filters) {
      const whereClause = this.buildWhereClause(filters);
      if (whereClause) {
        parts.push(whereClause);
      }
    }

    // ORDER BY
    if (sorts && sorts.length > 0) {
      const orderClause = this.buildOrderByClause(sorts);
      if (orderClause) {
        parts.push(orderClause);
      }
    }

    // LIMIT
    if (limit !== undefined) {
      parts.push(`LIMIT ${limit}`);
    }

    // OFFSET
    if (offset !== undefined && offset > 0) {
      parts.push(`OFFSET ${offset}`);
    }

    return parts.join(" ");
  }

  buildWhereClause(filters: FilterConfig): string {
    // Use raw WHERE clause if provided (for AI-generated filters)
    if (filters.rawWhereClause) {
      return `WHERE ${filters.rawWhereClause}`;
    }

    if (filters.root.conditions.length === 0) {
      return "";
    }

    const buildCondition = (
      condition: FilterConfig["root"]["conditions"][number],
    ): string => {
      // Check if this is a nested group
      if ("type" in condition) {
        // Nested group (FilterGroup)
        const group = condition;
        const subConditions = group.conditions
          .map(buildCondition)
          .filter(Boolean);
        if (subConditions.length === 0) return "";
        return `(${subConditions.join(` ${group.logical} `)})`;
      }

      // Simple condition (FilterCondition)
      const rawCol = this.quoteIdentifier(condition.column);
      // Cast to text if needed (for searching non-text columns)
      const col = condition.castToText ? `${rawCol}::text` : rawCol;
      const op = condition.operator.toUpperCase();
      const val = condition.value;

      // Handle special operators
      if (op === "IS NULL" || op === "IS NOT NULL") {
        return `${col} ${op}`;
      }

      if (op === "IN" && Array.isArray(val)) {
        const values = val.map((v) => this.formatLiteral(v)).join(", ");
        return `${col} IN (${values})`;
      }

      if (op === "NOT IN" && Array.isArray(val)) {
        const values = val.map((v) => this.formatLiteral(v)).join(", ");
        return `${col} NOT IN (${values})`;
      }

      if (op === "BETWEEN" && Array.isArray(val) && val.length === 2) {
        return `${col} BETWEEN ${this.formatLiteral(val[0])} AND ${this.formatLiteral(val[1])}`;
      }

      // Standard comparison
      return `${col} ${op} ${this.formatLiteral(val)}`;
    };

    const conditions = filters.root.conditions
      .map(buildCondition)
      .filter(Boolean);

    if (conditions.length === 0) {
      return "";
    }

    return `WHERE ${conditions.join(` ${filters.root.logical} `)}`;
  }

  buildOrderByClause(sorts: SortConfig[]): string {
    const clauses = sorts
      .filter((sort) => sort.column)
      .map((sort) => {
        const col = this.quoteIdentifier(sort.column);
        const dir = sort.direction.toUpperCase() === "DESC" ? "DESC" : "ASC";
        return `${col} ${dir}`;
      });

    if (clauses.length === 0) {
      return "";
    }

    return `ORDER BY ${clauses.join(", ")}`;
  }

  // ============================================================================
  // Abstract methods (must be implemented by subclasses)
  // ============================================================================

  abstract getDatabasesQuery(): string;
  abstract getSchemasQuery(): string;
  abstract getTablesQuery(schema: string): string;
  abstract getViewsQuery(schema: string): string;
  abstract getFunctionsQuery(schema: string): string;
  abstract getIndexesQuery(schema: string, table: string): string;
  abstract getIndexUsageStatsQuery(schema: string, table: string): string;
  abstract getConstraintsQuery(schema: string, table: string): string;
  abstract getColumnsQuery(schema: string, table: string): string;
  abstract getTriggersQuery(schema: string, table: string): string;
  abstract getSupportedIndexTypesQuery(): string;
  abstract getSupportedColumnTypesQuery(): string;
  abstract getTableCountQuery(schema: string, table: string, exact?: boolean): string;
  abstract getTableStatsQuery(schema: string, table: string): string;
  abstract getForeignKeyTargetsQuery(schema: string): string;
  abstract getObjectDefinitionQuery(
    objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
    schema: string,
    name: string,
  ): string;

  abstract createIndex(params: CreateIndexParams): string;
  abstract dropIndex(schema: string | undefined, indexName: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  abstract renameIndex(schema: string | undefined, oldName: string, newName: string): string;
  abstract addColumn(params: AddColumnParams): string;
  abstract dropColumn(schema: string | undefined, table: string, column: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  abstract modifyColumn(params: ModifyColumnParams): string[];
  abstract renameColumn(schema: string | undefined, table: string, oldName: string, newName: string): string;
  abstract addForeignKey(params: AddForeignKeyParams): string;
  abstract dropForeignKey(schema: string | undefined, table: string, constraintName: string, options?: { cascade?: boolean }): string;
  abstract createTrigger(params: CreateTriggerParams): string;
  abstract dropTrigger(schema: string | undefined, table: string, triggerName: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  abstract toggleTrigger(schema: string | undefined, table: string, triggerName: string, enabled: boolean): string;
}
