import { logger } from "@/lib/logger";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { HomeScreen } from "./screens/home/HomeScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { WorkspacePickerScreen } from "./screens/workspace/WorkspacePickerScreen";
import { BackupRestoreScreen } from "./screens/backup-restore";
import { useEffect, useState } from "react";
import { isTauri } from "./utils/tauri";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { vaultStorage } from "./services/vaultStorage";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConnectionWindowStore } from "./stores/connectionWindowStore";
import { useWorkspaceBundleStore } from "./stores/workspaceBundleStore";
import { useAcpStore } from "./stores/acpStore";
import { useByokStore } from "./stores/byokStore";
import { AcpService } from "./services/acpService";
import { useAppStore } from "./stores/appStore";
import { usePreferencesStore } from "./stores/preferencesStore";
import { getSessionDatabase } from "./lib/db/sessionDb";
import { windowManager } from "./services/windowManager";
import { setInstallHandler } from "./utils/appUpdate";

function VaultLoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-secondary">
      <img
        src="/logo.png"
        alt="Query Pilot"
        className="h-20 w-20 rounded-2xl mb-6"
      />
      <div className="w-8 h-8 min-w-8 min-h-8 border-[3px] border-border border-t-primary rounded-full animate-spin mb-3" />
      <div className="text-muted-foreground text-sm">Initializing vault…</div>
    </div>
  );
}

/**
 * Legacy route redirect: /connection/:connectionId -> opens temp workspace
 */
function LegacyConnectionRedirect() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const openSingleConnection = useWorkspaceBundleStore(
    (s) => s.openSingleConnection,
  );
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  useEffect(() => {
    if (connectionId) {
      void openSingleConnection(connectionId);
    }
  }, [connectionId, openSingleConnection]);

  // Redirect to workspace route once temp workspace is created
  if (activeWorkspace) {
    return <Navigate to={`/workspace/${activeWorkspace.config.id}`} replace />;
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-[3px] border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function AppContent() {
  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          {/* New workspace routes */}
          <Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} />
          <Route path="/workspace" element={<WorkspacePickerScreen />} />
          {/* Legacy route - backwards compat */}
          <Route
            path="/connection/:connectionId"
            element={<LegacyConnectionRedirect />}
          />
          {/* Backup/Restore wizard */}
          <Route path="/backup-restore" element={<BackupRestoreScreen />} />
        </Routes>
      </Router>
    </>
  );
}

