import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { useEffect, useState } from "react";
import { isTauri } from "./utils/tauri";
import type { Update } from "@tauri-apps/plugin-updater";
import { vaultStorage } from "./services/vaultStorage";
import { toast } from "sonner";
import { databaseService } from "./services/databaseService";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "./stores/aiStore";

function VaultLoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background">
      <img
        src="/logo.png"
        alt="Query Pilot"
        className="h-20 w-20 rounded-2xl mb-6"
      />
      <div className="w-8 h-8 border-[3px] border-border border-t-primary rounded-full animate-spin mb-3" />
      <div className="text-muted-foreground text-sm">Initializing vault…</div>
    </div>
  );
}

function AppContent() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/workspace/:connectionId" element={<WorkspaceScreen />} />
      </Routes>
    </Router>
  );
}

function App() {
  const [vaultReady, setVaultReady] = useState(!isTauri());
  const { setConfiguredProviders, setInitialized } = useAIStore();

  // Load configured AI providers on startup
  useEffect(() => {
    const loadConfiguredProviders = async () => {
      if (!isTauri()) return;

      try {
        const providers: string[] = await invoke("get_configured_providers");
        setConfiguredProviders(providers);
        setInitialized(true);
        console.log("✅ Loaded configured providers on startup:", providers);
      } catch (error) {
        console.error("Failed to load configured providers:", error);
        setInitialized(true); // Mark as initialized even on error
      }
    };

    void loadConfiguredProviders();
  }, [setConfiguredProviders, setInitialized]);

  // Ensure connections are closed on hard reloads as well
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Fire-and-forget; best effort before webview reload
      void databaseService.cleanup();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let removeListener: (() => void) | null = null;

    const registerWindowHandlers = async () => {
      try {
        const currentWindow = getCurrentWindow();

        // Preload vault and data before showing the main UI
        try {
          await vaultStorage.initialize();
          await vaultStorage.preloadAll();
        } catch (error) {
          console.error("Preload failed", error);
        } finally {
          // Mark vault as ready to show main UI
          setVaultReady(true);
        }
        // Only register close handler for main window
        const windowLabel = currentWindow.label;
        const isMainWindow = windowLabel === "main";

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
            console.error("Flush pending changes failed", err);
          } finally {
            if (toastId !== undefined) toast.dismiss(toastId);
          }

          // Ensure we close all backend DB connections to avoid leaks
          try {
            await databaseService.cleanup();
          } catch (err) {
            console.error("Database cleanup failed on window close", err);
          }

          await currentWindow.destroy();
        });

        if (disposed) {
          unlisten();
          return;
        }

        removeListener = unlisten;
      } catch (error) {
        console.error("Failed to initialize window state plugin", error);
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
          console.error("Failed to close updater resource", error);
        }
        updateResource = null;
      }
    };

    const checkForUpdates = async () => {
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
                console.error("Failed to install update", err);
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
        console.error("Update check failed", error);
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
