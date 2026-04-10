import { useCallback, useEffect, useRef, useState } from "react";
import { BackendAPI, type DuckDbQueryProgress } from "@/services/backend";

const POLL_MS = 500;

export interface UseDuckDbQueryProgressResult {
  progress: DuckDbQueryProgress | null;
  estimatedSecondsRemaining: number | null;
  cancel: () => void;
}

/**
 * Polls DuckDB engine query progress while `isRunning` is true.
 * Progress is populated from the backend cache updated during chunked streaming.
 */
export function useDuckDbQueryProgress(
  connId: string | undefined,
  isRunning: boolean,
): UseDuckDbQueryProgressResult {
  const [progress, setProgress] = useState<DuckDbQueryProgress | null>(null);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState<
    number | null
  >(null);
  const startedAtRef = useRef<number | null>(null);
  const pollGenerationRef = useRef(0);

  const cancel = useCallback(() => {
    if (!connId) return;
    void BackendAPI.duckdbInterruptQuery(connId);
  }, [connId]);

  useEffect(() => {
    if (!connId || !isRunning) {
      return;
    }

    const stableConnId = connId;
    const myGeneration = ++pollGenerationRef.current;

    startedAtRef.current = Date.now();

    const tick = async () => {
      try {
        const p = await BackendAPI.duckdbQueryProgress(stableConnId);
        if (pollGenerationRef.current !== myGeneration) {
          return;
        }
        setProgress(p);
        const pct = p.percentage;
        if (pct > 0 && pct < 100 && startedAtRef.current != null) {
          const elapsedSec = (Date.now() - startedAtRef.current) / 1000;
          const eta = elapsedSec * (100 / pct - 1);
          setEstimatedSecondsRemaining(
            Number.isFinite(eta) && eta >= 0 ? eta : null,
          );
        } else {
          setEstimatedSecondsRemaining(null);
        }
      } catch {
        if (pollGenerationRef.current !== myGeneration) {
          return;
        }
        setProgress(null);
        setEstimatedSecondsRemaining(null);
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      pollGenerationRef.current += 1;
      window.clearInterval(id);
      setProgress(null);
      setEstimatedSecondsRemaining(null);
      startedAtRef.current = null;
    };
  }, [connId, isRunning]);

  return { progress, estimatedSecondsRemaining, cancel };
}