function App() {
  const [vaultReady, setVaultReady] = useState(!isTauri());
  const { initialize: initializeConnectionWindowStore } =
    useConnectionWindowStore();
  const loadAgents = useAcpStore((s) => s.loadAgents);
  const loadApiKeys = useByokStore((s) => s.loadApiKeys);

  // Initialize connection window tracking
  // Note: BroadcastChannel works in both Tauri and browser
  useEffect(() => {
    initializeConnectionWindowStore();
  }, [initializeConnectionWindowStore]);

  // Note: Removed global cleanup on beforeunload
  // Each workspace window now handles its own connection cleanup
  // This prevents closing one window from disconnecting other windows' connections

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }

    let disposed = false;
    let removeListener: (() => void) | null = null;

    const registerWindowHandlers = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const windowLabel = currentWindow.label;
        const isMainWindow = windowLabel === "main";
        const isWorkspaceWindow = windowLabel.startsWith("workspace-");

        // Preload vault and data before showing the main UI
        // Only block on vault loading for the primary main window
        if (isMainWindow) {
          // Primary main window - block on vault load
          try {
            await vaultStorage.initialize();
            await vaultStorage.preloadAll();

            // Hydrate BYOK API keys from vault
            await loadApiKeys();

            // Check if keychain access failed
            if (!vaultStorage.isKeychainAccessible()) {
              toast.error("Keychain Access Required", {
                description:
                  "Click 'Request Access' to trigger keychain prompt, or grant access in System Settings.",
                duration: Infinity,
                action: {
                  label: "Request Access",
                  onClick: async () => {
                    const toastId = toast.loading(
                      "Requesting keychain access...",
                    );
                    const success = await vaultStorage.retryKeychainAccess();
                    toast.dismiss(toastId);
                    if (success) {
                      toast.success("Keychain access granted");
                      window.location.reload();
                    } else {
                      toast.error(
                        "Access denied. Check System Settings > Privacy & Security > QueryPilot.",
                      );
                    }
                  },
                },
              });
            }
          } catch (error) {
            logger.error("Vault initialization failed", error);
            // Show error toast when keychain access throws
            if (
              error instanceof Error &&
              error.message.includes("Keychain access required")
            ) {
              toast.error("Keychain Access Required", {
                description:
                  "Click 'Request Access' to trigger keychain prompt, or grant access in System Settings.",
                duration: Infinity,
                action: {
                  label: "Request Access",
                  onClick: async () => {
                    const toastId = toast.loading(
                      "Requesting keychain access...",
                    );
                    const success = await vaultStorage.retryKeychainAccess();
                    toast.dismiss(toastId);
                    if (success) {
                      toast.success("Keychain access granted");
                      window.location.reload();
                    } else {
                      toast.error(
                        "Access denied. Check System Settings > Privacy & Security > QueryPilot.",
                      );
                    }
                  },
                },
              });
            }
          } finally {
            // Check if we should restore previous session instead of showing home
            let restored = false;
            const startupBehavior = usePreferencesStore.getState().startupBehavior;
            if (startupBehavior === "restore") {
              try {
                const db = getSessionDatabase();
                const appState = await db.appState.get("singleton");
                if (appState?.lastActiveWorkspaceIds.length) {
                  // Load saved workspaces first so windowManager can look up names
                  await useWorkspaceBundleStore.getState().loadSavedWorkspaces();

                  const savedWorkspaces = useWorkspaceBundleStore.getState().savedWorkspaces;

                  // Open each workspace window
                  for (const workspaceId of appState.lastActiveWorkspaceIds) {
                    const ws = savedWorkspaces.find((w) => w.id === workspaceId);
                    if (ws) {
                      await windowManager.openNamedWorkspace(workspaceId, ws.name, {
                        icon: ws.icon,
                      });
                    }
                  }
                  // Don't set vaultReady — main window stays hidden, workspace windows open
                  restored = true;
                }
              } catch (error) {
                logger.error("[App] Failed to restore session:", error);
              }
            }

            if (!restored) {
              // Fall through to normal home screen
              setVaultReady(true);
            }

            // Initialize LLM home directory and load ACP agents in background (non-blocking)
            void (async () => {
              try {
                await AcpService.initializeLlmHome();
              } catch (error) {
                logger.error(
                  "LLM home initialization failed (continuing with agent load)",
                  error,
                );
              }
              // Always try to load agents, even if LLM home init failed
              try {
                await loadAgents();
              } catch (error) {
                logger.error("Agent discovery failed", error);
              }
            })();
          }
        } else if (isWorkspaceWindow) {
          // Workspace windows - show immediately, vault loads in background
          // Workspace windows don't need vault data to render since they get
          // connection info from URL params
          setVaultReady(true);
          // Initialize vault and load agents in background
          void (async () => {
            try {
              await vaultStorage.initialize();
              await vaultStorage.preloadAll();
              await loadApiKeys();
            } catch (error) {
              logger.error(
                "Background vault load for workspace window failed",
                error,
              );
            }
            // Also load agents for workspace windows
            try {
              await loadAgents();
            } catch (error) {
              logger.error("Agent discovery failed in workspace window", error);
            }
          })();
        } else {
          // Secondary main windows (main-<timestamp>) - minimal background init
          setVaultReady(true);
          void (async () => {
            try {
              await vaultStorage.initialize();
              await vaultStorage.preloadAll();
              await loadApiKeys();
            } catch (error) {
              logger.error("Background preload failed", error);
            }
            // Also load agents for secondary windows
            try {
              await loadAgents();
            } catch (error) {
              logger.error("Agent discovery failed in secondary window", error);
            }
          })();
        }

        if (!isMainWindow) {
          // Workspace windows handle their own close logic in WorkspaceScreen
          return;
        }

        const unlisten = await currentWindow.onCloseRequested(async (event) => {
          // For main window, handle vault and cleanup
          event.preventDefault();

          let toastId: string | number | undefined;
          try {
            if (vaultStorage.hasPendingChanges()) {
              toastId = toast.loading("Saving your work…");
              await vaultStorage.flushPendingChanges();
            }
          } catch (err) {
            logger.error("Flush pending changes failed", err);
          } finally {
            if (toastId !== undefined) toast.dismiss(toastId);
          }

          // Note: Do NOT call databaseService.cleanup() here!
          // Each workspace window manages its own connection cleanup in WorkspaceScreen.
          // Calling disconnectAll() here would disconnect ALL windows' connections.

          await currentWindow.destroy();
        });

        if (disposed) {
          unlisten();
          return;
        }

        removeListener = unlisten;
      } catch (error) {
        logger.error("Failed to initialize window state plugin", error);
      }
    };

    void registerWindowHandlers();

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [loadAgents, loadApiKeys]);

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }

    let disposed = false;
    let updateClosed = false;
    let updateResource: Update | null = null;

    const closeUpdate = async () => {
      if (updateResource && !updateClosed) {
        updateClosed = true;
        try {
          await updateResource.close();
        } catch (error) {
          logger.error("Failed to close updater resource", error);
        }
        updateResource = null;
      }
    };

    const checkForUpdates = async () => {
      // Only check for updates from the main window
      if (getCurrentWindow().label !== "main") {
        return;
      }

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();

        if (!update) {
          return;
        }

        updateResource = update;

        if (disposed) {
          await closeUpdate();
          return;
        }

        // Store the update info for title bar / home screen notice
        useAppStore.getState().setPendingUpdate({
          version: update.version,
          body: update.body ?? undefined,
        });

        // Store the install handler so UI components can trigger it
        setInstallHandler(async () => {
          const pending = updateResource;
          if (!pending) {
            return;
          }
          const { setIsInstallingUpdate, setPendingUpdate, isInstallingUpdate: alreadyInstalling } = useAppStore.getState();
          if (alreadyInstalling) {
            return;
          }
          setIsInstallingUpdate(true);
          try {
            await pending.downloadAndInstall();
            await closeUpdate();
            setPendingUpdate(null);
            await relaunch();
          } catch (err) {
            logger.error("Failed to install update", err);
            toast.error("Update failed", {
              description: err instanceof Error ? err.message : "Failed to install update",
            });
          } finally {
            setIsInstallingUpdate(false);
          }
        });
      } catch (error) {
        logger.error("Update check failed", error);
      }
    };

    void checkForUpdates();

    return () => {
      disposed = true;
      setInstallHandler(null);
      useAppStore.getState().setPendingUpdate(null);
      void closeUpdate();
    };
  }, []);

  if (!vaultReady) {
    return <VaultLoadingScreen />;
  }

  return <AppContent />;
}

export default App;
