import { logger } from "@/lib/logger";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { HomeScreen } from "./screens/home/HomeScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { useEffect, useState } from "react";
import { isTauri } from "./utils/tauri";
import type { Update } from "@tauri-apps/plugin-updater";
import { vaultStorage } from "./services/vaultStorage";
import { toast } from "sonner";
import { databaseService } from "./services/databaseService";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConnectionWindowStore } from "./stores/connectionWindowStore";
import { useRoleSelection } from "./components/dialogs/RoleSelectionDialog";

function VaultLoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background">
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

function AppContent() {
  const { selectRole, RoleSelectionDialog } = useRoleSelection();

  // Register role selection callback with database service
  useEffect(() => {
    databaseService.setRoleSelectionCallback(selectRole);
  }, [selectRole]);

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/workspace/:connectionId" element={<WorkspaceScreen />} />
        </Routes>
      </Router>
      <RoleSelectionDialog />
    </>
  );
}

function App() {
  const [vaultReady, setVaultReady] = useState(!isTauri());
  const { initialize: initializeConnectionWindowStore } =
    useConnectionWindowStore();

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
      return;
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
            // Mark vault as ready to show main UI
            setVaultReady(true);
          }
        } else if (isWorkspaceWindow) {
          // Workspace windows - show immediately, vault loads in background
          // Workspace windows don't need vault data to render since they get
          // connection info from URL params
          setVaultReady(true);
          // Initialize vault in background for metadata operations
          void vaultStorage
            .initialize()
            .then(() => vaultStorage.preloadAll())
            .catch((error: unknown) => {
              logger.error(
                "Background vault load for workspace window failed",
                error,
              );
            });
        } else {
          // Secondary main windows (main-<timestamp>) - minimal background init
          setVaultReady(true);
          void vaultStorage
            .initialize()
            .then(() => vaultStorage.preloadAll())
            .catch((error: unknown) => {
              logger.error("Background preload failed", error);
            });
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
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
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

        const handleInstall = () => {
          const pendingUpdate = updateResource;
          if (!pendingUpdate) {
            return;
          }

          return toast.promise(
            (async () => {
              await pendingUpdate.downloadAndInstall();
              await closeUpdate();
            })(),
            {
              loading: "Downloading update…",
              success:
                "Update downloaded. The application will restart to finish installation.",
              error: (err) => {
                logger.error("Failed to install update", err);
                return err instanceof Error
                  ? err.message
                  : "Failed to install update";
              },
            },
          );
        };

        toast(`Update ${update.version} available`, {
          description:
            update.body ?? "A new version of Query Pilot is ready to install.",
          action: {
            label: "Install",
            onClick: () => handleInstall(),
          },
          duration: 60000,
        });
      } catch (error) {
        logger.error("Update check failed", error);
      }
    };

    void checkForUpdates();

    return () => {
      disposed = true;
      void closeUpdate();
    };
  }, []);

  if (!vaultReady) {
    return <VaultLoadingScreen />;
  }

  return <AppContent />;
}

export default App;
