/**
 * Workspace Bundle Store
 *
 * Manages named multi-root workspaces that bundle multiple database connections.
 * Handles workspace CRUD, connection lifecycle, and persistence.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import { databaseService } from "@/services/databaseService";
import { vaultStorage } from "@/services/vaultStorage";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { refreshConnectionData } from "@/lib/refreshConnectionData";
import type {
  WorkspaceConfig,
  OpenConnection,
  ActiveWorkspace,
} from "@/types/workspace";
import { getDefaultSchema } from "@/types/connection";
import useWorkbenchStore from "@/stores/workbenchStore";

interface WorkspaceBundleStore {
  // ===== State =====

  /** Saved workspaces loaded from vault on app init */
  savedWorkspaces: WorkspaceConfig[];

  /** Currently active workspace (runtime state) */
  activeWorkspace: ActiveWorkspace | null;

  /** Dirty tracking - true if workspace has unsaved changes */
  isDirty: boolean;

  // ===== Actions - Workspace CRUD =====

  loadSavedWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, connectionIds: string[]) => Promise<string>;
  updateWorkspace: (
    id: string,
    updates: Partial<WorkspaceConfig>,
  ) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;

  // ===== Actions - Auto-Workspace Resolution =====

  /** Find or create an auto-workspace for a single connection */
  getOrCreateWorkspaceForConnection: (connectionId: string) => Promise<WorkspaceConfig>;

  // ===== Actions - Open/Close =====

  openWorkspace: (workspaceId: string) => Promise<void>;
  openSingleConnection: (
    connectionId: string,
    options?: { database?: string; schema?: string },
  ) => Promise<void>;
  closeWorkspace: () => Promise<void>;

  // ===== Actions - Connection Management =====

  addConnectionToWorkspace: (connectionId: string) => Promise<void>;
  removeConnectionFromWorkspace: (connectionId: string) => Promise<void>;
  reorderConnections: (orderedIds: string[]) => void;
  setFocusedConnection: (connectionId: string) => void;
  updateConnectionState: (
    connectionId: string,
    database: string,
    schema: string,
  ) => void;
  reconnectConnection: (connectionId: string) => Promise<void>;
  reconnectDisconnectedConnections: () => Promise<void>;

  // ===== Actions - Persistence =====

  saveCurrentWorkspace: () => Promise<void>;
  saveAsNewWorkspace: (name: string) => Promise<string>;

  // ===== Getters =====

  getFocusedConnection: () => OpenConnection | null;
  getConnectionById: (id: string) => OpenConnection | undefined;
  getTabsForConnection: (connectionId: string) => string[];
  getWindowTitle: () => string;

  // Workspace-Connection grouping helpers
  getWorkspacesForConnection: (connectionId: string) => WorkspaceConfig[];
  getConnectionsByWorkspace: () => Map<string, string[]>;
  getUncategorizedConnectionIds: () => string[];
  addConnectionToSavedWorkspace: (
    workspaceId: string,
    connectionId: string,
  ) => Promise<void>;
  removeConnectionFromSavedWorkspace: (
    workspaceId: string,
    connectionId: string,
  ) => Promise<void>;
}

