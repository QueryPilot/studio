import { logger } from "@/lib/logger";
import { useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { SidebarConnectionList } from "./components/SidebarConnectionList";
import { WorkbenchLayout, WorkbenchDndProvider } from "@/components/Workbench";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { databaseService } from "@/services/databaseService";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AIPanel } from "@/components/AI";

import { useConnectionAutoReconnect } from "@/hooks/useConnectionAutoReconnect";
import { useSchemaPreload } from "@/hooks/useSchemaPreload";
import { PreferencesDialog } from "@/components/Preferences/PreferencesDialog";
import { DebugKeybindings } from "@/components/DebugKeybindings";
import { useCrudStore } from "@/stores/crudStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/utils/tauri";
import { windowChannelTracker } from "@/services/windowChannelTracker";
import { useMenuEventListener } from "@/hooks/useMenuEventListener";
import { DbType } from "@/types/connection";

// Default sidebars state - using a constant to avoid creating new objects
const DEFAULT_SIDEBARS = { left: true, right: false };

export function WorkspaceScreen() {
  // Get workspaceId from route params
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  // Get workspace bundle store state — use granular selectors to avoid
  // re-rendering the entire tree on every connection status change
  const activeWorkspaceConfigId = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.id ?? null,
  );
  const focusedConnection = useWorkspaceBundleStore((s) => {
    const ws = s.activeWorkspace;
    if (!ws?.focusedConnectionId) return null;
    return ws.connections.get(ws.focusedConnectionId) ?? null;
  });
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const openWorkspace = useWorkspaceBundleStore((s) => s.openWorkspace);
  const openSingleConnection = useWorkspaceBundleStore(
    (s) => s.openSingleConnection,
  );

  // Get connection store state - needed to ensure connections are loaded
  const connections = useConnectionStore((s) => s.connections);
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);

  // Track if workspaces and connections have been loaded
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);

  // Get connection ID from focused connection in workspace
  const connectionId = focusedConnection?.id;

  useMenuEventListener();
  const [searchParams, setSearchParams] = useSearchParams();

  // Extract primitive values from searchParams to use as stable dependencies
  const urlDbname = searchParams.get("dbname");
  const urlSchema = searchParams.get("schema");

  const { initWorkspace, setActiveConnection: setActiveWorkspace } =
    useWorkspaceScreenStore();

  // Subscribe to sidebar state - let Zustand handle equality checking
  const sidebars = useWorkspaceScreenStore((state) => {
    const workspace = state.workspaces.get(state.activeConnectionId || "");
    return workspace?.sidebars ?? DEFAULT_SIDEBARS;
  });

  const [isLoading, setIsLoading] = useState(true);

  const persistWorkbenchLayout = useCallback(() => {
    const persistenceScopeId =
      useWorkspaceBundleStore.getState().activeWorkspace?.config.id ??
      connectionId;
    if (persistenceScopeId) {
      useWorkbenchStore.getState().flushLayout(persistenceScopeId);
    }
  }, [connectionId]);

  // Use useShallow for multi-value selector to prevent unnecessary re-renders
  const {
    database: selectedDatabase,
    setSchema: setSelectedSchema,
    setActiveConnection: setActiveWorkspaceConnection,
    setSelectedDatabase: setWorkspaceDatabase,
  } = useWorkspaceSelectionStore(
    useShallow((state) => ({
      database: state.database,
      setSchema: state.setSchema,
      setActiveConnection: state.setActiveConnection,
      setSelectedDatabase: state.setSelectedDatabase,
    })),
  );

  useConnectionAutoReconnect(connectionId);

  // Background prefetch schema data for Command Palette warm cache
  useSchemaPreload();

  // Load connections on mount (essential for workspace to function)
  useEffect(() => {
    if (connections.length === 0 && !connectionsLoaded) {
      void fetchConnections()
        .then(() => {
          setConnectionsLoaded(true);
        })
        .catch(() => {
          // Still mark as loaded even on error to prevent infinite loop
          setConnectionsLoaded(true);
        });
    } else if (connections.length > 0) {
      setConnectionsLoaded(true);
    }
  }, [connections.length, connectionsLoaded, fetchConnections]);

  // Load saved workspaces on mount (needed before we can open a named workspace by ID)
  useEffect(() => {
    if (workspaceId && savedWorkspaces.length === 0 && !workspacesLoaded) {
      void loadSavedWorkspaces().then(() => {
        setWorkspacesLoaded(true);
      });
    } else {
      setWorkspacesLoaded(true);
    }
  }, [
    workspaceId,
    savedWorkspaces.length,
    workspacesLoaded,
    loadSavedWorkspaces,
  ]);

  // Handle workspace opening based on route
  useEffect(() => {
    if (!workspaceId) return;

    // Skip if workspace is already active and matches the route
    if (activeWorkspaceConfigId === workspaceId) {
      return;
    }

    // Wait for both workspaces AND connections to be loaded
    if (!workspacesLoaded || !connectionsLoaded) return;

    // Check if this is a saved workspace ID
    const isInSavedWorkspaces = savedWorkspaces.some(
      (ws) => ws.id === workspaceId,
    );

    if (isInSavedWorkspaces) {
      // It's a named workspace - open it
      void openWorkspace(workspaceId);
    } else {
      // It's likely a connection ID (legacy single connection flow)
      // Open it as a single connection temp workspace
      // Pass URL params as overrides if present
      void openSingleConnection(workspaceId, {
        database: urlDbname || undefined,
        schema: urlSchema || undefined,
      });
    }
  }, [
    workspaceId,
    activeWorkspaceConfigId,
    workspacesLoaded,
    connectionsLoaded,
    savedWorkspaces,
    openWorkspace,
    openSingleConnection,
    urlDbname,
    urlSchema,
  ]);

  // Update URL params without navigation
  const updateUrlParams = useCallback(
    (dbname: string, schema?: string) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        if (dbname) {
          newParams.set("dbname", dbname);
        } else {
          newParams.delete("dbname");
        }
        if (schema) {
          newParams.set("schema", schema);
        } else {
          newParams.delete("schema");
        }
        return newParams;
      });
    },
    [setSearchParams],
  );

  // Initialize from URL params or connection defaults
  // Using extracted primitive values (urlDbname, urlSchema) instead of searchParams object
  useEffect(() => {
    setActiveWorkspaceConnection(connectionId ?? null);
    // Set active connection in workspace screen store for sidebar state
    setActiveWorkspace(connectionId ?? null);
    if (connectionId) {
      // Check if we have saved state for this connection
      const savedState = useWorkspaceSelectionStore
        .getState()
        .getConnectionState(connectionId);
      const currentDatabase = useWorkspaceSelectionStore.getState().database;

      // Priority: URL param > saved per-connection state > connection profile default
      if (urlDbname) {
        if (currentDatabase !== urlDbname) {
          useWorkspaceSelectionStore.setState({ database: urlDbname });
          setWorkspaceDatabase(urlDbname);
        }
      } else if (savedState.database) {
        // Restore saved state for this connection
        useWorkspaceSelectionStore.setState({ database: savedState.database });
        setWorkspaceDatabase(savedState.database);
        // Set URL param to match
        updateUrlParams(savedState.database, savedState.schema ?? undefined);
      } else if (!currentDatabase) {
        const stored = useConnectionStore
          .getState()
          .getConnection(connectionId);
        const profile = stored?.profile;
        if (profile?.database) {
          useWorkspaceSelectionStore.setState({ database: profile.database });
          setWorkspaceDatabase(profile.database);
          // Set URL param to match
          updateUrlParams(profile.database);
        }
      }

      // Handle schema from URL or saved state or profile default
      const currentSchema = useWorkspaceSelectionStore.getState().schema;
      if (urlSchema) {
        if (currentSchema !== urlSchema) {
          useWorkspaceSelectionStore.setState({ schema: urlSchema });
          setSelectedSchema(urlSchema);
        }
      } else if (savedState.schema) {
        // Restore saved schema for this connection
        useWorkspaceSelectionStore.setState({ schema: savedState.schema });
        setSelectedSchema(savedState.schema);
      } else if (!currentSchema) {
        // Fall back to profile's default_schema or common defaults
        const stored = useConnectionStore
          .getState()
          .getConnection(connectionId);
        const profile = stored?.profile;

        // For MySQL/SQLite, use database name as schema (they don't have separate schemas)
        // For PostgreSQL/MSSQL, use default_schema or fallback to 'public'/'dbo'
        let defaultSchema = profile?.default_schema;
        if (!defaultSchema) {
          const dbType = profile?.db_type;
          if (dbType === DbType.MySQL || dbType === DbType.MariaDB) {
            // MySQL: use current database name as schema
            defaultSchema = profile?.database || "";
          } else if (dbType === DbType.SQLite) {
            // SQLite: always use 'main' as the schema (profile.database is the file path)
            defaultSchema = "main";
          } else if (dbType === DbType.SQLServer) {
            defaultSchema = "dbo";
          } else {
            defaultSchema = "public";
          }
        }

        logger.info(
          `[WorkspaceScreen] Setting default schema for ${profile?.db_type}: ${defaultSchema}`,
        );

        useWorkspaceSelectionStore.setState({ schema: defaultSchema });
        setSelectedSchema(defaultSchema);
      }
    }
  }, [
    connectionId,
    urlDbname,
    urlSchema,
    setActiveWorkspaceConnection,
    setWorkspaceDatabase,
    setActiveWorkspace,
    updateUrlParams,
    setSelectedSchema,
  ]);

  useEffect(() => {
    if (connectionId) {
      // Initialize workspace for this connection
      initWorkspace(connectionId);

      // Register this window with the connection tracker (BroadcastChannel)
      void windowChannelTracker.registerWindow(connectionId);

      // Note: Connection is now handled by openSingleConnection/openWorkspace
      // in workspaceBundleStore. We just need to track loading state from there.
      setIsLoading(false);
    }

    // Cleanup on unmount
    return () => {
      persistWorkbenchLayout();

      // Unregister window from connection tracker (BroadcastChannel)
      windowChannelTracker.unregisterWindow();

      // NOTE: We intentionally do NOT disconnect on React unmount!
      // The disconnect is handled by the onCloseRequested handler above.
      // React may unmount for other reasons (hot reload, route change) where
      // we don't want to disconnect. Only actual window close should disconnect.
    };
  }, [connectionId, initWorkspace, persistWorkbenchLayout]);

  // Handle browser beforeunload for pending changes (web dev mode)
  useEffect(() => {
    if (!connectionId) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      persistWorkbenchLayout();

      // Check if there are pending changes for this connection
      const { stagedCommands } = useCrudStore.getState();
      const hasPendingChanges = Array.from(stagedCommands.entries()).some(
        ([tableKey, commands]) =>
          tableKey.startsWith(`${connectionId}:`) && commands.length > 0,
      );

      if (hasPendingChanges) {
        // Standard way to trigger "unsaved changes" dialog
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [connectionId, persistWorkbenchLayout]);

  // Handle Tauri window close with pending changes check
  useEffect(() => {
    if (!isTauri() || !connectionId) return;

    let unlisten: (() => void) | null = null;
    let isDisposed = false;

    const setupCloseHandler = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const unlistenFn = await currentWindow.onCloseRequested(
          async (event) => {
            persistWorkbenchLayout();

            // Check if there are pending changes for this connection
            const { stagedCommands } = useCrudStore.getState();
            const hasPendingChanges = Array.from(stagedCommands.entries()).some(
              ([tableKey, commands]) =>
                tableKey.startsWith(`${connectionId}:`) && commands.length > 0,
            );

            if (hasPendingChanges) {
              // Prevent close and show confirmation dialog
              event.preventDefault();

              const confirmed = await import("@tauri-apps/plugin-dialog").then(
                (dialog) =>
                  dialog.confirm(
                    "You have unsaved changes. Are you sure you want to close this workspace?",
                    {
                      title: "Unsaved Changes",
                      kind: "warning",
                    },
                  ),
              );

              if (confirmed) {
                // User confirmed, disconnect with timeout and destroy window
                logger.info(
                  `[WorkspaceScreen] Closing window with unsaved changes - disconnecting ${connectionId}`,
                );

                // Only try to disconnect if connection is actually active
                if (databaseService.isConnectionActive(connectionId)) {
                  // Use timeout to prevent freeze on dead connections
                  await databaseService.disconnectWithTimeout(
                    connectionId,
                    3000,
                  );
                } else {
                  logger.info(
                    `[WorkspaceScreen] Connection not active, skipping disconnect`,
                  );
                }

                // Destroy the window
                await currentWindow.destroy();
              }
            } else {
              // No pending changes, prevent default and handle cleanup
              event.preventDefault();

              logger.info(
                `[WorkspaceScreen] Closing window - disconnecting ${connectionId}`,
              );

              // Only try to disconnect if connection is actually active
              // This prevents hanging when window is closed during "Connecting" state
              if (databaseService.isConnectionActive(connectionId)) {
                // Use timeout to prevent freeze on dead connections
                await databaseService.disconnectWithTimeout(connectionId, 3000);
              } else {
                logger.info(
                  `[WorkspaceScreen] Connection not active, skipping disconnect`,
                );
              }

              // Destroy the window
              await currentWindow.destroy();
            }
          },
        );

        // Only store if not already disposed
        if (!isDisposed) {
          unlisten = unlistenFn;
        } else {
          // Already disposed, cleanup immediately
          unlistenFn();
        }
      } catch (error) {
        logger.error("[WorkspaceScreen] Failed to setup close handler:", error);
      }
    };

    void setupCloseHandler();

    return () => {
      isDisposed = true;
      if (unlisten) unlisten();
    };
  }, [connectionId, persistWorkbenchLayout]);

  if (!connectionId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">No connection ID provided</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-secondary">
      {/* Title Bar */}
      <WorkspaceTitleBar connectionId={connectionId} isConnecting={isLoading} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* DnD context wraps both sidebar and workbench so sidebar items can drag to panel drop zones */}
        <WorkbenchDndProvider>
          {/* Resizable Panels */}
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex-1 p-1.5 pt-0"
            autoSaveId="workspace-sidebars"
          >
            {/* Left Sidebar - Database Explorer */}
            {sidebars.left && (
              <>
                <ResizablePanel
                  id="sidebar-left"
                  defaultSize="18"
                  minSize="12"
                  maxSize="30"
                  className="flex flex-col rounded-xl bg-background"
                >
                  <div className="flex-1 overflow-hidden">
                    <SidebarConnectionList />
                  </div>
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}

            {/* Central Content - Workbench Layout */}
            <ResizablePanel
              id="main-content"
              defaultSize={
                sidebars.left
                  ? sidebars.right
                    ? "59"
                    : "82"
                  : sidebars.right
                    ? "77"
                    : "100"
              }
            >
              <WorkbenchLayout
                className="h-full"
                connectionId={connectionId}
                database={selectedDatabase ?? undefined}
              />
            </ResizablePanel>

            {/* Right Sidebar - AI Panel */}
            {sidebars.right && (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="sidebar-right"
                  defaultSize="23"
                  minSize="18"
                  maxSize="40"
                  className="flex flex-col rounded-xl bg-background"
                >
                  <AIPanel
                    connectionId={connectionId}
                    onClose={() => {
                      useWorkspaceScreenStore.getState().toggleSidebar("right");
                    }}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </WorkbenchDndProvider>
      </div>

      {/* Global Preferences Dialog */}
      <PreferencesDialog />

      {/* Debug panel for keyboard shortcuts (Cmd+Shift+K to toggle) */}
      {process.env.NODE_ENV === "development" ? <DebugKeybindings /> : null}
    </div>
  );
}
