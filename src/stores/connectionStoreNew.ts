import { create } from "zustand";
import { strongholdStorage } from "@/services/vaultStorage";
import {
  type StoredConnection,
  type ConnectionProfile,
} from "@/types/connection";

interface ConnectionStore {
  // State
  connections: StoredConnection[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchConnections: () => Promise<void>;
  saveConnection: (
    profile: ConnectionProfile,
    tags?: string[],
  ) => Promise<string>;
  updateConnection: (
    id: string,
    profile: ConnectionProfile,
    tags?: string[],
  ) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;

  // Metadata operations
  toggleFavorite: (id: string) => Promise<boolean>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
  markAsUsed: (id: string) => Promise<void>;

  // Search
  searchConnections: (query: string) => StoredConnection[];

  // Getters
  getConnection: (id: string) => StoredConnection | undefined;
  getFavoriteConnections: () => StoredConnection[];
  getRecentConnections: (limit?: number) => StoredConnection[];
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  // Initial state
  connections: [],
  loading: false,
  error: null,

  // Fetch all connections from backend
  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await strongholdStorage.listConnections();
      set({ connections, loading: false });
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to fetch connections";
      set({ error, loading: false });
      throw new Error(error);
    }
  },

  // Save new connection
  saveConnection: async (profile: ConnectionProfile, tags?: string[]) => {
    set({ error: null });
    try {
      const id = await strongholdStorage.storeConnection({ ...profile });

      if (tags?.length) {
        const uniqueTags = Array.from(
          new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
        );
        if (uniqueTags.length > 0) {
          await strongholdStorage.updateTags(id, uniqueTags);
        }
      }

      await get().fetchConnections();
      return id;
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to save connection";
      set({ error });
      throw new Error(error);
    }
  },

  // Update existing connection
  updateConnection: async (
    id: string,
    profile: ConnectionProfile,
    tags?: string[],
  ) => {
    set({ error: null });
    try {
      await strongholdStorage.updateConnection(id, { ...profile });

      if (tags) {
        const uniqueTags = Array.from(
          new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
        );
        await strongholdStorage.updateTags(id, uniqueTags);
      }

      await get().fetchConnections();
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to update connection";
      set({ error });
      throw new Error(error);
    }
  },

  // Delete connection
  deleteConnection: async (id: string) => {
    set({ error: null });
    try {
      await strongholdStorage.deleteConnection(id);
      await get().fetchConnections();
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to delete connection";
      set({ error });
      throw new Error(error);
    }
  },

  // Toggle favorite status
  toggleFavorite: async (id: string) => {
    try {
      const isFavorite = await strongholdStorage.toggleFavorite(id);
      await get().fetchConnections();
      return isFavorite;
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to toggle favorite";
      set({ error });
      throw new Error(error);
    }
  },

  // Add tag to connection
  addTag: async (id: string, tag: string) => {
    try {
      const connection = get().getConnection(id);
      if (!connection) {
        throw new Error("Connection not found");
      }

      const tags = new Set(connection.metadata.tags);
      tags.add(tag.trim());
      await strongholdStorage.updateTags(id, Array.from(tags).filter(Boolean));
      await get().fetchConnections();
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to add tag";
      set({ error });
      throw new Error(error);
    }
  },

  // Remove tag from connection
  removeTag: async (id: string, tag: string) => {
    try {
      const connection = get().getConnection(id);
      if (!connection) {
        throw new Error("Connection not found");
      }

      const tags = connection.metadata.tags.filter(
        (existingTag) => existingTag !== tag,
      );
      await strongholdStorage.updateTags(id, tags);
      await get().fetchConnections();
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to remove tag";
      set({ error });
      throw new Error(error);
    }
  },

  // Mark connection as used
  markAsUsed: async (id: string) => {
    try {
      await strongholdStorage.markAsUsed(id);
      await get().fetchConnections();
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to mark as used";
      set({ error });
      throw new Error(error);
    }
  },

  // Search connections locally
  searchConnections: (query: string) => {
    const connections = get().connections;
    const queryLower = query.toLowerCase();

    return connections.filter(
      (conn) =>
        conn.profile.name.toLowerCase().includes(queryLower) ||
        conn.profile.host.toLowerCase().includes(queryLower) ||
        conn.profile.database.toLowerCase().includes(queryLower) ||
        conn.metadata.tags.some((tag) =>
          tag.toLowerCase().includes(queryLower),
        ),
    );
  },

  // Get single connection
  getConnection: (id: string) => {
    return get().connections.find((conn) => conn.profile.id === id);
  },

  // Get favorite connections
  getFavoriteConnections: () => {
    return get().connections.filter((conn) => conn.metadata.is_favorite);
  },

  // Get recent connections
  getRecentConnections: (limit = 10) => {
    const connections = [...get().connections];

    // Sort by last_used (most recent first)
    connections.sort((a, b) => {
      if (!a.metadata.last_used) return 1;
      if (!b.metadata.last_used) return -1;
      return (
        new Date(b.metadata.last_used).getTime() -
        new Date(a.metadata.last_used).getTime()
      );
    });

    return connections.slice(0, limit);
  },
}));
