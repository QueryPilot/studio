export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'redis';

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  filepath?: string; // For SQLite
  connectionString?: string; // For MongoDB or custom connection strings
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  color?: string;
  connections: DatabaseConnection[];
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: 'table' | 'view' | 'materialized_view';
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
}