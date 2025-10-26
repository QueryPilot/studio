/**
 * SQL Generation Utilities
 *
 * Database-agnostic SQL generators for table editing operations.
 * Supports PostgreSQL, MySQL, SQLite, MSSQL, MariaDB, MongoDB.
 */

import type { DatabaseType } from "@/types/database";

// ============================================================================
// Types
// ============================================================================

export interface ColumnOperation {
  type: "add" | "alter" | "drop" | "rename";
  schema?: string;
  table: string;
  column: {
    name: string;
    newName?: string; // For renames
    db_type?: string;
    nullable?: boolean;
    default?: string | null;
    check_constraint?: string | null;
    comment?: string | null;
  };
  previousColumn?: string; // For positioning in MySQL
}

export interface IndexOperation {
  type: "create" | "drop";
  schema?: string;
  table: string;
  index: {
    name: string;
    columns: string[];
    unique?: boolean;
    indexType?: string; // btree, hash, gin, gist, etc.
    condition?: string; // WHERE clause for partial indexes
  };
}

export interface TriggerOperation {
  type: "create" | "drop" | "enable" | "disable";
  schema?: string;
  table: string;
  trigger: {
    name: string;
    event?: string[]; // INSERT, UPDATE, DELETE
    timing?: string; // BEFORE, AFTER, INSTEAD OF
    level?: string; // ROW, STATEMENT
    function?: string;
    condition?: string;
  };
}

export interface DataOperation {
  type: "insert" | "update" | "delete";
  schema?: string;
  table: string;
  data: {
    columns?: string[];
    values?: any[];
    where?: Record<string, any>;
    set?: Record<string, any>;
  };
}

export interface TransactionOptions {
  begin?: boolean;
  commit?: boolean;
  rollback?: boolean;
}

// ============================================================================
// Identifier Quoting
// ============================================================================

/**
 * Quote identifier based on database type
 */
export function quoteIdentifier(
  identifier: string,
  dbType: DatabaseType,
): string {
  if (!identifier) return identifier;

  switch (dbType) {
    case "postgresql":
    case "sqlite":
      return `"${identifier.replace(/"/g, '""')}"`;
    case "mysql":
    case "mariadb":
      return `\`${identifier.replace(/`/g, "``")}\``;
    case "mssql":
      return `[${identifier.replace(/]/g, "]]")}]`;
    case "mongodb":
      return identifier; // MongoDB doesn't use quoted identifiers
    default:
      return `"${identifier.replace(/"/g, '""')}"`;
  }
}

/**
 * Create qualified table name
 */
export function qualifyTable(
  table: string,
  schema: string | undefined,
  dbType: DatabaseType,
): string {
  const quotedTable = quoteIdentifier(table, dbType);

  if (!schema) return quotedTable;

  const quotedSchema = quoteIdentifier(schema, dbType);
  return `${quotedSchema}.${quotedTable}`;
}

// ============================================================================
// Value Escaping
// ============================================================================

/**
 * Escape and format SQL value
 */
export function formatValue(value: any, dbType: DatabaseType): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "NULL";
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    switch (dbType) {
      case "postgresql":
      case "sqlite":
        return value ? "TRUE" : "FALSE";
      case "mysql":
      case "mariadb":
      case "mssql":
        return value ? "1" : "0";
      default:
        return value ? "TRUE" : "FALSE";
    }
  }

  if (value instanceof Date) {
    return formatValue(value.toISOString(), dbType);
  }

  if (typeof value === "object") {
    // JSON
    const json = JSON.stringify(value);
    return formatValue(json, dbType);
  }

  return formatValue(String(value), dbType);
}

// ============================================================================
// Column Operations
// ============================================================================

/**
 * Generate ADD COLUMN statement
 */
export function generateAddColumn(
  op: ColumnOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const columnName = quoteIdentifier(op.column.name, dbType);
  const columnType = op.column.db_type || "TEXT";

  let sql = `ALTER TABLE ${qualifiedTable} ADD COLUMN ${columnName} ${columnType}`;

  // Nullable constraint
  if (op.column.nullable === false) {
    sql += " NOT NULL";
  }

  // Default value
  if (op.column.default !== undefined && op.column.default !== null) {
    sql += ` DEFAULT ${op.column.default}`;
  }

  // Check constraint (PostgreSQL, SQLite)
  if (
    op.column.check_constraint &&
    (dbType === "postgresql" || dbType === "sqlite")
  ) {
    sql += ` CHECK (${op.column.check_constraint})`;
  }

  return sql;
}

