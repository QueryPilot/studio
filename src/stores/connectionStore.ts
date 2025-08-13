import { create } from "zustand";
import { persist } from "zustand/middleware";
import { databaseService } from "@/services/database";
import { encryptCredentials, decryptCredentials } from "@/lib/encryption";

interface ConnectionConfig {
  id: string;
  name: string;
  type: "postgresql" | "mysql" | "sqlite" | "mongodb";
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string; // This will be encrypted when stored
  ssl?: boolean;
  filePath?: string; // For SQLite
  workspaceId?: string; // Which workspace this connection belongs to
}

interface Connection {
  config: ConnectionConfig;
  status: "connected" | "connecting" | "disconnected" | "error";
  error?: string;
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
  
  addConnection: (config: ConnectionConfig) => Promise<void>;
  updateConnection: (connectionId: string, config: ConnectionConfig) => Promise<void>;
  removeConnection: (connectionId: string) => void;
  connect: (connectionId: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setActiveConnection: (connectionId: string) => void;
  executeQuery: (query: string) => Promise<QueryResult>;
  setQueryProgress: (progress: number) => void;
  testConnection: (config: ConnectionConfig) => Promise<boolean>;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
  connections: new Map(),
  activeConnectionId: null,
  isExecuting: false,
  queryProgress: 0,
  
  addConnection: async (config) => {
    // Encrypt password if present
    if (config.password) {
      config.password = await encryptCredentials(config.password);
    }
    
    set((state) => {
      const newConnections = new Map(state.connections);
      newConnections.set(config.id, {
        config,
        status: "disconnected",
      });
      return { connections: newConnections };
    });
  },
  
  updateConnection: async (connectionId, config) => {
    // Encrypt password if present
    if (config.password) {
      config.password = await encryptCredentials(config.password);
    }
    
    set((state) => {
      const newConnections = new Map(state.connections);
      const existingConnection = newConnections.get(connectionId);
      if (existingConnection) {
        newConnections.set(connectionId, {
          ...existingConnection,
          config,
          status: "disconnected", // Reset status when config changes
        });
      }
      return { connections: newConnections };
    });
  },
    
  removeConnection: (connectionId) =>
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
    }),
    
  connect: async (connectionId) => {
    const connection = get().connections.get(connectionId);
    if (!connection) return;

    set((state) => {
      const newConnections = new Map(state.connections);
      const conn = newConnections.get(connectionId);
      if (conn) {
        conn.status = "connecting";
        conn.error = undefined;
      }
      return { connections: newConnections };
    });
    
    try {
      // Decrypt password before connecting
      const config = { ...connection.config };
      if (config.password) {
        config.password = await decryptCredentials(config.password);
      }
      
      // Use the database service to connect
      await databaseService.connect(config);
      
      set((state) => {
        const newConnections = new Map(state.connections);
        const conn = newConnections.get(connectionId);
        if (conn) {
          conn.status = "connected";
        }
        return { 
          connections: newConnections,
          activeConnectionId: connectionId 
        };
      });
    } catch (error) {
      set((state) => {
        const newConnections = new Map(state.connections);
        const conn = newConnections.get(connectionId);
        if (conn) {
          conn.status = "error";
          conn.error = error instanceof Error ? error.message : "Connection failed";
        }
        return { connections: newConnections };
      });
    }
  },
  
  disconnect: async (connectionId) => {
    try {
      // Use the database service to disconnect
      await databaseService.disconnect(connectionId);
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
      // Use the database service to execute query
      const result = await databaseService.executeQuery(
        connection.config,
        connection.config.database,
        query
      );
      
      set({ isExecuting: false, queryProgress: 100 });
      return result;
    } catch (error) {
      set({ isExecuting: false, queryProgress: 0 });
      throw error;
    }
  },
  
  setQueryProgress: (progress) => set({ queryProgress: progress }),
  
  testConnection: async (config) => {
    try {
      return await databaseService.testConnection(config);
    } catch (error) {
      console.error("Error testing connection:", error);
      return false;
    }
  },
    }),
    {
      name: "connection-storage",
      // Custom serialization to handle Map
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              connections: new Map(state.connections),
            },
          };
        },
        setItem: (name, value) => {
          const { state } = value as { state: ConnectionState };
          const serialized = {
            state: {
              ...state,
              connections: Array.from(state.connections.entries()),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);