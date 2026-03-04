import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useHomeScreenStore } from "@/screens/home/store/homeScreenStore";
import { isTauri } from "@/utils/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { eventBus } from "@/services/eventBus";
import { databaseService } from "@/services/databaseService";
import { windowManager } from "@/services/windowManager";
import { commandService } from "@/services/commandService";
import { menuActionCommandMap } from "@/data/menuActionCommandMap";
import { v4 as uuidv4 } from "uuid";
import { useQueryClient } from "@tanstack/react-query";
import { checkForAppUpdates } from "@/utils/appUpdate";

export function useMenuEventListener() {
  const { openPreferences } = usePreferencesStore();
  const { openConnectionForm } = useHomeScreenStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlistenPromise = listen<string>("menu_action", async (event) => {
      const action = event.payload;
      logger.info(`[MenuAction] Received: ${action}`);

      const mappedCommandId = menuActionCommandMap[action];
      if (mappedCommandId && commandService.has(mappedCommandId)) {
        try {
          await commandService.execute(mappedCommandId);
          return;
        } catch (error) {
          logger.error(
            `[MenuAction] Failed to execute mapped command ${mappedCommandId}:`,
            error,
          );
        }
      }

      // Get current context
      const workspaceStore = useWorkspaceScreenStore.getState();
      const workbenchStore = useWorkbenchStore.getState();
      const activeConnectionId = workspaceStore.activeConnectionId;

      // Debug: Log context for all database-related actions
      if (["connect", "disconnect", "refresh", "execute", "execute_selection", "export", "import", "new_query"].includes(action)) {
        logger.info(`[MenuAction] Context for '${action}': activeConnectionId=${activeConnectionId}, focusedPanel=${usePanelFocusStore.getState().focusedPanelId}`);
      }

      switch (action) {
        // App/File Menu
        case "check_updates":
          void handleCheckUpdates();
          break;
        case "open_preferences":
          openPreferences();
          break;
        case "new_connection":
          void handleNewConnection(openConnectionForm);
          break;
        case "new_query":
          if (activeConnectionId) {
            handleNewQuery(activeConnectionId, workbenchStore);
          }
          break;
        case "close_tab":
          handleCloseTab(workbenchStore);
          break;

        // Edit Menu
        case "find":
          eventBus.emit("query-editor:find", {});
          break;
        case "replace":
          eventBus.emit("query-editor:replace", {});
          break;
        case "find_in_files":
          // TODO: Implement find in files
          logger.warn("Find in files not implemented");
          break;

        // Database Menu
        case "connect":
          if (activeConnectionId) {
            void databaseService.connectById(activeConnectionId);
          }
          break;
        case "disconnect":
          if (activeConnectionId) {
            void databaseService.disconnect(activeConnectionId);
          }
          break;
        case "refresh":
          if (activeConnectionId) {
            // Invalidate React Query caches to refresh UI
            await queryClient.invalidateQueries({
              predicate: (query) =>
                Array.isArray(query.queryKey) &&
                (query.queryKey[0] === "databases" ||
                  query.queryKey[0] === "schemas" ||
                  query.queryKey[0] === "tables" ||
                  query.queryKey[0] === "columns"),
            });
            logger.info("Refreshed database metadata");
          }
          break;
        case "execute":
          eventBus.emit("query-editor:execute", {});
          break;
        case "execute_selection":
          eventBus.emit("query-editor:execute", { selection: true });
          break;
        case "export":
          eventBus.emit("data-grid:export-csv", {});
          break;
        case "import":
          // TODO: Implement import
          logger.warn("Import not implemented");
          break;
        case "backup_restore": {
          // Get profile ID from active connection (not runtime connection ID)
          let profileId: string | undefined;
          if (activeConnectionId) {
            const bundleStore = useWorkspaceBundleStore.getState();
            const connection = bundleStore.getConnectionById(activeConnectionId);
            profileId = connection?.profile.id;
          }
          void windowManager.openBackupRestore(profileId);
          break;
        }

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
      unlistenPromise
        .then((unlisten) => {
          unlisten();
        })
        .catch((err: unknown) => {
          logger.error("[useMenuEventListener] Failed to unlisten:", err);
        });
    };
  }, [
    openPreferences,
    openConnectionForm,
    queryClient,
  ]);
}

function handleNewQuery(
  connectionId: string,
  workbenchStore: ReturnType<typeof useWorkbenchStore.getState>,
) {
  const { panelContents, addTab, focusPanel } = workbenchStore;
  let targetPanelId: string | null = usePanelFocusStore.getState().focusedPanelId;

  // If no panel focused, use first available
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(targetPanelId);
    }
  }

  if (targetPanelId) {
    const tabId = uuidv4();
    addTab(targetPanelId, tabId, {
      type: "query",
      title: "New Query",
      connectionId,
    });
  }
}

function handleCloseTab(
  workbenchStore: ReturnType<typeof useWorkbenchStore.getState>,
) {
  const { panelContents, removeTab } = workbenchStore;
  const focusedPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!focusedPanelId) return;

  const panel = panelContents.get(focusedPanelId);
  if (panel && panel.activeTabId) {
    removeTab(focusedPanelId, panel.activeTabId);
  }
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
    const currentWindow = getCurrentWindow();
    const currentLabel = currentWindow.label;

    if (currentLabel === "main") {
      // We're on main window, open the form directly
      openConnectionForm("create");
    } else {
      // We're on a workspace window, focus main window and open form there
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainWindow = await (WebviewWindow as any).getByLabel("main");
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
  await checkForAppUpdates({ manual: true, openDialog: true });
}
