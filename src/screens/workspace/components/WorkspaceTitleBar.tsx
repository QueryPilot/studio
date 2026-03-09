import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  IconHome,
  IconRefresh,
  IconSettings,
  IconLayoutSidebar,
  IconCheck,
  IconDatabase,
  IconCircle,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconAlertCircle,
  IconLoader2,
  IconRotate,
  IconSparkles,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconGitCommit,
} from "@tabler/icons-react";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useCrudStore } from "@/stores/crudStore";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCommand } from "@/hooks/useCommand";
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
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import type { CrudOperationType, TableCreatePayload } from "@/types/crud";
import { eventBus } from "@/services/eventBus";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { openAppUpdateDialog } from "@/utils/appUpdate";
import { saveWindowBounds } from "@/services/windowManager";

interface WorkspaceTitleBarProps {
  connectionId: string;
  isConnecting?: boolean;
}

const SCHEMA_INVALIDATION_TYPES = new Set<CrudOperationType>([
  "table.create",
  "table.drop",
  "table.duplicate",
  "table.truncate",
  "table.rename",
  "view.create",
  "view.drop",
  "view.rename",
  "sequence.create",
  "sequence.drop",
  "sequence.rename",
]);

const parseDesignerTag = (
  tags: string[] | undefined,
): { panelId: string; tabId: string } | null => {
  const tag = tags?.find((item) => item.startsWith("table-designer:"));
  if (!tag) return null;

  const parts = tag.split(":");
  if (parts.length < 3) return null;
  const panelId = parts[1];
  const tabId = parts[2];
  if (!panelId || !tabId) return null;
  return { panelId, tabId };
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
  const connections = useConnectionStore((s) => s.connections);

  const connection = storedConnection?.profile;
  const navigate = useNavigate();
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] =
    useState<ConnectionHealth | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const pendingUpdate = useAppStore((state) => state.pendingUpdate);
  const isDownloadingUpdate = useAppStore((state) => state.isDownloadingUpdate);
  const isInstallingUpdate = useAppStore((state) => state.isInstallingUpdate);
  const isUpdateBusy = isDownloadingUpdate || isInstallingUpdate;


  const { toggleSidebar: onToggleSidebar } = useWorkspaceScreenStore();
  const { openPreferences } = usePreferencesStore();
  const flushLayout = useWorkbenchStore((s) => s.flushLayout);
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

  // Calculate total pending changes across the workspace
  const totalChanges = useMemo(() => {
    let count = 0;
    stagedCommands.forEach((commands) => {
      count += commands.length;
    });
    return count;
  }, [stagedCommands]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const [showGlobalChanges, setShowGlobalChanges] = useState(false);
  const [commitProgress, setCommitProgress] = useState(0);
  const commitProgressRef = useRef<number | null>(null);

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

        // Start progress animation with rAF for smooth rendering
        // 0-80%: fast, 80-90%: slower, 90-98%: much slower, then wait
        let progress = 0;
        let lastTime = performance.now();
        const animateProgress = (now: number) => {
          const dt = now - lastTime;
          lastTime = now;
          // Scale increments by elapsed time (~50ms baseline)
          const scale = dt / 50;
          if (progress < 80) {
            progress += 4 * scale;
          } else if (progress < 90) {
            progress += 0.5 * scale;
          } else if (progress < 98) {
            progress += 0.1 * scale;
          }
          if (progress > 98) progress = 98;
          setCommitProgress(progress);
          commitProgressRef.current = requestAnimationFrame(animateProgress);
        };
        commitProgressRef.current = requestAnimationFrame(animateProgress);

        try {
          logger.info(
            "[WorkspaceTitleBar] Cmd+S pressed - committing all changes",
          );

          // Get all staged commands before committing
          const stagedCommandsSnapshot = Array.from(stagedCommands.entries());
          const schemaInvalidations = new Set<string>();
          const tableInvalidations = new Set<string>();
          const designerTransitions = new Map<
            string,
            {
              panelId: string;
              tabId: string;
              connectionId: string;
              database: string;
              schema: string;
              table: string;
              timestamp: number;
            }
          >();

          stagedCommandsSnapshot.forEach(([tableKey, commands]) => {
            const [connId, db, sch = "public", tbl] = tableKey.split(":");
            if (!connId || !db) return;

            const hasSchemaChanges = commands.some((cmd) =>
              SCHEMA_INVALIDATION_TYPES.has(cmd.type),
            );

            if (hasSchemaChanges) {
              schemaInvalidations.add(`${connId}:${db}:${sch}`);
            } else if (tbl) {
              tableInvalidations.add(`${connId}:${db}:${sch}:${tbl}`);
            }

            commands.forEach((command) => {
              if (command.type !== "table.create") return;

              const location = parseDesignerTag(command.metadata.tags);
              if (!location) return;

              const payload = command.payload as TableCreatePayload;
              const payloadName = payload.tableName.trim();
              const targetName = (command.target.table || "").trim();
              const table = payloadName || targetName;
              if (!table || table.startsWith("__new_table_")) return;

              const designerSchema =
                (command.target.schema || "public").trim() || "public";
              const transitionKey = `${location.panelId}:${location.tabId}`;
              const timestampMs = Date.parse(command.metadata.timestamp);
              const timestamp = Number.isNaN(timestampMs) ? 0 : timestampMs;
              const existing = designerTransitions.get(transitionKey);

              if (!existing || timestamp >= existing.timestamp) {
                designerTransitions.set(transitionKey, {
                  panelId: location.panelId,
                  tabId: location.tabId,
                  connectionId: command.target.connectionId,
                  database: command.target.database || "",
                  schema: designerSchema,
                  table,
                  timestamp,
                });
              }
            });
          });

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

          // Broadcast invalidation for all affected tables/schemas
          const { invalidateTable, invalidateSchema } =
            useDataInvalidationStore.getState();
          const { clearCommittedChanges } = useCrudStore.getState();

          schemaInvalidations.forEach((schemaKey) => {
            const [connId, db, sch] = schemaKey.split(":");
            if (!connId || !db || !sch) return;

            logger.info(
              `[WorkspaceTitleBar] Invalidating schema: ${db}.${sch}`,
            );
            invalidateSchema(connId, db, sch);
          });

          tableInvalidations.forEach((tableInvalidationKey) => {
            const [connId, db, sch, tbl] = tableInvalidationKey.split(":");
            if (!connId || !db || !sch || !tbl) return;
            if (schemaInvalidations.has(`${connId}:${db}:${sch}`)) return;

            logger.info(
              `[WorkspaceTitleBar] Invalidating table: ${db}.${sch}.${tbl}`,
            );
            invalidateTable(connId, db, sch, tbl);
          });

          stagedCommandsSnapshot.forEach(([tableKey]) => {
            clearCommittedChanges(tableKey);
          });

          const { updateTabMetadata } = useWorkbenchStore.getState();
          designerTransitions.forEach((transition) => {
            const panel = useWorkbenchStore
              .getState()
              .panelContents.get(transition.panelId);
            if (!panel || !panel.tabIds.includes(transition.tabId)) return;

            updateTabMetadata(transition.panelId, transition.tabId, {
              type: "table",
              title: transition.table,
              table: transition.table,
              schema: transition.schema,
              connectionId: transition.connectionId,
              database: transition.database,
              kind: "Table",
              isView: false,
              viewType: "data",
              objectKey: `table-${transition.connectionId}-${transition.schema}-${transition.table}`,
            });
          });

          // Complete progress to 100%

          cancelAnimationFrame(commitProgressRef.current);
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

          cancelAnimationFrame(commitProgressRef.current);
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

          cancelAnimationFrame(commitProgressRef.current);
          commitProgressRef.current = null;
        }
      } else {
        const workbenchState = useWorkbenchStore.getState();
        const focusedPanelId = usePanelFocusStore.getState().focusedPanelId;
        const fallbackPanelId =
          focusedPanelId ?? Array.from(workbenchState.panelContents.keys())[0];
        if (!fallbackPanelId) return;

        const panel = workbenchState.panelContents.get(fallbackPanelId);
        if (!panel) return;
        const activeTabId = panel.activeTabId;
        if (!activeTabId) return;

        const activeMetadata = panel.metadata?.[activeTabId];
        if (activeMetadata?.type === "collection-design") {
          eventBus.emit("collection-designer:save", {
            panelId: fallbackPanelId,
            tabId: activeTabId,
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
  // Granular selectors — avoid re-rendering title bar on every connection status change
  const isAutoCreated = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.autoCreated ?? true,
  );
  const workspaceConfigId = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.id ?? null,
  );
  const workspaceName = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.name ?? null,
  );
  const workspaceConnectionCount = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.connectionIds.length ?? 0,
  );

  // Update document title with unsaved changes indicator and workspace name
  useEffect(() => {
    // If in a named (non-auto-created) workspace, use workspace title
    if (!isAutoCreated) {
      document.title = getWindowTitle();
    } else {
      // Fallback to database name for single connection or auto-created workspace
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
    isAutoCreated,
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
    const activeConnection =
      databaseService.getActiveConnection(connectionId);
    if (activeConnection?.server_version) {
      const match = activeConnection.server_version.match(/\d+\.?\d*/);
      setServerVersion(match ? match[0] : null);
      return;
    }

    // Connection might not be ready yet — poll briefly, then stop
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const conn = databaseService.getActiveConnection(connectionId);
      if (conn?.server_version) {
        const match = conn.server_version.match(/\d+\.?\d*/);
        setServerVersion(match ? match[0] : null);
        clearInterval(interval);
      } else if (attempts >= 10) {
        clearInterval(interval);
      }
    }, 1000);

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
      await useWorkspaceBundleStore.getState().reconnectConnection(connectionId);

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

      const persistenceScopeId = workspaceConfigId ?? connectionId;
      if (persistenceScopeId) {
        flushLayout(persistenceScopeId);
      }

      // Save window bounds before closing (window is still alive at this point)
      if (persistenceScopeId) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const position = await win.outerPosition();
          const size = await win.outerSize();
          await saveWindowBounds(persistenceScopeId, {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          });
        } catch (error) {
          logger.error("Failed to save window bounds:", error);
        }
      }

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
      <div className="flex items-center gap-2.5 pl-26">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleGoHome}
          title="Go to home"
        >
          <IconHome className="size-4!" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleReload}
          title="Reload workspace"
        >
          <IconRefresh className="size-4!" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          title="Select database"
          onClick={() => {
            const { openPalette, setNestedMode } =
              useCommandPaletteStore.getState();
            openPalette();
            setTimeout(() => {
              setNestedMode({ type: "switch-database" });
            }, 0);
          }}
        >
          <IconDatabase className="!size-4" />
        </Button>

        {/* Pending Changes Count */}
        {totalChanges > 0 && (
          <>
            <div
              className="h-3 w-px bg-border shrink-0"
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
              className="h-5 px-2 text-xs gap-1.5 rounded-full running-border"
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
        {/* Workspace Name (if named or multi-connection workspace) */}
        {!isAutoCreated || workspaceConnectionCount > 1 ? (
          <>
            <span
              className="font-medium text-xs truncate"
              data-tauri-drag-region
            >
              {workspaceName}
            </span>
            <span
              className="text-muted-foreground whitespace-nowrap text-[10px]"
              data-tauri-drag-region
            >
              {workspaceConnectionCount} connections
            </span>
          </>
        ) : (
          <>
            {/* Single-connection workspace: show workspace name if named */}
            {!isAutoCreated && (
              <>
                <span
                  className="font-medium text-xs truncate"
                  data-tauri-drag-region
                >
                  {workspaceName}
                </span>
                <div
                  className="h-3 w-px bg-border shrink-0"
                  data-tauri-drag-region
                />
              </>
            )}

            {/* Database Name with Type */}
            <div
              className="flex items-center gap-1 min-w-0 flex-shrink"
              data-tauri-drag-region
            >
              <span
                className={cn(
                  "text-xs truncate",
                  isAutoCreated
                    ? "font-medium"
                    : "text-muted-foreground",
                )}
                data-tauri-drag-region
              >
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
                <div className="h-3 w-px bg-border shrink-0 hidden xl:block" />
                <span
                  className="text-muted-foreground truncate min-w-0 hidden xl:inline text-[10px]"
                  data-tauri-drag-region
                >
                  {connection.host}:{connection.port}
                </span>
              </>
            )}
          </>
        )}

        {/* Connection Status Badge */}
        <div className="h-3 w-px bg-border shrink-0" data-tauri-drag-region />
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded-full transition-all whitespace-nowrap shrink-0",
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
              className="h-5 px-1.5 text-xs gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 shrink-0"
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
          <IconSparkles className="!size-4" />
        </Button>

        {/* Update available notice */}
        {pendingUpdate && (
          <button
            className={cn(
              "h-5 px-2 text-[10px] font-medium gap-1.5 rounded-full running-border running-border--red inline-flex items-center text-red-600 dark:text-red-400 transition-opacity",
              isUpdateBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-80"
            )}
            onClick={() => { openAppUpdateDialog(); }}
            disabled={isUpdateBusy}
            title={`Update to v${pendingUpdate.version}`}
          >
            {isUpdateBusy ? (
              <IconLoader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <IconRotate className="h-2.5 w-2.5" />
            )}
            <span>
              {isUpdateBusy
                ? "Updating…"
                : pendingUpdate.downloaded
                  ? `Restart v${pendingUpdate.version}`
                  : `v${pendingUpdate.version}`}
            </span>
          </button>
        )}

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
        open={showGlobalChanges}
        onOpenChange={setShowGlobalChanges}
      />
    </div>
  );
}
