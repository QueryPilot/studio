import type { InlineTunnelConfig } from "./tunnel";

export type AttachmentKind =
  | "iceberg"
  | "delta"
  | "ducklake"
  | "postgres"
  | "mysql"
  | "sqlite"
  | "duckdb";

export interface Attachment {
  alias: string;
  kind: AttachmentKind;
  uri: string;
  read_only?: boolean;
  options?: Record<string, string>;
  secret_ref?: string;
}

/**
 * Per-database entry on a ConnectionProfile.
 *
 * `visible_schemas[0]` is the primary (drives search_path). Ordering matters.
 *
 * Phase 4 / Trino exception: Trino allows `visible_schemas` to be empty at the
 * DatabaseEntry level (meaning "surface all schemas for this catalog"). Phase 1
 * does NOT exercise that path; all non-Trino dialects MUST keep `visible_schemas`
 * non-empty. Validation lives in `setVisibleSchemas` + backend
 * `update_connection_schemas`.
 */
export interface DatabaseEntry {
  name: string;
  visible_schemas: string[];
  attachments?: Attachment[];
  extensions?: string[];
  secret_refs?: string[];
}

// Connection Profile matching Rust backend
export interface ConnectionProfile {
  id: string;
  name: string;
  db_type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl_mode?: SslMode;
  ssl_config?: SslConfig;
  ssh_tunnel?: SshTunnelConfig;
  bastion?: BastionConfig;
  tunnel_profile_id?: string;
  tunnel_inline?: InlineTunnelConfig;
  tunnel_remote_host?: string;
  tunnel_remote_port?: number;
  options: Record<string, string>;
  group?: string; // Optional group name for organizing related connections
  default_schema?: string; // Default schema for schema-aware SQL databases (e.g., PostgreSQL, SQL Server, Trino)
  // DEPRECATED — read-only; migrated in-place on load by migrateTrinoLegacyFields(). Never write.
  trino_catalogs?: string[];
  // DEPRECATED — read-only; migrated in-place on load by migrateTrinoLegacyFields(). Never write.
  trino_schema_filters?: string;
  safe_mode?: SafeMode; // Per-connection safe mode (defaults to "full_access")
  pooler_mode?: boolean | null; // PostgreSQL connection pooler override: true, false, or auto-detect (null)
  databases: DatabaseEntry[]; // Ordered list of databases/catalogs with their visible schemas
}

export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MariaDB = "MariaDB",
  SQLite = "SQLite",
  DuckDB = "DuckDB",
  MotherDuck = "MotherDuck",
  SQLServer = "SQLServer",
  Oracle = "Oracle",
  // New paradigms
  MongoDB = "MongoDB",
  Redis = "Redis",
  // Analytics engines
  Trino = "Trino",
}

/** Database paradigm - categorizes databases by their query model */
export type DatabaseParadigm = 'sql' | 'document' | 'keyvalue';

/**
 * Get the database paradigm for a given database type
 */
export function getParadigm(dbType: DbType): DatabaseParadigm {
  switch (dbType) {
    case DbType.PostgreSQL:
    case DbType.MySQL:
    case DbType.MariaDB:
    case DbType.SQLite:
    case DbType.DuckDB:
    case DbType.MotherDuck:
    case DbType.SQLServer:
    case DbType.Oracle:
    case DbType.Trino:
      return 'sql';
    case DbType.MongoDB:
      return 'document';
    case DbType.Redis:
      return 'keyvalue';
  }
}

/**
 * Check if database type is MySQL-compatible (MySQL or MariaDB)
 */
export function isMySQLCompatible(dbType: DbType): boolean {
  return dbType === DbType.MySQL || dbType === DbType.MariaDB;
}

/**
 * Check if database type uses SQL
 */
export function isSql(dbType: DbType): boolean {
  return getParadigm(dbType) === 'sql';
}

/**
 * Check if database type is a document database
 */
export function isDocument(dbType: DbType): boolean {
  return getParadigm(dbType) === 'document';
}

/**
 * Check if database type is a key-value database
 */
export function isKeyValue(dbType: DbType): boolean {
  return getParadigm(dbType) === 'keyvalue';
}

/**
 * Get the default schema for a database type.
 * - PostgreSQL: "public"
 * - MySQL/MariaDB: Uses database name as schema (pass null, will use database)
 * - SQLite: "main"
 * - DuckDB: "main"
 * - SQL Server: "dbo"
 * - MongoDB/Redis: null (no schema concept)
 */
export function getDefaultSchema(dbType: DbType, database?: string): string | null {
  switch (dbType) {
    case DbType.PostgreSQL:
      return 'public';
    case DbType.MySQL:
    case DbType.MariaDB:
      // MySQL uses database name as schema
      return database || null;
    case DbType.SQLite:
    case DbType.DuckDB:
    case DbType.MotherDuck:
      return 'main';
    case DbType.SQLServer:
      return 'dbo';
    case DbType.Oracle:
    case DbType.Trino:
      return null;
    case DbType.MongoDB:
    case DbType.Redis:
      // No schema concept
      return null;
  }
}

/** Per-connection safe mode restricting allowed operations */
export type SafeMode = "read_only" | "read_write" | "read_write_update" | "full_access";

export enum SslMode {
  Disable = "Disable",
  Allow = "Allow",
  Prefer = "Prefer",
  Require = "Require",
  VerifyCa = "VerifyCa",
  VerifyFull = "VerifyFull",
}

export interface SslConfig {
  key_file?: string;
  cert_file?: string;
  ca_file?: string;
}

export interface SshTunnelConfig {
  host: string;
  port: number;
  user: string;
  auth: SshAuthMethod;
}

export type SshAuthMethod =
  | { Password: string }
  | { KeyFile: { path: string; passphrase?: string | null } }
  | { Agent: true };

export type BastionConfig =
  | { Ssh: SshTunnelConfig };

export interface StoredConnection {
  profile: ConnectionProfile;
  metadata: ConnectionMetadata;
}

export interface ConnectionMetadata {
  created_at: string;
  last_used: string | null;
  use_count: number;
  tags: string[];
  is_favorite: boolean;
}

export interface GroupTag {
  name: string;
  color: string;
}

export interface ActiveConnectionState {
  connection_id: string;
  connected_at: string;
}

export interface WindowStates {
  [windowLabel: string]: ActiveConnectionState;
}

export interface ConnectionChangedEvent {
  window: string;
  connection_id: string;
}

export interface ConnectionDeletedEvent {
  connection_id: string;
  affected_windows: string[];
}
