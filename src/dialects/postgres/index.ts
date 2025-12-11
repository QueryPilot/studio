/**
 * PostgreSQL Dialect Implementation
 *
 * Complete SQL generation for PostgreSQL including introspection queries,
 * DDL operations, and data query building.
 */

import { DbType } from "@/services/backend";
import { BaseDialect } from "../base";
import type {
  CreateIndexParams,
  AddColumnParams,
  ModifyColumnParams,
  AddForeignKeyParams,
  CreateTriggerParams,
} from "../types";
import * as introspection from "./introspection";

export class PostgresDialect extends BaseDialect {
  readonly name = "PostgreSQL";
  readonly dbType = DbType.PostgreSQL;
  readonly booleanLiterals = { true: "TRUE", false: "FALSE" };
  readonly supportsSchemas = true;
  readonly supportsStreaming = true;
  protected readonly identifierQuote = '"';

  // ============================================================================
  // Introspection Queries
  // ============================================================================

  getDatabasesQuery(): string {
    return introspection.GET_DATABASES_QUERY;
  }

  getSchemasQuery(): string {
    return introspection.GET_SCHEMAS_QUERY;
  }

  getTablesQuery(schema: string): string {
    // Return query with placeholder - caller handles parameter binding
    return introspection.GET_TABLES_QUERY.replace(/\$1/g, this.formatLiteral(schema));
  }

  getViewsQuery(schema: string): string {
    return introspection.GET_VIEWS_QUERY.replace(/\$1/g, this.formatLiteral(schema));
  }

  getFunctionsQuery(schema: string): string {
    return introspection.GET_FUNCTIONS_QUERY.replace(/\$1/g, this.formatLiteral(schema));
  }

