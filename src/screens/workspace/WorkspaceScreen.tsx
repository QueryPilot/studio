import { useParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { DatabaseSidebar } from "./components/DatabaseSidebar";
import { DatabaseSchemaSelector } from "./components/DatabaseSchemaSelector";
import { WorkbenchLayout } from "@/components/Workbench";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";

import { usePanelStore } from "@/stores/panelStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { Backend } from "@/services/backend";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

import { useConnectionAutoReconnect } from "@/hooks/useConnectionAutoReconnect";
import { AIAssistantSidebar } from "@/components/AIAssistant/AIAssistantSidebar";
import { PreferencesDialog } from "@/components/Preferences/PreferencesDialog";

// Default sidebars state - using a constant to avoid creating new objects
const DEFAULT_SIDEBARS = { left: true, right: false };

export function WorkspaceScreen() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const { initWorkspace, setActiveConnection: setActiveWorkspace } =
    useWorkspaceScreenStore();
  // Subscribe to sidebar state reactively - use memoized selector
  const sidebars = useWorkspaceScreenStore(
    useCallback((state) => {
      const workspace = state.workspaces.get(state.activeConnectionId || "");
      return workspace?.sidebars ?? DEFAULT_SIDEBARS;
    }, []),
  );

  const { initialize: initializePanels } = usePanelStore();

  const [isLoading, setIsLoading] = useState(true);
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );

  const selectedSchema = useWorkspaceSelectionStore((state) => state.schema);
  const setSelectedSchema = useWorkspaceSelectionStore(
    (state) => state.setSchema,
  );
  const setActiveWorkspaceConnection = useWorkspaceSelectionStore(
    (state) => state.setActiveConnection,
  );
  const setWorkspaceDatabase = useWorkspaceSelectionStore(
    (state) => state.setSelectedDatabase,
  );

  useConnectionAutoReconnect(connectionId);

  useEffect(() => {
    setActiveWorkspaceConnection(connectionId ?? null);
    // Set active connection in workspace screen store for sidebar state
    setActiveWorkspace(connectionId ?? null);
    if (connectionId) {
      // Sync activeConnectionId to connection store (direct state update, no side effects)
      const connectionStore = useConnectionStore.getState();
      if (connectionStore.activeConnectionId !== connectionId) {
        useConnectionStore.setState({ activeConnectionId: connectionId });
      }

      const currentDatabase = useWorkspaceSelectionStore.getState().database;
      if (!currentDatabase) {
        const stored = useConnectionStore
          .getState()
          .getConnection(connectionId);
        const profile = stored?.profile;
        if (profile?.database) {
          useWorkspaceSelectionStore.setState({
            database: profile.database,
          });
        }
      }
    }
  }, [
    connectionId,
    setActiveWorkspaceConnection,
    setWorkspaceDatabase,
    setActiveWorkspace,
  ]);

  useEffect(() => {
    if (connectionId) {
      // Initialize workspace for this connection
      setIsLoading(true);
      initWorkspace(connectionId);
      initializePanels(connectionId);

      // Connect to the database
      void databaseService
        .connectById(connectionId)
        .then(() => {
          // Minimal pre-warming: Prepare tiny queries to "prime" the statement cache
          // These run in ~15ms total and eliminate cold start on first real query
          Backend.prewarmQuery(connectionId, "SELECT 1").catch(() => {});
          Backend.prewarmQuery(connectionId, "SELECT current_database()").catch(
            () => {},
          );
        })
        .catch((err: unknown) => {
          console.error("Failed to connect to database:", err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }

    // Cleanup on unmount
    return () => {
      if (connectionId && databaseService.isConnectionActive(connectionId)) {
        void databaseService.disconnect(connectionId);
      }
    };
  }, [connectionId, initWorkspace, initializePanels]);

  const handleDatabaseChange = useCallback(
    (database: string) => {
      if (!connectionId) {
        return;
      }
      useWorkspaceSelectionStore.setState({ database });
    },
    [connectionId],
  );

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
              {/* Database/Schema Selector aligned with tabs */}
              <div className="flex items-center overflow-hidden">
                <DatabaseSchemaSelector
                  connectionId={connectionId}
                  selectedDatabase={selectedDatabase ?? ""}
                  selectedSchema={selectedSchema ?? ""}
                  onDatabaseChange={handleDatabaseChange}
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
    </div>
  );
}
