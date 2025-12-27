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
} from '@/types/crud';
import type { DatabaseAdapter, TableRef, RowData, WhereClause } from './types';

// Lazy imports to avoid circular dependencies
const adapterModules = {
  [DbType.PostgreSQL]: () =>
    import('./dialects/PostgreSQLAdapter').then((m) => m.PostgreSQLAdapter),
  [DbType.MySQL]: () =>
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
 */
function commandToSql(adapter: DatabaseAdapter, command: CrudCommand): string | null {
  const target: TableRef = {
    schema: command.target.schema,
    table: command.target.table ?? '',
  };

  switch (command.type) {
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

    default:
      return null;
  }
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

    const statements: string[] = [];
    for (const cmd of commands) {
      const sql = commandToSql(adapter, cmd);
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
