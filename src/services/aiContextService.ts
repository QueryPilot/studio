/**
 * AI Context Service
 *
 * Syncs frontend state to backend for AI agent access.
 */

import { invoke } from "@tauri-apps/api/core";

export interface ActiveContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  query: string | null;
  lastExecutedQuery: string | null;
  hasResults: boolean;
  rowCount: number | null;
  columnCount: number | null;
  updatedAt: number;
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  connectionId: string;
  database: string;
  schema?: string;
  executedAt: number;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
}

/**
 * Sync active editor context to backend
 */
export async function syncAiContext(context: ActiveContext): Promise<void> {
  try {
    await invoke("sync_ai_context", { context });
  } catch (error) {
    console.error("[AIContext] Failed to sync context:", error);
  }
}

/**
 * Track a query execution in AI history
 */
export async function trackQueryExecution(
  entry: QueryHistoryEntry
): Promise<void> {
  try {
    await invoke("track_query_execution", { entry });
  } catch (error) {
    console.error("[AIContext] Failed to track execution:", error);
  }
}

// Debounce timer for context sync
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 500;

/**
 * Debounced context sync (call frequently, syncs at most every 500ms)
 */
export function debouncedSyncAiContext(context: ActiveContext): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    void syncAiContext(context);
    syncTimer = null;
  }, SYNC_DEBOUNCE_MS);
}
