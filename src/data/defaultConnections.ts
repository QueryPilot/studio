import { DatabaseConnection, DatabaseType } from '@/types/database';

export interface DefaultConnection {
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  workspace: string;
  tags: Array<{ name: string; color: string }>;
  description?: string;
}

/**
 * Default database connections based on Docker Compose setup
 * These match the development database containers
 */
export const defaultConnections: DefaultConnection[] = [
  {
    name: 'PostgreSQL Development',
    type: 'postgresql',
    host: 'localhost',
    port: 15432,
    database: 'todoapp',
    username: 'devuser',
    password: 'devpass123',
    workspace: 'Development',
    tags: [
      { name: 'development', color: '#10B981' },
      { name: 'postgres', color: '#3B82F6' }
    ],
    description: 'PostgreSQL development database with comprehensive test data'
  },
  {
    name: 'MySQL Development', 
    type: 'mysql',
    host: 'localhost',
    port: 13306,
    database: 'todoapp',
    username: 'devuser',
    password: 'devpass123',
    workspace: 'Development',
    tags: [
      { name: 'development', color: '#10B981' },
      { name: 'mysql', color: '#F59E0B' }
    ],
    description: 'MySQL development database with sample todos and users'
  },
  {
    name: 'MariaDB Development',
    type: 'mariadb', 
    host: 'localhost',
    port: 13307,
    database: 'todoapp',
    username: 'devuser',
    password: 'devpass123',
    workspace: 'Development',
    tags: [
      { name: 'development', color: '#10B981' },
      { name: 'mariadb', color: '#8B5CF6' }
    ],
    description: 'MariaDB development database - MySQL compatible'
  },
  {
    name: 'SQL Server Development',
    type: 'mssql',
    host: 'localhost', 
    port: 11434,
    database: 'todoapp',
    username: 'sa',
    password: 'DevPass123',
    workspace: 'Development',
    tags: [
      { name: 'development', color: '#10B981' },
      { name: 'mssql', color: '#EF4444' }
    ],
    description: 'SQL Server development database with advanced data types'
  },
  {
    name: 'SQLite Development',
    type: 'sqlite',
    host: '',
    port: 0,
    database: '/Users/hieuvu/Workspaces/devdb-studio/seeds/sqlite/todoapp.db',
    username: '',
    password: '',
    workspace: 'Development',
    tags: [
      { name: 'development', color: '#10B981' },
      { name: 'sqlite', color: '#6B7280' }
    ],
    description: 'SQLite file database - lightweight development option'
  }
];

/**
 * Generate a DatabaseConnection from a DefaultConnection
 */
export function createConnectionFromDefault(defaultConn: DefaultConnection): Omit<DatabaseConnection, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: defaultConn.name,
    type: defaultConn.type,
    workspace: defaultConn.workspace,
    tags: defaultConn.tags,
    host: defaultConn.host || undefined,
    port: defaultConn.port || undefined,
    database: defaultConn.database,
    username: defaultConn.username,
    password: defaultConn.password,
    filepath: defaultConn.type === 'sqlite' ? defaultConn.database : undefined,
  };
}

/**
 * Check if a connection matches an existing connection to prevent duplicates
 */
export function isDuplicateConnection(
  existing: DatabaseConnection,
  newConn: DefaultConnection
): boolean {
  return (
    existing.type === newConn.type &&
    existing.database === newConn.database &&
    existing.host === newConn.host &&
    existing.port === newConn.port
  );
}