export const useWorkspaceBundleStore = create<WorkspaceBundleStore>(
  (set, get) => ({
    // ===== Initial State =====
    savedWorkspaces: [],
    activeWorkspace: null,
    isDirty: false,

    // ===== Actions - Workspace CRUD =====

    loadSavedWorkspaces: async () => {
      logger.info("[WorkspaceBundleStore] Loading saved workspaces");
      const workspaces = await vaultStorage.listWorkspaces();
      set({ savedWorkspaces: workspaces });
      logger.info(
        `[WorkspaceBundleStore] Loaded ${workspaces.length} workspaces`,
      );
    },

    createWorkspace: async (name, connectionIds) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const config: WorkspaceConfig = {
        id,
        name,
        connectionIds,
        connectionStates: {},
        createdAt: now,
        updatedAt: now,
      };

      await vaultStorage.storeWorkspace(config);
      set((state) => ({
        savedWorkspaces: [...state.savedWorkspaces, config],
      }));

      logger.info(`[WorkspaceBundleStore] Created workspace: ${name} (${id})`);
      return id;
    },

    updateWorkspace: async (id, updates) => {
      await vaultStorage.updateWorkspace(id, updates);
      set((state) => {
        const updatedConfig = { ...updates, updatedAt: new Date().toISOString() };
        return {
          savedWorkspaces: state.savedWorkspaces.map((ws) =>
            ws.id === id ? { ...ws, ...updatedConfig } : ws,
          ),
          // Also sync to activeWorkspace if it matches
          activeWorkspace:
            state.activeWorkspace?.config.id === id
              ? {
                  ...state.activeWorkspace,
                  config: { ...state.activeWorkspace.config, ...updatedConfig },
                }
              : state.activeWorkspace,
        };
      });
    },

    deleteWorkspace: async (id) => {
      await vaultStorage.deleteWorkspace(id);
      set((state) => ({
        savedWorkspaces: state.savedWorkspaces.filter((ws) => ws.id !== id),
      }));
      logger.info(`[WorkspaceBundleStore] Deleted workspace: ${id}`);
    },

    // ===== Actions - Auto-Workspace Resolution =====

    getOrCreateWorkspaceForConnection: async (connectionId) => {
      const { savedWorkspaces } = get();

      // Check for existing auto-workspace for this connection
      const existing = savedWorkspaces.find(
        (ws) =>
          ws.autoCreated &&
          ws.connectionIds.length === 1 &&
          ws.connectionIds[0] === connectionId,
      );
      if (existing) return existing;

      // Create new auto-workspace
      const profile = useConnectionStore.getState().getConnection(connectionId);
      const now = new Date().toISOString();
      const config: WorkspaceConfig = {
        id: crypto.randomUUID(),
        name: profile?.profile.name ?? "Untitled",
        autoCreated: true,
        connectionIds: [connectionId],
        connectionStates: {},
        createdAt: now,
        updatedAt: now,
      };

      await vaultStorage.storeWorkspace(config);
      set((state) => ({
        savedWorkspaces: [...state.savedWorkspaces, config],
      }));

      logger.info(
        `[WorkspaceBundleStore] Created auto-workspace for connection: ${connectionId} (${config.id})`,
      );
      return config;
    },

    // ===== Actions - Open/Close =====

    openWorkspace: async (workspaceId) => {
      const { savedWorkspaces } = get();
      const config = savedWorkspaces.find((ws) => ws.id === workspaceId);

      if (!config) {
        logger.error(
          `[WorkspaceBundleStore] Workspace not found: ${workspaceId}`,
        );
        return;
      }

      logger.info(`[WorkspaceBundleStore] Opening workspace: ${config.name}`);

      // Create active workspace with empty connections map
      const activeWorkspace: ActiveWorkspace = {
        config,
        connections: new Map(),
        focusedConnectionId: null,
      };

      set({ activeWorkspace, isDirty: false });

      // Connect to each connection in the workspace
      const connectionStore = useConnectionStore.getState();

      // Filter out orphaned connection IDs (connections that no longer exist in the store)
      const validConnectionIds = config.connectionIds.filter((id) => {
        const exists = !!connectionStore.getConnection(id);
        if (!exists) {
          logger.warn(
            `[WorkspaceBundleStore] Removing orphaned connection from workspace: ${id}`,
          );
        }
        return exists;
      });

      // Update config if orphaned connections were found
      if (validConnectionIds.length !== config.connectionIds.length) {
        const cleanedConfig = {
          ...config,
          connectionIds: validConnectionIds,
        };
        set((s) => {
          if (!s.activeWorkspace) return s;
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              config: cleanedConfig,
            },
          };
        });
        // Persist the cleaned config
        void get().updateWorkspace(workspaceId, {
          connectionIds: validConnectionIds,
        });
      }

      for (const connectionId of validConnectionIds) {
        const stored = connectionStore.getConnection(connectionId);
        if (!stored) {
          logger.warn(
            `[WorkspaceBundleStore] Connection missing while opening workspace: ${connectionId}`,
          );
          continue;
        }

        const profile = stored.profile;
        const state = config.connectionStates[connectionId] || {
          database: profile.database,
          schema: profile.default_schema || getDefaultSchema(profile.db_type, profile.database) || "",
        };

        // Add connection with connecting status
        const openConnection: OpenConnection = {
          id: connectionId,
          profile,
          status: "connecting",
          database: state.database,
          schema: state.schema,
        };

        set((s) => {
          if (!s.activeWorkspace || s.activeWorkspace.config.id !== workspaceId) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          newConnections.set(connectionId, openConnection);
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
              focusedConnectionId:
                s.activeWorkspace.focusedConnectionId || connectionId,
            },
          };
        });

        // Attempt to connect
        try {
          await databaseService.connectById(connectionId);
          set((s) => {
            if (!s.activeWorkspace || s.activeWorkspace.config.id !== workspaceId) return s;
            const conn = s.activeWorkspace.connections.get(connectionId);
            if (!conn) return s;
            const newConnections = new Map(s.activeWorkspace.connections);
            newConnections.set(connectionId, { ...conn, status: "connected" });
            return {
              activeWorkspace: {
                ...s.activeWorkspace,
                connections: newConnections,
              },
            };
          });
        } catch (error) {
          logger.error(
            `[WorkspaceBundleStore] Failed to connect: ${connectionId}`,
            error,
          );
          set((s) => {
            if (!s.activeWorkspace || s.activeWorkspace.config.id !== workspaceId) return s;
            const conn = s.activeWorkspace.connections.get(connectionId);
            if (!conn) return s;
            const newConnections = new Map(s.activeWorkspace.connections);
            newConnections.set(connectionId, {
              ...conn,
              status: "error",
              error:
                error instanceof Error ? error.message : "Connection failed",
            });
            return {
              activeWorkspace: {
                ...s.activeWorkspace,
                connections: newConnections,
              },
            };
          });
        }
      }

      // Update last opened
      void get().updateWorkspace(workspaceId, {
        lastOpenedAt: new Date().toISOString(),
      });

      // Layout loading is handled by WorkbenchLayout component
    },

    openSingleConnection: async (connectionId, options) => {
      logger.info(
        `[WorkspaceBundleStore] Opening single connection: ${connectionId}`,
      );

      const connectionStore = useConnectionStore.getState();
      const stored = connectionStore.getConnection(connectionId);

      if (!stored) {
        logger.error(
          `[WorkspaceBundleStore] Connection not found: ${connectionId}`,
        );
        return;
      }

      const profile = stored.profile;

      // Use override options if provided, otherwise fall back to profile defaults
      const database = options?.database || profile.database;
      const schema = options?.schema || profile.default_schema || getDefaultSchema(profile.db_type, database) || "";

      // Get or create an auto-workspace for this connection (clone to avoid mutating store state)
      const originalConfig = await get().getOrCreateWorkspaceForConnection(connectionId);
      const config = {
        ...originalConfig,
        connectionStates: { ...originalConfig.connectionStates },
      };

      // Update connection state on the cloned config if options override defaults
      if (options?.database || options?.schema) {
        config.connectionStates[connectionId] = { database, schema };
      }

      const openConnection: OpenConnection = {
        id: connectionId,
        profile,
        status: "connecting",
        database,
        schema,
      };

      const connections = new Map<string, OpenConnection>();
      connections.set(connectionId, openConnection);

      const activeWorkspace: ActiveWorkspace = {
        config,
        connections,
        focusedConnectionId: connectionId,
      };

      set({ activeWorkspace, isDirty: false });

      // Layout loading is handled by WorkbenchLayout component

      // Connect (pass database override if provided)
      try {
        logger.info(`[WorkspaceBundleStore] Calling databaseService.connectById for ${connectionId}`);
        await databaseService.connectById(connectionId, options?.database);
        logger.info(`[WorkspaceBundleStore] databaseService.connectById returned successfully for ${connectionId}`);
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const conn = newConnections.get(connectionId);
          if (conn) {
            newConnections.set(connectionId, { ...conn, status: "connected" });
          }
          logger.info(`[WorkspaceBundleStore] Updated connection status to "connected" for ${connectionId}`);
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });
      } catch (error) {
        logger.error(
          `[WorkspaceBundleStore] Failed to connect: ${connectionId}`,
          error,
        );
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const conn = newConnections.get(connectionId);
          if (conn) {
            newConnections.set(connectionId, {
              ...conn,
              status: "error",
              error:
                error instanceof Error ? error.message : "Connection failed",
            });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });
      }
    },

    closeWorkspace: async () => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      logger.info(
        `[WorkspaceBundleStore] Closing workspace: ${activeWorkspace.config.name}`,
      );

      // Disconnect all connections
      for (const connectionId of activeWorkspace.connections.keys()) {
        try {
          await databaseService.disconnect(connectionId);
        } catch (error) {
          logger.warn(
            `[WorkspaceBundleStore] Failed to disconnect: ${connectionId}`,
            error,
          );
        }
      }

      set({ activeWorkspace: null, isDirty: false });
    },

    // ===== Actions - Connection Management =====

    addConnectionToWorkspace: async (connectionId) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      if (activeWorkspace.connections.has(connectionId) || activeWorkspace.config.connectionIds.includes(connectionId)) {
        logger.warn(
          `[WorkspaceBundleStore] Connection already in workspace: ${connectionId}`,
        );
        return;
      }

      const connectionStore = useConnectionStore.getState();
      const stored = connectionStore.getConnection(connectionId);

      if (!stored) {
        logger.error(
          `[WorkspaceBundleStore] Connection not found: ${connectionId}`,
        );
        return;
      }

      const profile = stored.profile;
      const openConnection: OpenConnection = {
        id: connectionId,
        profile,
        status: "connecting",
        database: profile.database,
        schema: profile.default_schema || getDefaultSchema(profile.db_type, profile.database) || "",
      };

      set((s) => {
        if (!s.activeWorkspace) return s;
        const newConnections = new Map(s.activeWorkspace.connections);
        newConnections.set(connectionId, openConnection);
        const newConfig = {
          ...s.activeWorkspace.config,
          connectionIds: [
            ...s.activeWorkspace.config.connectionIds,
            connectionId,
          ],
          connectionStates: {
            ...s.activeWorkspace.config.connectionStates,
            [connectionId]: {
              database: profile.database,
              schema: profile.default_schema || getDefaultSchema(profile.db_type, profile.database) || "",
            },
          },
        };
        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            config: newConfig,
            connections: newConnections,
            focusedConnectionId: connectionId, // Auto-focus new connection
          },
          isDirty: true,
        };
      });

      // Connect
      try {
        await databaseService.connectById(connectionId);
        
        // Fetch and store the database version for feature detection
        // This is important for SQLite to detect RENAME COLUMN, DROP COLUMN support
        await databaseService.testConnection(connectionId).catch((err: unknown) => {
          logger.warn(
            `[WorkspaceBundleStore] Failed to fetch version for ${connectionId}:`,
            err,
          );
        });
        
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const conn = newConnections.get(connectionId);
          if (conn) {
            newConnections.set(connectionId, { ...conn, status: "connected" });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });

        // Trigger sidebar data refresh for the new connection
        refreshConnectionData(openConnection);
      } catch (error) {
        logger.error(
          `[WorkspaceBundleStore] Failed to connect: ${connectionId}`,
          error,
        );
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const conn = newConnections.get(connectionId);
          if (conn) {
            newConnections.set(connectionId, {
              ...conn,
              status: "error",
              error:
                error instanceof Error ? error.message : "Connection failed",
            });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });
      }

      // When adding a second connection to an auto-workspace, promote it
      const updatedWorkspace = get().activeWorkspace;
      if (updatedWorkspace) {
        if (
          updatedWorkspace.config.autoCreated &&
          updatedWorkspace.config.connectionIds.length > 1
        ) {
          // Promote: no longer auto-created
          set((s) => {
            if (!s.activeWorkspace) return s;
            return {
              activeWorkspace: {
                ...s.activeWorkspace,
                config: {
                  ...s.activeWorkspace.config,
                  autoCreated: false,
                },
              },
            };
          });
        }
        // Auto-save the workspace after adding a connection
        await get().saveCurrentWorkspace();
      }
    },

    removeConnectionFromWorkspace: async (connectionId) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      // TODO: Check for open tabs and prompt user

      // Disconnect
      try {
        await databaseService.disconnect(connectionId);
      } catch (error) {
        logger.warn(
          `[WorkspaceBundleStore] Failed to disconnect: ${connectionId}`,
          error,
        );
      }

      set((s) => {
        if (!s.activeWorkspace) return s;
        const newConnections = new Map(s.activeWorkspace.connections);
        newConnections.delete(connectionId);

        const newConnectionIds = s.activeWorkspace.config.connectionIds.filter(
          (id) => id !== connectionId,
        );

        const { [connectionId]: _removed, ...newConnectionStates } =
          s.activeWorkspace.config.connectionStates;
        void _removed; // Explicitly ignore the removed value

        // If focused connection was removed, focus first remaining
        let newFocusedId = s.activeWorkspace.focusedConnectionId;
        if (newFocusedId === connectionId) {
          newFocusedId = newConnectionIds[0] || null;
        }

        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            config: {
              ...s.activeWorkspace.config,
              connectionIds: newConnectionIds,
              connectionStates: newConnectionStates,
            },
            connections: newConnections,
            focusedConnectionId: newFocusedId,
          },
          isDirty: true,
        };
      });
    },

    reorderConnections: (orderedIds) => {
      set((s) => {
        if (!s.activeWorkspace) return s;
        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            config: {
              ...s.activeWorkspace.config,
              connectionIds: orderedIds,
            },
          },
          isDirty: true,
        };
      });
    },

    setFocusedConnection: (connectionId) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;
      if (!activeWorkspace.connections.has(connectionId)) return;
      if (activeWorkspace.focusedConnectionId === connectionId) return;

      // Simply update the focused connection ID - tabs from ALL connections remain visible
      // We no longer swap per-connection layouts; there's one global tab list
      set((s) => {
        if (!s.activeWorkspace) return s;
        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            focusedConnectionId: connectionId,
          },
        };
      });

      logger.info(
        `[WorkspaceBundleStore] Focused connection changed to: ${connectionId}`,
      );
    },

    updateConnectionState: (connectionId, database, schema) => {
      set((s) => {
        if (!s.activeWorkspace) return s;
        const conn = s.activeWorkspace.connections.get(connectionId);
        if (!conn) return s;

        const newConnections = new Map(s.activeWorkspace.connections);
        newConnections.set(connectionId, { ...conn, database, schema });

        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            config: {
              ...s.activeWorkspace.config,
              connectionStates: {
                ...s.activeWorkspace.config.connectionStates,
                [connectionId]: { database, schema },
              },
            },
            connections: newConnections,
          },
          isDirty: true,
        };
      });
    },

    reconnectConnection: async (connectionId) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      const conn = activeWorkspace.connections.get(connectionId);
      if (!conn) return;

      set((s) => {
        if (!s.activeWorkspace) return s;
        const newConnections = new Map(s.activeWorkspace.connections);
        newConnections.set(connectionId, {
          ...conn,
          status: "connecting",
          error: undefined,
        });
        return {
          activeWorkspace: {
            ...s.activeWorkspace,
            connections: newConnections,
          },
        };
      });

      try {
        await databaseService.connectById(connectionId, conn.database || undefined);
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const c = newConnections.get(connectionId);
          if (c) {
            newConnections.set(connectionId, {
              ...c,
              status: "connected",
              error: undefined,
            });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });

        refreshConnectionData({
          ...conn,
          status: "connected",
          error: undefined,
        });
      } catch (error) {
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const c = newConnections.get(connectionId);
          if (c) {
            newConnections.set(connectionId, {
              ...c,
              status: "error",
              error:
                error instanceof Error ? error.message : "Connection failed",
            });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });

        throw error instanceof Error ? error : new Error("Connection failed");
      }
    },

    reconnectDisconnectedConnections: async () => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      const reconnectableIds = Array.from(activeWorkspace.connections.values())
        .filter(
          (connection) =>
            connection.status === "error" ||
            connection.status === "disconnected",
        )
        .map((connection) => connection.id);

      if (reconnectableIds.length === 0) return;

      await Promise.allSettled(
        reconnectableIds.map((connectionId) =>
          get().reconnectConnection(connectionId),
        ),
      );
    },

    // ===== Actions - Persistence =====

    saveCurrentWorkspace: async () => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return;

      const updatedConfig: WorkspaceConfig = {
        ...activeWorkspace.config,
        updatedAt: new Date().toISOString(),
      };

      set((s) => ({
        savedWorkspaces: s.savedWorkspaces.map((ws) =>
          ws.id === updatedConfig.id ? updatedConfig : ws,
        ),
        activeWorkspace: s.activeWorkspace
          ? { ...s.activeWorkspace, config: updatedConfig }
          : null,
        isDirty: false,
      }));

      await vaultStorage.storeWorkspace(updatedConfig);
      logger.info(
        `[WorkspaceBundleStore] Saved workspace: ${updatedConfig.name}`,
      );
    },

    saveAsNewWorkspace: async (name) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) throw new Error("No active workspace");

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const newConfig: WorkspaceConfig = {
        ...activeWorkspace.config,
        id,
        name,
        autoCreated: false,
        createdAt: now,
        updatedAt: now,
      };

      set((s) => ({
        savedWorkspaces: [...s.savedWorkspaces, newConfig],
        activeWorkspace: {
          ...activeWorkspace,
          config: newConfig,
        },
        isDirty: false,
      }));

      await vaultStorage.storeWorkspace(newConfig);
      logger.info(
        `[WorkspaceBundleStore] Saved new workspace: ${name} (${id})`,
      );
      return id;
    },

    // ===== Getters =====

    getFocusedConnection: () => {
      const { activeWorkspace } = get();
      if (!activeWorkspace || !activeWorkspace.focusedConnectionId) return null;
      return (
        activeWorkspace.connections.get(activeWorkspace.focusedConnectionId) ||
        null
      );
    },

    getConnectionById: (id) => {
      const { activeWorkspace } = get();
      if (!activeWorkspace) return undefined;
      return activeWorkspace.connections.get(id);
    },

    getTabsForConnection: (connectionId) => {
      const workbenchState = useWorkbenchStore.getState();
      const tabs: string[] = [];

      workbenchState.panelContents.forEach((panel) => {
        panel.tabIds.forEach((tabId) => {
          const meta = panel.metadata?.[tabId];
          if (meta?.connectionId === connectionId) {
            tabs.push(tabId);
          }
        });
      });

      return tabs;
    },

    getWindowTitle: () => {
      const { activeWorkspace, isDirty } = get();
      if (!activeWorkspace) return "QueryPilot";
      const name = activeWorkspace.config.name;
      return isDirty ? `• ${name} - QueryPilot` : `${name} - QueryPilot`;
    },

    getWorkspacesForConnection: (connectionId: string) => {
      const { savedWorkspaces } = get();
      return savedWorkspaces.filter((ws) =>
        ws.connectionIds.includes(connectionId),
      );
    },

    getConnectionsByWorkspace: () => {
      const result = new Map<string, string[]>();
      const { savedWorkspaces } = get();
      for (const ws of savedWorkspaces) {
        result.set(ws.id, [...ws.connectionIds]);
      }
      return result;
    },

    getUncategorizedConnectionIds: () => {
      const { savedWorkspaces } = get();
      const categorizedIds = new Set<string>();
      for (const ws of savedWorkspaces) {
        for (const id of ws.connectionIds) {
          categorizedIds.add(id);
        }
      }
      const allConnections = useConnectionStore.getState().connections;
      return allConnections
        .filter(c => !categorizedIds.has(c.profile.id))
        .map(c => c.profile.id);
    },

    addConnectionToSavedWorkspace: async (workspaceId, connectionId) => {
      const { savedWorkspaces } = get();
      const workspace = savedWorkspaces.find((ws) => ws.id === workspaceId);
      if (!workspace) {
        logger.error(
          `[WorkspaceBundleStore] Workspace not found: ${workspaceId}`,
        );
        return;
      }

      if (workspace.connectionIds.includes(connectionId)) {
        logger.warn(
          `[WorkspaceBundleStore] Connection already in workspace: ${connectionId}`,
        );
        return;
      }

      const updatedConnectionIds = [...workspace.connectionIds, connectionId];
      await get().updateWorkspace(workspaceId, {
        connectionIds: updatedConnectionIds,
      });
      logger.info(
        `[WorkspaceBundleStore] Added connection ${connectionId} to workspace ${workspaceId}`,
      );
    },

    removeConnectionFromSavedWorkspace: async (workspaceId, connectionId) => {
      const { savedWorkspaces } = get();
      const workspace = savedWorkspaces.find((ws) => ws.id === workspaceId);
      if (!workspace) {
        logger.error(
          `[WorkspaceBundleStore] Workspace not found: ${workspaceId}`,
        );
        return;
      }

      const updatedConnectionIds = workspace.connectionIds.filter(
        (id) => id !== connectionId,
      );
      await get().updateWorkspace(workspaceId, {
        connectionIds: updatedConnectionIds,
      });
      logger.info(
        `[WorkspaceBundleStore] Removed connection ${connectionId} from workspace ${workspaceId}`,
      );
    },
  }),
);
