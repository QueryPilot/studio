import { create } from "zustand";

interface ConnectionConfig {
  id: string;
  name: string;
  type: "postgresql" | "mysql" | "sqlite" | "mongodb";
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  filePath?: string; // For SQLite
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
  
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (connectionId: string) => void;
  connect: (connectionId: string) => Promise<void>;
  disconnect: (connectionId: string) => void;
  setActiveConnection: (connectionId: string) => void;
  executeQuery: (query: string) => Promise<QueryResult>;
  setQueryProgress: (progress: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: new Map(),
  activeConnectionId: null,
  isExecuting: false,
  queryProgress: 0,
  
  addConnection: (config) =>
    set((state) => {
      const newConnections = new Map(state.connections);
      newConnections.set(config.id, {
        config,
        status: "disconnected",
      });
      return { connections: newConnections };
    }),
    
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
    set((state) => {
      const newConnections = new Map(state.connections);
      const connection = newConnections.get(connectionId);
      if (connection) {
        connection.status = "connecting";
        connection.error = undefined;
      }
      return { connections: newConnections };
    });
    
    // Simulate connection (replace with actual Tauri command)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    set((state) => {
      const newConnections = new Map(state.connections);
      const connection = newConnections.get(connectionId);
      if (connection) {
        connection.status = "connected";
      }
      return { connections: newConnections };
    });
  },
  
  disconnect: (connectionId) =>
    set((state) => {
      const newConnections = new Map(state.connections);
      const connection = newConnections.get(connectionId);
      if (connection) {
        connection.status = "disconnected";
      }
      return { connections: newConnections };
    }),
    
  setActiveConnection: (connectionId) =>
    set({ activeConnectionId: connectionId }),
    
  executeQuery: async (_query) => {
    set({ isExecuting: true, queryProgress: 0 });
    
    // Simulate query execution with progress
    const progressInterval = setInterval(() => {
      set((state) => ({
        queryProgress: Math.min(state.queryProgress + 10, 90),
      }));
    }, 100);
    
    // Simulate query execution (replace with actual Tauri command)
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    clearInterval(progressInterval);
    set({ isExecuting: false, queryProgress: 100 });
    
    // Mock result
    return {
      columns: ["id", "name", "email", "created_at"],
      rows: [
        {
          id: 1,
          name: "John Doe",
          email: "john@example.com",
          created_at: "2024-01-15",
        },
        {
          id: 2,
          name: "Jane Smith",
          email: "jane@example.com",
          created_at: "2024-01-16",
        },
      ],
      rowCount: 2,
      executionTime: 234,
    };
  },
  
  setQueryProgress: (progress) => set({ queryProgress: progress }),
}));