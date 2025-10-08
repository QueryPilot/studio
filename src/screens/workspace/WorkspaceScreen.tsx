import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { DatabaseSidebar } from "./components/DatabaseSidebar";
import { DatabaseSchemaSelector } from "./components/DatabaseSchemaSelector";
import { WorkbenchLayout } from "@/components/Workbench";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { usePanelStore } from "@/stores/panelStore";
import { databaseService } from "@/services/databaseService";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { useConnectionAutoReconnect } from "@/hooks/useConnectionAutoReconnect";
import { AIAssistantSidebar } from "@/components/AIAssistant/AIAssistantSidebar";

export function WorkspaceScreen() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const { toggleSidebar, initWorkspace, getSidebars } = useWorkspaceScreenStore();
  const sidebars = getSidebars();
  const { loadSchemas } = useSchemaStore();
  const { initialize: initializePanels } = usePanelStore();
  const commandPalette = useCommandPalette();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [selectedSchema, setSelectedSchema] = useState("");

  useConnectionAutoReconnect(connectionId);

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
          // Load schemas after successful connection
          return loadSchemas(connectionId);
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
  }, [connectionId, loadSchemas, initWorkspace, initializePanels]);

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
      <WorkspaceTitleBar
        connectionId={connectionId}
        onToggleSidebar={toggleSidebar}
      />

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
                  selectedDatabase={selectedDatabase}
                  selectedSchema={selectedSchema}
                  onDatabaseChange={setSelectedDatabase}
                  onSchemaChange={setSelectedSchema}
                />
              </div>
              {/* Database Sidebar */}
              <div className="flex-1 overflow-hidden">
                <DatabaseSidebar
                  connectionId={connectionId}
                  isLoading={isLoading}
                  selectedDatabase={selectedDatabase}
                  selectedSchema={selectedSchema}
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
            database={selectedDatabase}
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

      {/* Command Palette */}
      <CommandPalette
        open={commandPalette.isOpen}
        onOpenChange={commandPalette.setOpen}
        initialMode={commandPalette.mode}
      />
    </div>
  );
}
