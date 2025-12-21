/**
 * SQL Generator - Converts CRUD commands to SQL statements
 */
import type { CrudCommand } from "@/types/crud";
import type { DatabaseType } from "@/types";

/**
 * Get quoting rules for different database types
 */
export function getDialectQuoting(dbType: DatabaseType) {
  switch (dbType) {
    case "postgresql":
    case "sqlite":
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
    case "mysql":
    case "mariadb":
      return {
        quoteIdentifier: (id: string) => `\`${id}\``,
        formatTableName: (schema: string, table: string) =>
          `\`${schema}\`.\`${table}\``,
      };
    case "mssql":
      return {
        quoteIdentifier: (id: string) => `[${id}]`,
        formatTableName: (schema: string, table: string) =>
          `[${schema}].[${table}]`,
      };
    default:
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
  }
}

/**
 * Format value for SQL
 */
export function formatSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    switch (dbType) {
      case "postgresql":
        return value ? "TRUE" : "FALSE";
      case "mysql":
      case "mariadb":
      case "sqlite":
      case "mssql":
        return value ? "1" : "0";
      default:
        return value ? "TRUE" : "FALSE";
    }
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      const escaped = json.replace(/'/g, "''");
      return `'${escaped}'`;
    } catch {
      return "NULL";
    }
  }

  return "NULL";
}

/**
 * Generate SQL for a single CRUD command
 */
