import { useEffect, useRef } from "react";
import { databaseService } from "@/services/databaseService";
import { isTauri, safeEmit } from "@/utils/tauri";

const RECONNECT_DELAYS = [1000, 5000, 10000] as const;

/**
 * Automatically attempts to reconnect when the window regains focus.
 * Handles idle disconnects from the native connection manager.
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
          return true;
        }
      } catch (err: unknown) {
        console.error("Failed to inspect connection health:", err);
      }

      try {
        await databaseService.connectById(targetId);
        await safeEmit("database-reconnected", { connectionId: targetId });
        return true;
      } catch (err: unknown) {
        console.error(`Auto reconnect attempt ${attemptIndex + 1} failed:`, err);
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
        console.error("Failed to verify connection health before reconnect:", err);
        // Proceed with reconnect attempts even if health check fails.
      }

      scheduleAttempt(0);
    };

    const handleFocus = () => {
      void startSequence();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      isDisposed = true;
      window.removeEventListener("focus", handleFocus);
      stopSequence();
    };
  }, [connectionId]);
}
