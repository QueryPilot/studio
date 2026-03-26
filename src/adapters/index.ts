/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * Database Adapter Factory
 *
 * Creates the appropriate adapter based on database type.
 * Caches adapters by connection ID for reuse.
 */

import { DbType } from "@/types/connection";
import type {
  CrudCommand,
  DataDeletePayload,
  DataInsertPayload,
  DataUpdatePayload,
  ColumnAddPayload,
  ColumnModifyPayload,
  ColumnDropPayload,
  ColumnRenamePayload,
  IndexCreatePayload,
  IndexDropPayload,
  IndexRenamePayload,
  TriggerCreatePayload,
  TriggerDropPayload,
  TriggerTogglePayload,
  TriggerRenamePayload,
  ForeignKeyAddPayload,
  ForeignKeyDropPayload,
  TableCreatePayload,
  TableRenamePayload,
  TableDropPayload,
  TableTruncatePayload,
  TableDuplicatePayload,
  ViewCreatePayload,
  ViewDropPayload,
  ViewReplacePayload,
  ViewRenamePayload,
  ConstraintAddPayload,
  ConstraintDropPayload,
  ConstraintRenamePayload,
  SequenceCreatePayload,
  SequenceAlterPayload,
  SequenceDropPayload,
  SequenceRenamePayload,
} from "@/types/crud";
import { sqlDiffGenerator } from "@/services/sqlDiffGenerator";
import type {
  DatabaseAdapter,
  TableRef,
  RowData,
  WhereClause,
  BaseAdapter,
} from "./types";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getParadigm } from "@/types/connection";
import { MongoDBAdapter } from "./mongodb/MongoDBAdapter";
import { RedisAdapter } from "./redis/RedisAdapter";

// Lazy imports for SQL adapters to avoid circular dependencies
const sqlAdapterModules: Partial<
  Record<DbType, () => Promise<new (connectionId: string) => DatabaseAdapter>>
> = {
  [DbType.PostgreSQL]: () =>
    import("./dialects/PostgreSQLAdapter").then((m) => m.PostgreSQLAdapter),
  [DbType.MySQL]: () =>
    import("./dialects/MySQLAdapter").then((m) => m.MySQLAdapter),
  [DbType.MariaDB]: () =>
    import("./dialects/MySQLAdapter").then((m) => m.MySQLAdapter),
  [DbType.SQLite]: () =>
    import("./dialects/SQLiteAdapter").then((m) => m.SQLiteAdapter),
  [DbType.DuckDB]: () =>
    import("./dialects/DuckDBAdapter").then((m) => m.DuckDBAdapter),
  [DbType.SQLServer]: () =>
    import("./dialects/MSSQLAdapter").then((m) => m.MSSQLAdapter),
  [DbType.Oracle]: () =>
    import("./dialects/OracleAdapter").then((m) => m.OracleAdapter),
};

export function isSqlParadigm(dbType: DbType): boolean {
  return getParadigm(dbType) === "sql";
}

const adapterCache = new Map<string, BaseAdapter>();
const pendingAdapters = new Map<string, Promise<BaseAdapter>>();

/**
 * Get adapter for any database type (SQL, Document, or KeyValue)
 * Returns BaseAdapter - use type guards to access paradigm-specific methods
 */
export async function getAdapter(
  connectionId: string,
  dbType: DbType,
): Promise<BaseAdapter> {
  const cached = adapterCache.get(connectionId);
  if (cached) {
    return cached;
  }

  // Deduplicate concurrent calls for the same connection
  const pending = pendingAdapters.get(connectionId);
  if (pending) {
    return pending;
  }

  const promise = createAdapter(connectionId, dbType);
  pendingAdapters.set(connectionId, promise);

  try {
    const adapter = await promise;
    adapterCache.set(connectionId, adapter);
    return adapter;
  } finally {
    pendingAdapters.delete(connectionId);
  }
}

