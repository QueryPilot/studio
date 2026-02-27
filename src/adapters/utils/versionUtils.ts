/**
 * Database Version Utilities
 *
 * Parse and compare database version strings for version-aware SQL generation.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  isMariaDB: boolean;
  raw: string;
}

// ─────────────────────────────────────────────────────────────────
// PostgreSQL Version Parsing
// ─────────────────────────────────────────────────────────────────

/**
 * Parse a PostgreSQL version string
 *
 * Examples:
 * - "PostgreSQL 15.4 on x86_64-pc-linux-gnu, compiled by gcc..."
 * - "PostgreSQL 14.9 (Ubuntu 14.9-1.pgdg22.04+1)"
 * - "15.4"
 */
export function parsePostgreSQLVersion(version: string): ParsedVersion {
  // Extract version numbers - PostgreSQL X.Y or X.Y.Z
  const match = version.match(/PostgreSQL\s*(\d+)\.(\d+)(?:\.(\d+))?|^(\d+)\.(\d+)(?:\.(\d+))?/);

  if (!match) {
    // Default to PG 12 if parsing fails (conservative)
    return { major: 12, minor: 0, patch: 0, isMariaDB: false, raw: version };
  }

  // Handle both formats (with and without "PostgreSQL" prefix)
  const major = match[1] ?? match[4] ?? '12';
  const minor = match[2] ?? match[5] ?? '0';
  const patch = match[3] ?? match[6] ?? '0';

  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    isMariaDB: false,
    raw: version,
  };
}

/**
 * Parse a MySQL/MariaDB version string
 *
 * Examples:
 * - MySQL: "8.0.32", "5.7.44"
 * - MariaDB: "10.11.2-MariaDB", "11.2.2-MariaDB-1:11.2.2+maria~ubu2204"
 */
export function parseMySQLVersion(version: string): ParsedVersion {
  const isMariaDB = version.toLowerCase().includes('mariadb');

  // Extract version numbers (format: X.Y.Z or X.Y.Z-suffix)
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    // Default to old version if parsing fails
    return { major: 5, minor: 5, patch: 0, isMariaDB, raw: version };
  }

  return {
    major: parseInt(match[1] ?? '0', 10),
    minor: parseInt(match[2] ?? '0', 10),
    patch: parseInt(match[3] ?? '0', 10),
    isMariaDB,
    raw: version,
  };
}

/**
 * Parse a SQLite version string
 *
 * Examples:
 * - "SQLite 3.45.1"
 * - "3.45.1"
 */
export function parseSQLiteVersion(version: string): ParsedVersion {
  // Remove "SQLite " prefix if present
  const cleanVersion = version.replace(/^SQLite\s*/i, '');

  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    // Default to old version if parsing fails
    return { major: 3, minor: 0, patch: 0, isMariaDB: false, raw: version };
  }

  return {
    major: parseInt(match[1] ?? '3', 10),
    minor: parseInt(match[2] ?? '0', 10),
    patch: parseInt(match[3] ?? '0', 10),
    isMariaDB: false,
    raw: version,
  };
}

/**
 * Compare if version is at least the specified version
 */
export function isVersionAtLeast(
  version: ParsedVersion,
  major: number,
  minor: number,
  patch: number = 0
): boolean {
  if (version.major > major) return true;
  if (version.major < major) return false;
  if (version.minor > minor) return true;
  if (version.minor < minor) return false;
  return version.patch >= patch;
}

// ─────────────────────────────────────────────────────────────────
// MySQL/MariaDB Version Feature Flags
// ─────────────────────────────────────────────────────────────────

/**
 * MySQL 8.0+ features
 */
export interface MySQLVersionFeatures {
  // RENAME COLUMN (MySQL 8.0+, MariaDB 10.5.2+)
  supportsRenameColumn: boolean;
  // DROP INDEX IF EXISTS (MySQL 8.0.29+, MariaDB 10.1.4+)
  supportsDropIndexIfExists: boolean;
  // CHECK constraints (MySQL 8.0.16+, MariaDB 10.2.1+)
  supportsCheckConstraints: boolean;
  // Window functions (MySQL 8.0+, MariaDB 10.2+)
  supportsWindowFunctions: boolean;
  // CTEs (MySQL 8.0+, MariaDB 10.2.1+)
  supportsCTEs: boolean;
  // JSON_TABLE (MySQL 8.0+, MariaDB 10.6+)
  supportsJsonTable: boolean;
  // INVISIBLE columns (MySQL 8.0.23+, MariaDB 10.3.3+)
  supportsInvisibleColumns: boolean;
  // Performance Schema index stats (MySQL 5.7+, MariaDB 10.0+)
  supportsPerformanceSchemaIndexStats: boolean;
  // INNODB_SYS_TABLESTATS for size info (MySQL 5.7+, MariaDB 10.0+)
  supportsInnoDbSysTableStats: boolean;
}

