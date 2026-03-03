/**
 * Tab State Database
 *
 * IndexedDB persistence for tab query state using Dexie.
 * Replaces localStorage for better performance and no quota limits.
 */

import { logger } from "@/lib/logger";
import Dexie, { type Table } from "dexie";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { ViewMode } from "@/types/viewMode";

/**
 * Lightweight state for IndexedDB persistence.
 * Only includes fields that should survive app restarts.
 */
export interface PersistedTabState {
  tabId: string;
  query: string;
  lastExecutedQuery: string;
  viewMode: ViewMode;
  selectedDialect?: SqlDialect | "auto";
  tableViewType?: string; // "data" | "structure" | "indexes" | "triggers" | "partitions" | "definition"
  // New fields for full-fidelity restore
  scrollPosition?: { top: number; left: number };
  editorCursorPosition?: { line: number; ch: number };
  gridColumnWidths?: Record<string, number>;
  pinnedResultQuery?: string | null;
}

class TabStateDatabase extends Dexie {
  tabStates!: Table<PersistedTabState, string>;

  constructor() {
    super("query-pilot-tab-state");
    this.version(1).stores({
      // tabId is the primary key
      tabStates: "&tabId",
    });
  }
}

const isClient = typeof window !== "undefined" && typeof indexedDB !== "undefined";

let db: TabStateDatabase | null = null;

function getDatabase(): TabStateDatabase | null {
  if (!isClient) return null;
  if (!db) {
    db = new TabStateDatabase();
  }
  return db;
}

// In-memory fallback for SSR or when IndexedDB is unavailable
const memoryStore = new Map<string, PersistedTabState>();

/**
 * Persist tab state to IndexedDB
 */
export async function persistTabState(
  tabId: string,
  state: Partial<PersistedTabState>
): Promise<void> {
  const database = getDatabase();

  if (!database) {
    // Fallback to memory store
    const existing = memoryStore.get(tabId);
    const toSave: PersistedTabState = {
      tabId,
      query: state.query ?? existing?.query ?? "",
      lastExecutedQuery: state.lastExecutedQuery ?? existing?.lastExecutedQuery ?? "",
      viewMode: state.viewMode ?? existing?.viewMode ?? "table",
      selectedDialect: state.selectedDialect ?? existing?.selectedDialect ?? "auto",
      tableViewType: state.tableViewType ?? existing?.tableViewType,
      scrollPosition: state.scrollPosition ?? existing?.scrollPosition,
      editorCursorPosition: state.editorCursorPosition ?? existing?.editorCursorPosition,
      gridColumnWidths: state.gridColumnWidths ?? existing?.gridColumnWidths,
      pinnedResultQuery: state.pinnedResultQuery ?? existing?.pinnedResultQuery,
    };
    memoryStore.set(tabId, toSave);
    return;
  }

  try {
    const existing = await database.tabStates.get(tabId);
    const toSave: PersistedTabState = {
      tabId,
      query: state.query ?? existing?.query ?? "",
      lastExecutedQuery: state.lastExecutedQuery ?? existing?.lastExecutedQuery ?? "",
      viewMode: state.viewMode ?? existing?.viewMode ?? "table",
      selectedDialect: state.selectedDialect ?? existing?.selectedDialect ?? "auto",
      tableViewType: state.tableViewType ?? existing?.tableViewType,
      scrollPosition: state.scrollPosition ?? existing?.scrollPosition,
      editorCursorPosition: state.editorCursorPosition ?? existing?.editorCursorPosition,
      gridColumnWidths: state.gridColumnWidths ?? existing?.gridColumnWidths,
      pinnedResultQuery: state.pinnedResultQuery ?? existing?.pinnedResultQuery,
    };
    await database.tabStates.put(toSave);
  } catch (error) {
    logger.warn("Failed to persist tab state to IndexedDB:", error);
    // Fallback to memory
    const existing = memoryStore.get(tabId);
    const toSave: PersistedTabState = {
      tabId,
      query: state.query ?? existing?.query ?? "",
      lastExecutedQuery: state.lastExecutedQuery ?? existing?.lastExecutedQuery ?? "",
      viewMode: state.viewMode ?? existing?.viewMode ?? "table",
      selectedDialect: state.selectedDialect ?? existing?.selectedDialect ?? "auto",
      tableViewType: state.tableViewType ?? existing?.tableViewType,
      scrollPosition: state.scrollPosition ?? existing?.scrollPosition,
      editorCursorPosition: state.editorCursorPosition ?? existing?.editorCursorPosition,
      gridColumnWidths: state.gridColumnWidths ?? existing?.gridColumnWidths,
      pinnedResultQuery: state.pinnedResultQuery ?? existing?.pinnedResultQuery,
    };
    memoryStore.set(tabId, toSave);
  }
}

/**
 * Load tab state from IndexedDB
 */
export async function loadTabState(tabId: string): Promise<PersistedTabState | null> {
  const database = getDatabase();

  if (!database) {
    return memoryStore.get(tabId) ?? null;
  }

  try {
    const stored = await database.tabStates.get(tabId);
    return stored ?? null;
  } catch (error) {
    logger.warn("Failed to load tab state from IndexedDB:", error);
    return memoryStore.get(tabId) ?? null;
  }
}

/**
 * Load all tab states from IndexedDB (for bulk initialization)
 */
export async function loadAllTabStates(): Promise<Map<string, PersistedTabState>> {
  const database = getDatabase();
  const result = new Map<string, PersistedTabState>();

  if (!database) {
    return new Map(memoryStore);
  }

  try {
    const allStates = await database.tabStates.toArray();
    for (const state of allStates) {
      result.set(state.tabId, state);
    }
    return result;
  } catch (error) {
    logger.warn("Failed to load all tab states from IndexedDB:", error);
    return new Map(memoryStore);
  }
}

/**
 * Remove tab state from IndexedDB
 */
export async function removePersistedTabState(tabId: string): Promise<void> {
  const database = getDatabase();
  memoryStore.delete(tabId);

  if (!database) {
    return;
  }

  try {
    await database.tabStates.delete(tabId);
  } catch (error) {
    logger.warn("Failed to remove tab state from IndexedDB:", error);
  }
}

/**
 * Clear all tab states from IndexedDB (for testing or reset)
 */
export async function clearAllTabStates(): Promise<void> {
  const database = getDatabase();
  memoryStore.clear();

  if (!database) {
    return;
  }

  try {
    await database.tabStates.clear();
  } catch (error) {
    logger.warn("Failed to clear all tab states from IndexedDB:", error);
  }
}

/**
 * Migrate data from localStorage to IndexedDB (one-time migration)
 */
export async function migrateFromLocalStorage(): Promise<number> {
  if (!isClient) return 0;

  const database = getDatabase();
  if (!database) return 0;

  let migratedCount = 0;
  const keysToRemove: string[] = [];

  try {
    // Find all tab-state keys in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("tab-state-")) {
        const tabId = key.replace("tab-state-", "");
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as PersistedTabState;
            // Only migrate if not already in IndexedDB
            const existing = await database.tabStates.get(tabId);
            if (!existing) {
              await database.tabStates.put({ ...parsed, tabId });
              migratedCount++;
            }
            keysToRemove.push(key);
          } catch {
            // Skip corrupted entries
            keysToRemove.push(key);
          }
        }
      }
    }

    // Remove migrated keys from localStorage
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    if (migratedCount > 0) {
      logger.info(`Migrated ${migratedCount} tab states from localStorage to IndexedDB`);
    }
  } catch (error) {
    logger.warn("Failed to migrate tab states from localStorage:", error);
  }

  return migratedCount;
}