async function createAdapter(
  connectionId: string,
  dbType: DbType,
): Promise<BaseAdapter> {
  const paradigm = getParadigm(dbType);
  switch (paradigm) {
    case "sql": {
      const adapterLoader = sqlAdapterModules[dbType];
      if (!adapterLoader) {
        throw new Error(`Unsupported SQL database type: ${dbType}`);
      }
      const AdapterClass = await adapterLoader();
      return new AdapterClass(connectionId);
    }
    case "document":
      return new MongoDBAdapter(connectionId);
    case "keyvalue":
      return new RedisAdapter(connectionId);
    default:
      throw new Error(`Unsupported database paradigm for type: ${dbType}`);
  }
}

/**
 * Get a SQL adapter specifically (throws if not SQL paradigm)
 */
export async function getSqlAdapter(
  connectionId: string,
  dbType: DbType,
): Promise<DatabaseAdapter> {
  if (!isSqlParadigm(dbType)) {
    throw new Error(`${dbType} is not a SQL database`);
  }
  const adapter = await getAdapter(connectionId, dbType);
  return adapter as DatabaseAdapter;
}

/**
 * Get the database type for a connection from the store
 */
export function getConnectionDbType(connectionId: string): DbType {
  const store = useConnectionStore.getState();
  const connection = store.connections.find(
    (c) => c.profile.id === connectionId,
  );
  if (!connection) {
    return DbType.PostgreSQL; // Default fallback
  }
  return connection.profile.db_type || DbType.PostgreSQL;
}

/**
 * Get adapter for a connection (looks up db type automatically)
 */
export async function getAdapterForConnection(
  connectionId: string,
): Promise<BaseAdapter> {
  const dbType = getConnectionDbType(connectionId);
  return getAdapter(connectionId, dbType);
}

/**
 * Get SQL adapter for a connection (returns null if not SQL paradigm)
 */
export async function getSqlAdapterForConnection(
  connectionId: string,
): Promise<DatabaseAdapter | null> {
  const dbType = getConnectionDbType(connectionId);
  if (!isSqlParadigm(dbType)) {
    return null;
  }
  return getSqlAdapter(connectionId, dbType);
}

/**
 * Get adapter synchronously (throws if not cached)
 * Use this only when you're sure the adapter was already created
 */
export function getAdapterSync(connectionId: string): BaseAdapter {
  const adapter = adapterCache.get(connectionId);
  if (!adapter) {
    throw new Error(
      `Adapter not found for connection: ${connectionId}. Call getAdapter() first.`,
    );
  }
  return adapter;
}

/**
 * Get SQL adapter synchronously (throws if not cached or not SQL)
 */
export function getSqlAdapterSync(connectionId: string): DatabaseAdapter {
  const adapter = getAdapterSync(connectionId);
  if (adapter.paradigm !== "sql") {
    throw new Error(`Adapter for ${connectionId} is not a SQL adapter`);
  }
  return adapter as DatabaseAdapter;
}

/**
 * Clear cached adapter for a connection
 * Call this when a connection is closed
 */
export function clearAdapter(connectionId: string): void {
  adapterCache.delete(connectionId);
  pendingAdapters.delete(connectionId);
}

/**
 * Clear all cached adapters
 */
export function clearAllAdapters(): void {
  adapterCache.clear();
  pendingAdapters.clear();
}

// Re-export types
export type {
  DatabaseAdapter,
  QueryPayload,
  QueryResult,
  BaseAdapter,
} from "./types";
export type {
  TableRef,
  WhereClause,
  RowData,
  SelectOptions,
  InsertOptions,
  MongoDBAdapter as MongoDBAdapterType,
  RedisAdapter as RedisAdapterType,
} from "./types";
export { isSqlAdapter, isDocumentAdapter, isKeyValueAdapter } from "./types";

/**
 * Convert a single CrudCommand to SQL using an adapter
 * IMPORTANT: This is the single source of truth for SQL generation.
 * Any changes here should be reflected in both preview and commit flows.
 */
