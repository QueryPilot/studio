import { Button } from "@/components/ui/button";
import {
  Home,
  RefreshCw,
  Lock,
  SwatchBook,
  Settings,
  PanelLeft,
  Check,
  Database,
  Circle,
  Waypoints,
  Sun,
  Moon,
  Monitor,
  AlertCircle,
  Loader2,
  RotateCcw,
  Bot,
  Undo2,
  Redo2,
  GitCommit,
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
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useCrudStore } from "@/stores/crudStore";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useCommand } from "@/hooks/useCommand";
import { windowManager } from "@/services/windowManager";
import {
  databaseService,
  type ConnectionHealth,
} from "@/services/databaseService";
import { safeEmit } from "@/utils/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { toast } from "sonner";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GlobalChangesModal } from "@/components/GlobalChangesModal";

interface WorkspaceTitleBarProps {
  connectionId: string;
  isConnecting?: boolean;
}

export function WorkspaceTitleBar({
  connectionId,
  isConnecting: isInitiallyConnecting = false,
}: WorkspaceTitleBarProps) {
  const { connections, fetchConnections } = useConnectionStore();
  const storedConnection = connections.find(
    (c) => c.profile.id === connectionId,
  );

  const connection = storedConnection?.profile;
  const navigate = useNavigate();
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] =
    useState<ConnectionHealth | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { theme, setTheme } = useTheme();
  const { toggleSidebar: onToggleSidebar } = useWorkspaceScreenStore();
  const { openPreferences } = usePreferencesStore();
  const {
    stagedCommands,
    commitAll,
    discardAll,
    undo,
    redo,
    historyIndex,
    history,
  } = useCrudStore();

  // Combined connecting state (initial + reconnecting)
  const isConnecting = isInitiallyConnecting || isReconnecting;

  // Calculate total pending changes for this connection
  const totalChanges = useMemo(() => {
    let count = 0;
    stagedCommands.forEach((commands, tableKey) => {
      // tableKey format: "connectionId:database:schema:table"
      if (tableKey.startsWith(`${connectionId}:`)) {
        count += commands.length;
      }
    });
    return count;
  }, [stagedCommands, connectionId]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const [showGlobalChanges, setShowGlobalChanges] = useState(false);

  // Keyboard shortcuts
  useCommand(
    "workspace.commitAll",
    async () => {
      if (totalChanges > 0) {
        try {
          console.log(
            "[WorkspaceTitleBar] Cmd+S pressed - committing all changes",
          );

          // Get all staged commands before committing
          const stagedCommandsSnapshot = Array.from(stagedCommands.entries());

          const results = await commitAll();
          const totalCommitted = Object.values(results).reduce(
            (sum, result) => sum + result.committed.length,
            0,
          );

          console.log(
            `[WorkspaceTitleBar] Commit succeeded, invalidating ${stagedCommandsSnapshot.length} table(s)...`,
          );

          // Small delay to ensure database transaction is fully committed
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Broadcast invalidation for all affected tables
          const { invalidateTable } = useDataInvalidationStore.getState();
          stagedCommandsSnapshot.forEach(([tableKey]) => {
            const parts = tableKey.split(":");
            const [connId, db, sch, tbl] = parts;
            if (connId && db && tbl) {
              console.log(
                `[WorkspaceTitleBar] Invalidating table: ${db}.${
                  sch ?? "public"
                }.${tbl}`,
              );
              invalidateTable(connId, db, sch ?? "public", tbl);
            }
          });

          toast.success("All changes committed", {
            description: `Successfully committed ${totalCommitted} change${
              totalCommitted === 1 ? "" : "s"
            }`,
          });
        } catch (error) {
          toast.error("Commit failed", {
            description:
              error instanceof Error
                ? error.message
                : "Failed to commit changes",
          });
        }
      }
    },
    {
      label: "Commit All Changes",
      category: "Workspace",
      when: "!editorTextFocus && !editingCell",
    },
  );

  useCommand(
    "workspace.discardAll",
    () => {
      if (totalChanges > 0) {
        discardAll();
        toast.success("All changes discarded");
      }
    },
    {
      label: "Discard All Changes",
      category: "Workspace",
      when: "!editorTextFocus && !editingCell",
    },
  );

  useCommand(
    "workspace.reviewChanges",
    () => {
      if (totalChanges > 0) {
        setShowGlobalChanges(true);
      }
    },
    {
      label: "Review All Changes",
      category: "Workspace",
      when: "!editorTextFocus && !editingCell",
    },
  );

  useCommand(
    "workspace.undo",
    () => {
      if (canUndo) {
        undo();
        toast.success("Changes undone");
      }
    },
    {
      label: "Undo",
      category: "Workspace",
      when: "!editorTextFocus && !editingCell",
    },
  );

  useCommand(
    "workspace.redo",
    () => {
      if (canRedo) {
        redo();
        toast.success("Changes redone");
      }
    },
    {
      label: "Redo",
      category: "Workspace",
      when: "!editorTextFocus && !editingCell",
    },
  );

  // Warn before reload if there are pending changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (totalChanges > 0) {
        e.preventDefault();
        return false;
      }
      return true;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [totalChanges, commitAll, discardAll]);

  // Load connections if not already loaded
  useEffect(() => {
    if (connections.length === 0) {
      void fetchConnections();
    }
  }, [connections.length, fetchConnections]);

  // Get server version from active connection
  useEffect(() => {
    const updateServerVersion = () => {
      const activeConnection =
        databaseService.getActiveConnection(connectionId);
      if (activeConnection?.server_version) {
        // Extract major version from server string
        const match = activeConnection.server_version.match(/\d+\.?\d*/);
        setServerVersion(match ? match[0] : null);
      }
    };

    updateServerVersion();

    // Also check periodically as connection might not be immediately ready
    const interval = setInterval(updateServerVersion, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [connectionId]);

  // Subscribe to connection health updates
  useEffect(() => {
    let previousHealth: ConnectionHealth | null = null;

    const unsubscribe = databaseService.onHealthChange(
      connectionId,
      (health) => {
        setConnectionHealth(health);

        // Show toast on error status change
        if (health.status === "error" && previousHealth?.status !== "error") {
          toast.error("Connection Failed", {
            description:
              health.error ||
              "Unable to connect to the database. Please check your connection settings.",
          });
        } else if (
          health.status === "ready" &&
          previousHealth?.status === "error"
        ) {
          toast.success("Connection Restored", {
            description: "Successfully reconnected to the database.",
          });
        }

        previousHealth = health;
      },
    );

    return () => {
      unsubscribe();
    };
  }, [connectionId]);

  // Track open workspace windows using windowManager
  useEffect(() => {
    const checkOpenWindows = () => {
      const activeWindows = windowManager.getActiveWindows();
      const connectionIds = Array.from(activeWindows.values()).map(
        (w) => w.connectionId,
      );
      setOpenWindows(connectionIds);
    };

    checkOpenWindows();
    // Check periodically for window changes
    const interval = setInterval(checkOpenWindows, 2000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      try {
        if (databaseService.isConnectionActive(connectionId)) {
          await databaseService.disconnect(connectionId);
        }
      } catch (error) {
        console.error("Failed to disconnect:", error);
        toast.error("Failed to disconnect", {
          description:
            error instanceof Error
              ? error.message
              : "Failed to disconnect from the database.",
        });
      }
      await databaseService.connectById(connectionId);
      // Emit event to refresh sidebar data
      await safeEmit("database-reconnected", { connectionId });
      toast.success("Reconnection Successful", {
        description: "Successfully reconnected to the database.",
      });
    } catch (error) {
      console.error("Failed to reconnect:", error);
      toast.error("Reconnection Failed", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to reconnect to the database.",
      });
    } finally {
      setIsReconnecting(false);
    }
  };

  const getStatusColor = () => {
    if (isConnecting) return "text-yellow-500";

    // Check if connection is active before showing gray
    if (!connectionHealth) {
      return databaseService.isConnectionActive(connectionId)
        ? "text-yellow-500" // Still connecting (waiting for health check)
        : "text-gray-500"; // Actually disconnected
    }

    switch (connectionHealth.status) {
      case "ready":
        return "text-green-500";
      case "degraded":
        return "text-yellow-500";
      case "error":
        return "text-red-500 font-semibold";
      default:
        return "text-gray-500";
    }
  };

  const getStatusText = () => {
    if (isConnecting) return "Connecting";

    // Check if connection is actually active before showing "Disconnected"
    if (!connectionHealth) {
      return databaseService.isConnectionActive(connectionId)
        ? "Connecting"
        : "Disconnected";
    }

    switch (connectionHealth.status) {
      case "ready":
        return connectionHealth.rttMs
          ? `${connectionHealth.rttMs}ms`
          : "Connected";
      case "degraded":
        return connectionHealth.rttMs
          ? `${connectionHealth.rttMs}ms`
          : "Degraded";
      case "error":
        return "Connection Failed";
      default:
        return "Unknown";
    }
  };

  const getStatusIcon = () => {
    if (isConnecting) {
      return <Loader2 className="h-2 w-2 animate-spin" />;
    }

    // Show spinner if connection is active but health check hasn't fired yet
    if (!connectionHealth && databaseService.isConnectionActive(connectionId)) {
      return <Loader2 className="h-2 w-2 animate-spin" />;
    }

    if (connectionHealth?.status === "error") {
      return <AlertCircle className="h-3 w-3" />;
    }

    return (
      <Circle
        className={cn(
          "h-2 w-2 fill-current",
          getStatusColor(),
          connectionHealth?.status === "ready" && "animate-pulse",
        )}
      />
    );
  };

  const handleGoHome = async () => {
    try {
      console.log("Going home from workspace:", connectionId);

      // Disconnect from the current database
      if (connectionId && databaseService.isConnectionActive(connectionId)) {
        await databaseService.disconnect(connectionId);
      }

      // Check if we're in a separate window or the main window
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const currentWindow = WebviewWindow.getCurrent();
      const windowLabel = currentWindow.label;

      if (windowLabel === "main") {
        // We're in the main window, just navigate
        void navigate("/");
      } else {
        // We're in a separate workspace window
        // Show main window first
        const mainWindow = await WebviewWindow.getByLabel("main");
        if (mainWindow) {
          await mainWindow.show();
          await mainWindow.setFocus();
        }
        // Close current workspace window
        await currentWindow.close();
      }
    } catch (error) {
      console.error("Failed to go home:", error);
      // Fallback: navigate using React Router
      void navigate("/");
    }
  };

  const handleReload = () => {
    // Don't disconnect before reload - backend connections persist across frontend refreshes
    // Disconnecting causes blank screen because connection is gone after reload
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
      const targetConnection = connections.find(
        (c) => c.profile.id === targetConnectionId,
      );

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
        await windowManager.openWorkspace(
          targetConnectionId,
          targetConnection.profile.name,
        );
      }
    } catch (error) {
      console.error("Failed to switch connection:", error);
      // Fallback: navigate in current window
      await navigate(`/workspace/${targetConnectionId}`);
    }
  };

  const handleOpenErd = () => {
    const { focusedPanelId, panelContents, addTab, focusPanel } =
      useWorkbenchStore.getState();

    const erdTabId = `erd-${connectionId}`;
    const erdMetadata = {
      type: "erd" as const,
      title: "ERD",
      connectionId,
      database: connection?.database,
      schema: "public",
    };

    let targetPanelId = focusedPanelId;

    if (!targetPanelId) {
      const firstPanel = Array.from(panelContents.entries())[0];
      if (firstPanel) {
        targetPanelId = firstPanel[0];
        focusPanel(firstPanel[0]);
      }
    }

    if (targetPanelId) {
      addTab(targetPanelId, erdTabId, erdMetadata);
      return;
    }
  };

  return (
    <div
      className="relative flex items-center justify-between h-8 bg-secondary"
      data-tauri-drag-region
    >
      {/* Left Section - Add padding for macOS traffic lights */}
      <div className="flex items-center gap-2 pl-24">
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
                      key={conn.profile.id}
                      value={`${conn.profile.name} ${conn.profile.db_type} ${
                        conn.profile.host || ""
                      }`}
                      onSelect={() => handleSwitchConnection(conn.profile.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Database className={cn("h-4 w-4")} />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {conn.profile.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {conn.profile.db_type} •{" "}
                              {conn.profile.host || "localhost"}:
                              {conn.profile.port || ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          {conn.profile.id === connectionId && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                          {openWindows.includes(conn.profile.id) &&
                            conn.profile.id !== connectionId && (
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

        {/* Pending Changes Count */}
        {totalChanges > 0 && (
          <>
            <div
              className="h-3 w-px bg-border flex-shrink-0"
              data-tauri-drag-region
            />
            {/* Undo/Redo buttons */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo"
                >
                  <Undo2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Undo (Cmd+Z)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo"
                >
                  <Redo2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Redo (Cmd+Shift+Z)</p>
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowGlobalChanges(true);
              }}
              className="h-5 px-2 text-xs gap-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-full"
              title="Click to review and commit changes"
            >
              <GitCommit className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
              <span className="font-medium text-orange-600 dark:text-orange-400">
                {totalChanges} {totalChanges === 1 ? "change" : "changes"}
              </span>
            </Button>
          </>
        )}
      </div>

      {/* Center Section - Absolute positioning for true center */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-3 text-xs max-w-[40%] min-w-0 select-none">
        {/* Database Name with Type */}
        <div className="flex items-center gap-2 min-w-0" data-tauri-drag-region>
          <span className="font-medium text-xs truncate" data-tauri-drag-region>
            {connection?.name || "Loading..."}
          </span>
          <span
            className="text-muted-foreground whitespace-nowrap"
            data-tauri-drag-region
          >
            {connection ? connection.db_type : ""}
            {serverVersion && ` ${serverVersion}`}
          </span>
        </div>

        {/* Connection Details */}
        {connection?.host && (
          <>
            <div className="h-3 w-px bg-border flex-shrink-0" />
            <span
              className="text-muted-foreground truncate min-w-0"
              data-tauri-drag-region
            >
              {connection.host}:{connection.port}/{connection.database}
            </span>
          </>
        )}

        {/* Connection Status Badge */}
        <div
          className="h-3 w-px bg-border flex-shrink-0"
          data-tauri-drag-region
        />
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all whitespace-nowrap",
            connectionHealth?.status === "ready" && "bg-green-500/10",
            connectionHealth?.status === "degraded" && "bg-yellow-500/10",
            connectionHealth?.status === "error" &&
              "bg-red-500/20 border border-red-500/30 animate-pulse",
            (!connectionHealth || isConnecting) && "bg-gray-500/10",
          )}
          title={connectionHealth?.error || "Connection status"}
          data-tauri-drag-region
        >
          {getStatusIcon()}
          <span
            className={cn("font-medium", getStatusColor())}
            data-tauri-drag-region
          >
            {getStatusText()}
          </span>
        </div>

        {/* Reconnect button for error state */}
        {(!connectionHealth || connectionHealth.status === "error") &&
          !isConnecting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReconnect}
              className="h-5 px-2 text-xs gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reconnect
            </Button>
          )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2 pr-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleOpenErd}
          title="Open ERD"
        >
          <Waypoints className="h-3.5 w-3.5" />
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
          <PanelLeft className={cn("h-3.5 w-3.5")} />
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
          <Bot className="h-3.5 w-3.5" />
        </Button>

        {/* Settings Dropdown - Now at the far right */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Monitor className="mr-2 h-4 w-4" />
                <span>Theme</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("light");
                  }}
                >
                  <Sun className="mr-2 h-4 w-4" />
                  <span>Light</span>
                  {theme === "light" && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("dark");
                  }}
                >
                  <Moon className="mr-2 h-4 w-4" />
                  <span>Dark</span>
                  {theme === "dark" && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("system");
                  }}
                >
                  <Monitor className="mr-2 h-4 w-4" />
                  <span>System</span>
                  {theme === "system" && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                openPreferences("general");
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>Preferences</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Global Changes Modal */}
      <GlobalChangesModal
        connectionId={connectionId}
        open={showGlobalChanges}
        onOpenChange={setShowGlobalChanges}
      />
    </div>
  );
}
