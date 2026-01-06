/**
 * Database Adapter Factory
 *
 * Creates the appropriate adapter based on database type.
 * Caches adapters by connection ID for reuse.
 */

import { DbType } from '@/types/connection';
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
} from '@/types/crud';
import { sqlDiffGenerator } from '@/services/sqlDiffGenerator';
import type { DatabaseAdapter, TableRef, RowData, WhereClause } from './types';
import { useConnectionStore } from '@/stores/connectionStoreNew';

// Lazy imports to avoid circular dependencies
const adapterModules = {
  [DbType.PostgreSQL]: () =>
    import('./dialects/PostgreSQLAdapter').then((m) => m.PostgreSQLAdapter),
  [DbType.MySQL]: () =>
    import('./dialects/MySQLAdapter').then((m) => m.MySQLAdapter),
  [DbType.MariaDB]: () =>
    import('./dialects/MySQLAdapter').then((m) => m.MySQLAdapter),
  [DbType.SQLite]: () =>
    import('./dialects/SQLiteAdapter').then((m) => m.SQLiteAdapter),
  [DbType.SQLServer]: () =>
    import('./dialects/MSSQLAdapter').then((m) => m.MSSQLAdapter),
};

// Cache adapters by connection ID
const adapterCache = new Map<string, DatabaseAdapter>();

/**
 * Get or create an adapter for the given connection
 *
 * @param connectionId - Connection ID
 * @param dbType - Database type
 * @returns Database adapter instance
 */
