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
  IconExternalLink,
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
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { useAppStore } from "@/stores/appStore";
import { toast } from "sonner";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
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
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
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
    isCommittingAll,
    setIsCommittingAll,
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
  const [commitProgress, setCommitProgress] = useState(0);
  const commitProgressRef = useRef<NodeJS.Timeout | null>(null);

  // IconKeyboard shortcuts
  useCommand(
    "workspace.commitAll",
    async () => {
      // Prevent double-commit
      if (isCommittingAll) {
        logger.info("[WorkspaceTitleBar] Already committing, ignoring Cmd+S");
        return;
      }

      if (totalChanges > 0) {
        setIsCommittingAll(true);
        setCommitProgress(0);

        // Start progress animation with different speeds:
        // 0-80%: fast, 80-90%: slower, 90-98%: much slower, then wait
        let progress = 0;
        commitProgressRef.current = setInterval(() => {
          if (progress < 80) {
            // Fast: 0-80%
            progress += 4;
          } else if (progress < 90) {
            // Slower: 80-90%
            progress += 0.5;
          } else if (progress < 98) {
            // Much slower: 90-98%
            progress += 0.1;
          }
          // Stop at 98% and wait for completion
          if (progress > 98) progress = 98;
          setCommitProgress(progress);
        }, 50);

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
          const { clearCommittedChanges } = useCrudStore.getState();
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
            // Clear committed changes from store
            clearCommittedChanges(tableKey);
          });

          // Complete progress to 100%
          if (commitProgressRef.current)
            clearInterval(commitProgressRef.current);
          setCommitProgress(100);

          toast.success("All changes committed", {
            description: `Successfully committed ${totalCommitted} change${
              totalCommitted === 1 ? "" : "s"
            }`,
          });

          // Hide progress bar after brief delay
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          // Stop progress on error
          if (commitProgressRef.current)
            clearInterval(commitProgressRef.current);
          setCommitProgress(0);

          toast.error("Commit failed", {
            description:
              error instanceof Error
                ? error.message
                : "Failed to commit changes",
          });
        } finally {
          setIsCommittingAll(false);
          setCommitProgress(0);
          if (commitProgressRef.current) {
            clearInterval(commitProgressRef.current);
            commitProgressRef.current = null;
          }
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

  // Get workspace bundle store for window title and workspace actions
  const getWindowTitle = useWorkspaceBundleStore((s) => s.getWindowTitle);
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const addConnectionToWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToWorkspace,
  );
  const setFocusedConnection = useWorkspaceBundleStore(
    (s) => s.setFocusedConnection,
  );

  // Update document title with unsaved changes indicator and workspace name
  useEffect(() => {
    // If in a named workspace, use workspace title
    if (activeWorkspace && !activeWorkspace.isTemporary) {
      document.title = getWindowTitle();
    } else {
      // Fallback to database name for single connection or temp workspace
      const dbName = selectedDatabase || connection?.database || "Query Pilot";
      const baseTitle = `${dbName} - Query Pilot`;
      document.title = totalChanges > 0 ? `• ${baseTitle}` : baseTitle;
    }

    // Cleanup: reset title on unmount
    return () => {
      document.title = "Query Pilot";
    };
  }, [
    totalChanges,
    selectedDatabase,
    connection?.database,
    activeWorkspace,
    getWindowTitle,
  ]);

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

    // Track if we've shown CRUD warning to avoid spam
    let crudWarningShown = false;

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

          // Show warning if there are pending CRUD changes
          const { stagedCommands } = useCrudStore.getState();
          const hasPendingChanges = Array.from(stagedCommands.entries()).some(
            ([tableKey, commands]) =>
              tableKey.startsWith(`${connectionId}:`) && commands.length > 0,
          );

          if (hasPendingChanges && !crudWarningShown) {
            toast.warning("Unsaved Changes at Risk", {
              description:
                "You have unsaved CRUD changes and connection is offline. Consider saving your work.",
              duration: 8000,
            });
            crudWarningShown = true;
          }
        } else if (
          health.status === "ready" &&
          previousHealth?.status === "error"
        ) {
          toast.success("Connection Restored", {
            description: "Successfully reconnected to the database.",
          });
          crudWarningShown = false; // Reset warning flag on successful reconnect
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
      <IconCircle className={cn("h-2 w-2 fill-current", getStatusColor())} />
    );
  };

  const handleGoHome = async () => {
    try {
      logger.info("Going home from workspace:", connectionId);

      // Disconnect from the current database (with timeout to prevent freeze on dead connections)
      if (connectionId && databaseService.isConnectionActive(connectionId)) {
        await databaseService.disconnectWithTimeout(connectionId, 3000);
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

  /**
   * Get or create connection profile for a database
   */
  const getOrCreateConnectionForDatabase = async (
    dbName: string,
    hasProfile: boolean,
  ): Promise<string | null> => {
    if (!connection) {
      logger.error("Current connection not found");
      return null;
    }

    const connectionStore = useConnectionStore.getState();

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
        return null;
      }

      return existingConnection.profile.id;
    } else {
      // New profile - create it
      const existingBeforeCreate = connectionStore.findConnectionByDatabase(
        connection.host,
        connection.port,
        dbName,
        connection.username,
      );

      if (existingBeforeCreate) {
        return existingBeforeCreate.profile.id;
      }

      return await connectionStore.getOrCreateDatabaseConnection(
        connectionId,
        dbName,
      );
    }
  };

  /**
   * Open database in a new window (default action)
   */
  const handleOpenDatabaseNewWindow = async (
    dbName: string,
    hasProfile: boolean,
  ) => {
    if (isOpeningWindow) return;
    if (dbName === selectedDatabase) {
      setOpen(false);
      return;
    }

    setOpen(false);
    setIsOpeningWindow(true);

    try {
      const targetConnectionId = await getOrCreateConnectionForDatabase(
        dbName,
        hasProfile,
      );
      if (!targetConnectionId) return;

      if (windowManager.isWorkspaceOpen(targetConnectionId)) {
        await windowManager.focusWorkspace(targetConnectionId);
      } else {
        await windowManager.openWorkspace(targetConnectionId, dbName, {
          database: dbName,
        });
      }
    } catch (error) {
      logger.error("Failed to open database in new window:", error);
      toast.error("Failed to open database", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTimeout(() => {
        setIsOpeningWindow(false);
      }, 1000);
    }
  };

  /**
   * Handle database selection - uses add-to-workspace flow.
   * If connection exists in workspace, just focus it.
   * If not, create/find connection and add to workspace.
   */
  const handleDatabaseSelect = async (
    dbName: string,
    hasProfile: boolean,
  ) => {
    if (!activeWorkspace) {
      toast.error("No active workspace");
      return;
    }

    // If clicking on current database, just close
    if (dbName === selectedDatabase) {
      setOpen(false);
      return;
    }

    setOpen(false);

    try {
      const targetConnectionId = await getOrCreateConnectionForDatabase(
        dbName,
        hasProfile,
      );
      if (!targetConnectionId) return;

      // Check if connection already exists in workspace
      if (activeWorkspace.connections.has(targetConnectionId)) {
        // Just focus the existing connection
        setFocusedConnection(targetConnectionId);
        logger.info(`[WorkspaceTitleBar] Focused existing connection: ${targetConnectionId}`);
      } else {
        // Add to workspace (this also sets focus to the new connection)
        await addConnectionToWorkspace(targetConnectionId);
        logger.info(`[WorkspaceTitleBar] Added and focused connection: ${targetConnectionId}`);
      }
    } catch (error) {
      logger.error("Failed to switch database:", error);
      toast.error("Failed to switch database", {
        description: error instanceof Error ? error.message : String(error),
      });
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
      {/* Commit Progress Bar - Windows 11 style with 3 layers */}
      {(isCommittingAll || commitProgress > 0) && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 z-50">
          {/* Layer 1: Background track */}
          <div className="absolute inset-0 bg-primary/20" />

          {/* Layer 2: Main progress bar (solid) */}
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-all duration-150 ease-out"
            style={{ width: `${commitProgress}%` }}
          />

          {/* Layer 3: Shimmer overlay (only when waiting at 98%+) */}
          {commitProgress >= 98 && (
            <div
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${commitProgress}%` }}
            >
              <div className="absolute inset-0 animate-progress-shimmer" />
            </div>
          )}
        </div>
      )}

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

        <Button variant="ghost" size="icon-sm" title="Connection security">
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

                {/* Section 2: Other Databases on This Server */}
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
                            void handleDatabaseSelect(
                              dbItem.name,
                              dbItem.hasProfile,
                            );
                            setSearchQuery("");
                          }}
                          className="cursor-pointer py-1.5 px-2 group/db-item"
                        >
                          <div className="flex items-center justify-between w-full gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
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
                              {dbItem.hasProfile && (
                                <IconCircle className="!h-2 !w-2 fill-primary text-primary shrink-0" />
                              )}
                            </div>
                            {/* Open in New Window button - visible on hover */}
                            <div className="flex items-center gap-1 opacity-0 group-hover/db-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 transition-opacity shrink-0">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleOpenDatabaseNewWindow(
                                          dbItem.name,
                                          dbItem.hasProfile,
                                        );
                                      }}
                                      className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                                    >
                                      <IconExternalLink className="!h-3.5 !w-3.5" />
                                    </button>
                                  }
                                />
                                <TooltipContent side="top" className="text-xs">
                                  Open in New Window
                                </TooltipContent>
                              </Tooltip>
                            </div>
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
                      // Open in new window action
                      const handleOpenProfileNewWindow = () => {
                        void windowManager.openWorkspace(
                          profile.id,
                          profile.name,
                          profile.database
                            ? { database: profile.database }
                            : undefined,
                        );
                        setSearchQuery("");
                        setOpen(false);
                      };

                      // Add-to-workspace action (default click)
                      const handleSelectProfile = async () => {
                        if (!activeWorkspace) {
                          toast.error("No active workspace");
                          return;
                        }

                        setOpen(false);

                        // Check if connection already exists in workspace
                        if (activeWorkspace.connections.has(profile.id)) {
                          // Just focus the existing connection
                          setFocusedConnection(profile.id);
                          logger.info(`[WorkspaceTitleBar] Focused existing profile: ${profile.id}`);
                        } else {
                          // Add to workspace (this also sets focus to the new connection)
                          await addConnectionToWorkspace(profile.id);
                          logger.info(`[WorkspaceTitleBar] Added and focused profile: ${profile.id}`);
                        }
                      };

                      return (
                        <CommandItem
                          key={profile.id}
                          value={profile.id}
                          onSelect={() => {
                            void handleSelectProfile();
                          }}
                          className="cursor-pointer py-1.5 px-2 group/profile-item"
                        >
                          <div className="flex items-center justify-between w-full gap-2">
                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
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
                            {/* Open in New Window button - visible on hover */}
                            <div className="flex items-center gap-1 opacity-0 group-hover/profile-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 transition-opacity shrink-0">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenProfileNewWindow();
                                      }}
                                      className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                                    >
                                      <IconExternalLink className="!h-3.5 !w-3.5" />
                                    </button>
                                  }
                                />
                                <TooltipContent side="top" className="text-xs">
                                  Open in New Window
                                </TooltipContent>
                              </Tooltip>
                            </div>
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
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-1.5 text-xs max-w-[50%] min-w-0 select-none">
        {/* Workspace Name (if named workspace) */}
        {activeWorkspace && !activeWorkspace.isTemporary && (
          <>
            <span className="font-medium text-xs truncate" data-tauri-drag-region>
              {activeWorkspace.config.name}
            </span>
            <div className="h-3 w-px bg-border flex-shrink-0" data-tauri-drag-region />
          </>
        )}

        {/* IconDatabase Name with Type */}
        <div
          className="flex items-center gap-1 min-w-0 flex-shrink"
          data-tauri-drag-region
        >
          <span className={cn(
            "text-xs truncate",
            activeWorkspace?.isTemporary ? "font-medium" : "text-muted-foreground"
          )} data-tauri-drag-region>
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
              <Button variant="ghost" size="icon-sm" title="Settings">
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
