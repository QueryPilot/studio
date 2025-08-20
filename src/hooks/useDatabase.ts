import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { cacheService } from '@/services/cacheService';

interface DatabaseInfo {
  databases: string[];
}

interface SchemaInfo {
  schemas: string[];
}

/**
 * Hook for fetching available databases
 */
export function useDatabases(connectionId: string | null) {
  return useQuery({
    queryKey: ['databases', connectionId],
    queryFn: async (): Promise<string[]> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke<string[]>('db_list_databases', {
        connectionId,
      });

      return result || [];
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000,  // 10 minutes
    gcTime: 30 * 60 * 1000,     // 30 minutes
  });
}

/**
 * Hook for fetching schemas in a database
 */
export function useSchemas(connectionId: string | null, database?: string) {
  return useQuery({
    queryKey: ['schemas', connectionId, database],
    queryFn: async (): Promise<string[]> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke<string[]>('db_list_schemas', {
        connectionId,
        database: database || '',
      });

      return result || [];
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000,  // 10 minutes
    gcTime: 30 * 60 * 1000,     // 30 minutes
  });
}

/**
 * Hook for fetching complete database schema info
 */
export function useDatabase(connectionId: string | null) {
  return useQuery({
    queryKey: ['database', connectionId],
    queryFn: async () => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      // Fetch all schema information in parallel
      const [schemas, tables, views, functions] = await Promise.all([
        invoke<string[]>('db_list_schemas', { connectionId }),
        invoke<any[]>('db_list_tables', { connectionId }),
        invoke<any[]>('db_list_views', { connectionId }),
        invoke<any[]>('db_list_functions', { connectionId }),
      ]);

      return {
        schemas: schemas || [],
        tables: tables || [],
        views: views || [],
        functions: functions || [],
      };
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000,  // 10 minutes
    gcTime: 30 * 60 * 1000,     // 30 minutes
  });
}

/**
 * Hook for testing database connection
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: async (config: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl_mode?: string;
    }) => {
      const result = await invoke('db_test_connection', config);
      return result;
    },
    onSuccess: () => {
      console.log('Connection test successful');
    },
    onError: (error) => {
      console.error('Connection test failed:', error);
    },
  });
}

/**
 * Hook for establishing a database connection
 */
export function useConnectDatabase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl_mode?: string;
    }) => {
      const result = await invoke<{
        connection_id: string;
        database_type: string;
        server_version: string;
      }>('db_connect', config);

      return result;
    },
    onSuccess: (data) => {
      // Preload basic schema information
      queryClient.prefetchQuery({
        queryKey: ['databases', data.connection_id],
        queryFn: () => invoke('db_list_databases', {
          connectionId: data.connection_id,
        }),
        staleTime: 10 * 60 * 1000,
      });

      console.log('Connected to database:', data);
    },
    onError: (error) => {
      console.error('Failed to connect to database:', error);
    },
  });
}

/**
 * Hook for disconnecting from a database
 */
export function useDisconnectDatabase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      await invoke('db_disconnect', { connectionId });
      return connectionId;
    },
    onSuccess: (connectionId) => {
      // Clear all cached data for this connection
      cacheService.invalidateConnection(connectionId);

      // Remove all queries related to this connection
      queryClient.removeQueries({
        queryKey: ['databases', connectionId],
      });
      queryClient.removeQueries({
        queryKey: ['schemas', connectionId],
      });
      queryClient.removeQueries({
        queryKey: ['table', connectionId],
      });
      queryClient.removeQueries({
        queryKey: ['query', connectionId],
      });
      queryClient.removeQueries({
        queryKey: ['columns', connectionId],
      });

      console.log('Disconnected from database:', connectionId);
    },
    onError: (error) => {
      console.error('Failed to disconnect from database:', error);
    },
  });
}

/**
 * Hook for getting database server information
 */
export function useDatabaseInfo(connectionId: string | null) {
  return useQuery({
    queryKey: ['database-info', connectionId],
    queryFn: async () => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const version = await invoke<string>('db_server_version', {
        connectionId,
      });

      return { version };
    },
    enabled: !!connectionId,
    staleTime: 60 * 60 * 1000,  // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
  });
}

/**
 * Hook for executing database maintenance operations
 */
export function useDatabaseMaintenance(connectionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ operation, params }: { 
      operation: 'analyze' | 'vacuum' | 'reindex';
      params?: Record<string, any>;
    }) => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke('db_maintenance', {
        connectionId,
        operation,
        params: params || {},
      });

      return result;
    },
    onSuccess: (_, variables) => {
      console.log(`Database ${variables.operation} completed`);
      
      // Invalidate relevant caches after maintenance
      if (connectionId) {
        if (variables.operation === 'analyze') {
          // Invalidate table statistics
          queryClient.invalidateQueries({
            queryKey: ['row-count', connectionId],
          });
        }
      }
    },
    onError: (error, variables) => {
      console.error(`Database ${variables.operation} failed:`, error);
    },
  });
}

/**
 * Hook for managing database transactions
 */
export function useTransaction(connectionId: string | null) {
  return {
    begin: useMutation({
      mutationFn: async () => {
        if (!connectionId) {
          throw new Error('Connection ID is required');
        }

        const result = await invoke<string>('db_begin_transaction', {
          connectionId,
        });

        return result;
      },
    }),

    commit: useMutation({
      mutationFn: async (transactionId: string) => {
        if (!connectionId) {
          throw new Error('Connection ID is required');
        }

        await invoke('db_commit', {
          connectionId,
          txId: transactionId,
        });
      },
      onSuccess: () => {
        // Invalidate all cached data as transaction changes are committed
        if (connectionId) {
          cacheService.invalidateConnection(connectionId);
        }
      },
    }),

    rollback: useMutation({
      mutationFn: async (transactionId: string) => {
        if (!connectionId) {
          throw new Error('Connection ID is required');
        }

        await invoke('db_rollback', {
          connectionId,
          txId: transactionId,
        });
      },
    }),
  };
}