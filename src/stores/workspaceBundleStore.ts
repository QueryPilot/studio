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
import type {
  WorkspaceConfig,
  OpenConnection,
  ActiveWorkspace,
} from "@/types/workspace";
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
      set((state) => ({
        savedWorkspaces: state.savedWorkspaces.map((ws) =>
          ws.id === id
            ? { ...ws, ...updates, updatedAt: new Date().toISOString() }
            : ws,
        ),
      }));
    },

    deleteWorkspace: async (id) => {
      await vaultStorage.deleteWorkspace(id);
      set((state) => ({
        savedWorkspaces: state.savedWorkspaces.filter((ws) => ws.id !== id),
      }));
      logger.info(`[WorkspaceBundleStore] Deleted workspace: ${id}`);
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
        isTemporary: false,
        connections: new Map(),
        focusedConnectionId: null,
      };

      set({ activeWorkspace, isDirty: false });

      // Connect to each connection in the workspace
      const connectionStore = useConnectionStore.getState();

      for (const connectionId of config.connectionIds) {
        const stored = connectionStore.getConnection(connectionId);

        if (!stored) {
          logger.warn(
            `[WorkspaceBundleStore] Connection profile not found: ${connectionId}`,
          );
          // TODO: Prompt user to remove from workspace
          continue;
        }

        const profile = stored.profile;
        const state = config.connectionStates[connectionId] || {
          database: profile.database,
          schema: profile.default_schema || "public",
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
          if (!s.activeWorkspace) return s;
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
            if (!s.activeWorkspace) return s;
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
            if (!s.activeWorkspace) return s;
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

      // Restore tab layout if saved
      if (config.tabLayout) {
        try {
          const workbenchState = useWorkbenchStore.getState();

          // Restore layout tree and panel contents
          workbenchState.setLayoutTree(config.tabLayout.layoutTree);
          const panelContentsMap = new Map(config.tabLayout.panelContents);
          workbenchState.restorePanelContents(panelContentsMap);

          logger.info(
            `[WorkspaceBundleStore] Restored tab layout for workspace: ${config.name}`,
          );
        } catch (error) {
          logger.error(
            `[WorkspaceBundleStore] Failed to restore tab layout:`,
            error,
          );
        }
      }
    },

    openSingleConnection: async (connectionId, options) => {
      logger.info(
        `[WorkspaceBundleStore] Opening single connection as temp workspace: ${connectionId}`,
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
      const now = new Date().toISOString();

      // Use override options if provided, otherwise fall back to profile defaults
      const database = options?.database || profile.database;
      const schema = options?.schema || profile.default_schema || "public";

      // Create temporary workspace config
      const config: WorkspaceConfig = {
        id: `temp-${connectionId}`,
        name: profile.name,
        connectionIds: [connectionId],
        connectionStates: {
          [connectionId]: {
            database,
            schema,
          },
        },
        createdAt: now,
        updatedAt: now,
      };

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
        isTemporary: true,
        connections,
        focusedConnectionId: connectionId,
      };

      set({ activeWorkspace, isDirty: false });

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

      if (activeWorkspace.connections.has(connectionId)) {
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
        schema: profile.default_schema || "public",
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
              schema: profile.default_schema || "public",
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
        await databaseService.testConnection(connectionId).catch((err) => {
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

      // Auto-save the workspace after adding a connection (skip for temporary workspaces)
      const updatedWorkspace = get().activeWorkspace;
      if (updatedWorkspace && !updatedWorkspace.isTemporary) {
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
        await databaseService.connectById(connectionId);
        set((s) => {
          if (!s.activeWorkspace) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          const c = newConnections.get(connectionId);
          if (c) {
            newConnections.set(connectionId, { ...c, status: "connected" });
          }
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
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
      }
    },

    // ===== Actions - Persistence =====

    saveCurrentWorkspace: async () => {
      const { activeWorkspace } = get();
      if (!activeWorkspace || activeWorkspace.isTemporary) return;

      // Capture current tab layout from workbenchStore
      const workbenchState = useWorkbenchStore.getState();
      const tabLayout = workbenchState.layoutTree
        ? {
            layoutTree: workbenchState.layoutTree,
            panelContents: Array.from(workbenchState.panelContents.entries()),
          }
        : undefined;

      const updatedConfig: WorkspaceConfig = {
        ...activeWorkspace.config,
        tabLayout,
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

      // Capture current tab layout
      const workbenchState = useWorkbenchStore.getState();
      const tabLayout = workbenchState.layoutTree
        ? {
            layoutTree: workbenchState.layoutTree,
            panelContents: Array.from(workbenchState.panelContents.entries()),
          }
        : undefined;

      const newConfig: WorkspaceConfig = {
        ...activeWorkspace.config,
        id,
        name,
        tabLayout,
        createdAt: now,
        updatedAt: now,
      };

      set((s) => ({
        savedWorkspaces: [...s.savedWorkspaces, newConfig],
        activeWorkspace: {
          ...activeWorkspace,
          config: newConfig,
          isTemporary: false,
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
      const connectionStore = useConnectionStore.getState();
      const conn = connectionStore.getConnection(connectionId);

      // Prefer connection metadata (new way)
      if (conn?.metadata.workspace_ids) {
        const { savedWorkspaces } = get();
        return savedWorkspaces.filter(ws =>
          conn.metadata.workspace_ids!.includes(ws.id)
        );
      }

      // Fallback to workspace.connectionIds (legacy)
      const { savedWorkspaces } = get();
      return savedWorkspaces.filter((ws) =>
        ws.connectionIds.includes(connectionId),
      );
    },

    getConnectionsByWorkspace: () => {
      const connectionStore = useConnectionStore.getState();
      const result = new Map<string, string[]>();

      // Initialize with empty arrays
      const { savedWorkspaces } = get();
      for (const ws of savedWorkspaces) {
        result.set(ws.id, []);
      }

      // Build from connection metadata
      for (const conn of connectionStore.connections) {
        const workspaceIds = conn.metadata.workspace_ids || [];
        for (const wsId of workspaceIds) {
          const existing = result.get(wsId) || [];
          existing.push(conn.profile.id);
          result.set(wsId, existing);
        }
      }

      return result;
    },

    getUncategorizedConnectionIds: () => {
      const allConnections = useConnectionStore.getState().connections;
      return allConnections
        .filter(c => !c.metadata.workspace_ids || c.metadata.workspace_ids.length === 0)
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