/**
 * Generate ALTER COLUMN statement
 */
export function generateAlterColumn(
  op: ColumnOperation,
  dbType: DatabaseType,
): string[] {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const columnName = quoteIdentifier(op.column.name, dbType);
  const statements: string[] = [];

  switch (dbType) {
    case "postgresql": {
      // PostgreSQL requires separate statements for each alteration
      if (op.column.db_type) {
        statements.push(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${columnName} TYPE ${op.column.db_type}`,
        );
      }

      if (op.column.nullable !== undefined) {
        const nullAction = op.column.nullable
          ? "DROP NOT NULL"
          : "SET NOT NULL";
        statements.push(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${columnName} ${nullAction}`,
        );
      }

      if (op.column.default !== undefined) {
        if (op.column.default === null) {
          statements.push(
            `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${columnName} DROP DEFAULT`,
          );
        } else {
          statements.push(
            `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${columnName} SET DEFAULT ${op.column.default}`,
          );
        }
      }
      break;
    }

    case "mysql":
    case "mariadb": {
      // MySQL/MariaDB requires full column definition
      let sql = `ALTER TABLE ${qualifiedTable} MODIFY COLUMN ${columnName}`;

      if (op.column.db_type) {
        sql += ` ${op.column.db_type}`;
      }

      if (op.column.nullable === false) {
        sql += " NOT NULL";
      }

      if (op.column.default !== undefined && op.column.default !== null) {
        sql += ` DEFAULT ${op.column.default}`;
      }

      statements.push(sql);
      break;
    }

    case "sqlite": {
      // SQLite doesn't support ALTER COLUMN directly
      // Would need to recreate table - return comment instead
      statements.push(
        `-- SQLite does not support ALTER COLUMN. Table recreation required.`,
      );
      break;
    }

    case "mssql": {
      if (op.column.db_type) {
        statements.push(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${columnName} ${
            op.column.db_type
          }${op.column.nullable === false ? " NOT NULL" : ""}`,
        );
      }

      if (op.column.default !== undefined) {
        // MSSQL requires constraint name for defaults
        const constraintName = `DF_${op.table}_${op.column.name}`;
        if (op.column.default === null) {
          statements.push(
            `ALTER TABLE ${qualifiedTable} DROP CONSTRAINT ${constraintName}`,
          );
        } else {
          statements.push(
            `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${constraintName} DEFAULT ${op.column.default} FOR ${columnName}`,
          );
        }
      }
      break;
    }
  }

  return statements;
}

/**
 * Generate DROP COLUMN statement
 */
export function generateDropColumn(
  op: ColumnOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const columnName = quoteIdentifier(op.column.name, dbType);

  return `ALTER TABLE ${qualifiedTable} DROP COLUMN ${columnName}`;
}

/**
 * Generate RENAME COLUMN statement
 */
export function generateRenameColumn(
  op: ColumnOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const oldName = quoteIdentifier(op.column.name, dbType);
  const newName = quoteIdentifier(op.column.newName || op.column.name, dbType);

  switch (dbType) {
    case "postgresql":
      return `ALTER TABLE ${qualifiedTable} RENAME COLUMN ${oldName} TO ${newName}`;
    case "mysql":
    case "mariadb":
      // MySQL requires full column definition for rename
      return `ALTER TABLE ${qualifiedTable} CHANGE ${oldName} ${newName} ${
        op.column.db_type || "TEXT"
      }`;
    case "sqlite":
      return `ALTER TABLE ${qualifiedTable} RENAME COLUMN ${oldName} TO ${newName}`;
    case "mssql":
      return `EXEC sp_rename '${op.schema || "dbo"}.${op.table}.${
        op.column.name
      }', '${op.column.newName}', 'COLUMN'`;
    default:
      return `ALTER TABLE ${qualifiedTable} RENAME COLUMN ${oldName} TO ${newName}`;
  }
}

// ============================================================================
// Index Operations
// ============================================================================

/**
 * Generate CREATE INDEX statement
 */
export function generateCreateIndex(
  op: IndexOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const indexName = quoteIdentifier(op.index.name, dbType);
  const columns = op.index.columns
    .map((col) => quoteIdentifier(col, dbType))
    .join(", ");

  let sql = `CREATE ${
    op.index.unique ? "UNIQUE " : ""
  }INDEX ${indexName} ON ${qualifiedTable}`;

  // Index type (PostgreSQL, MySQL)
  if (op.index.indexType && dbType === "postgresql") {
    sql += ` USING ${op.index.indexType}`;
  }

  sql += ` (${columns})`;

  // Partial index condition (PostgreSQL, SQLite)
  if (op.index.condition && (dbType === "postgresql" || dbType === "sqlite")) {
    sql += ` WHERE ${op.index.condition}`;
  }

  return sql;
}

/**
 * Generate DROP INDEX statement
 */
export function generateDropIndex(
  op: IndexOperation,
  dbType: DatabaseType,
): string {
  const indexName = quoteIdentifier(op.index.name, dbType);

  switch (dbType) {
    case "postgresql":
    case "sqlite": {
      const schemaPrefix = op.schema
        ? `${quoteIdentifier(op.schema, dbType)}.`
        : "";
      return `DROP INDEX ${schemaPrefix}${indexName}`;
    }
    case "mysql":
    case "mariadb": {
      const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
      return `DROP INDEX ${indexName} ON ${qualifiedTable}`;
    }
    case "mssql": {
      const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
      return `DROP INDEX ${indexName} ON ${qualifiedTable}`;
    }
    default:
      return `DROP INDEX ${indexName}`;
  }
}

// ============================================================================
// Trigger Operations
// ============================================================================

/**
 * Generate CREATE TRIGGER statement
 */
export function generateCreateTrigger(
  op: TriggerOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
  const triggerName = quoteIdentifier(op.trigger.name, dbType);

  if (dbType === "postgresql") {
    const events = op.trigger.event?.join(" OR ") || "INSERT";
    const timing = op.trigger.timing || "AFTER";
    const level = op.trigger.level || "ROW";
    const functionName = op.trigger.function || "trigger_function";

    let sql = `CREATE TRIGGER ${triggerName}\n`;
    sql += `  ${timing} ${events} ON ${qualifiedTable}\n`;
    sql += `  FOR EACH ${level}`;

    if (op.trigger.condition) {
      sql += `\n  WHEN (${op.trigger.condition})`;
    }

    sql += `\n  EXECUTE FUNCTION ${functionName}()`;

    return sql;
  }

  if (dbType === "mysql" || dbType === "mariadb") {
    const event = op.trigger.event?.[0] || "INSERT";
    const timing = op.trigger.timing || "AFTER";

    // MySQL triggers require body - simplified version
    let sql = `CREATE TRIGGER ${triggerName}\n`;
    sql += `  ${timing} ${event} ON ${qualifiedTable}\n`;
    sql += `  FOR EACH ROW\n`;
    sql += `BEGIN\n`;
    sql += `  -- Trigger body\n`;
    sql += `END`;

    return sql;
  }

  if (dbType === "sqlite") {
    const event = op.trigger.event?.[0] || "INSERT";
    const timing = op.trigger.timing || "AFTER";

    let sql = `CREATE TRIGGER ${triggerName}\n`;
    sql += `  ${timing} ${event} ON ${qualifiedTable}\n`;

    if (op.trigger.condition) {
      sql += `  WHEN ${op.trigger.condition}\n`;
    }

    sql += `BEGIN\n`;
    sql += `  -- Trigger body\n`;
    sql += `END`;

    return sql;
  }

  return `-- CREATE TRIGGER not implemented for ${dbType}`;
}

/**
 * Generate DROP TRIGGER statement
 */
export function generateDropTrigger(
  op: TriggerOperation,
  dbType: DatabaseType,
): string {
  const triggerName = quoteIdentifier(op.trigger.name, dbType);

  switch (dbType) {
    case "postgresql": {
      const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
      return `DROP TRIGGER ${triggerName} ON ${qualifiedTable}`;
    }
    case "mysql":
    case "mariadb": {
      const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
      return `DROP TRIGGER ${triggerName}`;
    }
    case "sqlite": {
      return `DROP TRIGGER ${triggerName}`;
    }
    case "mssql": {
      const qualifiedTable = qualifyTable(op.table, op.schema, dbType);
      return `DROP TRIGGER ${triggerName} ON ${qualifiedTable}`;
    }
    default:
      return `DROP TRIGGER ${triggerName}`;
  }
}

/**
 * Generate ENABLE/DISABLE TRIGGER statement
 */
export function generateToggleTrigger(
  op: TriggerOperation,
  dbType: DatabaseType,
  enable: boolean,
): string {
  const triggerName = quoteIdentifier(op.trigger.name, dbType);
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);

  switch (dbType) {
    case "postgresql":
      return `ALTER TABLE ${qualifiedTable} ${
        enable ? "ENABLE" : "DISABLE"
      } TRIGGER ${triggerName}`;
    case "mysql":
    case "mariadb":
      // MySQL doesn't support enable/disable, would need to drop/recreate
      return `-- MySQL does not support ENABLE/DISABLE TRIGGER`;
    case "mssql":
      return `${
        enable ? "ENABLE" : "DISABLE"
      } TRIGGER ${triggerName} ON ${qualifiedTable}`;
    default:
      return `-- ENABLE/DISABLE TRIGGER not supported for ${dbType}`;
  }
}

// ============================================================================
// Data Operations
// ============================================================================

/**
 * Generate INSERT statement
 */
export function generateInsert(
  op: DataOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);

  if (!op.data.columns || !op.data.values) {
    throw new Error("INSERT requires columns and values");
  }

  const columns = op.data.columns
    .map((col) => quoteIdentifier(col, dbType))
    .join(", ");

  const values = op.data.values
    .map((val) => formatValue(val, dbType))
    .join(", ");

  return `INSERT INTO ${qualifiedTable} (${columns}) VALUES (${values})`;
}

