import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { eventBus } from "@/services/eventBus";
import { databaseService } from "@/services/databaseService";
import { commandService } from "@/services/commandService";
import { menuActionCommandMap } from "@/data/menuActionCommandMap";
import { useQueryClient } from "@tanstack/react-query";
import { checkForAppUpdates } from "@/utils/appUpdate";
import { toast } from "sonner";

export function useMenuEventListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlistenPromise = listen<string>("menu_action", async (event) => {
      const action = event.payload;
      logger.info(`[MenuAction] Received: ${action}`);

      // First, try the command service mapping
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

      // Get current context for actions that need it
      const activeConnectionId =
        useWorkspaceScreenStore.getState().activeConnectionId;

      switch (action) {
        case "check_updates":
          void handleCheckUpdates();
          break;

        // Database Menu — require active connection
        case "connect":
          if (activeConnectionId) {
            void databaseService.connectById(activeConnectionId);
          } else {
            toast.info("No active connection. Open a connection first.");
          }
          break;
        case "disconnect":
          if (activeConnectionId) {
            void databaseService.disconnect(activeConnectionId);
          } else {
            toast.info("No active connection to disconnect.");
          }
          break;
        case "refresh":
          if (activeConnectionId) {
            await queryClient.invalidateQueries({
              predicate: (query) =>
                Array.isArray(query.queryKey) &&
                (query.queryKey[0] === "databases" ||
                  query.queryKey[0] === "schemas" ||
                  query.queryKey[0] === "tables" ||
                  query.queryKey[0] === "columns"),
            });
            toast.success("Schema refreshed");
          } else {
            toast.info("No active connection. Connect to a database first.");
          }
          break;
        case "export":
          eventBus.emit("data-grid:export-csv", {});
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
  }, [queryClient]);
}

async function handleCheckUpdates() {
  await checkForAppUpdates({ manual: true, openDialog: true });
}
