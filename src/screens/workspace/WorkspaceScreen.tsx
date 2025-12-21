import { logger } from "@/lib/logger";
import { useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { DatabaseSidebar } from "./components/DatabaseSidebar";
import { DatabaseSchemaSelector } from "./components/DatabaseSchemaSelector";
import { WorkbenchLayout } from "@/components/Workbench";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useShallow } from "zustand/react/shallow";
import { usePanelStore } from "@/stores/panelStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

import { useConnectionAutoReconnect } from "@/hooks/useConnectionAutoReconnect";
import { AIAssistantSidebar } from "@/components/AIAssistant/AIAssistantSidebar";
import { PreferencesDialog } from "@/components/Preferences/PreferencesDialog";
import { DebugKeybindings } from "@/components/DebugKeybindings";
import { useCrudStore } from "@/stores/crudStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/utils/tauri";
import { windowChannelTracker } from "@/services/windowChannelTracker";
import { windowManager } from "@/services/windowManager";
import { useMenuEventListener } from "@/hooks/useMenuEventListener";

// Default sidebars state - using a constant to avoid creating new objects
const DEFAULT_SIDEBARS = { left: true, right: false };

export function WorkspaceScreen() {
  const { connectionId } = useParams<{ connectionId: string }>();

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

  const { initialize: initializePanels } = usePanelStore();

  const [isLoading, setIsLoading] = useState(true);

  // Use useShallow for multi-value selector to prevent unnecessary re-renders
  const {
    database: selectedDatabase,
    schema: selectedSchema,
    setSchema: setSelectedSchema,
    setActiveConnection: setActiveWorkspaceConnection,
    setSelectedDatabase: setWorkspaceDatabase,
  } = useWorkspaceSelectionStore(
    useShallow((state) => ({
      database: state.database,
      schema: state.schema,
      setSchema: state.setSchema,
      setActiveConnection: state.setActiveConnection,
      setSelectedDatabase: state.setSelectedDatabase,
    })),
  );

  useConnectionAutoReconnect(connectionId);

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
      const savedState =
        useWorkspaceSelectionStore.getState().getConnectionState(connectionId);
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

      // Handle schema from URL
      if (urlSchema) {
        const currentSchema = useWorkspaceSelectionStore.getState().schema;
        if (currentSchema !== urlSchema) {
          useWorkspaceSelectionStore.setState({ schema: urlSchema });
          setSelectedSchema(urlSchema);
        }
      } else if (savedState.schema) {
        // Restore saved schema for this connection
        useWorkspaceSelectionStore.setState({ schema: savedState.schema });
        setSelectedSchema(savedState.schema);
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
      setIsLoading(true);
      initWorkspace(connectionId);
      initializePanels(connectionId);

      // Register this window with the connection tracker (BroadcastChannel)
      void windowChannelTracker.registerWindow(connectionId);

      // Connect to the database with optional database override (using extracted urlDbname)
      void databaseService
        .connectById(connectionId, urlDbname || undefined)
        .catch((err: unknown) => {
          logger.error("Failed to connect to database:", err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }

    // Cleanup on unmount
    return () => {
      // Unregister window from connection tracker (BroadcastChannel)
      windowChannelTracker.unregisterWindow();

      // Disconnect this specific connection only
      // Note: This won't affect other windows' connections
      if (connectionId && databaseService.isConnectionActive(connectionId)) {
        logger.info(
          `[WorkspaceScreen] Unmounting - disconnecting connection ${connectionId}`,
        );
        void databaseService.disconnect(connectionId);
      }
    };
  }, [connectionId, urlDbname, initWorkspace, initializePanels]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Cmd/Ctrl + N combinations
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        if (event.shiftKey) {
          // Cmd+Shift+N: Open new main window
          event.preventDefault();
          logger.info('[WorkspaceScreen] Opening new main window (Cmd+Shift+N)');
          void windowManager.openNewMainWindow();
        } else {
          // Cmd+N: Open new table UI
          event.preventDefault();
          logger.info('[WorkspaceScreen] Opening new table UI (Cmd+N)');
          // TODO: Implement new table UI action
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Handle browser beforeunload for pending changes (web dev mode)
  useEffect(() => {
    if (!connectionId) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Check if there are pending changes for this connection
      const { stagedCommands } = useCrudStore.getState();
      const hasPendingChanges = Array.from(stagedCommands.entries()).some(
        ([tableKey, commands]) =>
          tableKey.startsWith(`${connectionId}:`) && commands.length > 0
      );

      if (hasPendingChanges) {
        // Standard way to trigger "unsaved changes" dialog
        event.preventDefault();
        // Chrome requires returnValue to be set
        event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return event.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [connectionId]);

  // Handle Tauri window close with pending changes check
  useEffect(() => {
    if (!isTauri() || !connectionId) return;

    let unlisten: (() => void) | null = null;
    let isDisposed = false;

    const setupCloseHandler = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const unlistenFn = await currentWindow.onCloseRequested(async (event) => {
          // Check if there are pending changes for this connection
          const { stagedCommands } = useCrudStore.getState();
          const hasPendingChanges = Array.from(stagedCommands.entries()).some(
            ([tableKey, commands]) =>
              tableKey.startsWith(`${connectionId}:`) && commands.length > 0
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
                  }
                )
            );

            if (confirmed) {
              // User confirmed, disconnect and destroy window
              logger.info(`[WorkspaceScreen] Closing window with unsaved changes - disconnecting ${connectionId}`);
              try {
                if (databaseService.isConnectionActive(connectionId)) {
                  await databaseService.disconnect(connectionId);
                  logger.info(`[WorkspaceScreen] Successfully disconnected ${connectionId}`);
                }
              } catch (error) {
                logger.error(`[WorkspaceScreen] Failed to disconnect ${connectionId}:`, error);
              }

              // Small delay to ensure disconnect completes
              await new Promise(resolve => setTimeout(resolve, 100));

              // Use destroy() instead of close() - it requires the destroy permission
              await currentWindow.destroy();
            }
          } else {
            // No pending changes, prevent default and handle cleanup
            event.preventDefault();

            logger.info(`[WorkspaceScreen] Closing window - disconnecting ${connectionId}`);

            // Disconnect if needed
            try {
              if (databaseService.isConnectionActive(connectionId)) {
                await databaseService.disconnect(connectionId);
                logger.info(`[WorkspaceScreen] Successfully disconnected ${connectionId}`);
              }
            } catch (error) {
              logger.error(`[WorkspaceScreen] Failed to disconnect ${connectionId}:`, error);
            }

            // Small delay to ensure disconnect completes
            await new Promise(resolve => setTimeout(resolve, 100));

            // Destroy the window
            await currentWindow.destroy();
          }
        });

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
  }, [connectionId]);

  if (!connectionId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">No connection ID provided</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Title Bar */}
      <WorkspaceTitleBar connectionId={connectionId} isConnecting={isLoading} />

      {/* Main Content Area */}
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1 p-1.5 pt-0 bg-secondary"
      >
        {/* Left Sidebar - Database Explorer */}
        {sidebars.left && (
          <>
            <ResizablePanel
              id="sidebar-left"
              order={1}
              defaultSize={18}
              minSize={12}
              maxSize={30}
              className="flex flex-col rounded-xl bg-background"
            >
              {/* Schema Selector aligned with tabs */}
              <div className="flex items-center overflow-hidden">
                <DatabaseSchemaSelector
                  connectionId={connectionId}
                  selectedSchema={selectedSchema ?? ""}
                  onSchemaChange={setSelectedSchema}
                />
              </div>
              {/* Database Sidebar */}
              <div className="flex-1 overflow-hidden">
                <DatabaseSidebar
                  connectionId={connectionId}
                  isLoading={isLoading}
                  selectedDatabase={selectedDatabase ?? ""}
                  selectedSchema={selectedSchema ?? ""}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}

        {/* Central Content - Workbench Layout */}
        <ResizablePanel
          id="main-content"
          order={2}
          defaultSize={
            sidebars.left
              ? sidebars.right
                ? 59
                : 82
              : sidebars.right
              ? 77
              : 100
          }
        >
          <WorkbenchLayout
            className="h-full"
            connectionId={connectionId}
            database={selectedDatabase ?? undefined}
          />
        </ResizablePanel>

        {/* Right Sidebar - AI Assistant */}
        {sidebars.right && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="sidebar-right"
              order={3}
              defaultSize={23}
              minSize={15}
              maxSize={40}
              className="flex flex-col rounded-xl bg-background overflow-hidden"
            >
              <AIAssistantSidebar />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Global Preferences Dialog */}
      <PreferencesDialog />

      {/* Debug panel for keyboard shortcuts (Cmd+Shift+K to toggle) */}
      <DebugKeybindings />
    </div>
  );
}
