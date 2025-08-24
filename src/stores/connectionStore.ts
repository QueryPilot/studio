import { create } from "zustand";
import { type DatabaseConnection } from "@/types/database";
import {
  defaultConnections,
  createConnectionFromDefault,
  isDuplicateConnection,
} from "@/data/defaultConnections";
import { secureConnectionService } from "@/services/secureConnectionService";
import { clearAllService } from "@/services/clearAllService";

interface ConnectionStore {
  // State (temporary cache, not persisted)
  connections: DatabaseConnection[];
  activeConnectionId: string | null;
  isLoading: boolean;

  // Actions - all interact with backend
  addConnection: (
    connection: Omit<DatabaseConnection, "id" | "createdAt" | "updatedAt">,
  ) => Promise<string>;
  updateConnection: (
    id: string,
    updates: Partial<DatabaseConnection>,
  ) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setActiveConnection: (id: string | null) => void;

  // Load connections from backend
  loadConnections: () => Promise<void>;
  loadDefaultConnections: () => Promise<{ added: number; skipped: number }>;
  clearAllConnections: () => Promise<void>;

  // Getters
  getConnection: (id: string) => DatabaseConnection | undefined;
  getConnectionsByWorkspace: (workspace: string) => DatabaseConnection[];
  getWorkspaces: () => string[];
  getActiveConnection: () => DatabaseConnection | null;
}

export const useConnectionStore = create<ConnectionStore>()((set, get) => ({
  // Initial state
  connections: [],
  activeConnectionId: null,
  isLoading: false,

  // Actions
  addConnection: async (connectionData) => {
    const id = crypto.randomUUID();
    const now = new Date();

    const connection: DatabaseConnection = {
      ...connectionData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    // Save to backend first
    await secureConnectionService.saveConnection(connection);

    // Reload connections from backend to ensure consistency
    await get().loadConnections();

    return id;
  },

  updateConnection: async (id, updates) => {
    // Find the connection
    const connection = get().connections.find((c) => c.id === id);
    if (!connection) return;

    // Create updated connection
    const updatedConnection = {
      ...connection,
      ...updates,
      updatedAt: new Date(),
    };

    // Save to backend
    await secureConnectionService.saveConnection(updatedConnection);

    // Reload from backend
    await get().loadConnections();
  },

  removeConnection: async (id) => {
    // Delete from backend
    await secureConnectionService.deleteConnection(id);

    // Update local state
    set((state) => ({
      connections: state.connections.filter((conn) => conn.id !== id),
      activeConnectionId:
        state.activeConnectionId === id ? null : state.activeConnectionId,
    }));
  },

  setActiveConnection: (id) => {
    set({ activeConnectionId: id });
  },

  loadConnections: async () => {
    set({ isLoading: true });
    try {
      // Load all connections from backend
      const connections = await secureConnectionService.getAllConnections();
      set({
        connections,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load connections:", error);
      set({ isLoading: false });
    }
  },

  loadDefaultConnections: async () => {
    let added = 0;
    let skipped = 0;

    try {
      // Get current connections from backend
      const backendConnections =
        await secureConnectionService.getAllConnections();

      const newConnections: DatabaseConnection[] = [];

      for (const defaultConn of defaultConnections) {
        // Check for duplicates in backend
        const isDuplicate = backendConnections.some((existing) =>
          isDuplicateConnection(existing, defaultConn),
        );

        if (isDuplicate) {
          skipped++;
        } else {
          const connectionData = createConnectionFromDefault(defaultConn);
          const id = crypto.randomUUID();
          const now = new Date();

          const connection: DatabaseConnection = {
            ...connectionData,
            id,
            createdAt: now,
            updatedAt: now,
          };

          newConnections.push(connection);
          added++;
        }
      }

      if (newConnections.length > 0) {
        // Save all new connections to backend
        await secureConnectionService.saveConnections(newConnections);

        // Reload from backend to update local cache
        await get().loadConnections();
      }
    } catch (error) {
      console.error("Failed to load default connections:", error);
      throw error;
    }

    return { added, skipped };
  },

  clearAllConnections: async () => {
    try {
      // Clear all connections from backend
      await clearAllService.clearConnections();

      // Clear local state
      set({
        connections: [],
        activeConnectionId: null,
      });
    } catch (error) {
      console.error("Failed to clear all connections:", error);
      throw error;
    }
  },

  // Getters
  getConnection: (id) => {
    return get().connections.find((conn) => conn.id === id);
  },

  getConnectionsByWorkspace: (workspace) => {
    return get().connections.filter((conn) => conn.workspace === workspace);
  },

  getWorkspaces: () => {
    const connections = get().connections;
    const workspaces = new Set(
      connections.map((conn) => conn.workspace as string),
    );
    return Array.from(workspaces).sort();
  },

  getActiveConnection: () => {
    const state = get();
    if (!state.activeConnectionId) return null;
    return (
      state.connections.find((conn) => conn.id === state.activeConnectionId) ||
      null
    );
  },
}));
