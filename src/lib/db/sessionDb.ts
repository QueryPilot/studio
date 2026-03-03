/**
 * Session Database
 *
 * IndexedDB persistence for workspace layouts, tab states, and app state
 * using Dexie. This is the foundation of the workspace-first persistent
 * sessions feature.
 */

import Dexie, { type Table } from "dexie";
import type { GridNode, PanelContent } from "@/types/workbench";

// ---------------------------------------------------------------------------
// Persisted types
// ---------------------------------------------------------------------------

export interface PersistedWorkspaceLayout {
  workspaceId: string;
  layoutTree: GridNode;
  panelContents: Array<[string, PanelContent]>;
  savedAt: number;
  lastActiveAt: number;
}

/**
 * Extended tab state stored in the session database.
 * This will replace the `PersistedTabState` in `tabState.ts` after migration.
 * Fields beyond `tabId` are intentionally open until Task 6 defines the full schema.
 */
export interface PersistedTabState {
  tabId: string;
  [key: string]: unknown;
}

export interface PersistedAppState {
  key: string; // always "singleton"
  lastActiveWorkspaceIds: string[];
  windowStates: Array<{
    workspaceId: string;
    windowBounds?: { x: number; y: number; width: number; height: number };
  }>;
  migrationVersion: number;
}

// ---------------------------------------------------------------------------
// Database class
// ---------------------------------------------------------------------------

class SessionDatabase extends Dexie {
  workspaceLayouts!: Table<PersistedWorkspaceLayout, string>;
  tabStates!: Table<PersistedTabState, string>;
  appState!: Table<PersistedAppState, string>;

  constructor() {
    super("query-pilot-sessions");
    this.version(1).stores({
      workspaceLayouts: "&workspaceId",
      tabStates: "&tabId",
      appState: "&key",
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let db: SessionDatabase | null = null;

/**
 * Returns the singleton SessionDatabase instance.
 * Throws if called outside a browser environment (no IndexedDB).
 */
export function getSessionDatabase(): SessionDatabase {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error(
      "SessionDatabase is only available in a browser environment with IndexedDB"
    );
  }
  if (!db) {
    db = new SessionDatabase();
  }
  return db;
}