export async function getAdapter(
  connectionId: string,
  dbType: DbType
): Promise<DatabaseAdapter> {
  // Return cached adapter if exists
  const cached = adapterCache.get(connectionId);
  if (cached) {
    return cached;
  }

  // Create new adapter
  const adapterLoader = adapterModules[dbType];
  if (!adapterLoader) {
    throw new Error(`Unsupported database type: ${dbType}`);
  }

  const AdapterClass = await adapterLoader();
  const adapter = new AdapterClass(connectionId);

  // Cache and return
  adapterCache.set(connectionId, adapter);
  return adapter;
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
export async function getAdapterForConnection(connectionId: string): Promise<DatabaseAdapter> {
  const dbType = getConnectionDbType(connectionId);
  return getAdapter(connectionId, dbType);
}

/**
 * Get adapter synchronously (throws if not cached)
 * Use this only when you're sure the adapter was already created
 */
export function getAdapterSync(connectionId: string): DatabaseAdapter {
  const adapter = adapterCache.get(connectionId);
  if (!adapter) {
    throw new Error(
      `Adapter not found for connection: ${connectionId}. Call getAdapter() first.`
    );
  }
  return adapter;
}

/**
 * Clear cached adapter for a connection
 * Call this when a connection is closed
 */
export function clearAdapter(connectionId: string): void {
  adapterCache.delete(connectionId);
}

/**
 * Clear all cached adapters
 */
export function clearAllAdapters(): void {
  adapterCache.clear();
}

// Re-export types
export type { DatabaseAdapter, QueryPayload, QueryResult } from './types';
export type {
  TableRef,
  WhereClause,
  RowData,
  SelectOptions,
  InsertOptions,
} from './types';

/**
 * Convert a single CrudCommand to SQL using an adapter
 * IMPORTANT: This is the single source of truth for SQL generation.
 * Any changes here should be reflected in both preview and commit flows.
 */
export function commandToSql(adapter: DatabaseAdapter, command: CrudCommand): string | null {
  const target: TableRef = {
    schema: command.target.schema,
    table: command.target.table ?? '',
  };

  switch (command.type) {
    // DML operations
    case 'data.insert': {
      const payload = command.payload as DataInsertPayload;
      const values = payload.values ?? {};
      if (Object.keys(values).length === 0) {
        return null;
      }
      const result = adapter.insert(target, values as RowData);
      return typeof result === 'string' ? result : null;
    }

    case 'data.update': {
      const payload = command.payload as DataUpdatePayload;
      if (!payload.column || !payload.primaryKeys) {
        return null;
      }
      const data: RowData = { [payload.column]: payload.newValue };
      const where: WhereClause = payload.primaryKeys as WhereClause;
      const result = adapter.update(target, data, where);
      return typeof result === 'string' ? result : null;
    }

    case 'data.delete': {
      const payload = command.payload as DataDeletePayload;
      if (!payload.primaryKeys) {
        return null;
      }
      const where: WhereClause = payload.primaryKeys as WhereClause;
      const result = adapter.delete(target, where);
      return typeof result === 'string' ? result : null;
    }

    // DDL operations - delegate to adapter
    case 'column.add': {
      const payload = command.payload as ColumnAddPayload;
      if (!payload.column?.name) return null;
      const result = adapter.addColumn(target, payload.column);
      return typeof result === 'string' ? result : null;
    }

    case 'column.modify': {
      const payload = command.payload as ColumnModifyPayload;
      if (!payload.columnName || !payload.newDefinition) return null;
      const result = adapter.modifyColumn(target, payload.columnName, payload.newDefinition);
      return typeof result === 'string' && result ? result : null;
    }

    case 'column.drop': {
      const payload = command.payload as ColumnDropPayload;
      if (!payload.columnName) return null;
      const result = adapter.dropColumn(target, payload.columnName, payload.cascade);
      return typeof result === 'string' ? result : null;
    }

    case 'column.rename': {
      const payload = command.payload as ColumnRenamePayload;
      if (!payload.columnName || !payload.newName) return null;
      const result = adapter.renameColumn(target, payload.columnName, payload.newName);
      return typeof result === 'string' ? result : null;
    }

    // Index DDL operations
    case 'index.create': {
      const payload = command.payload as IndexCreatePayload;
      if (!payload.definition?.name || !payload.definition?.columns?.length) return null;
      const result = adapter.createIndex(target, payload.definition);
      return typeof result === 'string' ? result : null;
    }

    case 'index.drop': {
      const payload = command.payload as IndexDropPayload;
      if (!payload.indexName) return null;
      const result = adapter.dropIndex(target, payload.indexName, payload.ifExists);
      return typeof result === 'string' ? result : null;
    }

    case 'index.rename': {
      const payload = command.payload as IndexRenamePayload;
      if (!payload.indexName || !payload.newName) return null;
      const result = adapter.renameIndex(target, payload.indexName, payload.newName);
      return typeof result === 'string' ? result : null;
    }

    // Trigger DDL operations
    case 'trigger.create': {
      const payload = command.payload as TriggerCreatePayload;
      if (!payload.definition?.name || !payload.definition?.functionName) return null;
      const result = adapter.createTrigger(target, payload.definition);
      return typeof result === 'string' ? result : null;
    }

    case 'trigger.drop': {
      const payload = command.payload as TriggerDropPayload;
      if (!payload.triggerName) return null;
      const result = adapter.dropTrigger(target, payload.triggerName, payload.ifExists);
      return typeof result === 'string' ? result : null;
    }

    case 'trigger.rename': {
      const payload = command.payload as TriggerRenamePayload;
      if (!payload.triggerName || !payload.newName) return null;
      const result = adapter.renameTrigger(target, payload.triggerName, payload.newName);
      return typeof result === 'string' ? result : null;
    }

    case 'trigger.enable':
    case 'trigger.disable': {
      const payload = command.payload as TriggerTogglePayload;
      if (!payload.triggerName) return null;
      const enable = command.type === 'trigger.enable';
      const result = adapter.toggleTrigger(target, payload.triggerName, enable);
      return typeof result === 'string' ? result : null;
    }

    // Foreign key DDL operations - use SqlDiffGenerator
    case 'fk.add': {
      const payload = command.payload as ForeignKeyAddPayload;
      if (!payload.definition?.name || !payload.definition?.columns?.length) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case 'fk.drop': {
      const payload = command.payload as ForeignKeyDropPayload;
      if (!payload.constraintName) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    // Table DDL operations
    case 'table.create': {
      const payload = command.payload as TableCreatePayload;
      if (!payload.tableName || !payload.columns?.length) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case 'table.rename': {
      const payload = command.payload as TableRenamePayload;
      if (!payload.newName || !command.target.table) return null;
      const result = sqlDiffGenerator.generateSql([command], adapter.dbType);
      const stmt = result.statements[0];
      return stmt?.statement ?? null;
    }

    case 'table.drop': {
      const payload = command.payload as TableDropPayload;
      if (!payload.tableName) return null;
      // Generate DROP TABLE SQL directly since sqlDiffGenerator doesn't support it
      const schemaPrefix = target.schema ? `${adapter.quoteIdentifier(target.schema)}.` : '';
      const tableName = adapter.quoteIdentifier(payload.tableName);
      const ifExists = payload.ifExists ? 'IF EXISTS ' : '';
      const cascade = payload.cascade ? ' CASCADE' : '';
      return `DROP TABLE ${ifExists}${schemaPrefix}${tableName}${cascade}`;
    }

    case 'table.truncate': {
      const payload = command.payload as TableTruncatePayload;
      if (!payload.tableName) return null;
      const schemaPrefix = target.schema ? `${adapter.quoteIdentifier(target.schema)}.` : '';
      const tableName = adapter.quoteIdentifier(payload.tableName);
      const restart = payload.restartIdentity ? ' RESTART IDENTITY' : '';
      const cascade = payload.cascade ? ' CASCADE' : '';
      return `TRUNCATE TABLE ${schemaPrefix}${tableName}${restart}${cascade}`;
    }

    case 'table.duplicate': {
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
      return typeof result === 'string' ? result : null;
    }

    // View DDL operations
    case 'view.create': {
      const payload = command.payload as ViewCreatePayload;
      if (!payload.definition?.name || !payload.definition?.definition) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.createView(schema, payload.definition);
      return typeof result === 'string' ? result : null;
    }

    case 'view.drop': {
      const payload = command.payload as ViewDropPayload;
      if (!payload.viewName) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.dropView(
        schema,
        payload.viewName,
        payload.ifExists,
        payload.cascade,
        payload.isMaterialized
      );
      return typeof result === 'string' ? result : null;
    }

    case 'view.replace': {
      const payload = command.payload as ViewReplacePayload;
      if (!payload.viewName || !payload.definition) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.replaceView(
        schema,
        payload.viewName,
        payload.definition,
        payload.isMaterialized
      );
      return typeof result === 'string' ? result : null;
    }

    case 'view.rename': {
      const payload = command.payload as ViewRenamePayload;
      if (!payload.viewName || !payload.newName) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.renameView(
        schema,
        payload.viewName,
        payload.newName,
        payload.isMaterialized
      );
      return typeof result === 'string' ? result : null;
    }

    // Constraint DDL operations
    case 'constraint.addPrimaryKey':
    case 'constraint.addUnique':
    case 'constraint.addCheck': {
      const payload = command.payload as ConstraintAddPayload;
      if (!payload.definition?.name) return null;
      const result = adapter.addConstraint(target, payload.definition);
      return typeof result === 'string' ? result : null;
    }

    case 'constraint.dropPrimaryKey':
    case 'constraint.dropUnique':
    case 'constraint.dropCheck':
    case 'constraint.drop': {
      const payload = command.payload as ConstraintDropPayload;
      if (!payload.constraintName) return null;
      const result = adapter.dropConstraint(
        target,
        payload.constraintName,
        payload.cascade,
        payload.ifExists
      );
      return typeof result === 'string' ? result : null;
    }

    case 'constraint.rename': {
      const payload = command.payload as ConstraintRenamePayload;
      if (!payload.constraintName || !payload.newName) return null;
      const result = adapter.renameConstraint(target, payload.constraintName, payload.newName);
      return typeof result === 'string' ? result : null;
    }

    // Sequence DDL operations
    case 'sequence.create': {
      const payload = command.payload as SequenceCreatePayload;
      if (!payload.definition?.name) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.createSequence(schema, payload.definition);
      return typeof result === 'string' ? result : null;
    }

    case 'sequence.alter': {
      const payload = command.payload as SequenceAlterPayload;
      if (!payload.sequenceName || !payload.changes) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.alterSequence(schema, payload.sequenceName, payload.changes);
      return typeof result === 'string' ? result : null;
    }

    case 'sequence.drop': {
      const payload = command.payload as SequenceDropPayload;
      if (!payload.sequenceName) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.dropSequence(
        schema,
        payload.sequenceName,
        payload.ifExists,
        payload.cascade
      );
      return typeof result === 'string' ? result : null;
    }

    case 'sequence.rename': {
      const payload = command.payload as SequenceRenamePayload;
      if (!payload.sequenceName || !payload.newName) return null;
      const schema = command.target.schema || 'public';
      const result = adapter.renameSequence(schema, payload.sequenceName, payload.newName);
      return typeof result === 'string' ? result : null;
    }

    default:
      return null;
  }
}

const buildTableRenameKey = (command: CrudCommand): string =>
  `${command.target.schema ?? ''}.${command.target.table ?? ''}`;

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
  if (originalCmd.type !== 'table.rename') return;
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
  if (command.type === 'column.modify') {
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
  if (command.type === 'column.drop') {
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
  if (command.type === 'column.rename') {
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
  if (command.type === 'fk.add') {
    const payload = command.payload as ForeignKeyAddPayload;
    if (payload.definition) {
      let changed = false;
      let newColumns = payload.definition.columns;
      let newRefColumns = payload.definition.referenceColumns;

      if (payload.definition.columns?.length) {
        const result = renameColumnsInArray(payload.definition.columns, columnRenames);
        if (result.changed) {
          changed = true;
          newColumns = result.columns;
        }
      }

      // Note: referenceColumns usually reference a different table, but if same table FK,
      // we should still rename them
      if (payload.definition.referenceColumns?.length) {
        const result = renameColumnsInArray(payload.definition.referenceColumns, columnRenames);
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
  if (command.type === 'index.create') {
    const payload = command.payload as IndexCreatePayload;
    if (payload.definition) {
      let changed = false;
      let newColumns = payload.definition.columns;
      let newIncludeColumns = payload.definition.includeColumns;

      if (payload.definition.columns?.length) {
        const result = renameColumnsInArray(payload.definition.columns, columnRenames);
        if (result.changed) {
          changed = true;
          newColumns = result.columns;
        }
      }

      if (payload.definition.includeColumns?.length) {
        const result = renameColumnsInArray(payload.definition.includeColumns, columnRenames);
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
  if (command.type === 'data.insert') {
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
  if (command.type === 'data.update') {
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
  if (originalCmd.type !== 'column.rename') return;

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
  stagedCommands: Map<string, CrudCommand[]>
): Promise<string> {
  const adapter = await getAdapter(connectionId, dbType);
  const sections: string[] = [];

  for (const [tableKey, commands] of stagedCommands) {
    if (commands.length === 0) continue;

    // Extract table name from key (format: connectionId:database:schema:table)
    const parts = tableKey.split(':');
    const tableName = parts[parts.length - 1] ?? 'unknown';
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

      const sql = commandToSql(adapter, adjustedCmd);
      if (sql) {
        statements.push(sql);
      }
    }

    if (statements.length > 0) {
      sections.push(statements.join(';\n') + ';');
    }
  }

  return sections.join('\n\n') || '-- No changes to commit';
}
