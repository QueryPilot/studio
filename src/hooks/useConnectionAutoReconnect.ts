import { logger } from "@/lib/logger";
import { useEffect, useRef } from "react";
import { databaseService } from "@/services/databaseService";
import { isTauri, safeEmit } from "@/utils/tauri";
import { toast } from "sonner";

// 10 attempts total:
// - First 3: wait 500ms, 1s, 3s
// - Next 3: wait 5s between attempts  
// - Last 4: wait 10s between attempts
const RECONNECT_DELAYS = [
  500, 1000, 3000, // Attempts 1-3: 500ms, 1s, 3s
  5000, 5000, 5000, // Attempts 4-6: 5s
  10000, 10000, 10000, 10000, // Attempts 7-10: 10s
] as const;

/**
 * Automatically attempts to reconnect when:
 * - Window regains focus
 * - Network connection is restored
 * - Connection health check fails
 * 
 * Uses progressive retry strategy with up to 10 attempts.
 */
export function useConnectionAutoReconnect(connectionId?: string) {
  const latestIdRef = useRef<string | undefined>(connectionId);
  const sequenceActiveRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !isTauri()) {
      return;
    }

    let isDisposed = false;

    const stopSequence = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      sequenceActiveRef.current = false;
    };

    const runAttempt = async (attemptIndex: number): Promise<boolean> => {
      const targetId = latestIdRef.current;
      if (!targetId || isDisposed) {
        return true;
      }

      try {
        const health = await databaseService.getConnectionHealth(targetId);
        if (health.status !== "error") {
          logger.info(`[AutoReconnect] Connection already healthy, stopping`);
          return true;
        }
      } catch (err: unknown) {
        logger.error("[AutoReconnect] Failed to inspect connection health:", err);
      }

      const attemptNumber = attemptIndex + 1;
      logger.info(
        `[AutoReconnect] Attempt ${attemptNumber}/${RECONNECT_DELAYS.length} for connection ${targetId}`,
      );

      try {
        await databaseService.connectById(targetId);
        await safeEmit("database-reconnected", { connectionId: targetId });
        
        logger.info(`[AutoReconnect] Successfully reconnected on attempt ${attemptNumber}`);
        toast.success("Connection Restored", {
          description: "Successfully reconnected to the database.",
        });
        
        return true;
      } catch (err: unknown) {
        logger.error(`[AutoReconnect] Attempt ${attemptNumber} failed:`, err);
        
        // Show warning on last attempt
        if (attemptNumber === RECONNECT_DELAYS.length) {
          toast.error("Reconnection Failed", {
            description: `Failed to reconnect after ${RECONNECT_DELAYS.length} attempts. Please check your connection.`,
          });
        }
        
        return false;
      }
    };

    const scheduleAttempt = (index: number) => {
      const delay = RECONNECT_DELAYS[index];
      if (delay === undefined) {
        stopSequence();
        return;
      }

      timeoutRef.current = setTimeout(async () => {
        timeoutRef.current = null;
        if (isDisposed) {
          stopSequence();
          return;
        }

        const success = await runAttempt(index);
        if (success) {
          stopSequence();
          return;
        }

        scheduleAttempt(index + 1);
      }, delay);
    };

    const startSequence = async () => {
      if (sequenceActiveRef.current) {
        return;
      }
      sequenceActiveRef.current = true;

      const targetId = latestIdRef.current;
      if (!targetId || isDisposed) {
        stopSequence();
        return;
      }

      try {
        const health = await databaseService.getConnectionHealth(targetId);
        if (health.status !== "error") {
          stopSequence();
          return;
        }
      } catch (err: unknown) {
        logger.error("Failed to verify connection health before reconnect:", err);
        // Proceed with reconnect attempts even if health check fails.
      }

      scheduleAttempt(0);
    };

    const handleFocus = () => {
      logger.info("[AutoReconnect] Window focused, checking connection");
      void startSequence();
    };

    const handleOnline = () => {
      logger.info("[AutoReconnect] Network connection restored, attempting reconnect");
      toast.info("Network Restored", {
        description: "Attempting to reconnect to database...",
        duration: 2000,
      });
      void startSequence();
    };

    const handleOffline = () => {
      logger.info("[AutoReconnect] Network connection lost");
      toast.warning("Network Lost", {
        description: "Network connection lost. Will reconnect when restored.",
        duration: 3000,
      });
      stopSequence(); // Stop ongoing attempts if network is lost
    };

    // Subscribe to health changes - trigger reconnect when status becomes "error"
    let previousStatus: string | undefined;
    const unsubscribeHealth = databaseService.onHealthChange(
      connectionId,
      (health) => {
        // Only trigger reconnect if status transitions TO error (not already in error)
        if (health.status === "error" && previousStatus !== "error") {
          logger.info("[AutoReconnect] Health check failed, attempting reconnect");
          void startSequence();
        }
        previousStatus = health.status;
      },
    );

    // Listen for window focus
    window.addEventListener("focus", handleFocus);
    
    // Listen for network events
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      isDisposed = true;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribeHealth();
      stopSequence();
    };
  }, [connectionId]);
}
