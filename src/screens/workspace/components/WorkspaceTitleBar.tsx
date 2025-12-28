import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  IconHome,
  IconRefresh,
  IconLock,
  IconSettings,
  IconLayoutSidebar,
  IconCheck,
  IconDatabase,
  IconCircle,
  IconSitemap,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconAlertCircle,
  IconLoader2,
  IconRotate,
  IconRobot,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconGitCommit,
} from "@tabler/icons-react";
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
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import type { DbType } from "@/types/connection";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Fuse, { type IFuseOptions } from "fuse.js";
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
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { getDatabaseLogo } from "@/utils/databaseLogos";

interface WorkspaceTitleBarProps {
  connectionId: string;
  isConnecting?: boolean;
}

interface DatabaseItem {
  name: string;
  hasProfile: boolean;
  isCurrent: boolean;
}

interface SavedProfileItem {
  id: string;
  name: string;
  database: string;
  host: string;
  port: number;
  db_type: DbType;
}

// Fuse.js configuration for database fuzzy search
const DATABASE_FUSE_OPTIONS: IFuseOptions<DatabaseItem> = {
  keys: ["name"],
  threshold: 0.3, // Lower = more strict matching
  includeScore: true,
  minMatchCharLength: 1,
};

export function WorkspaceTitleBar({
  connectionId,
  isConnecting: isInitiallyConnecting = false,
}: WorkspaceTitleBarProps) {
  // Optimized selectors - only subscribe to what we need
  const storedConnection = useConnectionStore(
    useCallback(
      (s) => s.connections.find((c) => c.profile.id === connectionId),
      [connectionId],
    ),
  );
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);
  // Get connections only for the groupedDatabases calculation
  const connections = useConnectionStore((s) => s.connections);

  const connection = storedConnection?.profile;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] =
    useState<ConnectionHealth | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { theme, setTheme } = useTheme();
  const [isOpeningWindow, setIsOpeningWindow] = useState(false);

  // Query for databases list
  const { data: databases = [], isLoading: isLoadingDatabases } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => {
      if (!databaseService.isConnectionActive(connectionId)) {
        return [];
      }
      return await databaseService.listDatabases(connectionId);
    },
    enabled: !!connectionId && databaseService.isConnectionActive(connectionId),
    staleTime: 60_000, // 1 minute
    retry: 2,
  });

  // Pre-compute database items (only when databases/connections/connection change)
  const databaseItems = useMemo<DatabaseItem[]>(() => {
    if (!connection) return [];
    return databases.map((db) => {
      const hasProfile = connections.some(
        (conn) =>
          conn.profile.host === connection.host &&
          conn.profile.port === connection.port &&
          conn.profile.database === db &&
          conn.profile.username === connection.username,
      );
      const isCurrent = db === selectedDatabase;
      return { name: db, hasProfile, isCurrent };
    });
  }, [databases, connections, connection, selectedDatabase]);

  // Pre-compute other profile items (only when connections/connection change)
  const otherProfileItems = useMemo<SavedProfileItem[]>(() => {
    if (!connection) return [];
    return connections
      .filter((conn) => {
        const isSameServer =
          conn.profile.host === connection.host &&
          conn.profile.port === connection.port &&
          conn.profile.username === connection.username;
        return !isSameServer;
      })
      .map((conn) => ({
        id: conn.profile.id,
        name: conn.profile.name,
        database: conn.profile.database || "",
        host: conn.profile.host,
        port: conn.profile.port,
        db_type: conn.profile.db_type,
      }));
  }, [connections, connection]);

  // Create Fuse indexes only when data changes (not on every search)
  const dbFuse = useMemo(
    () => new Fuse(databaseItems, DATABASE_FUSE_OPTIONS),
    [databaseItems],
  );
  const profileFuse = useMemo(
    () =>
      new Fuse(otherProfileItems, {
        keys: ["name", "database"],
        threshold: 0.3,
        includeScore: true,
      }),
    [otherProfileItems],
  );

  // Filter results based on search query
  const groupedDatabases = useMemo(() => {
    if (!connection) {
      return { current: null, thisServer: [], otherProfiles: [] };
    }

    let filteredDatabases = databaseItems;
    let filteredOtherProfiles = otherProfileItems;

    if (searchQuery.trim()) {
      filteredDatabases = dbFuse.search(searchQuery).map((r) => r.item);
      filteredOtherProfiles = profileFuse
        .search(searchQuery)
        .map((r) => r.item);
    }

    const current = filteredDatabases.find((db) => db.isCurrent) || null;
    const thisServer = filteredDatabases.filter((db) => !db.isCurrent);

    return { current, thisServer, otherProfiles: filteredOtherProfiles };
  }, [
    connection,
    databaseItems,
    otherProfileItems,
    dbFuse,
    profileFuse,
    searchQuery,
  ]);
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

  // IconKeyboard shortcuts
  useCommand(
    "workspace.commitAll",
    async () => {
      if (totalChanges > 0) {
        try {
          logger.info(
            "[WorkspaceTitleBar] Cmd+S pressed - committing all changes",
          );

          // Get all staged commands before committing
          const stagedCommandsSnapshot = Array.from(stagedCommands.entries());

          const results = await commitAll();
          const totalCommitted = Object.values(results).reduce(
            (sum, result) => sum + result.committed.length,
            0,
          );

          logger.info(
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
              logger.info(
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

  // Update document title with unsaved changes indicator
  useEffect(() => {
    const dbName = selectedDatabase || connection?.database || "Query Pilot";
    const baseTitle = `${dbName} - Query Pilot`;
    document.title = totalChanges > 0 ? `* ${baseTitle}` : baseTitle;

    // Cleanup: reset title on unmount
    return () => {
      document.title = "Query Pilot";
    };
  }, [totalChanges, selectedDatabase, connection?.database]);

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

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      try {
        if (databaseService.isConnectionActive(connectionId)) {
          await databaseService.disconnect(connectionId);
        }
      } catch (error) {
        logger.error("Failed to disconnect:", error);
        toast.error("Failed to disconnect", {
          description:
            error instanceof Error
              ? error.message
              : "Failed to disconnect from the database.",
        });
      }
      // Get the currently selected database from store to maintain it on reconnect
      const selectedDatabase = useWorkspaceSelectionStore.getState().database;
      await databaseService.connectById(
        connectionId,
        selectedDatabase || undefined,
      );
      // Emit event to refresh sidebar data
      await safeEmit("database-reconnected", { connectionId });
      toast.success("Reconnection Successful", {
        description: "Successfully reconnected to the database.",
      });
    } catch (error) {
      logger.error("Failed to reconnect:", error);
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

    // IconCheck if connection is active before showing gray
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

    // IconCheck if connection is actually active before showing "Disconnected"
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
      return <IconLoader2 className="h-2 w-2 animate-spin" />;
    }

    // Show spinner if connection is active but health check hasn't fired yet
    if (!connectionHealth && databaseService.isConnectionActive(connectionId)) {
      return <IconLoader2 className="h-2 w-2 animate-spin" />;
    }

    if (connectionHealth?.status === "error") {
      return <IconAlertCircle className="h-3 w-3" />;
    }

    return (
      <IconCircle
        className={cn(
          "h-2 w-2 fill-current",
          getStatusColor(),
        )}
      />
    );
  };

  const handleGoHome = async () => {
    try {
      logger.info("Going home from workspace:", connectionId);

      // Disconnect from the current database
      if (connectionId && databaseService.isConnectionActive(connectionId)) {
        await databaseService.disconnect(connectionId);
      }

      // IconCheck if we're in a separate window or the main window
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
      logger.error("Failed to go home:", error);
      // Fallback: navigate using React Router
      void navigate("/");
    }
  };

  const handleReload = () => {
    // Don't disconnect before reload - backend connections persist across frontend refreshes
    // Disconnecting causes blank screen because connection is gone after reload
    window.location.reload();
  };

  const handleSelectDatabase = async (dbName: string, hasProfile: boolean) => {
    // Prevent multiple simultaneous window operations
    if (isOpeningWindow) {
      logger.info(
        `[WorkspaceTitleBar] Already opening a window, ignoring request for ${dbName}`,
      );
      return;
    }

    if (dbName === selectedDatabase) {
      setOpen(false);
      return; // Already on this database
    }

    setOpen(false); // Close the popover
    setIsOpeningWindow(true);

    try {
      if (!connection) {
        logger.error("Current connection not found");
        return;
      }

      logger.info(
        `[WorkspaceTitleBar] Selecting database ${dbName}, hasProfile: ${hasProfile}, currentConnectionId: ${connectionId}`,
      );

      const connectionStore = useConnectionStore.getState();
      let targetConnectionId: string;

      if (hasProfile) {
        // Existing profile - find it
        const existingConnection = connectionStore.findConnectionByDatabase(
          connection.host,
          connection.port,
          dbName,
          connection.username,
        );

        if (!existingConnection) {
          logger.error(
            `[WorkspaceTitleBar] Profile not found for database ${dbName}`,
          );
          return;
        }

        logger.info(
          `[WorkspaceTitleBar] Using existing profile for database ${dbName}: ${existingConnection.profile.id}`,
        );
        targetConnectionId = existingConnection.profile.id;
      } else {
        // New profile - create it
        logger.info(
          `[WorkspaceTitleBar] Creating new profile for database ${dbName} from source ${connectionId}`,
        );

        // CRITICAL: IconCheck if we're already creating a profile for this database
        // This prevents infinite loops where opening a window triggers another profile creation
        const existingBeforeCreate = connectionStore.findConnectionByDatabase(
          connection.host,
          connection.port,
          dbName,
          connection.username,
        );

        if (existingBeforeCreate) {
          logger.info(
            `[WorkspaceTitleBar] Profile was just created for ${dbName}, using it: ${existingBeforeCreate.profile.id}`,
          );
          targetConnectionId = existingBeforeCreate.profile.id;
        } else {
          targetConnectionId =
            await connectionStore.getOrCreateDatabaseConnection(
              connectionId,
              dbName,
            );

          logger.info(
            `[WorkspaceTitleBar] Created new profile with ID: ${targetConnectionId}`,
          );

          // Note: No need to refetch - the store already updated its cache
          // and the UI will re-render automatically via Zustand subscriptions
        }
      }

      logger.info(
        `[WorkspaceTitleBar] Target connectionId: ${targetConnectionId}, isWorkspaceOpen: ${windowManager.isWorkspaceOpen(
          targetConnectionId,
        )}`,
      );

      // IconCheck if we need to open a new window or if one already exists
      if (windowManager.isWorkspaceOpen(targetConnectionId)) {
        // Window exists, focus it
        logger.info(
          `[WorkspaceTitleBar] Focusing existing window for ${dbName}`,
        );
        await windowManager.focusWorkspace(targetConnectionId);
      } else {
        // Create new window for this database (keep current window open)
        logger.info(
          `[WorkspaceTitleBar] Opening new window for ${dbName} with connectionId: ${targetConnectionId}`,
        );
        await windowManager.openWorkspace(
          targetConnectionId,
          dbName, // Use database name as window title
          {
            database: dbName,
          },
        );
        logger.info(`[WorkspaceTitleBar] New window opened successfully`);
      }
    } catch (error) {
      logger.error("Failed to select database:", error);
      toast.error("Failed to select database", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Reset the flag after a delay to allow window creation to complete
      setTimeout(() => {
        setIsOpeningWindow(false);
      }, 1000);
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
      <div className="flex items-center gap-2.5 pl-20">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleGoHome}
          title="Go to home"
        >
          <IconHome className="!size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleReload}
          title="Reload workspace"
        >
          <IconRefresh className="!size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          title="Connection security"
        >
          <IconLock className="!size-4" />
        </Button>

        <Popover
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) setSearchQuery(""); // Clear search on close
          }}
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                title="Select database"
                disabled={isLoadingDatabases}
              >
                <IconDatabase className="!size-4" />
              </Button>
            }
          />
          <PopoverContent className="w-80 p-0" align="start">
            <Command
              className="[&_[cmdk-input]]:outline-none [&_[cmdk-input]]:focus:outline-none"
              shouldFilter={false}
            >
              <CommandInput
                placeholder="Search databases..."
                className="h-8 text-xs focus-visible:ring-0"
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandList>
                <CommandEmpty>
                  {isLoadingDatabases
                    ? "Loading databases..."
                    : "No databases found."}
                </CommandEmpty>

                {/* Section 1: Current IconDatabase */}
                {groupedDatabases.current && (
                  <CommandGroup
                    heading="Current"
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    <CommandItem
                      key={groupedDatabases.current.name}
                      value={groupedDatabases.current.name}
                      onSelect={() => {
                        setOpen(false);
                      }}
                      className="cursor-pointer py-1.5 px-2 bg-accent/50"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          {connection?.db_type ? (
                            <img
                              src={getDatabaseLogo(connection.db_type)}
                              alt="database"
                              className="h-3.5 w-3.5 shrink-0"
                            />
                          ) : (
                            <IconDatabase className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          )}
                          <span className="text-xs font-semibold truncate">
                            {groupedDatabases.current.name}
                          </span>
                        </div>
                        <IconCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}

                {/* Section 2: Other Databases on This IconServer */}
                {groupedDatabases.thisServer.length > 0 && (
                  <CommandGroup
                    heading="On this Server"
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {groupedDatabases.thisServer.map((dbItem) => {
                      return (
                        <CommandItem
                          key={dbItem.name}
                          value={dbItem.name}
                          onSelect={() => {
                            void handleSelectDatabase(
                              dbItem.name,
                              dbItem.hasProfile,
                            );
                            setSearchQuery("");
                          }}
                          className="cursor-pointer py-1.5 px-2"
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              {connection?.db_type ? (
                                <img
                                  src={getDatabaseLogo(connection.db_type)}
                                  alt="database"
                                  className="h-3.5 w-3.5 shrink-0"
                                />
                              ) : (
                                <IconDatabase
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    dbItem.hasProfile
                                      ? "text-blue-500"
                                      : "text-muted-foreground",
                                  )}
                                />
                              )}
                              <span
                                className={cn(
                                  "text-xs truncate",
                                  dbItem.hasProfile && "font-medium",
                                )}
                              >
                                {dbItem.name}
                              </span>
                            </div>
                            {dbItem.hasProfile && (
                              <IconCircle className="!h-2 !w-2 fill-primary text-primary shrink-0" />
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}

                {/* Section 3: Other Saved Profiles (Different Servers) */}
                {groupedDatabases.otherProfiles.length > 0 && (
                  <CommandGroup
                    heading="Saved profiles"
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {groupedDatabases.otherProfiles.map((profile) => {
                      return (
                        <CommandItem
                          key={profile.id}
                          value={`${profile.name} ${profile.database}`}
                          onSelect={() => {
                            // Switch to a different server connection
                            void windowManager.openWorkspace(
                              profile.id,
                              profile.name,
                              profile.database
                                ? { database: profile.database }
                                : undefined,
                            );
                            setSearchQuery("");
                            setOpen(false);
                          }}
                          className="cursor-pointer py-1.5 px-2"
                        >
                          <div className="flex flex-col gap-0.5 w-full">
                            <div className="flex items-center gap-2">
                              <img
                                src={getDatabaseLogo(profile.db_type)}
                                alt="database"
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              <span className="text-xs font-medium truncate">
                                {profile.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground pl-5 truncate">
                              {profile.host}:{profile.port}
                              {profile.database && ` / ${profile.database}`}
                            </span>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
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
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={undo}
                    disabled={!canUndo}
                    title="Undo"
                  >
                    <IconArrowBackUp className="!size-4" />
                  </Button>
                }
              />
              <TooltipContent>
                <p className="text-xs">Undo (Cmd+Z)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={redo}
                    disabled={!canRedo}
                    title="Redo"
                  >
                    <IconArrowForwardUp className="!size-4" />
                  </Button>
                }
              />
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
              className="h-5 px-2 text-xs gap-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-full animate-pulse"
              title="Click to review and commit changes"
            >
              <IconGitCommit className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
              <span className="font-medium text-orange-600 dark:text-orange-400">
                {totalChanges} {totalChanges === 1 ? "change" : "changes"}
              </span>
            </Button>
          </>
        )}
      </div>

      {/* Center Section - Absolute positioning for true center, shrinks when space is limited */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-1.5 text-xs max-w-[40%] min-w-0 select-none">
        {/* IconDatabase Name with Type */}
        <div
          className="flex items-center gap-1 min-w-0 flex-shrink"
          data-tauri-drag-region
        >
          <span className="font-medium text-xs truncate" data-tauri-drag-region>
            {selectedDatabase || connection?.database || "Loading..."}
          </span>
          <span
            className="text-muted-foreground whitespace-nowrap hidden lg:inline text-[10px]"
            data-tauri-drag-region
          >
            {connection?.db_type}
            {serverVersion && ` ${serverVersion}`}
          </span>
        </div>

        {/* Connection Details - Hidden on smaller screens */}
        {connection?.host && (
          <>
            <div className="h-3 w-px bg-border flex-shrink-0 hidden xl:block" />
            <span
              className="text-muted-foreground truncate min-w-0 hidden xl:inline text-[10px]"
              data-tauri-drag-region
            >
              {connection.host}:{connection.port}
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
            "flex items-center gap-1 px-1.5 py-0.5 rounded-full transition-all whitespace-nowrap flex-shrink-0",
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
            className={cn("font-medium hidden sm:inline", getStatusColor())}
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
              className="h-5 px-1.5 text-xs gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 flex-shrink-0"
            >
              <IconRotate className="h-2.5 w-2.5" />
              <span className="hidden sm:inline">Reconnect</span>
            </Button>
          )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2.5 pr-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleOpenErd}
          title="Open ERD"
        >
          <IconSitemap className="!size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            onToggleSidebar("left");
          }}
          title="Toggle left sidebar"
        >
          <IconLayoutSidebar className="!size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            onToggleSidebar("right");
          }}
          title="Toggle right sidebar"
        >
          <IconRobot className="!size-4" />
        </Button>

        {/* IconSettings Dropdown - Now at the far right */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                title="Settings"
              >
                <IconSettings className="!size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconDeviceDesktop className="mr-2 h-4 w-4" />
                <span>Theme</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("light");
                  }}
                >
                  <IconSun className="mr-2 h-4 w-4" />
                  <span>Light</span>
                  {theme === "light" && (
                    <IconCheck className="ml-auto h-4 w-4" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("dark");
                  }}
                >
                  <IconMoon className="mr-2 h-4 w-4" />
                  <span>Dark</span>
                  {theme === "dark" && (
                    <IconCheck className="ml-auto h-4 w-4" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setTheme("system");
                  }}
                >
                  <IconDeviceDesktop className="mr-2 h-4 w-4" />
                  <span>System</span>
                  {theme === "system" && (
                    <IconCheck className="ml-auto h-4 w-4" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                openPreferences("general");
              }}
            >
              <IconSettings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Global Changes Dialog */}
      <GlobalChangesDialog
        connectionId={connectionId}
        open={showGlobalChanges}
        onOpenChange={setShowGlobalChanges}
      />
    </div>
  );
}
