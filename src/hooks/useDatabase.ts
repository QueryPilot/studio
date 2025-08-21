import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { cacheService } from "@/services/cacheService";
import { type DatabaseType } from "@/types/database";
import { useSecureConnectionStore } from "@/stores";

// interface DatabaseInfo {
//   databases: string[];
// }

// interface SchemaInfo {
//   schemas: string[];
// }

/**
 * Hook for fetching available databases
 */
export function useDatabases(connectionId: string | null) {
  return useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async (): Promise<string[]> => {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      return await secureDatabaseService.getDatabases(connectionId);
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Hook for fetching schemas in a database
 */
export function useSchemas(connectionId: string | null, database?: string) {
  return useQuery({
    queryKey: ["schemas", connectionId, database],
    queryFn: async (): Promise<string[]> => {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      return await secureDatabaseService.getSchemas(
        connectionId,
        database || "",
      );
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Hook for fetching complete database schema info
 */
export function useDatabase(connectionId: string | null) {
  return useQuery({
    queryKey: ["database", connectionId],
    queryFn: async () => {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      // Fetch all schema information in parallel
      const [schemas, tables, views, functions] = await Promise.all([
        secureDatabaseService.getSchemas(connectionId, ""),
        secureDatabaseService.getTables(connectionId),
        secureDatabaseService.getViews(connectionId),
        secureDatabaseService.getFunctions(connectionId),
      ]);

      return {
        schemas,
        tables,
        views,
        functions,
      };
    },
    enabled: !!connectionId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Hook for testing database connection
 * Delegates to the secure connection store's test functionality
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: async (config: {
      type: string;
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl_mode?: string;
    }) => {
      // Note: This should typically use the secure connection store
      // For now, we'll use the service directly but this may need refactoring
      const tempConnectionId = crypto.randomUUID();
      try {
        await secureDatabaseService.createConnectionById(tempConnectionId);
        const result = await secureDatabaseService.testConnection(
          tempConnectionId,
        );
        await secureDatabaseService.closeConnection(tempConnectionId);
        return result;
      } catch (error) {
        await secureDatabaseService.closeConnection(tempConnectionId);
        throw error;
      }
    },
    onSuccess: () => {
      console.log("Connection test successful");
    },
    onError: (error) => {
      console.error("Connection test failed:", error);
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
      type: string;
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl_mode?: string;
    }) => {
      const connectionId = crypto.randomUUID();
      await secureDatabaseService.createConnection(connectionId, {
        id: connectionId,
        name: `${config.host}:${config.port}`,
        type: config.type as DatabaseType,
        sslMode: config.ssl_mode,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return {
        connection_id: connectionId,
        database_type: config.type,
        server_version: "unknown", // TODO: Get from backend
      };
    },
    onSuccess: (data) => {
      // Preload basic schema information
      queryClient.prefetchQuery({
        queryKey: ["databases", data.connection_id],
        queryFn: () => secureDatabaseService.getDatabases(data.connection_id),
        staleTime: 10 * 60 * 1000,
      });

      console.log("Connected to database:", data);
    },
    onError: (error) => {
      console.error("Failed to connect to database:", error);
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
      await secureDatabaseService.closeConnection(connectionId);
      return connectionId;
    },
    onSuccess: (connectionId) => {
      // Clear all cached data for this connection
      cacheService.invalidateConnection(connectionId);

      // Remove all queries related to this connection
      queryClient.removeQueries({
        queryKey: ["databases", connectionId],
      });
      queryClient.removeQueries({
        queryKey: ["schemas", connectionId],
      });
      queryClient.removeQueries({
        queryKey: ["table", connectionId],
      });
      queryClient.removeQueries({
        queryKey: ["query", connectionId],
      });
      queryClient.removeQueries({
        queryKey: ["columns", connectionId],
      });

      console.log("Disconnected from database:", connectionId);
    },
    onError: (error) => {
      console.error("Failed to disconnect from database:", error);
    },
  });
}

/**
 * Hook for getting database server information
 */
export function useDatabaseInfo(connectionId: string | null) {
  const { getActualConnectionId } = useSecureConnectionStore();

  return useQuery({
    queryKey: ["database-info", connectionId],
    queryFn: async () => {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      // Get the actual backend connection ID (includes workspace isolation)
      const actualConnectionId = getActualConnectionId(connectionId);

      // Server version info is not currently available in the new architecture
      // Return basic connection status instead
      const isConnected = await secureDatabaseService.testConnection(
        actualConnectionId,
      );

      return {
        version: "unknown", // TODO: Implement server version in backend
        connected: isConnected,
      };
    },
    enabled: !!connectionId,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
  });
}

/**
 * Hook for executing database maintenance operations
 */
export function useDatabaseMaintenance(connectionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      operation,
      params: _params,
    }: {
      operation: "analyze" | "vacuum" | "reindex";
      params?: Record<string, any>;
    }) => {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      // Database maintenance operations are not currently supported in the new architecture
      // Execute SQL commands directly instead
      let sql = "";
      switch (operation) {
        case "analyze":
          sql = "ANALYZE";
          break;
        case "vacuum":
          sql = "VACUUM";
          break;
        case "reindex":
          sql = "REINDEX DATABASE CURRENT";
          break;
        default:
          throw new Error(`Unsupported maintenance operation: ${operation}`);
      }

      const result = await secureDatabaseService.executeStatement(
        connectionId,
        sql,
      );
      return { rows_affected: result };
    },
    onSuccess: (_, variables) => {
      console.log(`Database ${variables.operation} completed`);

      // Invalidate relevant caches after maintenance
      if (connectionId) {
        if (variables.operation === "analyze") {
          // Invalidate table statistics
          queryClient.invalidateQueries({
            queryKey: ["row-count", connectionId],
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
          throw new Error("Connection ID is required");
        }

        // Use direct SQL execution for transaction commands
        await secureDatabaseService.executeStatement(connectionId, "BEGIN");
        return crypto.randomUUID(); // Return a dummy transaction ID
      },
    }),

    commit: useMutation({
      mutationFn: async (_transactionId: string) => {
        if (!connectionId) {
          throw new Error("Connection ID is required");
        }

        await secureDatabaseService.executeStatement(connectionId, "COMMIT");
      },
      onSuccess: () => {
        // Invalidate all cached data as transaction changes are committed
        if (connectionId) {
          cacheService.invalidateConnection(connectionId);
        }
      },
    }),

    rollback: useMutation({
      mutationFn: async (_transactionId: string) => {
        if (!connectionId) {
          throw new Error("Connection ID is required");
        }

        await secureDatabaseService.executeStatement(connectionId, "ROLLBACK");
      },
    }),
  };
}
