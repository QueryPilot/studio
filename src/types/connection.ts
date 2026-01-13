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
  options: Record<string, string>;
  group?: string; // Optional group name for organizing related connections
  default_schema?: string; // Default schema for PostgreSQL/SQLServer (e.g., "myschema" instead of "public")
}

export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MariaDB = "MariaDB",
  SQLite = "SQLite",
  SQLServer = "SQLServer",
  // New paradigms
  MongoDB = "MongoDB",
  Redis = "Redis",
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
    case DbType.SQLServer:
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

export enum SslMode {
  Disable = "Disable",
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