export function commandToSQL(
  command: CrudCommand,
  dbType: DatabaseType = "postgresql"
): string {
  const { quoteIdentifier, formatTableName } = getDialectQuoting(dbType);
  const { target } = command;

  // Handle missing table name
  if (!target.table) {
    return `-- Command missing table name`;
  }

  const fullTableName = target.schema
    ? formatTableName(target.schema, target.table)
    : quoteIdentifier(target.table);

  switch (command.type) {
    case "data.insert": {
      const payload = command.payload as {
        values?: Record<string, unknown>;
      };
      const values = payload.values ?? {};
      const columns = Object.keys(values);

      if (columns.length === 0) {
        return `-- INSERT with no values\nINSERT INTO ${fullTableName} DEFAULT VALUES;`;
      }

      const columnNames = columns.map(quoteIdentifier).join(", ");
      const valueList = columns
        .map((col) => formatSQLValue(values[col], dbType))
        .join(", ");

      return `INSERT INTO ${fullTableName} (${columnNames})\nVALUES (${valueList});`;
    }

    case "data.update": {
      const payload = command.payload as {
        primaryKeys?: Record<string, unknown>;
        column?: string;
        newValue?: unknown;
      };

      if (!payload.column || !payload.primaryKeys) {
        return `-- UPDATE missing column or primary keys`;
      }

      const setClause = `${quoteIdentifier(payload.column)} = ${formatSQLValue(payload.newValue, dbType)}`;
      const whereClause = Object.entries(payload.primaryKeys)
        .map(([key, val]) => `${quoteIdentifier(key)} = ${formatSQLValue(val, dbType)}`)
        .join(" AND ");

      return `UPDATE ${fullTableName}\nSET ${setClause}\nWHERE ${whereClause};`;
    }

    case "data.delete": {
      const payload = command.payload as {
        primaryKeys?: Record<string, unknown>;
      };

      if (!payload.primaryKeys) {
        return `-- DELETE missing primary keys`;
      }

      const whereClause = Object.entries(payload.primaryKeys)
        .map(([key, val]) => `${quoteIdentifier(key)} = ${formatSQLValue(val, dbType)}`)
        .join(" AND ");

      return `DELETE FROM ${fullTableName}\nWHERE ${whereClause};`;
    }

    case "column.add": {
      const payload = command.payload as {
        column?: {
          name: string;
          dataType: string;
          nullable?: boolean;
          defaultValue?: string | null;
        };
      };
      const col = payload.column;
      if (!col) return `-- ADD COLUMN missing definition`;

      let sql = `ALTER TABLE ${fullTableName}\nADD COLUMN ${quoteIdentifier(col.name)} ${col.dataType}`;
      if (col.nullable === false) sql += " NOT NULL";
      if (col.defaultValue !== undefined && col.defaultValue !== null) {
        sql += ` DEFAULT ${col.defaultValue}`;
      }
      return sql + ";";
    }

    case "column.drop": {
      const payload = command.payload as { columnName?: string };
      if (!payload.columnName) return `-- DROP COLUMN missing name`;
      return `ALTER TABLE ${fullTableName}\nDROP COLUMN ${quoteIdentifier(payload.columnName)};`;
    }

    case "column.rename": {
      const payload = command.payload as {
        columnName?: string;
        newName?: string;
      };
      if (!payload.columnName || !payload.newName) {
        return `-- RENAME COLUMN missing names`;
      }

      // Syntax varies by database
      switch (dbType) {
        case "postgresql":
          return `ALTER TABLE ${fullTableName}\nRENAME COLUMN ${quoteIdentifier(payload.columnName)} TO ${quoteIdentifier(payload.newName)};`;
        case "mysql":
        case "mariadb":
          return `ALTER TABLE ${fullTableName}\nRENAME COLUMN ${quoteIdentifier(payload.columnName)} TO ${quoteIdentifier(payload.newName)};`;
        case "mssql":
          return `EXEC sp_rename '${target.schema ? target.schema + "." : ""}${target.table}.${payload.columnName}', '${payload.newName}', 'COLUMN';`;
        default:
          return `ALTER TABLE ${fullTableName}\nRENAME COLUMN ${quoteIdentifier(payload.columnName)} TO ${quoteIdentifier(payload.newName)};`;
      }
    }

    case "column.modify": {
      const payload = command.payload as {
        columnName?: string;
        newDefinition?: {
          dataType?: string;
          nullable?: boolean;
          defaultValue?: string | null;
        };
      };
      if (!payload.columnName || !payload.newDefinition) {
        return `-- MODIFY COLUMN missing definition`;
      }

      const def = payload.newDefinition;
      const parts: string[] = [];

      // Different syntax per database
      switch (dbType) {
        case "postgresql":
          if (def.dataType) {
            parts.push(`ALTER TABLE ${fullTableName}\nALTER COLUMN ${quoteIdentifier(payload.columnName)} TYPE ${def.dataType};`);
          }
          if (def.nullable !== undefined) {
            parts.push(`ALTER TABLE ${fullTableName}\nALTER COLUMN ${quoteIdentifier(payload.columnName)} ${def.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
          }
          if (def.defaultValue !== undefined) {
            if (def.defaultValue === null) {
              parts.push(`ALTER TABLE ${fullTableName}\nALTER COLUMN ${quoteIdentifier(payload.columnName)} DROP DEFAULT;`);
            } else {
              parts.push(`ALTER TABLE ${fullTableName}\nALTER COLUMN ${quoteIdentifier(payload.columnName)} SET DEFAULT ${def.defaultValue};`);
            }
          }
          return parts.join("\n") || `-- No modifications`;

        case "mysql":
        case "mariadb":
          // MySQL uses MODIFY COLUMN with full definition
          if (def.dataType) {
            let sql = `ALTER TABLE ${fullTableName}\nMODIFY COLUMN ${quoteIdentifier(payload.columnName)} ${def.dataType}`;
            if (def.nullable === false) sql += " NOT NULL";
            if (def.defaultValue !== undefined && def.defaultValue !== null) {
              sql += ` DEFAULT ${def.defaultValue}`;
            }
            return sql + ";";
          }
          return `-- MySQL MODIFY requires full column definition`;

        default:
          return parts.join("\n") || `-- Column modification not supported for this database`;
      }
    }

    default:
      return `-- Unsupported command type: ${command.type}`;
  }
}

/**
 * Generate SQL for multiple commands
 */
export function commandsToSQL(
  commands: CrudCommand[],
  dbType: DatabaseType = "postgresql"
): string {
  if (commands.length === 0) {
    return "-- No changes to commit";
  }

  const statements = commands.map((cmd) => commandToSQL(cmd, dbType));
  return statements.join("\n\n");
}

/**
 * Generate SQL for all staged commands grouped by table
 */
export function stagedCommandsToSQL(
  stagedCommands: Map<string, CrudCommand[]>,
  dbType: DatabaseType = "postgresql"
): string {
  const sections: string[] = [];

  for (const [tableKey, commands] of stagedCommands) {
    if (commands.length === 0) continue;

    const parts = tableKey.split(":");
    const tableName = parts[parts.length - 1] ?? "unknown";
    const schemaName = parts.length > 3 ? parts[2] : undefined;
    const displayName = schemaName ? `${schemaName}.${tableName}` : tableName;

    sections.push(`-- Table: ${displayName}`);
    sections.push(commandsToSQL(commands, dbType));
  }

  return sections.join("\n\n") || "-- No changes to commit";
}