  getIndexesQuery(schema: string, table: string): string {
    return introspection.GET_INDEXES_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getIndexUsageStatsQuery(_schema: string, table: string): string {
    // Use legacy query by default - caller can detect PG version and use PG16 version
    // Note: schema is not used in the legacy query - it joins with pg_stat_user_indexes
    return introspection.GET_INDEX_USAGE_STATS_QUERY_LEGACY.replace(
      /\$1/g,
      this.formatLiteral(table),
    );
  }

  /**
   * Get index usage stats query for PostgreSQL 16+
   */
  getIndexUsageStatsQueryPg16(table: string): string {
    return introspection.GET_INDEX_USAGE_STATS_QUERY_PG16.replace(
      /\$1/g,
      this.formatLiteral(table),
    );
  }

  getConstraintsQuery(schema: string, table: string): string {
    return introspection.GET_CONSTRAINTS_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getColumnsQuery(schema: string, table: string): string {
    return introspection.GET_COLUMNS_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getTriggersQuery(schema: string, table: string): string {
    return introspection.GET_TRIGGERS_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getSupportedIndexTypesQuery(): string {
    return introspection.GET_SUPPORTED_INDEX_TYPES_QUERY;
  }

  getSupportedColumnTypesQuery(): string {
    return introspection.GET_SUPPORTED_COLUMN_TYPES_QUERY;
  }

  getTableCountQuery(schema: string, table: string, exact = false): string {
    if (exact) {
      return `SELECT COUNT(*) as count FROM ${this.qualifyName(schema, table)}`;
    }
    return introspection.GET_TABLE_COUNT_ESTIMATED_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getTableStatsQuery(schema: string, table: string): string {
    return introspection.GET_TABLE_STATS_QUERY
      .replace(/\$1/g, this.formatLiteral(schema))
      .replace(/\$2/g, this.formatLiteral(table));
  }

  getForeignKeyTargetsQuery(schema: string): string {
    return introspection.GET_FOREIGN_KEY_TARGETS_QUERY.replace(
      /\$1/g,
      this.formatLiteral(schema),
    );
  }

  getObjectDefinitionQuery(
    objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
    schema: string,
    name: string,
  ): string {
    const qualifiedName = this.qualifyName(schema, name);

    switch (objectType) {
      case "view":
      case "materialized_view":
        return `SELECT pg_get_viewdef('${this.escapeStringLiteral(qualifiedName)}'::regclass, true) as definition`;
      case "function":
      case "procedure":
        // Use OID lookup to handle overloaded functions - returns first match
        // For multiple overloads with same name, signature should be passed in name param
        return `SELECT pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = ${this.formatLiteral(schema)}
  AND p.proname = ${this.formatLiteral(name)}
LIMIT 1`;
      case "table":
        return introspection.GET_TABLE_DEFINITION_QUERY
          .replace(/\$1/g, this.formatLiteral(schema))
          .replace(/\$2/g, this.formatLiteral(name));
      default:
        throw new Error(`Unsupported object type: ${objectType}`);
    }
  }

  // ============================================================================
  // DDL Generation - Index Operations
  // ============================================================================

  createIndex(params: CreateIndexParams): string {
    const {
      schema,
      table,
      indexName,
      columns,
      unique = false,
      using = "btree",
      where,
      includeColumns,
      concurrent = false,
    } = params;

    const parts: string[] = ["CREATE"];

    if (unique) {
      parts.push("UNIQUE");
    }
    parts.push("INDEX");

    if (concurrent) {
      parts.push("CONCURRENTLY");
    }

    parts.push(this.quoteIdentifier(indexName));
    parts.push("ON", this.qualifyName(schema, table));
    parts.push(`USING ${using}`);

    // Format columns with optional order, nulls position, and opclass
    const columnDefs = columns.map((col) => {
      let def = this.formatIndexColumn(col.name);
      if (col.opclass) {
        def += ` ${col.opclass}`;
      }
      if (col.order) {
        def += ` ${col.order}`;
      }
      if (col.nullsPosition) {
        def += ` NULLS ${col.nullsPosition}`;
      }
      return def;
    });
    parts.push(`(${columnDefs.join(", ")})`);

    // INCLUDE columns (covering index)
    if (includeColumns && includeColumns.length > 0) {
      parts.push(`INCLUDE (${includeColumns.map((c) => this.quoteIdentifier(c)).join(", ")})`);
    }

    // WHERE clause for partial index
    if (where) {
      parts.push(`WHERE ${where}`);
    }

    return parts.join(" ");
  }

  /**
   * Format index column - handles expressions and opclasses
   */
  private formatIndexColumn(col: string): string {
    // If it contains parentheses, assume it's an expression
    if (col.includes("(")) {
      return col;
    }
    // Check for opclass (e.g., "column gin_trgm_ops")
    const parts = col.split(/\s+/);
    if (parts.length > 1 && parts[0]) {
      return `${this.quoteIdentifier(parts[0])} ${parts.slice(1).join(" ")}`;
    }
    return this.quoteIdentifier(col);
  }

  dropIndex(
    schema: string | undefined,
    indexName: string,
    options?: { ifExists?: boolean; cascade?: boolean },
  ): string {
    const parts = ["DROP INDEX"];

    if (options?.ifExists) {
      parts.push("IF EXISTS");
    }

    parts.push(this.qualifyName(schema, indexName));

    if (options?.cascade) {
      parts.push("CASCADE");
    }

    return parts.join(" ");
  }

  renameIndex(schema: string | undefined, oldName: string, newName: string): string {
    return `ALTER INDEX ${this.qualifyName(schema, oldName)} RENAME TO ${this.quoteIdentifier(newName)}`;
  }

  // ============================================================================
  // DDL Generation - Column Operations
  // ============================================================================

  addColumn(params: AddColumnParams): string {
    const { schema, table, column } = params;
    const parts = [
      `ALTER TABLE ${this.qualifyName(schema, table)} ADD COLUMN`,
      this.quoteIdentifier(column.name),
      this.buildColumnType(column),
    ];

    if (column.nullable === false) {
      parts.push("NOT NULL");
    }

    if (column.defaultValue !== undefined) {
      parts.push(`DEFAULT ${this.formatLiteral(column.defaultValue)}`);
    }

    if (column.isUnique) {
      parts.push("UNIQUE");
    }

    if (column.isPrimaryKey) {
      parts.push("PRIMARY KEY");
    }

    if (column.checkExpression) {
      parts.push(`CHECK (${column.checkExpression})`);
    }

    return parts.join(" ");
  }

  private buildColumnType(column: AddColumnParams["column"]): string {
    let type = column.dataType;

    if (column.length) {
      type += `(${column.length})`;
    } else if (column.precision !== undefined) {
      if (column.scale !== undefined) {
        type += `(${column.precision}, ${column.scale})`;
      } else {
        type += `(${column.precision})`;
      }
    }

    return type;
  }

  dropColumn(
    schema: string | undefined,
    table: string,
    column: string,
    options?: { ifExists?: boolean; cascade?: boolean },
  ): string {
    const parts = [`ALTER TABLE ${this.qualifyName(schema, table)} DROP COLUMN`];

    if (options?.ifExists) {
      parts.push("IF EXISTS");
    }

    parts.push(this.quoteIdentifier(column));

    if (options?.cascade) {
      parts.push("CASCADE");
    }

    return parts.join(" ");
  }

  modifyColumn(params: ModifyColumnParams): string[] {
    const { schema, table, columnName, changes } = params;
    const statements: string[] = [];
    const tableName = this.qualifyName(schema, table);
    const colName = this.quoteIdentifier(columnName);

    // Type change
    if (changes.dataType) {
      let typeSpec = changes.dataType;
      if (changes.length) {
        typeSpec += `(${changes.length})`;
      } else if (changes.precision !== undefined) {
        if (changes.scale !== undefined) {
          typeSpec += `(${changes.precision}, ${changes.scale})`;
        } else {
          typeSpec += `(${changes.precision})`;
        }
      }
      statements.push(
        `ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${typeSpec} USING ${colName}::${typeSpec}`,
      );
    }

    // Nullable change
    if (changes.nullable !== undefined) {
      if (changes.nullable) {
        statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP NOT NULL`);
      } else {
        statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL`);
      }
    }

    // Default value change
    if (changes.dropDefault) {
      statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT`);
    } else if (changes.defaultValue !== undefined) {
      statements.push(
        `ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT ${this.formatLiteral(changes.defaultValue)}`,
      );
    }

    // Comment change
    if (changes.comment !== undefined) {
      const fullColName = `${tableName}.${colName}`;
      statements.push(
        `COMMENT ON COLUMN ${fullColName} IS ${this.formatLiteral(changes.comment)}`,
      );
    }

    return statements;
  }

  renameColumn(
    schema: string | undefined,
    table: string,
    oldName: string,
    newName: string,
  ): string {
    return `ALTER TABLE ${this.qualifyName(schema, table)} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ============================================================================
  // DDL Generation - Foreign Key Operations
  // ============================================================================

  addForeignKey(params: AddForeignKeyParams): string {
    const {
      schema,
      table,
      constraintName,
      columns,
      referenceSchema,
      referenceTable,
      referenceColumns,
      onUpdate,
      onDelete,
      deferrable,
      initiallyDeferred,
    } = params;

    const parts = [
      `ALTER TABLE ${this.qualifyName(schema, table)} ADD CONSTRAINT`,
      this.quoteIdentifier(constraintName),
      "FOREIGN KEY",
      `(${columns.map((c) => this.quoteIdentifier(c)).join(", ")})`,
      "REFERENCES",
      this.qualifyName(referenceSchema ?? schema, referenceTable),
      `(${referenceColumns.map((c) => this.quoteIdentifier(c)).join(", ")})`,
    ];

    if (onUpdate) {
      parts.push(`ON UPDATE ${onUpdate}`);
    }

    if (onDelete) {
      parts.push(`ON DELETE ${onDelete}`);
    }

    if (deferrable) {
      parts.push("DEFERRABLE");
      if (initiallyDeferred) {
        parts.push("INITIALLY DEFERRED");
      }
    }

    return parts.join(" ");
  }

  dropForeignKey(
    schema: string | undefined,
    table: string,
    constraintName: string,
    options?: { cascade?: boolean },
  ): string {
    const parts = [
      `ALTER TABLE ${this.qualifyName(schema, table)} DROP CONSTRAINT`,
      this.quoteIdentifier(constraintName),
    ];

    if (options?.cascade) {
      parts.push("CASCADE");
    }

    return parts.join(" ");
  }

  // ============================================================================
  // DDL Generation - Trigger Operations
  // ============================================================================

  createTrigger(params: CreateTriggerParams): string {
    const {
      schema,
      table,
      triggerName,
      timing,
      events,
      level,
      functionName,
      functionSchema,
      condition,
      updateColumns,
    } = params;

    const parts = ["CREATE TRIGGER", this.quoteIdentifier(triggerName)];
    parts.push(timing);

    // Events with optional UPDATE OF columns
    const eventParts = events.map((event) => {
      if (event === "UPDATE" && updateColumns && updateColumns.length > 0) {
        return `UPDATE OF ${updateColumns.map((c) => this.quoteIdentifier(c)).join(", ")}`;
      }
      return event;
    });
    parts.push(eventParts.join(" OR "));

    parts.push("ON", this.qualifyName(schema, table));
    parts.push("FOR EACH", level);

    if (condition) {
      parts.push(`WHEN (${condition})`);
    }

    const funcRef = functionSchema
      ? `${this.quoteIdentifier(functionSchema)}.${this.quoteIdentifier(functionName)}`
      : this.quoteIdentifier(functionName);
    parts.push(`EXECUTE FUNCTION ${funcRef}()`);

    return parts.join(" ");
  }

  dropTrigger(
    schema: string | undefined,
    table: string,
    triggerName: string,
    options?: { ifExists?: boolean; cascade?: boolean },
  ): string {
    const parts = ["DROP TRIGGER"];

    if (options?.ifExists) {
      parts.push("IF EXISTS");
    }

    parts.push(this.quoteIdentifier(triggerName));
    parts.push("ON", this.qualifyName(schema, table));

    if (options?.cascade) {
      parts.push("CASCADE");
    }

    return parts.join(" ");
  }

  toggleTrigger(
    schema: string | undefined,
    table: string,
    triggerName: string,
    enabled: boolean,
  ): string {
    const action = enabled ? "ENABLE" : "DISABLE";
    return `ALTER TABLE ${this.qualifyName(schema, table)} ${action} TRIGGER ${this.quoteIdentifier(triggerName)}`;
  }
}

// Export singleton instance for convenience
export const postgresDialect = new PostgresDialect();
