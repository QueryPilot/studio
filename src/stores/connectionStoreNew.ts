import { logger } from "@/lib/logger";
import { create } from "zustand";
import { vaultStorage } from "@/services/vaultStorage";
import {
  type StoredConnection,
  type ConnectionProfile,
} from "@/types/connection";

interface ConnectionStore {
  // State
  connections: StoredConnection[];
  loading: boolean;
  error: string | null;
  activeConnectionId: string | null;

  // Actions
  fetchConnections: () => Promise<void>;
  setActiveConnection: (id: string | null) => void;
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
  getActiveConnection: () => { id: string } | null;
  getFavoriteConnections: () => StoredConnection[];
  getRecentConnections: (limit?: number) => StoredConnection[];

  // Connection cloning for database switching
  getOrCreateDatabaseConnection: (
    sourceId: string,
    database: string,
  ) => Promise<string>;
  findConnectionByDatabase: (
    host: string,
    port: number,
    database: string,
    username: string,
  ) => StoredConnection | undefined;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  // Initial state
  connections: [],
  loading: false,
  error: null,
  activeConnectionId: null,

  // Fetch all connections from backend
  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await vaultStorage.listConnections();
      set({ connections, loading: false });
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "Failed to fetch connections";
      set({ error, loading: false });
      throw new Error(error);
    }
  },

  // Set active connection (compatibility shim)
  setActiveConnection: (id: string | null) => {
    set({ activeConnectionId: id });
  },

  // Save new connection
  saveConnection: async (profile: ConnectionProfile, tags?: string[]) => {
    set({ error: null });
    try {
      const id = await vaultStorage.storeConnection({ ...profile });

      const uniqueTags = tags?.length
        ? Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
        : [];

      if (uniqueTags.length > 0) {
        await vaultStorage.updateTags(id, uniqueTags);
      }

      // Update local state directly - no need to refetch all connections
      const newConnection: StoredConnection = {
        profile: { ...profile, id },
        metadata: {
          created_at: new Date().toISOString(),
          last_used: null,
          use_count: 0,
          tags: uniqueTags,
          is_favorite: false,
        },
      };
      set((state) => ({ connections: [...state.connections, newConnection] }));
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
      await vaultStorage.updateConnection(id, { ...profile });

      const uniqueTags = tags
        ? Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
        : undefined;

      if (uniqueTags) {
        await vaultStorage.updateTags(id, uniqueTags);
      }

      // Update local state directly - no need to refetch all connections
      set((state) => ({
        connections: state.connections.map((conn) =>
          conn.profile.id === id
            ? {
                ...conn,
                profile: { ...profile, id },
                metadata: uniqueTags
                  ? { ...conn.metadata, tags: uniqueTags }
                  : conn.metadata,
              }
            : conn,
        ),
      }));
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
      await vaultStorage.deleteConnection(id);
      // Update local state directly - no need to refetch all connections
      set((state) => ({
        connections: state.connections.filter((conn) => conn.profile.id !== id),
      }));
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
      const isFavorite = await vaultStorage.toggleFavorite(id);
      // Update local state directly - no need to refetch all connections
      set((state) => ({
        connections: state.connections.map((conn) =>
          conn.profile.id === id
            ? { ...conn, metadata: { ...conn.metadata, is_favorite: isFavorite } }
            : conn,
        ),
      }));
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

      const trimmedTag = tag.trim();
      if (!trimmedTag) return;

      const newTags = [...new Set([...connection.metadata.tags, trimmedTag])];
      await vaultStorage.updateTags(id, newTags);
      // Update local state directly - no need to refetch all connections
      set((state) => ({
        connections: state.connections.map((conn) =>
          conn.profile.id === id
            ? { ...conn, metadata: { ...conn.metadata, tags: newTags } }
            : conn,
        ),
      }));
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

      const newTags = connection.metadata.tags.filter(
        (existingTag) => existingTag !== tag,
      );
      await vaultStorage.updateTags(id, newTags);
      // Update local state directly - no need to refetch all connections
      set((state) => ({
        connections: state.connections.map((conn) =>
          conn.profile.id === id
            ? { ...conn, metadata: { ...conn.metadata, tags: newTags } }
            : conn,
        ),
      }));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to remove tag";
      set({ error });
      throw new Error(error);
    }
  },

  // Mark connection as used
  markAsUsed: async (id: string) => {
    try {
      await vaultStorage.markAsUsed(id);
      // Update local state directly - no need to refetch all connections
      const now = new Date().toISOString();
      set((state) => ({
        connections: state.connections.map((conn) =>
          conn.profile.id === id
            ? {
                ...conn,
                metadata: {
                  ...conn.metadata,
                  last_used: now,
                  use_count: conn.metadata.use_count + 1,
                },
              }
            : conn,
        ),
      }));
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

  // Get active connection info (compatibility shim returning only id)
  getActiveConnection: () => {
    const id = get().activeConnectionId;
    return id ? { id } : null;
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

  // Find connection by database credentials
  findConnectionByDatabase: (host, port, database, username) => {
    return get().connections.find(
      (conn) =>
        conn.profile.host === host &&
        conn.profile.port === port &&
        conn.profile.database === database &&
        conn.profile.username === username,
    );
  },

  // Get or create a connection for a specific database (clone if needed)
  getOrCreateDatabaseConnection: async (sourceId, database) => {
    const source = get().getConnection(sourceId);
    if (!source) {
      throw new Error(`Source connection ${sourceId} not found`);
    }

    // Check if a connection for this database already exists
    const existing = get().findConnectionByDatabase(
      source.profile.host,
      source.profile.port,
      database,
      source.profile.username,
    );

    if (existing) {
      logger.info(
        `[ConnectionStore] Found existing connection for database ${database}: ${existing.profile.id}`,
      );
      return existing.profile.id;
    }

    // Clone the source profile with new database
    const groupName =
      source.profile.group || `${source.profile.host}:${source.profile.port}`;

    const newProfile: ConnectionProfile = {
      ...source.profile,
      id: crypto.randomUUID(),
      name: database, // Use database name as connection name
      database: database,
      group: groupName,
    };

    logger.info(
      `[ConnectionStore] Cloning connection for database ${database}, group: ${groupName}`,
    );

    // Save the new connection
    const newId = await get().saveConnection(newProfile);

    // Don't update the source connection to avoid triggering workspace reload
    // The source will be updated to the group on next app restart or when
    // the user manually edits it

    return newId;
  },
}));
