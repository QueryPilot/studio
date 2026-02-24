/**
 * Query Tracker Service
 *
 * Tracks query executions in history.
 * Call this after any query completes (success or failure).
 */

import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { hashString } from "@/components/CodeEditor/languages/sql/shared";
import type { QuerySource } from "@/lib/db/queryHistory";

interface TrackQueryParams {
  query: string;
  connectionId: string;
  database: string;
  schema?: string;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
  source: QuerySource;
}

// Debounce duplicate queries
const recentQueries = new Map<string, number>();
const DEBOUNCE_MS = 1000;
const MAX_CACHE_SIZE = 100;

/**
 * Track a query execution in history.
 * Automatically debounces duplicate queries.
 */
export async function trackQuery(params: TrackQueryParams): Promise<void> {
  // Hash query for efficient dedup key
  const queryHash = hashString(params.query);
  const key = `${params.connectionId}:${queryHash}`;

  const lastRun = recentQueries.get(key);
  if (lastRun && Date.now() - lastRun < DEBOUNCE_MS) {
    return; // Skip duplicate
  }

  // Prevent unbounded growth
  if (recentQueries.size > MAX_CACHE_SIZE) {
    const entries = [...recentQueries.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < MAX_CACHE_SIZE / 2; i++) {
      const entry = entries[i];
      if (entry) {
        recentQueries.delete(entry[0]);
      }
    }
  }

  recentQueries.set(key, Date.now());

  // Get stable profileId from connectionId
  const connection = useConnectionStore
    .getState()
    .getConnection(params.connectionId);
  if (!connection) return;

  await useQueryHistoryStore.getState().trackExecution({
    ...params,
    profileId: connection.profile.id,
  });
}

/**
 * Higher-order function to wrap query execution with tracking.
 * Automatically captures timing and handles errors.
 */
export function withTracking<T>(
  executeFn: () => Promise<T>,
  params: Omit<TrackQueryParams, "success" | "error" | "executionTimeMs">
): Promise<T> {
  const startTime = performance.now();

  return executeFn()
    .then((result) => {
      void trackQuery({
        ...params,
        success: true,
        executionTimeMs: Math.round(performance.now() - startTime),
      });
      return result;
    })
    .catch((error: unknown) => {
      void trackQuery({
        ...params,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Math.round(performance.now() - startTime),
      });
      throw error;
    });
}
