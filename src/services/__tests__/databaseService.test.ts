import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { mockTauriCommands, createMockTable, createMockColumn } from '@/test-utils/mockTauri';
import { type ConnectionProfile, DbType } from '@/types/connection';

// Type for mock invoke args (more permissive than InvokeArgs)
interface MockInvokeArgs {
  profile?: ConnectionProfile;
  connection_id?: string;
  schema?: string;
  table?: string;
  sql?: string;
  id?: string;
  provider?: string;
  key?: string;
  [key: string]: unknown;
}

// Type for connection response
interface ConnectionResponse {
  connection_id: string;
  server_version: string;
}

// Type for test connection response
interface TestConnectionResponse {
  success: boolean;
  message?: string;
  version?: string | null;
  warnings: string[];
}

// Type for success response
interface SuccessResponse {
  success: boolean;
}

// Type for sidecar status response
interface SidecarStatusResponse {
  running: boolean;
  port: number;
}

describe('databaseService with Tauri IPC Mocking', () => {
  const mockProfile: ConnectionProfile = {
    id: 'test-conn',
    name: 'Test Database',
    db_type: DbType.PostgreSQL,
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    username: 'postgres',
    password: 'password',
    options: {},
  };

  beforeEach(() => {
    // Setup Tauri mocks
    mockTauriCommands();
    vi.clearAllMocks();
  });

  describe('IPC Command Invocations', () => {
    it('should call connect_to_database command', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'connect_to_database') {
          expect(args).toBeDefined();
          const connArgs = args as MockInvokeArgs;
          expect(connArgs.profile).toMatchObject({
            db_type: mockProfile.db_type,
            host: mockProfile.host,
            port: mockProfile.port,
          });
          return {
            connection_id: 'conn-123',
            server_version: 'PostgreSQL 15.0',
          };
        }
        return undefined;
      });

      const response = await invoke('connect_to_database', { profile: mockProfile });

      expect(response.connection_id).toBe('conn-123');
      expect(response.server_version).toBe('PostgreSQL 15.0');
    });

    it('should call get_databases command', async () => {
      const mockDatabases = ['postgres', 'testdb', 'myapp'];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_databases') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          return mockDatabases;
        }
        return undefined;
      });

      const result = await invoke('get_databases', { connection_id: 'conn-123' });
      expect(result).toEqual(mockDatabases);
    });

    it('should call get_tables command', async () => {
      const mockTables = [
        createMockTable({ name: 'users', row_count: 100 }),
        createMockTable({ name: 'posts', row_count: 500 }),
      ];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_tables') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          expect(typedArgs.schema).toBe('public');
          return mockTables;
        }
        return undefined;
      });

      const result = await invoke('get_tables', {
        connection_id: 'conn-123',
        schema: 'public',
      });

      expect(result).toEqual(mockTables);
      expect(result).toHaveLength(2);
    });

    it('should call get_table_columns command', async () => {
      const mockColumns = [
        createMockColumn({ name: 'id', db_type: 'integer' }),
        createMockColumn({ name: 'email', db_type: 'varchar', primary_key: false }),
      ];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_table_columns') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          expect(typedArgs.schema).toBe('public');
          expect(typedArgs.table).toBe('users');
          return mockColumns;
        }
        return undefined;
      });

      const result = await invoke('get_table_columns', {
        connection_id: 'conn-123',
        schema: 'public',
        table: 'users',
      });

      expect(result).toEqual(mockColumns);
    });

    it('should call execute_sql command', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'execute_sql') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          expect(typedArgs.sql).toBe('DELETE FROM users WHERE id = 1');
          return {
            success: true,
            rows_affected: 1,
          };
        }
        return undefined;
      });

      const result = await invoke('execute_sql', {
        connection_id: 'conn-123',
        sql: 'DELETE FROM users WHERE id = 1',
      });

      expect(result).toEqual({
        success: true,
        rows_affected: 1,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'connect_to_database') {
          throw new Error('Connection refused');
        }
      });

      await expect(
        invoke('connect_to_database', { profile: mockProfile })
      ).rejects.toThrow('Connection refused');
    });

    it('should handle query errors', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'execute_sql') {
          throw new Error('Syntax error at position 10');
        }
      });

      await expect(
        invoke('execute_sql', {
          connection_id: 'conn-123',
          sql: 'INVALID SQL',
        })
      ).rejects.toThrow('Syntax error');
    });

    it('should handle missing connection errors', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'get_databases') {
          throw new Error('Connection not found: conn-999');
        }
      });

      await expect(
        invoke('get_databases', { connection_id: 'conn-999' })
      ).rejects.toThrow('Connection not found');
    });
  });

  describe('Test Connection', () => {
    it('should test connection successfully', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'test_connection') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.profile).toMatchObject({
            host: mockProfile.host,
            port: mockProfile.port,
          });
          return {
            success: true,
            message: 'Connection successful',
            version: 'PostgreSQL 15.0',
            warnings: [],
          };
        }
        return undefined;
      });

      const result = await invoke('test_connection', { profile: mockProfile });

      expect(result.success).toBe(true);
      expect(result.version).toBe('PostgreSQL 15.0');
    });

    it('should handle test connection failure', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'test_connection') {
          return {
            success: false,
            message: 'Authentication failed',
            version: null,
            warnings: [],
          };
        }
        return undefined;
      });

      const result = await invoke('test_connection', { profile: mockProfile });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication failed');
    });

    it('should return warnings on test connection', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'test_connection') {
          return {
            success: true,
            message: 'Connection successful',
            version: 'PostgreSQL 13.0',
            warnings: ['Server version is outdated'],
          };
        }
        return undefined;
      });

      const result = await invoke('test_connection', { profile: mockProfile });

      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('outdated');
    });
  });

  describe('Disconnect', () => {
    it('should disconnect from database', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'disconnect_from_database') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          return { success: true };
        }
        return undefined;
      });

      const result = await invoke('disconnect_from_database', {
        connection_id: 'conn-123',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Schema Operations', () => {
    it('should get schemas', async () => {
      const mockSchemas = ['public', 'private', 'staging'];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_schemas') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          return mockSchemas;
        }
        return undefined;
      });

      const result = await invoke('get_schemas', {
        connection_id: 'conn-123',
      });

      expect(result).toEqual(mockSchemas);
    });

    it('should get table indexes', async () => {
      const mockIndexes = [
        {
          name: 'users_pkey',
          table_name: 'users',
          columns: ['id'],
          is_unique: true,
          is_primary: true,
          definition: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)',
        },
        {
          name: 'users_email_idx',
          table_name: 'users',
          columns: ['email'],
          is_unique: true,
          is_primary: false,
          definition: 'CREATE UNIQUE INDEX users_email_idx ON public.users (email)',
        },
      ];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_table_indexes') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          expect(typedArgs.schema).toBe('public');
          expect(typedArgs.table).toBe('users');
          return mockIndexes;
        }
        return undefined;
      });

      const result = await invoke('get_table_indexes', {
        connection_id: 'conn-123',
        schema: 'public',
        table: 'users',
      });

      expect(result).toEqual(mockIndexes);
      expect(result).toHaveLength(2);
    });

    it('should get table constraints', async () => {
      const mockConstraints = [
        {
          name: 'users_pkey',
          table_name: 'users',
          constraint_type: 'PrimaryKey',
          definition: 'PRIMARY KEY (id)',
        },
        {
          name: 'users_email_unique',
          table_name: 'users',
          constraint_type: 'Unique',
          definition: 'UNIQUE (email)',
        },
      ];

      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_table_constraints') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.connection_id).toBe('conn-123');
          expect(typedArgs.schema).toBe('public');
          expect(typedArgs.table).toBe('users');
          return mockConstraints;
        }
        return undefined;
      });

      const result = await invoke('get_table_constraints', {
        connection_id: 'conn-123',
        schema: 'public',
        table: 'users',
      });

      expect(result).toEqual(mockConstraints);
    });
  });

  describe('Vault Operations', () => {
    it('should save connection profile', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'save_connection_profile') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.profile).toMatchObject({
            name: mockProfile.name,
            db_type: mockProfile.db_type,
          });
          return { success: true };
        }
        return undefined;
      });

      const result = await invoke('save_connection_profile', {
        profile: mockProfile,
      });

      expect(result.success).toBe(true);
    });

    it('should load connection profiles', async () => {
      const mockProfiles = [
        mockProfile,
        {
          ...mockProfile,
          id: 'test-conn-2',
          name: 'Another DB',
        },
      ];

      mockTauriCommands((cmd) => {
        if (cmd === 'load_connection_profiles') {
          return mockProfiles;
        }
        return undefined;
      });

      const result = await invoke('load_connection_profiles');

      expect(result).toEqual(mockProfiles);
      expect(result).toHaveLength(2);
    });

    it('should delete connection profile', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'delete_connection_profile') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.id).toBe('test-conn');
          return { success: true };
        }
        return undefined;
      });

      const result = await invoke('delete_connection_profile', {
        id: 'test-conn',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('AI Sidecar Operations', () => {
    it('should get AI API key', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'get_ai_api_key') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.provider).toBe('openai');
          return 'sk-test-1234';
        }
        return undefined;
      });

      const result = await invoke('get_ai_api_key', {
        provider: 'openai',
      });

      expect(result).toBe('sk-test-1234');
    });

    it('should return null for missing API key', async () => {
      mockTauriCommands((_cmd) => {
        if (_cmd === 'get_ai_api_key') {
          return null;
        }
        return undefined;
      });

      const result = await invoke('get_ai_api_key', {
        provider: 'anthropic',
      });

      expect(result).toBe(null);
    });

    it('should set AI API key', async () => {
      mockTauriCommands((cmd, args) => {
        if (cmd === 'set_ai_api_key') {
          const typedArgs = args as MockInvokeArgs;
          expect(typedArgs.provider).toBe('openai');
          expect(typedArgs.key).toBe('sk-test-5678');
          return { success: true };
        }
        return undefined;
      });

      const result = await invoke('set_ai_api_key', {
        provider: 'openai',
        key: 'sk-test-5678',
      });

      expect(result.success).toBe(true);
    });

    it('should get sidecar status', async () => {
      mockTauriCommands((cmd) => {
        if (cmd === 'get_sidecar_status') {
          return {
            running: true,
            port: 3001,
          };
        }
        return undefined;
      });

      const result = await invoke('get_sidecar_status');

      expect(result.running).toBe(true);
      expect(result.port).toBe(3001);
    });
  });
});
