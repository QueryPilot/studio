import { Button } from "@/components/ui/button";
import {
  Home,
  RefreshCw,
  Lock,
  SwatchBook,
  Settings,
  PanelLeft,
  PanelRight,
  Check,
  Database,
  Circle,
  Columns2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useConnectionStore } from "@/stores/connectionStore";
import { usePanelStore } from "@/stores/panelStore";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { windowManager } from "@/services/windowManager";
import { databaseService } from "@/services/databaseService";

interface WorkspaceTitleBarProps {
  connectionId: string;
  onToggleSidebar: (side: "left" | "right") => void;
}

export function WorkspaceTitleBar({
  connectionId,
  onToggleSidebar,
}: WorkspaceTitleBarProps) {
  const { connections, loadConnections } = useConnectionStore();
  const connection = connections.find((c) => c.id === connectionId);
  const navigate = useNavigate();
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  
  // Get panel store state and functions
  const { panels, splitMode, setSplitMode, createPanel, getPrimaryPanel, getSecondaryPanel, removePanel, moveTabBetweenPanels } = usePanelStore();
  
  // Load connections if not already loaded
  useEffect(() => {
    if (connections.length === 0) {
      void loadConnections();
    }
  }, [connections.length, loadConnections]);

  // Get server version from active connection
  useEffect(() => {
    const updateServerVersion = () => {
      const activeConnection = databaseService.getActiveConnection(connectionId);
      if (activeConnection?.server_version) {
        // Extract major version from server string
        const match = activeConnection.server_version.match(/\d+\.?\d*/);
        setServerVersion(match ? match[0] : null);
      }
    };

    updateServerVersion();
    
    // Also check periodically as connection might not be immediately ready
    const interval = setInterval(updateServerVersion, 1000);
    
    return () => clearInterval(interval);
  }, [connectionId]);

  // Track open workspace windows using windowManager
  useEffect(() => {
    const checkOpenWindows = () => {
      const activeWindows = windowManager.getActiveWindows();
      const connectionIds = Array.from(activeWindows.values()).map(w => w.connectionId);
      setOpenWindows(connectionIds);
    };
    
    checkOpenWindows();
    // Check periodically for window changes
    const interval = setInterval(checkOpenWindows, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleGoHome = async () => {
    try {
      console.log("Going home, closing workspace:", connectionId);
      // Import WebviewWindow to close current window
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

      // Get the current window
      const currentWindow = WebviewWindow.getCurrent();

      // Show main window first
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }

      // Close current workspace window
      await currentWindow.close();
    } catch (error) {
      console.error("Failed to close workspace window:", error);
      // Fallback: navigate using React Router
      void navigate("/");
    }
  };

  const handleReload = () => {
    window.location.reload();
  };

  const handleSwitchConnection = async (targetConnectionId: string) => {
    if (targetConnectionId === connectionId) {
      setOpen(false);
      return; // Already on this connection
    }
    
    setOpen(false); // Close the popover
    
    try {
      // Get the target connection details
      const targetConnection = connections.find(c => c.id === targetConnectionId);
      if (!targetConnection) {
        console.error("Target connection not found");
        return;
      }

      // Use windowManager to handle window switching/opening
      if (windowManager.isWorkspaceOpen(targetConnectionId)) {
        // Window exists, focus it
        await windowManager.focusWorkspace(targetConnectionId);
      } else {
        // Create new window for this connection
        await windowManager.openWorkspace(targetConnectionId, targetConnection.name);
      }
    } catch (error) {
      console.error("Failed to switch connection:", error);
      // Fallback: navigate in current window
      navigate(`/workspace/${targetConnectionId}`);
    }
  };

  const handleToggleSplitPanel = () => {
    const secondaryPanel = getSecondaryPanel();
    const primaryPanel = getPrimaryPanel();
    
    if (splitMode !== "none" && secondaryPanel) {
      // Close split panel - move all tabs from secondary to primary
      if (primaryPanel && secondaryPanel.tabs.size > 0) {
        // Move all tabs from secondary to primary
        secondaryPanel.tabs.forEach((tab) => {
          moveTabBetweenPanels(tab.id, secondaryPanel.id, primaryPanel.id);
        });
      }
      // Remove secondary panel and set split mode to none
      removePanel(secondaryPanel.id);
      setSplitMode("none");
    } else {
      // Create split panel
      const newPanelId = createPanel("secondary");
      setSplitMode("horizontal");
      
      // Optionally create a new query tab in the secondary panel
      // This is commented out - uncomment if you want to auto-create a tab
      // const { addTabToPanel } = usePanelStore.getState();
      // addTabToPanel(newPanelId, {
      //   type: "query",
      //   connectionId,
      //   title: "New Query",
      //   payload: { sql: "" },
      // });
    }
  };

  return (
    <div
      className="relative flex items-center justify-between h-10 border-b bg-background/95 backdrop-blur"
      data-tauri-drag-region
    >
      {/* Left Section - Add padding for macOS traffic lights */}
      <div className="flex items-center gap-2 pl-20">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleGoHome}
          title="Go to home"
        >
          <Home className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleReload}
          title="Reload workspace"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Connection security"
        >
          <Lock className="h-3.5 w-3.5" />
        </Button>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="Switch connection"
            >
              <SwatchBook className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command className="[&_[cmdk-input]]:outline-none [&_[cmdk-input]]:focus:outline-none">
              <CommandInput 
                placeholder="Search connections..." 
                className="h-9 focus-visible:ring-0"
              />
              <CommandList>
                <CommandEmpty>No connections found.</CommandEmpty>
                <CommandGroup>
                  {connections.map((conn) => (
                    <CommandItem
                      key={conn.id}
                      value={`${conn.name} ${conn.type} ${conn.host || conn.filepath || ''}`}
                      onSelect={() => handleSwitchConnection(conn.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Database className={cn(
                            "h-4 w-4",
                            conn.type === 'postgresql' && "text-blue-500",
                            conn.type === 'mysql' && "text-orange-500",
                            conn.type === 'sqlite' && "text-green-500",
                            conn.type === 'mssql' && "text-red-500",
                            conn.type === 'mariadb' && "text-purple-500"
                          )} />
                          <div className="flex flex-col">
                            <span className="font-medium">{conn.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {conn.type.replace('sql', 'SQL')} • {conn.host || conn.filepath || 'localhost'}:{conn.port || ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          {conn.id === connectionId && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                          {openWindows.includes(conn.id) && conn.id !== connectionId && (
                            <Circle className="h-2 w-2 fill-blue-500 text-blue-500" />
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Center Section - Absolute positioning for true center */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs">
        <span className="font-medium">
          {connection?.name || "Loading..."}
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground capitalize">
          {connection ? connection.type.replace('sql', 'SQL') : "Database"}
        </span>
        {serverVersion && (
          <>
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">v{serverVersion}</span>
          </>
        )}
        {connection?.host && (
          <>
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">
              {connection.host}:{connection.port}/{connection.database}
            </span>
          </>
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2 pr-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 p-0",
            splitMode !== "none" && "text-primary"
          )}
          onClick={handleToggleSplitPanel}
          title={splitMode !== "none" ? "Close split panel" : "Split panel"}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => {
            onToggleSidebar("left");
          }}
          title="Toggle left sidebar"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => {
            onToggleSidebar("right");
          }}
          title="Toggle right sidebar"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
