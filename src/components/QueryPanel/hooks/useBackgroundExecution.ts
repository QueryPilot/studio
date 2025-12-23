import { useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useTabStateStore } from "@/stores/tabStateStore";
import { logger } from "@/lib/logger";

interface UseBackgroundExecutionOptions {
  tabId: string;
  onExecute: (sql: string) => Promise<void>;
}

interface NotificationPermissionState {
  granted: boolean;
  requested: boolean;
}

const NOTIFICATION_ICON = "/icon.png";

export function useBackgroundExecution(options: UseBackgroundExecutionOptions) {
  const { tabId, onExecute } = options;
  const startBackgroundQuery = useTabStateStore((state) => state.startBackgroundQuery);
  const completeBackgroundQuery = useTabStateStore((state) => state.completeBackgroundQuery);
  const failBackgroundQuery = useTabStateStore((state) => state.failBackgroundQuery);
  const getBackgroundQueries = useTabStateStore((state) => state.getBackgroundQueries);

  const permissionStateRef = useRef<NotificationPermissionState>({
    granted: false,
    requested: false,
  });

  const activeBackgroundQueriesRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      permissionStateRef.current.granted = Notification.permission === "granted";
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      logger.warn("[useBackgroundExecution] Notifications not supported");
      return false;
    }

    if (permissionStateRef.current.granted) {
      return true;
    }

    if (permissionStateRef.current.requested) {
      return permissionStateRef.current.granted;
    }

    permissionStateRef.current.requested = true;

    try {
      const permission = await Notification.requestPermission();
      permissionStateRef.current.granted = permission === "granted";

      if (permission === "granted") {
        logger.info("[useBackgroundExecution] Notification permission granted");
      } else if (permission === "denied") {
        logger.warn("[useBackgroundExecution] Notification permission denied");
        toast.warning("Notifications blocked", {
          description: "Enable notifications in your browser settings to receive query completion alerts",
        });
      }

      return permissionStateRef.current.granted;
    } catch (error) {
      logger.error("[useBackgroundExecution] Failed to request notification permission:", error);
      return false;
    }
  }, []);

  const sendNotification = useCallback((title: string, body: string, queryId: string) => {
    if (!permissionStateRef.current.granted || typeof Notification === "undefined") {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: NOTIFICATION_ICON,
        tag: queryId,
        requireInteraction: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();

        const bgQuery = getBackgroundQueries().find((q) => q.id === queryId);
        if (bgQuery?.result) {
          toast.success("Background query result ready", {
            description: "Showing results in current tab",
          });
        }
      };

      setTimeout(() => {
        notification.close();
      }, 10000);
    } catch (error) {
      logger.error("[useBackgroundExecution] Failed to send notification:", error);
    }
  }, [getBackgroundQueries]);

  const executeInBackground = useCallback(async (sql: string): Promise<string | null> => {
    if (!sql || !sql.trim()) {
      toast.error("No query to execute");
      return null;
    }

    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      toast.info("Running in background without notifications", {
        description: "Grant notification permissions to receive completion alerts",
      });
    }

    const queryId = startBackgroundQuery(tabId, sql);
    const controller = new AbortController();
    activeBackgroundQueriesRef.current.set(queryId, controller);

    toast.success("Query running in background", {
      description: hasPermission
        ? "You'll receive a notification when it completes"
        : "Check the background queries indicator for status",
      duration: 3000,
    });

    logger.info("[useBackgroundExecution] Started background query:", { queryId, sql });

    (async () => {
      const startTime = Date.now();

      try {
        await onExecute(sql);

        const tabState = useTabStateStore.getState().queryStates.get(tabId);
        const result = tabState?.result;

        if (result) {
          completeBackgroundQuery(queryId, result);

          const executionTime = Date.now() - startTime;
          const executionTimeSec = (executionTime / 1000).toFixed(2);

          if (result.error) {
            sendNotification(
              "Query Failed",
              `Background query failed after ${executionTimeSec}s: ${result.error.slice(0, 100)}`,
              queryId
            );

            toast.error("Background query failed", {
              description: result.error,
            });
          } else {
            const rowCountMsg = result.affectedRows !== undefined
              ? `${result.affectedRows} row(s) affected`
              : `${result.rowCount} row(s) returned`;

            sendNotification(
              "Query Completed",
              `Background query completed in ${executionTimeSec}s - ${rowCountMsg}`,
              queryId
            );

            toast.success("Background query completed", {
              description: `${rowCountMsg} in ${executionTimeSec}s`,
            });
          }
        } else {
          throw new Error("No result available after execution");
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failBackgroundQuery(queryId, errorMessage);

        const executionTime = Date.now() - startTime;
        const executionTimeSec = (executionTime / 1000).toFixed(2);

        sendNotification(
          "Query Failed",
          `Background query failed after ${executionTimeSec}s: ${errorMessage.slice(0, 100)}`,
          queryId
        );

        toast.error("Background query failed", {
          description: errorMessage,
        });

        logger.error("[useBackgroundExecution] Background query failed:", error);
      } finally {
        activeBackgroundQueriesRef.current.delete(queryId);
      }
    })();

    return queryId;
  }, [
    tabId,
    onExecute,
    startBackgroundQuery,
    completeBackgroundQuery,
    failBackgroundQuery,
    requestNotificationPermission,
    sendNotification,
  ]);

  useEffect(() => {
    return () => {
      activeBackgroundQueriesRef.current.forEach((controller) => {
        controller.abort();
      });
      activeBackgroundQueriesRef.current.clear();
    };
  }, []);

  return {
    executeInBackground,
    hasNotificationPermission: permissionStateRef.current.granted,
    requestNotificationPermission,
  };
}