/**
 * Generate UPDATE statement
 */
export function generateUpdate(
  op: DataOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);

  if (!op.data.set || Object.keys(op.data.set).length === 0) {
    throw new Error("UPDATE requires SET clause");
  }

  const setClauses = Object.entries(op.data.set)
    .map(([col, val]) => {
      const quotedCol = quoteIdentifier(col, dbType);
      const formattedVal = formatValue(val, dbType);
      return `${quotedCol} = ${formattedVal}`;
    })
    .join(", ");

  let sql = `UPDATE ${qualifiedTable} SET ${setClauses}`;

  // WHERE clause
  if (op.data.where && Object.keys(op.data.where).length > 0) {
    const whereClauses = Object.entries(op.data.where)
      .map(([col, val]) => {
        const quotedCol = quoteIdentifier(col, dbType);
        if (val === null || val === undefined) {
          return `${quotedCol} IS NULL`;
        }
        const formattedVal = formatValue(val, dbType);
        return `${quotedCol} = ${formattedVal}`;
      })
      .join(" AND ");

    sql += ` WHERE ${whereClauses}`;
  }

  return sql;
}

/**
 * Generate DELETE statement
 */
export function generateDelete(
  op: DataOperation,
  dbType: DatabaseType,
): string {
  const qualifiedTable = qualifyTable(op.table, op.schema, dbType);

  let sql = `DELETE FROM ${qualifiedTable}`;

  // WHERE clause (required for safety)
  if (op.data.where && Object.keys(op.data.where).length > 0) {
    const whereClauses = Object.entries(op.data.where)
      .map(([col, val]) => {
        const quotedCol = quoteIdentifier(col, dbType);
        if (val === null || val === undefined) {
          return `${quotedCol} IS NULL`;
        }
        const formattedVal = formatValue(val, dbType);
        return `${quotedCol} = ${formattedVal}`;
      })
      .join(" AND ");

    sql += ` WHERE ${whereClauses}`;
  } else {
    // Safety: don't allow DELETE without WHERE
    throw new Error("DELETE requires WHERE clause for safety");
  }

  return sql;
}

// ============================================================================
// Transaction Utilities
// ============================================================================

/**
 * Generate transaction control statements
 */
export function generateTransaction(
  statements: string[],
  options: TransactionOptions,
  dbType: DatabaseType,
): string[] {
  const result: string[] = [];

  if (options.begin !== false) {
    result.push(dbType === "mssql" ? "BEGIN TRANSACTION" : "BEGIN");
  }

  result.push(...statements);

  if (options.rollback) {
    result.push("ROLLBACK");
  } else if (options.commit !== false) {
    result.push("COMMIT");
  }

  return result;
}

/**
 * Wrap statements in savepoint for nested transactions
 */
export function generateSavepoint(
  name: string,
  statements: string[],
  dbType: DatabaseType,
): string[] {
  const result: string[] = [];

  result.push(`SAVEPOINT ${quoteIdentifier(name, dbType)}`);
  result.push(...statements);
  result.push(`RELEASE SAVEPOINT ${quoteIdentifier(name, dbType)}`);

  return result;
}
