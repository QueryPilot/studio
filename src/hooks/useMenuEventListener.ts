import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useHomeScreenStore } from "@/screens/home/store/homeScreenStore";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@/utils/tauri";

export function useMenuEventListener() {
  const { setTheme, toggleSidebar } = useAppStore();
  const { openPreferences } = usePreferencesStore();
  const { openConnectionForm } = useHomeScreenStore();

  useEffect(() => {
    const unlisten = listen<string>("menu_action", (event) => {
      const action = event.payload;

      switch (action) {
        // App/File Menu
        case "check_updates":
          handleCheckUpdates();
          break;
        case "open_preferences":
          openPreferences();
          break;
        case "new_connection":
          void handleNewConnection(openConnectionForm);
          break;
        case "new_query":
          // TODO: Implement new query tab
          logger.info("New query tab");
          break;
        case "new_erd":
          // TODO: Implement new ERD workspace
          logger.info("New ERD workspace");
          break;
        case "close_tab":
          // TODO: Implement close tab
          logger.info("Close tab");
          break;

        // View Menu
        case "toggle_sidebar":
          toggleSidebar();
          break;
        case "toggle_ai":
          // TODO: Implement AI assistant toggle
          logger.info("Toggle AI assistant");
          break;
        case "set_theme:light":
          setTheme("light");
          break;
        case "set_theme:dark":
          setTheme("dark");
          break;
        case "set_theme:system":
          setTheme("system");
          break;
        case "zoom_in":
        case "zoom_out":
        case "zoom_reset":
          // TODO: Implement zoom controls
          logger.info(action);
          break;

        // Edit Menu
        case "find":
        case "replace":
        case "find_in_files":
          // TODO: Implement find/replace
          logger.info(action);
          break;

        // Database Menu
        case "connect":
        case "disconnect":
        case "refresh":
        case "execute":
        case "execute_selection":
        case "export":
        case "import":
        case "erd":
          // TODO: Implement database actions
          logger.info(action);
          break;

        // Help Menu
        case "open_docs":
          window.open("https://querypilot.dev/docs", "_blank");
          break;
        case "report_issue":
          window.open(
            "https://github.com/querypilot/querypilot/issues/new",
            "_blank",
          );
          break;

        default:
          logger.warn("Unhandled menu action:", action);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setTheme, toggleSidebar, openPreferences, openConnectionForm]);
}

async function handleNewConnection(
  openConnectionForm: (mode: "create" | "edit") => void,
) {
  if (!isTauri()) {
    // Browser mode - just open the form
    openConnectionForm("create");
    return;
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const currentWindow = WebviewWindow.getCurrent();
    const currentLabel = currentWindow.label;

    if (currentLabel === "main") {
      // We're on main window, open the form directly
      openConnectionForm("create");
    } else {
      // We're on a workspace window, focus main window and open form there
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        // Show and focus main window
        await mainWindow.show();
        await mainWindow.setFocus();
        await mainWindow.unminimize();

        // Emit event to main window to open connection form
        await mainWindow.emit("open-connection-form", { mode: "create" });
      } else {
        // Main window doesn't exist, open a new one
        const { windowManager } = await import("@/services/windowManager");
        await windowManager.openNewMainWindow();
      }
    }
  } catch (error) {
    logger.error("Failed to handle new connection:", error);
    // Fallback - just open the form
    openConnectionForm("create");
  }
}

async function handleCheckUpdates() {
  try {
    const update = await check();
    if (update) {
      if (
        confirm(
          `Update available: ${update.version}\n\nDownload and install now?`,
        )
      ) {
        await update.downloadAndInstall();
        if (confirm("Update installed. Restart now?")) {
          await relaunch();
        }
      }
    } else {
      alert("You're already on the latest version!");
    }
  } catch (error) {
    logger.error("Update check failed:", error);
    alert(
      `Failed to check for updates: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
