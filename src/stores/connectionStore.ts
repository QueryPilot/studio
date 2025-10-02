import { create } from "zustand";
import { type DatabaseConnection } from "@/types/database";
import {
  defaultConnections,
  createConnectionFromDefault,
  isDuplicateConnection,
} from "@/data/defaultConnections";
import { secureConnectionService } from "@/services/secureConnectionService";
import { clearAllService } from "@/services/clearAllService";
import { connectionMetadataService } from "@/services/connectionMetadataService";

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
  loadPostgreSQLDev: () => Promise<{
    added: number;
    skipped: number;
    message: string;
  }>;
  loadDefaultConnections: () => Promise<{ added: number; skipped: number }>;
  clearAllConnections: () => Promise<void>;
  reorderConnections: (connections: DatabaseConnection[]) => Promise<void>;

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

    // Save metadata
    const currentConnections = get().connections;
    connectionMetadataService.saveMetadata(id, {
      order: connectionData.order ?? currentConnections.length,
      workspace: connectionData.workspace ?? "default",
      tags: connectionData.tags ?? [],
    });

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

    // Update metadata if needed
    if (
      updates.order !== undefined ||
      updates.workspace !== undefined ||
      updates.tags !== undefined
    ) {
      connectionMetadataService.saveMetadata(id, {
        order: updates.order ?? updatedConnection.order,
        workspace: updates.workspace ?? updatedConnection.workspace,
        tags: updates.tags ?? updatedConnection.tags,
      });
    }

    // Reload from backend
    await get().loadConnections();
  },

  removeConnection: async (id) => {
    // Delete from backend
    await secureConnectionService.deleteConnection(id);

    // Delete metadata
    connectionMetadataService.deleteMetadata(id);

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

      // Load metadata from local storage
      const allMetadata = connectionMetadataService.getAllMetadata();

      // Merge connections with metadata
      const mergedConnections = connections.map((conn, index) => {
        const metadata = allMetadata[conn.id];
        return {
          ...conn,
          order: metadata?.order ?? index,
          workspace: metadata?.workspace ?? conn.workspace ?? "default",
          tags: metadata?.tags ?? conn.tags ?? [],
        };
      });

      // Sort connections by order field
      const sortedConnections = mergedConnections.sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );

      set({
        connections: sortedConnections,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load connections:", error);
      set({ isLoading: false });
    }
  },

  loadPostgreSQLDev: async () => {
    try {
      // Get current connections from backend
      const backendConnections =
        await secureConnectionService.getAllConnections();

      // Get only PostgreSQL connection from defaults
      const pgConnection = defaultConnections[0]; // PostgreSQL is first in array
      if (!pgConnection) {
        throw new Error("PostgreSQL connection not found in defaults");
      }

      // Check if already exists
      const isDuplicate = backendConnections.some((existing) =>
        isDuplicateConnection(existing, pgConnection),
      );

      if (isDuplicate) {
        return {
          added: 0,
          skipped: 1,
          message: "PostgreSQL Dev connection already exists",
        };
      }

      // Create and save the connection
      const connectionData = createConnectionFromDefault(pgConnection);
      const id = crypto.randomUUID();
      const now = new Date();

      const connection: DatabaseConnection = {
        ...connectionData,
        id,
        createdAt: now,
        updatedAt: now,
      };

      // Save to backend using new API
      await secureConnectionService.saveConnection(connection);

      // Save metadata
      connectionMetadataService.saveMetadata(id, {
        order: backendConnections.length,
        workspace: connection.workspace ?? "Development",
        tags: connection.tags ?? [],
      });

      // Reload connections to update UI
      await get().loadConnections();

      return {
        added: 1,
        skipped: 0,
        message: "PostgreSQL Dev connection added successfully",
      };
    } catch (error) {
      console.error("Failed to load PostgreSQL Dev connection:", error);
      throw error;
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
      const newMetadata: Array<{
        id: string;
        order: number;
        workspace: string;
        tags: any[];
      }> = [];

      for (let i = 0; i < defaultConnections.length; i++) {
        const defaultConn = defaultConnections[i];
        if (!defaultConn) continue;

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
          newMetadata.push({
            id,
            order: backendConnections.length + added,
            workspace: connectionData.workspace ?? "default",
            tags: connectionData.tags ?? [],
          });
          added++;
        }
      }

      if (newConnections.length > 0) {
        // Save all new connections to backend
        await secureConnectionService.saveConnections(newConnections);

        // Save metadata for new connections
        newMetadata.forEach((meta) => {
          connectionMetadataService.saveMetadata(meta.id, meta);
        });

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

      // Clear all metadata
      connectionMetadataService.clearAll();

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
    const workspaces = new Set(connections.map((conn) => conn.workspace));
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

  reorderConnections: async (reorderedConnections) => {
    // Update order field for each connection
    const updatedConnections = reorderedConnections.map((conn, index) => ({
      ...conn,
      order: index,
      updatedAt: new Date(),
    }));

    // Save metadata with updated order for all connections
    const metadata = updatedConnections.map((conn) => ({
      id: conn.id,
      order: conn.order ?? 0,
      workspace: conn.workspace ?? "default",
      tags: conn.tags ?? [],
    }));

    connectionMetadataService.saveMultipleMetadata(metadata);

    // Update local state immediately for smooth UI
    set({ connections: updatedConnections });
  },
}));
