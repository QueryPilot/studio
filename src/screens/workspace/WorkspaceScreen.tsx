import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { DatabaseSidebar } from "./components/DatabaseSidebar";
import { DatabaseSchemaSelector } from "./components/DatabaseSchemaSelector";
import { AISidebar } from "./components/AISidebar";
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

export function WorkspaceScreen() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const { sidebars, toggleSidebar, initWorkspace } = useWorkspaceScreenStore();
  const { loadSchemas } = useSchemaStore();
  const { initialize: initializePanels } = usePanelStore();
  const commandPalette = useCommandPalette();
  const [isLoading, setIsLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [selectedSchema, setSelectedSchema] = useState("");

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
          setConnectionError(null);
          // Load schemas after successful connection
          return loadSchemas(connectionId);
        })
        .catch((error) => {
          console.error("Failed to connect to database:", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          setConnectionError(errorMessage);
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
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Sidebar - Database Explorer */}
        {sidebars.left && (
          <>
            <ResizablePanel
              id="sidebar-left"
              order={1}
              defaultSize={18}
              minSize={12}
              maxSize={30}
              className="bg-muted/20 flex flex-col"
            >
              {/* Database/Schema Selector aligned with tabs */}
              <div className="h-[34px] border-y bg-background flex items-center overflow-hidden">
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
            <ResizableHandle withHandle />
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
            <ResizableHandle withHandle />
            <ResizablePanel
              id="sidebar-right"
              order={3}
              defaultSize={23}
              minSize={15}
              maxSize={40}
              className="bg-muted/20"
            >
              <AISidebar connectionId={connectionId} />
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