export function commandToSql(
  adapter: DatabaseAdapter,
  command: CrudCommand,
): string | null {
  const target: TableRef = {
    schema: command.target.schema,
    table: command.target.table ?? "",
  };

  switch (command.type) {
    // DML operations
    case "data.insert": {
      const payload = command.payload as DataInsertPayload;
      const values = payload.values ?? {};
      if (Object.keys(values).length === 0) {
        return null;
      }
      const columnInfos = payload.columnTypes
        ? Object.entries(payload.columnTypes).map(([name, dbType]) => ({ name, dbType }))
        : undefined;
      const result = adapter.insert(target, values as RowData, { columnInfos });
      return typeof result === "string" ? result : null;
    }

    case "data.update": {
      const payload = command.payload as DataUpdatePayload;
      if (!payload.column || !payload.primaryKeys) {
        return null;
      }
      const data: RowData = { [payload.column]: payload.newValue };
      const where: WhereClause = payload.primaryKeys as WhereClause;
      const columnInfos = payload.columnType
        ? [{ name: payload.column, dbType: payload.columnType }]
        : undefined;
      const result = adapter.update(target, data, where, { columnInfos });
      return typeof result === "string" ? result : null;
    }

    case "data.delete": {
      const payload = command.payload as DataDeletePayload;
      if (!payload.primaryKeys) {
        return null;
      }
      const where: WhereClause = payload.primaryKeys as WhereClause;
      const result = adapter.delete(target, where);
      return typeof result === "string" ? result : null;
    }

    // DDL operations - delegate to adapter
    case "column.add": {
      const payload = command.payload as ColumnAddPayload;
      if (!payload.column?.name) return null;
      const result = adapter.addColumn(target, payload.column);
      return typeof result === "string" ? result : null;
    }

    case "column.modify": {
      const payload = command.payload as ColumnModifyPayload;
      if (!payload.columnName || !payload.newDefinition) return null;
      const result = adapter.modifyColumn(
        target,
        payload.columnName,
        payload.newDefinition,
      );
      if (typeof result === "string" && result) {
        return result;
      }
      // If no SQL was generated, provide a helpful comment about what was requested
      const changes = payload.newDefinition;
      const changesList: string[] = [];
      if (changes.dataType !== undefined)
        changesList.push(`type: ${changes.dataType}`);
      if (changes.nullable !== undefined)
        changesList.push(`nullable: ${changes.nullable}`);
      if (changes.defaultValue !== undefined)
        changesList.push(`default: ${JSON.stringify(changes.defaultValue)}`);
      if (changes.comment !== undefined)
        changesList.push(`comment: ${changes.comment}`);
      if (changes.checkExpression !== undefined)
        changesList.push(`check: ${changes.checkExpression}`);

      if (changesList.length > 0) {
        const schema = target.schema ? `${target.schema}.` : "";
        return `-- Modify column ${payload.columnName} on ${schema}${target.table}: ${changesList.join(", ")}`;
      }
      return null;
    }

    case "column.drop": {
      const payload = command.payload as ColumnDropPayload;
      if (!payload.columnName) return null;
      const result = adapter.dropColumn(
        target,
        payload.columnName,
        payload.cascade,
      );
      return typeof result === "string" ? result : null;
    }

    case "column.rename": {
      const payload = command.payload as ColumnRenamePayload;
      if (!payload.columnName || !payload.newName) return null;
      const result = adapter.renameColumn(
        target,
        payload.columnName,
        payload.newName,
      );
      return typeof result === "string" ? result : null;
    }

    // Index DDL operations
    case "index.create": {
      const payload = command.payload as IndexCreatePayload;
      if (!payload.definition?.name || !payload.definition?.columns?.length)
        return null;
      const result = adapter.createIndex(target, payload.definition);
      return typeof result === "string" ? result : null;
    }

    case "index.drop": {
      const payload = command.payload as IndexDropPayload;
      if (!payload.indexName) return null;
      const result = adapter.dropIndex(
        target,
        payload.indexName,
        payload.ifExists,
      );
      return typeof result === "string" ? result : null;
    }

    case "index.rename": {
      const payload = command.payload as IndexRenamePayload;
      if (!payload.indexName || !payload.newName) return null;
      const result = adapter.renameIndex(
        target,
        payload.indexName,
        payload.newName,
      );
      return typeof result === "string" ? result : null;
    }

    // Trigger DDL operations
    case "trigger.create": {
      const payload = command.payload as TriggerCreatePayload;
      if (!payload.definition?.name || !payload.definition?.functionName)
        return null;
      const result = adapter.createTrigger(target, payload.definition);
      return typeof result === "string" ? result : null;
    }

    case "trigger.drop": {
      const payload = command.payload as TriggerDropPayload;
      if (!payload.triggerName) return null;
      const result = adapter.dropTrigger(
        target,
        payload.triggerName,
        payload.ifExists,
      );
      return typeof result === "string" ? result : null;
    }

    case "trigger.rename": {
      const payload = command.payload as TriggerRenamePayload;
      if (!payload.triggerName || !payload.newName) return null;
      const result = adapter.renameTrigger(
        target,
        payload.triggerName,
        payload.newName,
      );
      return typeof result === "string" ? result : null;
    }

    case "trigger.enable":
    case "trigger.disable": {
      const payload = command.payload as TriggerTogglePayload;
      if (!payload.triggerName) return null;
      const enable = command.type === "trigger.enable";
      const result = adapter.toggleTrigger(target, payload.triggerName, enable);
      return typeof result === "string" ? result : null;
    }

    // Foreign key DDL operations - use SqlDiffGenerator
    case "fk.add": {
      const payload = command.payload as ForeignKeyAddPayload;
      if (!payload.definition?.name || !payload.definition?.columns?.length)
        return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case "fk.drop": {
      const payload = command.payload as ForeignKeyDropPayload;
      if (!payload.constraintName) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    // Table DDL operations
    case "table.create": {
      const payload = command.payload as TableCreatePayload;
      if (!payload.tableName || !payload.columns?.length) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case "table.rename": {
      const payload = command.payload as TableRenamePayload;
      if (!payload.newName || !command.target.table) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case "table.drop": {
      const payload = command.payload as TableDropPayload;
      if (!payload.tableName) return null;
      const schemaPrefix = target.schema
        ? `${adapter.quoteIdentifier(target.schema)}.`
        : "";
      const tableName = adapter.quoteIdentifier(payload.tableName);
      const ifExists = payload.ifExists ? "IF EXISTS " : "";
      // CASCADE only supported by PostgreSQL
      const cascade =
        payload.cascade && adapter.dbType === DbType.PostgreSQL
          ? " CASCADE"
          : "";
      return `DROP TABLE ${ifExists}${schemaPrefix}${tableName}${cascade}`;
    }

    case "table.truncate": {
      const payload = command.payload as TableTruncatePayload;
      if (!payload.tableName) return null;
      const schemaPrefix = target.schema
        ? `${adapter.quoteIdentifier(target.schema)}.`
        : "";
      const tableName = adapter.quoteIdentifier(payload.tableName);

      // SQLite doesn't support TRUNCATE TABLE
      if (adapter.dbType === DbType.SQLite) {
        return `DELETE FROM ${schemaPrefix}${tableName}`;
      }

      // RESTART IDENTITY and CASCADE only supported by PostgreSQL
      const restart =
        payload.restartIdentity && adapter.dbType === DbType.PostgreSQL
          ? " RESTART IDENTITY"
          : "";
      const cascade =
        payload.cascade && adapter.dbType === DbType.PostgreSQL
          ? " CASCADE"
          : "";
      return `TRUNCATE TABLE ${schemaPrefix}${tableName}${restart}${cascade}`;
    }

    case "table.duplicate": {
      const payload = command.payload as TableDuplicatePayload;
      if (!payload.sourceTableName || !payload.newTableName) return null;
      const result = adapter.duplicateTable(target, {
        sourceTableName: payload.sourceTableName,
        newTableName: payload.newTableName,
        includeData: payload.includeData,
        includeIndexes: payload.includeIndexes,
        includeConstraints: payload.includeConstraints,
        includeTriggers: payload.includeTriggers,
      });
      return typeof result === "string" ? result : null;
    }

    // View DDL operations
    case "view.create": {
      const payload = command.payload as ViewCreatePayload;
      if (!payload.definition?.name || !payload.definition?.definition)
        return null;
      const schema = command.target.schema || "public";
      const result = adapter.createView(schema, payload.definition);
      return typeof result === "string" ? result : null;
    }

    case "view.drop": {
      const payload = command.payload as ViewDropPayload;
      if (!payload.viewName) return null;
      const schema = command.target.schema || "public";
      const result = adapter.dropView(
        schema,
        payload.viewName,
        payload.ifExists,
        payload.cascade,
        payload.isMaterialized,
      );
      return typeof result === "string" ? result : null;
    }

    case "view.replace": {
      const payload = command.payload as ViewReplacePayload;
      if (!payload.viewName || !payload.definition) return null;
      const schema = command.target.schema || "public";
      const result = adapter.replaceView(
        schema,
        payload.viewName,
        payload.definition,
        payload.isMaterialized,
      );
      return typeof result === "string" ? result : null;
    }

    case "view.rename": {
      const payload = command.payload as ViewRenamePayload;
      if (!payload.viewName || !payload.newName) return null;
      const schema = command.target.schema || "public";
      const result = adapter.renameView(
        schema,
        payload.viewName,
        payload.newName,
        payload.isMaterialized,
      );
      return typeof result === "string" ? result : null;
    }

    // Constraint DDL operations
    case "constraint.addPrimaryKey":
    case "constraint.addUnique":
    case "constraint.addCheck": {
      const payload = command.payload as ConstraintAddPayload;
      if (!payload.definition?.name) return null;
      const result = adapter.addConstraint(target, payload.definition);
      return typeof result === "string" ? result : null;
    }

    case "constraint.dropPrimaryKey":
    case "constraint.dropUnique":
    case "constraint.dropCheck":
    case "constraint.drop": {
      const payload = command.payload as ConstraintDropPayload;
      if (!payload.constraintName) return null;
      const constraintTypeMap: Record<string, string> = {
        "constraint.dropPrimaryKey": "PRIMARY KEY",
        "constraint.dropUnique": "UNIQUE",
        "constraint.dropCheck": "CHECK",
      };
      const constraintType = constraintTypeMap[command.type];
      const result = adapter.dropConstraint(
        target,
        payload.constraintName,
        payload.cascade,
        payload.ifExists,
        constraintType,
      );
      return typeof result === "string" ? result : null;
    }

    case "constraint.rename": {
      const payload = command.payload as ConstraintRenamePayload;
      if (!payload.constraintName || !payload.newName) return null;
      const result = adapter.renameConstraint(
        target,
        payload.constraintName,
        payload.newName,
      );
      return typeof result === "string" ? result : null;
    }

    // Sequence DDL operations
    case "sequence.create": {
      const payload = command.payload as SequenceCreatePayload;
      if (!payload.definition?.name) return null;
      const schema = command.target.schema || "public";
      const result = adapter.createSequence(schema, payload.definition);
      return typeof result === "string" ? result : null;
    }

    case "sequence.alter": {
      const payload = command.payload as SequenceAlterPayload;
      if (!payload.sequenceName || !payload.changes) return null;
      const schema = command.target.schema || "public";
      const result = adapter.alterSequence(
        schema,
        payload.sequenceName,
        payload.changes,
      );
      return typeof result === "string" ? result : null;
    }

    case "sequence.drop": {
      const payload = command.payload as SequenceDropPayload;
      if (!payload.sequenceName) return null;
      const schema = command.target.schema || "public";
      const result = adapter.dropSequence(
        schema,
        payload.sequenceName,
        payload.ifExists,
        payload.cascade,
      );
      return typeof result === "string" ? result : null;
    }

    case "sequence.rename": {
      const payload = command.payload as SequenceRenamePayload;
      if (!payload.sequenceName || !payload.newName) return null;
      const schema = command.target.schema || "public";
      const result = adapter.renameSequence(
        schema,
        payload.sequenceName,
        payload.newName,
      );
      return typeof result === "string" ? result : null;
    }

    default:
      return null;
  }
}

const buildTableRenameKey = (command: CrudCommand): string =>
  `${command.target.schema ?? ""}.${command.target.table ?? ""}`;

/**
 * Helper to rename columns in an array of column names
 */
function renameColumnsInArray(
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
function renameColumnsInRecord(
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
 * Apply table renames from previous commands to the current command.
 * This ensures subsequent commands target the new table name after a rename.
 */
export function applyTableRenames(
  command: CrudCommand,
  tableRenames: Map<string, string>,
): CrudCommand {
  if (tableRenames.size === 0 || !command.target.table) {
    return command;
  }

  const key = buildTableRenameKey(command);
  const newName = tableRenames.get(key);
  if (!newName || newName === command.target.table) {
    return command;
  }

  return {
    ...command,
    target: {
      ...command.target,
      table: newName,
    },
  } as CrudCommand;
}

/**
 * Update table rename tracking for chained renames.
 */
export function trackTableRename(
  tableRenames: Map<string, string>,
  originalCmd: CrudCommand,
  adjustedCmd: CrudCommand,
): void {
  if (originalCmd.type !== "table.rename") return;
  if (!adjustedCmd.target.table) return;

  const payload = originalCmd.payload as TableRenamePayload;
  const newName = payload.newName;
  const adjustedKey = buildTableRenameKey(adjustedCmd);

  for (const [key, value] of tableRenames.entries()) {
    if (value === adjustedCmd.target.table) {
      tableRenames.set(key, newName);
    }
  }

  tableRenames.set(adjustedKey, newName);
}

/**
 * Apply column renames from previous commands to the current command.
 * This ensures subsequent modifications use the new column name after a rename.
 * Exported for use in crudStore commit flow.
 *
 * Handles: column.modify, column.drop, column.rename, fk.add, index.create,
 *          data.insert, data.update, trigger.create
 */
export function applyColumnRenames(
  command: CrudCommand,
  columnRenames: Map<string, string>,
): CrudCommand {
  if (columnRenames.size === 0) {
    return command;
  }

  // Apply rename to column.modify commands
  if (command.type === "column.modify") {
    const payload = command.payload as ColumnModifyPayload;
    const newName = columnRenames.get(payload.columnName);
    if (newName) {
      return {
        ...command,
        payload: { ...payload, columnName: newName },
      } as CrudCommand;
    }
  }

  // Apply rename to column.drop commands
  if (command.type === "column.drop") {
    const payload = command.payload as ColumnDropPayload;
    const newName = columnRenames.get(payload.columnName);
    if (newName) {
      return {
        ...command,
        payload: { ...payload, columnName: newName },
      } as CrudCommand;
    }
  }

  // Apply rename to chained column.rename commands
  if (command.type === "column.rename") {
    const payload = command.payload as ColumnRenamePayload;
    const newName = columnRenames.get(payload.columnName);
    if (newName) {
      return {
        ...command,
        payload: { ...payload, columnName: newName },
      } as CrudCommand;
    }
  }

  // Apply rename to fk.add commands (columns[] and referenceColumns[])
  if (command.type === "fk.add") {
    const payload = command.payload as ForeignKeyAddPayload;
    if (payload.definition) {
      let changed = false;
      let newColumns = payload.definition.columns;
      let newRefColumns = payload.definition.referenceColumns;

      if (payload.definition.columns?.length) {
        const result = renameColumnsInArray(
          payload.definition.columns,
          columnRenames,
        );
        if (result.changed) {
          changed = true;
          newColumns = result.columns;
        }
      }

      // Note: referenceColumns usually reference a different table, but if same table FK,
      // we should still rename them
      if (payload.definition.referenceColumns?.length) {
        const result = renameColumnsInArray(
          payload.definition.referenceColumns,
          columnRenames,
        );
        if (result.changed) {
          changed = true;
          newRefColumns = result.columns;
        }
      }

      if (changed) {
        return {
          ...command,
          payload: {
            ...payload,
            definition: {
              ...payload.definition,
              columns: newColumns,
              referenceColumns: newRefColumns,
            },
          },
        } as CrudCommand;
      }
    }
  }

  // Apply rename to index.create commands (columns[] and includeColumns[])
  if (command.type === "index.create") {
    const payload = command.payload as IndexCreatePayload;
    if (payload.definition) {
      let changed = false;
      let newColumns = payload.definition.columns;
      let newIncludeColumns = payload.definition.includeColumns;

      if (payload.definition.columns?.length) {
        const result = renameColumnsInArray(
          payload.definition.columns,
          columnRenames,
        );
        if (result.changed) {
          changed = true;
          newColumns = result.columns;
        }
      }

      if (payload.definition.includeColumns?.length) {
        const result = renameColumnsInArray(
          payload.definition.includeColumns,
          columnRenames,
        );
        if (result.changed) {
          changed = true;
          newIncludeColumns = result.columns;
        }
      }

      if (changed) {
        return {
          ...command,
          payload: {
            ...payload,
            definition: {
              ...payload.definition,
              columns: newColumns,
              includeColumns: newIncludeColumns,
            },
          },
        } as CrudCommand;
      }
    }
  }

  // Apply rename to data.insert commands (values{} keys)
  if (command.type === "data.insert") {
    const payload = command.payload as DataInsertPayload;
    if (payload.values) {
      const result = renameColumnsInRecord(payload.values, columnRenames);
      if (result.changed) {
        return {
          ...command,
          payload: { ...payload, values: result.record },
        } as CrudCommand;
      }
    }
  }

  // Apply rename to data.update commands (column field)
  if (command.type === "data.update") {
    const payload = command.payload as DataUpdatePayload;
    const newName = columnRenames.get(payload.column);
    if (newName) {
      return {
        ...command,
        payload: { ...payload, column: newName },
      } as CrudCommand;
    }
  }

  // Note: trigger.create doesn't have column references that need renaming
  // (TriggerDefinitionInput has condition which is SQL text, too complex to parse)

  return command;
}

/**
 * Update column rename tracking for chained renames.
 * When a column is renamed, we need to update any existing mappings
 * that point to the old name to now point to the new name.
 */
export function trackColumnRename(
  columnRenames: Map<string, string>,
  originalCmd: CrudCommand,
  adjustedCmd: CrudCommand,
): void {
  if (originalCmd.type !== "column.rename") return;

  const origPayload = originalCmd.payload as ColumnRenamePayload;
  const adjPayload = adjustedCmd.payload as ColumnRenamePayload;

  // Update existing chains: if anything points to the adjusted old name,
  // update it to point to the new name
  for (const [key, value] of columnRenames.entries()) {
    if (value === adjPayload.columnName) {
      columnRenames.set(key, origPayload.newName);
    }
  }

  // Track this rename (from adjusted column name to new name)
  columnRenames.set(adjPayload.columnName, origPayload.newName);
}

/**
 * Generate SQL preview for staged commands
 * Used by GlobalChangesDialog for SQL preview display
 */
export async function generateSqlPreview(
  connectionId: string,
  dbType: DbType,
  stagedCommands: Map<string, CrudCommand[]>,
): Promise<string> {
  const adapter = await getAdapter(connectionId, dbType);
  const sections: string[] = [];

  for (const [tableKey, commands] of stagedCommands) {
    if (commands.length === 0) continue;

    // Extract table name from key (format: connectionId:database:schema:table)
    const parts = tableKey.split(":");
    const tableName = parts[parts.length - 1] ?? "unknown";
    const schemaName = parts.length > 3 ? parts[2] : undefined;
    const displayName = schemaName ? `${schemaName}.${tableName}` : tableName;

    sections.push(`-- Table: ${displayName}`);

    // Track column renames so subsequent commands use new names
    const columnRenames = new Map<string, string>();
    const tableRenames = new Map<string, string>();
    const statements: string[] = [];

    for (const cmd of commands) {
      // Apply any pending renames to this command
      const tableAdjustedCmd = applyTableRenames(cmd, tableRenames);
      const adjustedCmd = applyColumnRenames(tableAdjustedCmd, columnRenames);

      // Track renames for subsequent commands (handles chained renames)
      trackColumnRename(columnRenames, cmd, adjustedCmd);
      trackTableRename(tableRenames, cmd, tableAdjustedCmd);

      const sql = commandToSql(adapter as DatabaseAdapter, adjustedCmd);
      if (sql) {
        statements.push(sql);
      }
    }

    if (statements.length > 0) {
      // Ensure each statement ends with exactly one semicolon.
      // Some commands (e.g. modifyColumn) return multiple statements joined with ";\n".
      const normalized = statements
        .map((s) => s.replace(/;?\s*$/, ";"))
        .join("\n");
      sections.push(normalized);
    }
  }

  return sections.join("\n\n") || "-- No changes to commit";
}

// Export capability types and interfaces
export * from "./capabilities";
export * from "./types/redis";
export * from "./types/mongodb";

// Export MongoDB and Redis adapters
export { MongoDBAdapter } from "./mongodb/MongoDBAdapter";
export { RedisAdapter } from "./redis/RedisAdapter";