export function getMySQLFeatures(version: ParsedVersion): MySQLVersionFeatures {
  if (version.isMariaDB) {
    return {
      supportsRenameColumn: isVersionAtLeast(version, 10, 5, 2),
      supportsDropIndexIfExists: isVersionAtLeast(version, 10, 1, 4),
      supportsCheckConstraints: isVersionAtLeast(version, 10, 2, 1),
      supportsWindowFunctions: isVersionAtLeast(version, 10, 2, 0),
      supportsCTEs: isVersionAtLeast(version, 10, 2, 1),
      supportsJsonTable: isVersionAtLeast(version, 10, 6, 0),
      supportsInvisibleColumns: isVersionAtLeast(version, 10, 3, 3),
      supportsPerformanceSchemaIndexStats: isVersionAtLeast(version, 10, 0, 0),
      supportsInnoDbSysTableStats: isVersionAtLeast(version, 10, 0, 0),
    };
  }

  // MySQL
  return {
    supportsRenameColumn: isVersionAtLeast(version, 8, 0, 0),
    supportsDropIndexIfExists: isVersionAtLeast(version, 8, 0, 29),
    supportsCheckConstraints: isVersionAtLeast(version, 8, 0, 16),
    supportsWindowFunctions: isVersionAtLeast(version, 8, 0, 0),
    supportsCTEs: isVersionAtLeast(version, 8, 0, 0),
    supportsJsonTable: isVersionAtLeast(version, 8, 0, 0),
    supportsInvisibleColumns: isVersionAtLeast(version, 8, 0, 23),
    supportsPerformanceSchemaIndexStats: isVersionAtLeast(version, 5, 7, 0),
    supportsInnoDbSysTableStats: isVersionAtLeast(version, 5, 7, 0),
  };
}

// ─────────────────────────────────────────────────────────────────
// SQLite Version Feature Flags
// ─────────────────────────────────────────────────────────────────

export interface SQLiteVersionFeatures {
  // RETURNING clause (SQLite 3.35.0+)
  supportsReturning: boolean;
  // DROP COLUMN (SQLite 3.35.0+)
  supportsDropColumn: boolean;
  // RENAME COLUMN (SQLite 3.25.0+)
  supportsRenameColumn: boolean;
  // Window functions (SQLite 3.25.0+)
  supportsWindowFunctions: boolean;
  // UPSERT (SQLite 3.24.0+)
  supportsUpsert: boolean;
  // JSON functions (SQLite 3.38.0+ native, earlier via extension)
  supportsNativeJson: boolean;
  // STRICT tables (SQLite 3.37.0+)
  supportsStrictTables: boolean;
}

export function getSQLiteFeatures(version: ParsedVersion): SQLiteVersionFeatures {
  return {
    supportsReturning: isVersionAtLeast(version, 3, 35, 0),
    supportsDropColumn: isVersionAtLeast(version, 3, 35, 0),
    supportsRenameColumn: isVersionAtLeast(version, 3, 25, 0),
    supportsWindowFunctions: isVersionAtLeast(version, 3, 25, 0),
    supportsUpsert: isVersionAtLeast(version, 3, 24, 0),
    supportsNativeJson: isVersionAtLeast(version, 3, 38, 0),
    supportsStrictTables: isVersionAtLeast(version, 3, 37, 0),
  };
}

// ─────────────────────────────────────────────────────────────────
// PostgreSQL Version Feature Flags
// ─────────────────────────────────────────────────────────────────

export interface PostgreSQLVersionFeatures {
  // GENERATED ALWAYS AS ... STORED (PG 12+)
  supportsGeneratedColumns: boolean;
  // INCLUDE clause in indexes (PG 11+)
  supportsIndexInclude: boolean;
  // CREATE INDEX CONCURRENTLY IF NOT EXISTS (PG 9.5+)
  supportsCreateIndexConcurrentlyIfNotExists: boolean;
  // JSON path operators @? and @@ (PG 12+)
  supportsJsonPath: boolean;
  // MERGE statement (PG 15+)
  supportsMerge: boolean;
  // Partitioned tables (PG 10+)
  supportsPartitioning: boolean;
  // Hash partitioning (PG 11+)
  supportsHashPartitioning: boolean;
  // Logical replication (PG 10+)
  supportsLogicalReplication: boolean;
  // Stored procedures with CALL (PG 11+)
  supportsStoredProcedures: boolean;
  // IDENTITY columns (PG 10+)
  supportsIdentityColumns: boolean;
  // Parallel query improvements (PG 9.6+)
  supportsParallelQuery: boolean;
  // JSON_TABLE (PG 17+)
  supportsJsonTable: boolean;
  // last_idx_scan column in pg_stat_all_indexes (PG 16+)
  supportsIndexLastScan: boolean;
}

export function getPostgreSQLFeatures(version: ParsedVersion): PostgreSQLVersionFeatures {
  return {
    supportsGeneratedColumns: isVersionAtLeast(version, 12, 0, 0),
    supportsIndexInclude: isVersionAtLeast(version, 11, 0, 0),
    supportsCreateIndexConcurrentlyIfNotExists: isVersionAtLeast(version, 9, 5, 0),
    supportsJsonPath: isVersionAtLeast(version, 12, 0, 0),
    supportsMerge: isVersionAtLeast(version, 15, 0, 0),
    supportsPartitioning: isVersionAtLeast(version, 10, 0, 0),
    supportsHashPartitioning: isVersionAtLeast(version, 11, 0, 0),
    supportsLogicalReplication: isVersionAtLeast(version, 10, 0, 0),
    supportsStoredProcedures: isVersionAtLeast(version, 11, 0, 0),
    supportsIdentityColumns: isVersionAtLeast(version, 10, 0, 0),
    supportsParallelQuery: isVersionAtLeast(version, 9, 6, 0),
    supportsJsonTable: isVersionAtLeast(version, 17, 0, 0),
    supportsIndexLastScan: isVersionAtLeast(version, 16, 0, 0),
  };
}
