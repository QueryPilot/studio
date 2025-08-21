import { create } from "zustand";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { secureStorage, SecureConnectionConfig } from "@/services/secureStorage";
import { DatabaseConnection } from "@/types/database";

type ConnectionConfig = DatabaseConnection;

interface Connection {
  config: ConnectionConfig;
  status: "connected" | "connecting" | "disconnected" | "error";
  error?: string;
  actualConnectionId?: string; // The isolated connection ID returned from backend
}

interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  executionTime: number;
}

interface ConnectionState {
  connections: Map<string, Connection>;
  activeConnectionId: string | null;
  isExecuting: boolean;
  queryProgress: number;
  isLoading: boolean;
  
  // Actions
  loadConnections: () => Promise<void>;
  addConnection: (config: ConnectionConfig) => Promise<string>;
  updateConnection: (connectionId: string, config: ConnectionConfig) => Promise<void>;
  removeConnection: (connectionId: string) => Promise<void>;
  removeAllConnections: () => Promise<void>;
  connect: (connectionId: string, maxRetries?: number, workspaceId?: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setActiveConnection: (connectionId: string) => void;
  getDecryptedConfig: (connectionId: string) => Promise<ConnectionConfig>;
  executeQuery: (query: string) => Promise<QueryResult>;
  setQueryProgress: (progress: number) => void;
  getActualConnectionId: (connectionId: string) => string;
  testConnection: (config: ConnectionConfig) => Promise<boolean>;
}

/**
 * Secure Connection Store
 * All sensitive data is stored in the Rust backend with encryption
 * No localStorage or sessionStorage is used
 */
export const useSecureConnectionStore = create<ConnectionState>((set, get) => ({
  connections: new Map(),
  activeConnectionId: null,
  isExecuting: false,
  queryProgress: 0,
  isLoading: false,
  
  loadConnections: async () => {
    set({ isLoading: true });
    try {
      // Load all connections from secure storage
      const storedConnections = await secureStorage.listConnections();
      const connectionsMap = new Map<string, Connection>();
      
      for (const conn of storedConnections) {
        if (conn.id) {
          // Convert from secure storage format to our format
          const config: ConnectionConfig = {
            id: conn.id,
            name: conn.name,
            type: conn.connection_type as any,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            database: conn.database,
            createdAt: conn.created_at ? new Date(conn.created_at) : new Date(),
            updatedAt: conn.updated_at ? new Date(conn.updated_at) : new Date(),
            // Password is not included in list response for security
          };
          
          connectionsMap.set(conn.id, {
            config,
            status: "disconnected",
          });
        }
      }
      
      set({ connections: connectionsMap, isLoading: false });
    } catch (error) {
      console.error('Failed to load connections:', error);
      set({ isLoading: false });
    }
  },
  
  addConnection: async (config) => {
    try {
      // Store in secure backend
      const secureConfig: SecureConnectionConfig = {
        name: config.name,
        host: config.host || 'localhost',
        port: config.port || 5432,
        username: config.username || '',
        password: config.password,
        database: config.database || '',
        connection_type: config.type,
      };
      
      const connectionId = await secureStorage.storeConnection(secureConfig);
      
      // Update local state (without password)
      const safeConfig = { 
        ...config, 
        id: connectionId, 
        password: undefined,
        createdAt: config.createdAt || new Date(),
        updatedAt: new Date()
      };
      set((state) => {
        const newConnections = new Map(state.connections);
        newConnections.set(connectionId, {
          config: safeConfig,
          status: "disconnected",
        });
        return { connections: newConnections };
      });
      
      // Return the connection ID for the caller
      return connectionId;
    } catch (error) {
      console.error('Failed to add connection:', error);
      throw error;
    }
  },
  
  updateConnection: async (connectionId, config) => {
    try {
      // Update in secure backend
      const secureConfig: SecureConnectionConfig = {
        name: config.name,
        host: config.host || 'localhost',
        port: config.port || 5432,
        username: config.username || '',
        password: config.password,
        database: config.database || '',
        connection_type: config.type,
      };
      
      await secureStorage.updateConnection(connectionId, secureConfig);
      
      // Update local state (without password)
      const safeConfig = { 
        ...config, 
        id: connectionId, 
        password: undefined,
        createdAt: config.createdAt || new Date(),
        updatedAt: new Date()
      };
      set((state) => {
        const newConnections = new Map(state.connections);
        const existingConnection = newConnections.get(connectionId);
        if (existingConnection) {
          newConnections.set(connectionId, {
            ...existingConnection,
            config: safeConfig,
            status: "disconnected",
          });
        }
        return { connections: newConnections };
      });
    } catch (error) {
      console.error('Failed to update connection:', error);
      throw error;
    }
  },
    
  removeConnection: async (connectionId) => {
    try {
      // Delete from secure backend
      await secureStorage.deleteConnection(connectionId);
      
      // Update local state
      set((state) => {
        const newConnections = new Map(state.connections);
        newConnections.delete(connectionId);
        return {
          connections: newConnections,
          activeConnectionId:
            state.activeConnectionId === connectionId
              ? null
              : state.activeConnectionId,
        };
      });
    } catch (error) {
      console.error('Failed to remove connection:', error);
      throw error;
    }
  },
  
  removeAllConnections: async () => {
    try {
      console.log('[SecureConnectionStore] Removing all connections...');
      
      const state = get();
      const connectionIds = Array.from(state.connections.keys());
      
      // Close all active connections first
      for (const connectionId of connectionIds) {
        const connection = state.connections.get(connectionId);
        if (connection?.status === 'connected') {
          try {
            await secureDatabaseService.closeConnection(connectionId);
          } catch (error) {
            console.error(`Failed to close connection ${connectionId}:`, error);
          }
        }
      }
      
      // Delete all connections from secure storage
      for (const connectionId of connectionIds) {
        try {
          await secureStorage.deleteConnection(connectionId);
          console.log(`[SecureConnectionStore] Deleted connection: ${connectionId}`);
        } catch (error) {
          console.error(`Failed to delete connection ${connectionId}:`, error);
        }
      }
      
      // Clear local state
      set({
        connections: new Map(),
        activeConnectionId: null,
      });
      
      console.log(`[SecureConnectionStore] ✅ Removed ${connectionIds.length} connections`);
    } catch (error) {
      console.error('Failed to remove all connections:', error);
      throw error;
    }
  },
    
  connect: async (connectionId, maxRetries = 3, workspaceId) => {
    const connection = get().connections.get(connectionId);
    if (!connection) {
      console.error(`[SecureConnectionStore] Connection ${connectionId} not found`);
      return;
    }

    console.log(`[SecureConnectionStore] Starting connection for ${connectionId}`);
    
    set((state) => {
      const newConnections = new Map(state.connections);
      const conn = newConnections.get(connectionId);
      if (conn) {
        conn.status = "connecting";
        conn.error = undefined;
      }
      return { connections: newConnections };
    });
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[SecureConnectionStore] Connection attempt ${attempt}/${maxRetries} for ${connectionId}`);
        
        // Create connection with 30-second timeout
        const connectionPromise = (async () => {
          // Create connection using ID only - backend will fetch details from secure storage
          const actualConnectionId = await secureDatabaseService.createConnectionById(connectionId, workspaceId);
          
          // Test the connection using the actual connection ID returned from backend (includes workspace isolation)
          const isConnected = await secureDatabaseService.testConnection(actualConnectionId);
          
          if (!isConnected) {
            throw new Error("Connection test failed");
          }
          
          return actualConnectionId;
        })();

        // Apply 30-second timeout to the connection process
        const actualConnectionId = await Promise.race([
          connectionPromise,
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error("Connection timeout after 30 seconds")), 30000)
          )
        ]);
        
        console.log(`[SecureConnectionStore] Successfully connected ${connectionId} on attempt ${attempt} with actual ID: ${actualConnectionId}`);
        
        set((state) => {
          const newConnections = new Map(state.connections);
          const conn = newConnections.get(connectionId);
          if (conn) {
            conn.status = "connected";
            conn.error = undefined;
            conn.actualConnectionId = actualConnectionId; // Store the isolated connection ID
          }
          // Only update activeConnectionId if it's not already set to this connection
          // This preserves optimistic updates from the UI
          return { 
            connections: newConnections,
            ...(state.activeConnectionId !== connectionId && { activeConnectionId: connectionId })
          };
        });
        
        return; // Success - exit retry loop
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Connection failed");
        console.error(`[SecureConnectionStore] Connection attempt ${attempt}/${maxRetries} failed for ${connectionId}: –`, lastError.message);
        
        // Log more detailed error information
        if (error instanceof Error) {
          console.error(`[SecureConnectionStore] Error details:`, {
            name: error.name,
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines of stack
          });
        }
        
        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5 seconds
          console.log(`[SecureConnectionStore] Retrying connection in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    // All attempts failed - set error state
    const errorMessage = lastError?.message || "Connection failed after multiple attempts";
    console.error(`[SecureConnectionStore] All ${maxRetries} connection attempts failed for ${connectionId}: ${errorMessage}`);
    
    set((state) => {
      const newConnections = new Map(state.connections);
      const conn = newConnections.get(connectionId);
      if (conn) {
        conn.status = "error";
        conn.error = `Failed after ${maxRetries} attempts: ${errorMessage}`;
      }
      return { connections: newConnections };
    });
    
    throw new Error(`Connection failed after ${maxRetries} attempts: ${errorMessage}`);
  },
  
  disconnect: async (connectionId) => {
    try {
      // Get the actual connection ID (isolated) for backend operations
      const connection = get().connections.get(connectionId);
      const backendConnectionId = connection?.actualConnectionId || connectionId;
      
      await secureDatabaseService.closeConnection(backendConnectionId);
    } catch (error) {
      console.error("Error disconnecting:", error);
    }
    
    set((state) => {
      const newConnections = new Map(state.connections);
      const connection = newConnections.get(connectionId);
      if (connection) {
        connection.status = "disconnected";
      }
      return { 
        connections: newConnections,
        activeConnectionId: state.activeConnectionId === connectionId ? null : state.activeConnectionId
      };
    });
  },
    
  setActiveConnection: (connectionId) =>
    set({ activeConnectionId: connectionId }),
    
  getDecryptedConfig: async (connectionId: string) => {
    try {
      // Get full config with decrypted password from secure storage
      const fullConfig = await secureStorage.getConnection(connectionId);
      
      // Convert to our format
      const config: ConnectionConfig = {
        id: connectionId,
        name: fullConfig.name,
        type: fullConfig.connection_type as any,
        host: fullConfig.host,
        port: fullConfig.port,
        username: fullConfig.username,
        password: fullConfig.password,
        database: fullConfig.database || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      return config;
    } catch (error) {
      console.error('Failed to get decrypted config:', error);
      throw error;
    }
  },
    
  executeQuery: async (query) => {
    const activeConnectionId = get().activeConnectionId;
    if (!activeConnectionId) {
      throw new Error("No active connection");
    }
    
    const connection = get().connections.get(activeConnectionId);
    if (!connection || connection.status !== "connected") {
      throw new Error("Connection not available");
    }
    
    set({ isExecuting: true, queryProgress: 0 });
    
    try {
      // Get the actual connection ID (isolated) for backend operations
      const connection = get().connections.get(activeConnectionId);
      const backendConnectionId = connection?.actualConnectionId || activeConnectionId;
      
      // Execute query through secure backend service
      const result = await secureDatabaseService.executeQuery(backendConnectionId, query);
      
      set({ isExecuting: false, queryProgress: 100 });
      return result;
    } catch (error) {
      set({ isExecuting: false, queryProgress: 0 });
      throw error;
    }
  },
  
  setQueryProgress: (progress) => set({ queryProgress: progress }),
  
  // Helper method to get the actual backend connection ID (isolated ID)
  getActualConnectionId: (connectionId: string) => {
    const connection = get().connections.get(connectionId);
    return connection?.actualConnectionId || connectionId;
  },
  
  testConnection: async (config) => {
    let tempId: string | null = null;
    let connectionCreated = false;
    
    try {
      // For test connections, we need to temporarily store the config in secure storage
      // Create a proper UUID for the test connection
      tempId = crypto.randomUUID();
      console.log(`[TestConnection] Starting test with ID: ${tempId}`);
      
      // Temporarily store the connection config with password in secure storage
      const secureConfig: SecureConnectionConfig = {
        name: `TEST_${config.name}`,  // Prefix to identify test connections
        host: config.host || 'localhost',
        port: config.port || 5432,
        username: config.username || '',
        password: config.password,
        database: config.database || '',
        connection_type: config.type,
      };
      
      // Store temporarily in secure storage
      await secureStorage.storeConnection(secureConfig, tempId);
      console.log(`[TestConnection] Stored test connection in secure storage`);
      
      try {
        // Create connection with 30-second timeout for test connections
        const testPromise = (async () => {
          // Create connection in backend (password will be fetched from secure storage)
          await secureDatabaseService.createConnection(tempId, config);
          connectionCreated = true;
          console.log(`[TestConnection] Created connection pool`);
          
          // Test the connection
          const result = await secureDatabaseService.testConnection(tempId);
          console.log(`[TestConnection] Test result: ${result}`);
          
          return result;
        })();

        // Apply 30-second timeout to the test connection process
        return await Promise.race([
          testPromise,
          new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error("Connection test timeout after 30 seconds")), 30000)
          )
        ]);
      } catch (error) {
        console.error(`[TestConnection] Test failed:`, error);
        throw error;
      } finally {
        // Always clean up, regardless of success or failure
        console.log(`[TestConnection] Starting cleanup for ${tempId}`);
        
        // First close the connection pool if it was created
        if (connectionCreated) {
          try {
            await secureDatabaseService.closeConnection(tempId);
            console.log(`[TestConnection] Closed connection pool`);
          } catch (closeError) {
            console.error(`[TestConnection] Failed to close connection:`, closeError);
          }
        }
        
        // Then delete from secure storage
        if (tempId) {
          try {
            await secureStorage.deleteConnection(tempId);
            console.log(`[TestConnection] Deleted from secure storage`);
          } catch (deleteError) {
            console.error(`[TestConnection] Failed to delete from storage:`, deleteError);
          }
        }
      }
    } catch (error) {
      console.error("Error in test connection setup:", error);
      return false;
    }
  },
}));