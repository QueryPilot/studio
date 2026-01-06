/**
 * Database Version Store
 *
 * Stores runtime version info for connected databases.
 * Version info is populated after connection test and used
 * by adapters for version-aware SQL generation.
 */

import { create } from 'zustand';
import type { DbType } from '@/types/connection';
import {
  parseMySQLVersion,
  parseSQLiteVersion,
  parsePostgreSQLVersion,
  getMySQLFeatures,
  getSQLiteFeatures,
  getPostgreSQLFeatures,
  type ParsedVersion,
  type MySQLVersionFeatures,
  type SQLiteVersionFeatures,
  type PostgreSQLVersionFeatures,
} from '@/adapters/utils/versionUtils';

interface VersionInfo {
  raw: string;
  parsed: ParsedVersion;
  detectedDbType?: DbType;
}

interface VersionStore {
  // Map: connectionId -> version info
  versions: Map<string, VersionInfo>;

  // Actions
  setVersion: (connectionId: string, version: string, detectedDbType?: DbType) => void;
  getVersion: (connectionId: string) => VersionInfo | undefined;
  clearVersion: (connectionId: string) => void;
  clearAll: () => void;

  // Convenience getters for adapters
  getMySQLFeatures: (connectionId: string) => MySQLVersionFeatures | null;
  getSQLiteFeatures: (connectionId: string) => SQLiteVersionFeatures | null;
  getPostgreSQLFeatures: (connectionId: string) => PostgreSQLVersionFeatures | null;
}

export const useVersionStore = create<VersionStore>((set, get) => ({
  versions: new Map(),

  setVersion: (connectionId, version, detectedDbType) => {
    // Parse version based on detected type
    const isMariaDB = detectedDbType === 'MariaDB' || version.toLowerCase().includes('mariadb');
    const isSQLite = version.toLowerCase().includes('sqlite');
    const isPostgreSQL = detectedDbType === 'PostgreSQL' || version.toLowerCase().includes('postgresql');

    let parsed: ParsedVersion;
    if (isPostgreSQL) {
      parsed = parsePostgreSQLVersion(version);
    } else if (isSQLite) {
      parsed = parseSQLiteVersion(version);
    } else {
      parsed = parseMySQLVersion(version);
      // Override isMariaDB based on detected type
      if (isMariaDB) {
        parsed = { ...parsed, isMariaDB: true };
      }
    }

    set((state) => {
      const newVersions = new Map(state.versions);
      newVersions.set(connectionId, { raw: version, parsed, detectedDbType });
      return { versions: newVersions };
    });
  },

  getVersion: (connectionId) => {
    return get().versions.get(connectionId);
  },

  clearVersion: (connectionId) => {
    set((state) => {
      const newVersions = new Map(state.versions);
      newVersions.delete(connectionId);
      return { versions: newVersions };
    });
  },

  clearAll: () => {
    set({ versions: new Map() });
  },

  getMySQLFeatures: (connectionId) => {
    const info = get().versions.get(connectionId);
    if (!info) return null;
    return getMySQLFeatures(info.parsed);
  },

  getSQLiteFeatures: (connectionId) => {
    const info = get().versions.get(connectionId);
    if (!info) return null;
    return getSQLiteFeatures(info.parsed);
  },

  getPostgreSQLFeatures: (connectionId) => {
    const info = get().versions.get(connectionId);
    if (!info) return null;
    return getPostgreSQLFeatures(info.parsed);
  },
}));

/**
 * Get MySQL features for a connection (convenience function for adapters)
 */
export function getMySQLFeaturesForConnection(connectionId: string): MySQLVersionFeatures {
  const features = useVersionStore.getState().getMySQLFeatures(connectionId);
  // Return conservative defaults if no version info available
  if (!features) {
    return {
      supportsRenameColumn: false,
      supportsDropIndexIfExists: false,
      supportsCheckConstraints: false,
      supportsWindowFunctions: false,
      supportsCTEs: false,
      supportsJsonTable: false,
      supportsInvisibleColumns: false,
    };
  }
  return features;
}

/**
 * Get SQLite features for a connection (convenience function for adapters)
 */
export function getSQLiteFeaturesForConnection(connectionId: string): SQLiteVersionFeatures {
  const features = useVersionStore.getState().getSQLiteFeatures(connectionId);
  // Return conservative defaults if no version info available
  if (!features) {
    return {
      supportsReturning: false,
      supportsDropColumn: false,
      supportsRenameColumn: false,
      supportsWindowFunctions: false,
      supportsUpsert: false,
      supportsNativeJson: false,
      supportsStrictTables: false,
    };
  }
  return features;
}

/**
 * Get PostgreSQL features for a connection (convenience function for adapters)
 */
export function getPostgreSQLFeaturesForConnection(connectionId: string): PostgreSQLVersionFeatures {
  const features = useVersionStore.getState().getPostgreSQLFeatures(connectionId);
  // Return permissive defaults if no version info available (assume modern PG)
  if (!features) {
    return {
      supportsGeneratedColumns: true,
      supportsIndexInclude: true,
      supportsCreateIndexConcurrentlyIfNotExists: true,
      supportsJsonPath: true,
      supportsMerge: false, // Conservative - PG 15+ only
      supportsPartitioning: true,
      supportsHashPartitioning: true,
      supportsLogicalReplication: true,
      supportsStoredProcedures: true,
      supportsIdentityColumns: true,
      supportsParallelQuery: true,
      supportsJsonTable: false, // PG 17+ only
    };
  }
  return features;
}
