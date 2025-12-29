import { logger } from "@/lib/logger";
import { DbType } from "./backend";
import type {
  CrudCommand,
  CrudCommandFor,
  CrudCommandTarget,
  CrudDiffConflict,
  CrudOperationType,
  JsonValue,
  SqlDiffStatement,
} from "@/types/crud";

const DIALECTS = {
  [DbType.PostgreSQL]: {
    identifierQuote: '"',
    escapeIdentifier: (value: string) => value.replace(/"/g, '""'),
  },
  [DbType.MySQL]: {
    identifierQuote: "`",
    escapeIdentifier: (value: string) => value.replace(/`/g, "``"),
  },
  [DbType.SQLite]: {
    identifierQuote: '"',
    escapeIdentifier: (value: string) => value.replace(/"/g, '""'),
  },
  [DbType.SQLServer]: {
    identifierQuote: "[",
    escapeIdentifier: (value: string) => value.replace(/]/g, "]]"),
  },
} as const;

type SupportedDbType = keyof typeof DIALECTS;

const SQL_TRUE_FALSE: Record<SupportedDbType, { true: string; false: string }> = {
  [DbType.PostgreSQL]: { true: "TRUE", false: "FALSE" },
  [DbType.MySQL]: { true: "TRUE", false: "FALSE" },
  [DbType.SQLite]: { true: "1", false: "0" },
  [DbType.SQLServer]: { true: "1", false: "0" },
};

const ensureDialect = (dbType: DbType): SupportedDbType => {
  if (!(dbType in DIALECTS)) {
    throw new Error(`SqlDiffGenerator: Unsupported database type ${dbType}`);
  }
  return dbType as SupportedDbType;
};

const quoteIdentifier = (identifier: string, dbType: SupportedDbType): string => {
  const trimmed = identifier.trim();
  if (trimmed === "*") {
    return trimmed;
  }

  const { identifierQuote, escapeIdentifier } = DIALECTS[dbType];
  if (identifierQuote === "[") {
    return `[${escapeIdentifier(trimmed)}]`;
  }
  return `${identifierQuote}${escapeIdentifier(trimmed)}${identifierQuote}`;
};

const qualifyName = (
  segments: Array<string | undefined>,
  dbType: SupportedDbType,
): string => segments.filter((segment): segment is string => Boolean(segment)).map((segment) => quoteIdentifier(segment, dbType)).join(".");

const escapeStringLiteral = (value: string): string => value.replace(/'/g, "''");

const formatJsonValue = (value: JsonValue, dbType: SupportedDbType): string => {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "string") {
    return `'${escapeStringLiteral(value)}'`;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : `'${escapeStringLiteral(value.toString())}'`;
  }

  if (typeof value === "boolean") {
    const mapping = SQL_TRUE_FALSE[dbType];
    return value ? mapping.true : mapping.false;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return `'${escapeStringLiteral(JSON.stringify(value))}'`;
  }

  return `'${escapeStringLiteral(String(value))}'`;
};

const buildWhereClause = (
  primaryKeys: Record<string, JsonValue>,
  dbType: SupportedDbType,
): string =>
  Object.entries(primaryKeys)
    .map(([key, value]) => {
      const identifier = quoteIdentifier(key, dbType);
      if (value === null) {
        return `${identifier} IS NULL`;
      }
      return `${identifier} = ${formatJsonValue(value, dbType)}`;
    })
    .join(" AND ");

const buildColumnDefinition = (
  definition: CrudCommandFor<'column.add'>['payload']['column'],
  dbType: SupportedDbType,
): string => {
  const parts: string[] = [quoteIdentifier(definition.name, dbType), definition.dataType];
  if (definition.length) {
    parts.push(`(${definition.length})`);
  }
  if (definition.precision !== undefined) {
    const scalePart = definition.scale !== undefined ? `, ${definition.scale}` : "";
    parts.push(`(${definition.precision}${scalePart})`);
  }
  if (!definition.nullable) {
    parts.push("NOT NULL");
  }
  if (definition.defaultValue !== undefined) {
    parts.push(`DEFAULT ${formatJsonValue(definition.defaultValue ?? null, dbType)}`);
  }
  if (definition.isUnique) {
    parts.push("UNIQUE");
  }
  if (definition.isPrimaryKey) {
    parts.push("PRIMARY KEY");
  }
  if (definition.checkExpression) {
    parts.push(`CHECK (${definition.checkExpression})`);
  }
  return parts.join(" ");
};

const getTableName = (target: CrudCommandTarget, dbType: SupportedDbType): string => {
  const schemaSegments: Array<string | undefined> = [];
  if (dbType === DbType.SQLServer) {
    if (target.database) {
      schemaSegments.push(target.database);
    }
    schemaSegments.push(target.schema ?? "dbo", target.table);
  } else {
    schemaSegments.push(target.schema, target.table);
  }
  return qualifyName(schemaSegments, dbType);
};

const buildIndexName = (target: CrudCommandTarget, indexName: string, dbType: SupportedDbType): string => {
  if (dbType === DbType.MySQL) {
    return quoteIdentifier(indexName, dbType);
  }
  if (dbType === DbType.SQLServer) {
    const segments: string[] = [];
    if (target.database) {
      segments.push(target.database);
    }
    segments.push(target.schema ?? "dbo");
    return qualifyName([...segments, indexName], dbType);
  }
  return quoteIdentifier(indexName, dbType);
};

interface SqlDiffResult {
  statements: SqlDiffStatement[];
  dependencies: { before: string[]; after: string[] };
  conflicts?: CrudDiffConflict[];
}

export class SqlDiffGenerator {
  generateSql(commands: CrudCommand[], dbType: DbType): SqlDiffResult {
    const dialect = ensureDialect(dbType);
    const statements: SqlDiffStatement[] = [];

    // Build rename map: track column renames so subsequent commands use new names
    // Map is: tableKey -> (oldName -> newName)
    const columnRenames = new Map<string, Map<string, string>>();

    for (const command of commands) {
      // Apply any pending renames to this command before generating SQL
      const adjustedCommand = this.applyColumnRenames(command, columnRenames);

      // Track renames for subsequent commands (handles chained renames)
      this.trackColumnRename(columnRenames, command, adjustedCommand);

      const statement = this.generateStatement(adjustedCommand, dialect);
      if (statement) {
        statements.push(statement);
      }
    }

    return {
      statements,
      dependencies: { before: [], after: [] },
    };
  }

  /**
   * Track column renames for chained rename support.
   * Updates existing mappings when a column is renamed again.
   */
  private trackColumnRename(
    columnRenames: Map<string, Map<string, string>>,
    originalCmd: CrudCommand,
    adjustedCmd: CrudCommand,
  ): void {
    if (originalCmd.type !== 'column.rename') return;

    const tableKey = `${originalCmd.target.schema ?? ''}.${originalCmd.target.table}`;
    if (!columnRenames.has(tableKey)) {
      columnRenames.set(tableKey, new Map());
    }
    const renames = columnRenames.get(tableKey)!;

    const origPayload = originalCmd.payload as CrudCommandFor<'column.rename'>['payload'];
    const adjPayload = adjustedCmd.payload as CrudCommandFor<'column.rename'>['payload'];

    // Update existing chains: if anything points to the adjusted old name,
    // update it to point to the new name
    for (const [key, value] of renames.entries()) {
      if (value === adjPayload.columnName) {
        renames.set(key, origPayload.newName);
      }
    }

    // Track this rename (from adjusted column name to new name)
    renames.set(adjPayload.columnName, origPayload.newName);
  }

  /**
   * Helper to rename columns in an array of column names
   */
  private renameColumnsInArray(
    columns: string[],
    renames: Map<string, string>,
  ): { columns: string[]; changed: boolean } {
    let changed = false;
    const newColumns = columns.map((col) => {
      const newName = renames.get(col);
      if (newName) {
        changed = true;
        return newName;
      }
      return col;
    });
    return { columns: newColumns, changed };
  }

  /**
   * Helper to rename column keys in a record
   */
  private renameColumnsInRecord(
    record: Record<string, unknown>,
    renames: Map<string, string>,
  ): { record: Record<string, unknown>; changed: boolean } {
    let changed = false;
    const newRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const newKey = renames.get(key);
      if (newKey) {
        changed = true;
        newRecord[newKey] = value;
      } else {
        newRecord[key] = value;
      }
    }
    return { record: newRecord, changed };
  }

  /**
   * Apply column renames from previous commands to this command.
   * This ensures that if a column was renamed earlier, subsequent
   * modifications use the new column name.
   *
   * Handles: column.modify, column.drop, column.rename, fk.add, index.create,
   *          data.insert, data.update, trigger.create
   */
  private applyColumnRenames(
    command: CrudCommand,
    columnRenames: Map<string, Map<string, string>>,
  ): CrudCommand {
    const tableKey = `${command.target.schema ?? ''}.${command.target.table}`;
    const renames = columnRenames.get(tableKey);

    if (!renames || renames.size === 0) {
      return command;
    }

    // Apply rename to column.modify commands
    if (command.type === 'column.modify') {
      const modifyCmd = command as CrudCommandFor<'column.modify'>;
      const newName = renames.get(modifyCmd.payload.columnName);
      if (newName) {
        return {
          ...modifyCmd,
          payload: {
            ...modifyCmd.payload,
            columnName: newName,
          },
        } as CrudCommand;
      }
    }

    // Apply rename to column.drop commands
    if (command.type === 'column.drop') {
      const dropCmd = command as CrudCommandFor<'column.drop'>;
      const newName = renames.get(dropCmd.payload.columnName);
      if (newName) {
        return {
          ...dropCmd,
          payload: {
            ...dropCmd.payload,
            columnName: newName,
          },
        } as CrudCommand;
      }
    }

    // Apply rename to column.rename commands (chained renames)
    if (command.type === 'column.rename') {
      const renameCmd = command as CrudCommandFor<'column.rename'>;
      const newName = renames.get(renameCmd.payload.columnName);
      if (newName) {
        return {
          ...renameCmd,
          payload: {
            ...renameCmd.payload,
            columnName: newName,
          },
        } as CrudCommand;
      }
    }

    // Apply rename to fk.add commands (columns[] and referenceColumns[])
    if (command.type === 'fk.add') {
      const fkCmd = command as CrudCommandFor<'fk.add'>;
      if (fkCmd.payload.definition) {
        let changed = false;
        let newColumns = fkCmd.payload.definition.columns;
        let newRefColumns = fkCmd.payload.definition.referenceColumns;

        if (fkCmd.payload.definition.columns?.length) {
          const result = this.renameColumnsInArray(fkCmd.payload.definition.columns, renames);
          if (result.changed) {
            changed = true;
            newColumns = result.columns;
          }
        }

        if (fkCmd.payload.definition.referenceColumns?.length) {
          const result = this.renameColumnsInArray(fkCmd.payload.definition.referenceColumns, renames);
          if (result.changed) {
            changed = true;
            newRefColumns = result.columns;
          }
        }

        if (changed) {
          return {
            ...fkCmd,
            payload: {
              ...fkCmd.payload,
              definition: {
                ...fkCmd.payload.definition,
                columns: newColumns,
                referenceColumns: newRefColumns,
              },
            },
          } as CrudCommand;
        }
      }
    }

    // Apply rename to index.create commands (columns[] and includeColumns[])
    if (command.type === 'index.create') {
      const indexCmd = command as CrudCommandFor<'index.create'>;
      if (indexCmd.payload.definition) {
        let changed = false;
        let newColumns = indexCmd.payload.definition.columns;
        let newIncludeColumns = indexCmd.payload.definition.includeColumns;

        if (indexCmd.payload.definition.columns?.length) {
          const result = this.renameColumnsInArray(indexCmd.payload.definition.columns, renames);
          if (result.changed) {
            changed = true;
            newColumns = result.columns;
          }
        }

        if (indexCmd.payload.definition.includeColumns?.length) {
          const result = this.renameColumnsInArray(indexCmd.payload.definition.includeColumns, renames);
          if (result.changed) {
            changed = true;
            newIncludeColumns = result.columns;
          }
        }

        if (changed) {
          return {
            ...indexCmd,
            payload: {
              ...indexCmd.payload,
              definition: {
                ...indexCmd.payload.definition,
                columns: newColumns,
                includeColumns: newIncludeColumns,
              },
            },
          } as CrudCommand;
        }
      }
    }

    // Apply rename to data.insert commands (values{} keys)
    if (command.type === 'data.insert') {
      const insertCmd = command as CrudCommandFor<'data.insert'>;
      if (insertCmd.payload.values) {
        const result = this.renameColumnsInRecord(insertCmd.payload.values, renames);
        if (result.changed) {
          return {
            ...insertCmd,
            payload: { ...insertCmd.payload, values: result.record },
          } as CrudCommand;
        }
      }
    }

    // Apply rename to data.update commands (column field)
    if (command.type === 'data.update') {
      const updateCmd = command as CrudCommandFor<'data.update'>;
      const newName = renames.get(updateCmd.payload.column);
      if (newName) {
        return {
          ...updateCmd,
          payload: { ...updateCmd.payload, column: newName },
        } as CrudCommand;
      }
    }

    // Note: trigger.create doesn't have column references that need renaming
    // (TriggerDefinitionInput has condition which is SQL text, too complex to parse)

    return command;
  }

  private generateStatement(
    command: CrudCommand,
    dbType: SupportedDbType,
  ): SqlDiffStatement | null {
    switch (command.type) {
      case 'data.update':
        return this.generateDataUpdate(command as CrudCommandFor<'data.update'>, dbType);
      case 'data.insert':
        return this.generateDataInsert(command as CrudCommandFor<'data.insert'>, dbType);
      case 'data.delete':
        return this.generateDataDelete(command as CrudCommandFor<'data.delete'>, dbType);
      case 'column.add':
        return this.generateColumnAdd(command as CrudCommandFor<'column.add'>, dbType);
      case 'column.modify':
        return this.generateColumnModify(command as CrudCommandFor<'column.modify'>, dbType);
      case 'column.drop':
        return this.generateColumnDrop(command as CrudCommandFor<'column.drop'>, dbType);
      case 'column.rename':
        return this.generateColumnRename(command as CrudCommandFor<'column.rename'>, dbType);
      case 'index.create':
        return this.generateIndexCreate(command as CrudCommandFor<'index.create'>, dbType);
      case 'index.drop':
        return this.generateIndexDrop(command as CrudCommandFor<'index.drop'>, dbType);
      case 'index.rename':
        return this.generateIndexRename(command as CrudCommandFor<'index.rename'>, dbType);
      case 'trigger.create':
        return this.generateTriggerCreate(command as CrudCommandFor<'trigger.create'>, dbType);
      case 'trigger.drop':
        return this.generateTriggerDrop(command as CrudCommandFor<'trigger.drop'>, dbType);
      case 'trigger.enable':
      case 'trigger.disable':
        return this.generateTriggerToggle(command as CrudCommandFor<'trigger.enable'>, dbType);
      case 'fk.add':
        return this.generateForeignKeyAdd(command as CrudCommandFor<'fk.add'>, dbType);
      case 'fk.drop':
        return this.generateForeignKeyDrop(command as CrudCommandFor<'fk.drop'>, dbType);
      default:
        logger.warn(`SqlDiffGenerator: Unsupported command type ${(command as { type: CrudOperationType }).type}`);
        return null;
    }
  }

  private createStatement(
    command: CrudCommand,
    dbType: SupportedDbType,
    sql: string,
  ): SqlDiffStatement {
    return {
      id: `${command.id}:sql`,
      commandId: command.id,
      statement: sql,
      dialect: dbType,
    };
  }

  private generateDataUpdate(
    command: CrudCommandFor<'data.update'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const setClause = `${quoteIdentifier(command.payload.column, dbType)} = ${formatJsonValue(
      command.payload.newValue,
      dbType,
    )}`;
    const whereClause = buildWhereClause(command.payload.primaryKeys, dbType);
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateDataInsert(
    command: CrudCommandFor<'data.insert'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const entries = Object.entries(command.payload.values);

    const columns = entries
      .map(([column]) => quoteIdentifier(column, dbType))
      .join(", ");
    const values = entries
      .map(([, value]) => formatJsonValue(value, dbType))
      .join(", ");

    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${values});`;
    return this.createStatement(command, dbType, sql);
  }

  private generateDataDelete(
    command: CrudCommandFor<'data.delete'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const whereClause = buildWhereClause(command.payload.primaryKeys, dbType);
    const sql = `DELETE FROM ${tableName} WHERE ${whereClause};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateColumnAdd(
    command: CrudCommandFor<'column.add'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const definition = buildColumnDefinition(command.payload.column, dbType);
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${definition};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateColumnModify(
    command: CrudCommandFor<'column.modify'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const definition = buildColumnDefinition(command.payload.newDefinition, dbType);

    let sql: string;
    switch (dbType) {
      case DbType.MySQL:
        sql = `ALTER TABLE ${tableName} MODIFY COLUMN ${definition};`;
        break;
      case DbType.SQLServer:
        sql = `ALTER TABLE ${tableName} ALTER COLUMN ${definition};`;
        break;
      default:
        sql = `ALTER TABLE ${tableName} ALTER COLUMN ${quoteIdentifier(
          command.payload.columnName,
          dbType,
        )} TYPE ${command.payload.newDefinition.dataType};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateColumnDrop(
    command: CrudCommandFor<'column.drop'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const cascade = command.payload.cascade ? ' CASCADE' : '';
    const sql = `ALTER TABLE ${tableName} DROP COLUMN ${quoteIdentifier(
      command.payload.columnName,
      dbType,
    )}${cascade};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateColumnRename(
    command: CrudCommandFor<'column.rename'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);

    let sql: string;
    switch (dbType) {
      case DbType.SQLServer:
        sql = `EXEC sp_rename '${command.target.schema ?? 'dbo'}.${command.payload.columnName}', '${command.payload.newName}', 'COLUMN';`;
        break;
      default:
        sql = `ALTER TABLE ${tableName} RENAME COLUMN ${quoteIdentifier(
          command.payload.columnName,
          dbType,
        )} TO ${quoteIdentifier(command.payload.newName, dbType)};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateIndexCreate(
    command: CrudCommandFor<'index.create'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const indexName = buildIndexName(command.target, command.payload.definition.name, dbType);
    const unique = command.payload.definition.unique ? 'UNIQUE ' : '';
    const columns = command.payload.definition.columns
      .map((column) => quoteIdentifier(column, dbType))
      .join(", ");
    const using = command.payload.definition.using ? ` USING ${command.payload.definition.using}` : '';
    const whereClause = command.payload.definition.where
      ? ` WHERE ${command.payload.definition.where}`
      : '';
    const include = command.payload.definition.includeColumns?.length
      ? ` INCLUDE (${command.payload.definition.includeColumns
          .map((column) => quoteIdentifier(column, dbType))
          .join(", ")})`
      : '';
    const sql = `CREATE ${unique}INDEX ${indexName} ON ${tableName}${using} (${columns})${include}${whereClause};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateIndexDrop(
    command: CrudCommandFor<'index.drop'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    let sql: string;
    switch (dbType) {
      case DbType.MySQL:
        sql = `ALTER TABLE ${getTableName(command.target, dbType)} DROP INDEX ${quoteIdentifier(
          command.payload.indexName,
          dbType,
        )};`;
        break;
      case DbType.SQLServer:
        sql = `DROP INDEX ${buildIndexName(command.target, command.payload.indexName, dbType)} ON ${getTableName(
          command.target,
          dbType,
        )};`;
        break;
      default:
        sql = `DROP INDEX ${quoteIdentifier(command.payload.indexName, dbType)};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateIndexRename(
    command: CrudCommandFor<'index.rename'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    let sql: string;
    switch (dbType) {
      case DbType.MySQL:
        sql = `ALTER TABLE ${getTableName(command.target, dbType)} RENAME INDEX ${quoteIdentifier(
          command.payload.indexName,
          dbType,
        )} TO ${quoteIdentifier(command.payload.newName, dbType)};`;
        break;
      case DbType.SQLServer:
        sql = `EXEC sp_rename '${command.payload.indexName}', '${command.payload.newName}', 'INDEX';`;
        break;
      default:
        sql = `ALTER INDEX ${quoteIdentifier(command.payload.indexName, dbType)} RENAME TO ${quoteIdentifier(
          command.payload.newName,
          dbType,
        )};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateTriggerCreate(
    command: CrudCommandFor<'trigger.create'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const trigger = quoteIdentifier(command.payload.definition.name, dbType);
    const events = command.payload.definition.events.join(" OR ");
    const level = command.payload.definition.level ?? 'ROW';
    const condition = command.payload.definition.condition
      ? ` WHEN (${command.payload.definition.condition})`
      : '';

    let sql: string;
    switch (dbType) {
      case DbType.SQLServer:
        sql = `CREATE TRIGGER ${trigger} ON ${tableName} ${command.payload.definition.timing} ${events} AS EXEC ${command.payload.definition.functionName};`;
        break;
      default:
        sql = `CREATE ${command.payload.definition.timing} TRIGGER ${trigger} ${events} ON ${tableName} FOR EACH ${level}${condition} EXECUTE FUNCTION ${command.payload.definition.functionName}();`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateTriggerDrop(
    command: CrudCommandFor<'trigger.drop'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const trigger = quoteIdentifier(command.payload.triggerName, dbType);
    let sql: string;
    switch (dbType) {
      case DbType.SQLServer:
        sql = `DROP TRIGGER ${trigger};`;
        break;
      case DbType.MySQL:
        sql = `DROP TRIGGER ${command.target.schema ? `${quoteIdentifier(command.target.schema, dbType)}.` : ''}${trigger};`;
        break;
      default:
        sql = `DROP TRIGGER ${command.payload.ifExists ? 'IF EXISTS ' : ''}${trigger} ON ${getTableName(
          command.target,
          dbType,
        )};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateTriggerToggle(
    command: CrudCommandFor<'trigger.enable'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const trigger = quoteIdentifier(command.payload.triggerName, dbType);

    let sql: string;
    switch (dbType) {
      case DbType.PostgreSQL:
        sql = `ALTER TABLE ${tableName} ${command.payload.enable ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger};`;
        break;
      case DbType.SQLServer:
        sql = `${command.payload.enable ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger} ON ${tableName};`;
        break;
      default:
        sql = `-- ${command.payload.enable ? 'ENABLE' : 'DISABLE'} trigger ${command.payload.triggerName} (not supported for ${dbType})`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }

  private generateForeignKeyAdd(
    command: CrudCommandFor<'fk.add'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    const def = command.payload.definition;
    const constraintName = quoteIdentifier(def.name, dbType);
    const columns = def.columns.map((column) => quoteIdentifier(column, dbType)).join(", ");
    const refColumns = def.referenceColumns.map((column) => quoteIdentifier(column, dbType)).join(", ");
    const refTable = qualifyName([
      def.referenceSchema ?? command.target.schema,
      def.referenceTable,
    ], dbType);

    const options = [
      def.onUpdate ? `ON UPDATE ${def.onUpdate}` : undefined,
      def.onDelete ? `ON DELETE ${def.onDelete}` : undefined,
      def.deferrable ? 'DEFERRABLE' : undefined,
      def.initiallyDeferred ? 'INITIALLY DEFERRED' : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    const sql = `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${columns}) REFERENCES ${refTable} (${refColumns})${options ? ` ${options}` : ''};`;
    return this.createStatement(command, dbType, sql);
  }

  private generateForeignKeyDrop(
    command: CrudCommandFor<'fk.drop'>,
    dbType: SupportedDbType,
  ): SqlDiffStatement {
    const tableName = getTableName(command.target, dbType);
    let sql: string;
    switch (dbType) {
      case DbType.SQLServer:
        sql = `ALTER TABLE ${tableName} DROP CONSTRAINT ${quoteIdentifier(
          command.payload.constraintName,
          dbType,
        )};`;
        break;
      case DbType.MySQL:
        sql = `ALTER TABLE ${tableName} DROP FOREIGN KEY ${quoteIdentifier(
          command.payload.constraintName,
          dbType,
        )};`;
        break;
      default:
        sql = `ALTER TABLE ${tableName} DROP CONSTRAINT ${quoteIdentifier(
          command.payload.constraintName,
          dbType,
        )}${command.payload.cascade ? ' CASCADE' : ''};`;
        break;
    }

    return this.createStatement(command, dbType, sql);
  }
}

export const sqlDiffGenerator = new SqlDiffGenerator();

