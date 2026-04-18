import { logger } from "@/lib/logger";
import { create } from "zustand";
import { vaultStorage } from "@/services/vaultStorage";
import { invoke } from "@tauri-apps/api/core";
import {
  type StoredConnection,
  type ConnectionProfile,
  DbType,
} from "@/types/connection";

// Track inflight fetch to deduplicate concurrent calls
let inflightFetch: Promise<void> | null = null;

const schemaUpdateInFlight = new Set<string>();

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
  setVisibleSchemas: (
    connectionId: string,
    databaseName: string,
    visibleSchemas: string[],
  ) => Promise<void>;
  getVisibleSchemas: (connectionId: string, databaseName: string) => string[];
  getPrimarySchema: (connectionId: string, databaseName: string) => string;

  // Search
  searchConnections: (query: string) => StoredConnection[];

  // Getters
  getConnection: (id: string) => StoredConnection | undefined;
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

  // Fetch all connections from backend (deduplicated)
  fetchConnections: async () => {
    // Return existing fetch if one is in progress
    if (inflightFetch) {
      return inflightFetch;
    }

    set({ loading: true, error: null });

    inflightFetch = (async () => {
      try {
        const connections = await vaultStorage.listConnections();
        set({ connections, loading: false });
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Failed to fetch connections";
        set({ error, loading: false });
        throw new Error(error);
      } finally {
        inflightFetch = null;
      }
    })();

    return inflightFetch;
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

  // Set visible schemas for a database within a connection
  setVisibleSchemas: async (
    connectionId: string,
    databaseName: string,
    visibleSchemas: string[],
  ) => {
    if (visibleSchemas.length === 0) {
      const conn = get().getConnection(connectionId);
      const dbType = conn?.profile.db_type;
      if (dbType !== DbType.Trino) {
        throw new Error("visibleSchemas must be non-empty");
      }
    }

    const lockKey = `${connectionId}::${databaseName}`;
    if (schemaUpdateInFlight.has(lockKey)) {
      throw new Error("Schema update already in progress");
    }
    schemaUpdateInFlight.add(lockKey);

    try {
      const conn = get().getConnection(connectionId);
      if (!conn) throw new Error("Connection not found");

      const prevDatabases = conn.profile.databases;
      const nextDatabases = (() => {
        const idx = prevDatabases.findIndex((d) => d.name === databaseName);
        if (idx === -1) {
          return [...prevDatabases, { name: databaseName, visible_schemas: visibleSchemas }];
        }
        const clone = [...prevDatabases];
        clone[idx] = { ...clone[idx]!, visible_schemas: visibleSchemas };
        return clone;
      })();

      const nextProfile = { ...conn.profile, databases: nextDatabases };

      // Optimistic in-memory update.
      set((state) => ({
        connections: state.connections.map((c) =>
          c.profile.id === connectionId ? { ...c, profile: nextProfile } : c,
        ),
      }));

      try {
        await vaultStorage.updateConnection(connectionId, nextProfile);
        await invoke("update_connection_schemas", {
          connId: connectionId,
          databaseName,
          visibleSchemas,
        });
      } catch (err) {
        // Rollback on either failure.
        const revert = { ...conn.profile, databases: prevDatabases };
        set((state) => ({
          connections: state.connections.map((c) =>
            c.profile.id === connectionId ? { ...c, profile: revert } : c,
          ),
        }));
        // Attempt to roll back the vault update — best effort.
        try { await vaultStorage.updateConnection(connectionId, revert); } catch (rollbackErr) { console.error("[connectionStore] Vault rollback failed:", rollbackErr); }
        throw err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      schemaUpdateInFlight.delete(lockKey);
    }
  },

  // Get visible schemas for a database within a connection
  getVisibleSchemas: (connectionId: string, databaseName: string) => {
    const conn = get().getConnection(connectionId);
    if (!conn) return [];
    const entry = conn.profile.databases.find((d) => d.name === databaseName);
    return entry?.visible_schemas ?? [];
  },

  // Get the primary (first) visible schema for a database
  getPrimarySchema: (connectionId: string, databaseName: string) => {
    const schemas = get().getVisibleSchemas(connectionId, databaseName);
    return schemas[0] ?? "";
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
      default_schema: undefined, // Clear so it derives from new database
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
