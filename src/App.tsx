import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { KeyboardProvider, useShortcut } from "./services/keyboard";
import { useEffect } from "react";
import { setupStoreIntegration } from "./services/keyboard/integration/storeIntegration";
import { windowManager } from "./services/windowManager";
import { PreferencesDialog } from "./components/Preferences/PreferencesDialog";
import { ChordIndicator } from "./components/ChordIndicator";
import { usePreferencesStore } from "./stores/preferencesStore";
import { isTauri, safeInvoke } from "./utils/tauri";
import type { Update } from "@tauri-apps/plugin-updater";
import { vaultStorage } from "./services/vaultStorage";
import { Toaster, toast } from "sonner";
import { databaseService } from "./services/databaseService";

function AppContent() {
  const openPreferences = usePreferencesStore((state) => state.open);

  // Register global keyboard shortcut for new window
  useShortcut(
    "cmd+shift+n",
    async () => {
      await windowManager.openNewMainWindow();
    },
    {
      preventDefault: true,
      description: "Open new window",
    },
  );

  // Register global keyboard shortcut for preferences
  useShortcut(
    "cmd+,",
    () => {
      openPreferences();
    },
    {
      preventDefault: true,
      description: "Open preferences",
    },
  );

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<MainScreen />} />
          <Route
            path="/workspace/:connectionId"
            element={<WorkspaceScreen />}
          />
        </Routes>
      </Router>
      <PreferencesDialog />
      <ChordIndicator />
    </>
  );
}

function App() {
  useEffect(() => {
    // Setup store integration for keyboard context
    const cleanup = setupStoreIntegration();
    return cleanup;
  }, []);

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
        const [
          { StateFlags, restoreStateCurrent, saveWindowState },
          { getCurrentWindow },
        ] = await Promise.all([
          import("@tauri-apps/plugin-window-state"),
          import("@tauri-apps/api/window"),
        ]);

        try {
          await restoreStateCurrent(StateFlags.ALL);
        } catch (error) {
          console.debug("No window state to restore yet", error);
        }

        const currentWindow = getCurrentWindow();

        // Preload vault and data before showing the main UI
        try {
          await vaultStorage.initialize();
          await vaultStorage.preloadAll();
        } catch (error) {
          console.error("Preload failed", error);
        } finally {
          // Hide splash and show main window (no-op if no splash configured)
          try {
            await safeInvoke("app_show_main_window");
          } catch {
            // ignore
          }
        }
        const unlisten = await currentWindow.onCloseRequested(async (event) => {
          event.preventDefault();

          try {
            await saveWindowState(StateFlags.ALL);
          } catch (error) {
            console.error("Failed to persist window state", error);
          }

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

          await currentWindow.close();
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
            update.body ?? "A new version of DevDB Studio is ready to install.",
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

  return (
    <KeyboardProvider>
      <Toaster position="top-center" richColors />
      <AppContent />
    </KeyboardProvider>
  );
}

export default App;
