/**
 * Session Migration
 *
 * One-time migration that moves data from old persistence locations
 * (localStorage layouts + old IndexedDB tab states) into the new
 * consolidated session database (`query-pilot-sessions`).
 *
 * The migration is idempotent — it checks `migrationVersion` in appState
 * and only runs when the stored version is below `MIGRATION_VERSION`.
 */

import Dexie from "dexie";
import {
  getSessionDatabase,
  type PersistedWorkspaceLayout,
} from "./sessionDb";
import type { GridNode, PanelContent } from "@/types/workbench";

const MIGRATION_VERSION = 1;

/**
 * Run all pending session data migrations.
 *
 * This is fire-and-forget — callers should `.catch()` to avoid
 * unhandled rejections, but a failure here must never block app startup.
 */
export async function runSessionMigration(): Promise<void> {
  const db = getSessionDatabase();

  // Check if already migrated
  const appState = await db.appState.get("singleton");
  if (appState && appState.migrationVersion >= MIGRATION_VERSION) return;

  // Run both migration steps — track success independently
  let layoutOk = true;
  let tabStatesOk = true;

  try {
    await migrateLayoutsFromLocalStorage(db);
  } catch (error) {
    layoutOk = false;
    console.warn("[migration] Layout migration failed:", error);
  }

  try {
    await migrateTabStatesFromOldDb(db);
  } catch (error) {
    tabStatesOk = false;
    console.warn("[migration] Tab state migration failed:", error);
  }

  // Only mark migration complete if ALL steps succeeded
  if (layoutOk && tabStatesOk) {
    await db.appState.put({
      key: "singleton",
      lastActiveWorkspaceIds: appState?.lastActiveWorkspaceIds ?? [],
      windowStates: appState?.windowStates ?? [],
      migrationVersion: MIGRATION_VERSION,
    });
  } else {
    console.warn(
      "[migration] Migration partially failed — will retry on next startup"
    );
  }
}

// ---------------------------------------------------------------------------
// Layout migration (localStorage → session DB)
// ---------------------------------------------------------------------------

interface OldLayoutData {
  layoutTree: GridNode;
  panelContents: Array<[string, PanelContent]>;
  savedAt: number;
}

async function migrateLayoutsFromLocalStorage(
  db: ReturnType<typeof getSessionDatabase>
): Promise<void> {
  const PREFIX = "workbench-connection-";
  let migratedCount = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const data = JSON.parse(raw) as OldLayoutData;
      if (!data.layoutTree || !data.panelContents) continue;

      const workspaceId = key.slice(PREFIX.length);

      const record: PersistedWorkspaceLayout = {
        workspaceId,
        layoutTree: data.layoutTree,
        panelContents: data.panelContents,
        savedAt: data.savedAt ?? Date.now(),
        lastActiveAt: data.savedAt ?? Date.now(),
      };

      await db.workspaceLayouts.put(record);
      keysToRemove.push(key);
      migratedCount++;
    } catch {
      // Skip corrupted entries — don't crash the migration
    }
  }

  // Clean up migrated localStorage keys
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

}

// ---------------------------------------------------------------------------
// Tab state migration (old IndexedDB → session DB)
// ---------------------------------------------------------------------------

const OLD_TAB_STATE_DB_NAME = "query-pilot-tab-state";

async function migrateTabStatesFromOldDb(
  db: ReturnType<typeof getSessionDatabase>
): Promise<void> {
  // Check if the old database exists
  const dbNames = await Dexie.getDatabaseNames();
  if (!dbNames.includes(OLD_TAB_STATE_DB_NAME)) return;

  // Open the old database with a generic Dexie instance so we can read
  // its data without importing the old schema class.
  const oldDb = new Dexie(OLD_TAB_STATE_DB_NAME);
  oldDb.version(1).stores({ tabStates: "&tabId" });

  try {
    const oldRecords = await oldDb.table("tabStates").toArray();

    // Filter to valid records with non-empty tabId
    const validRecords = oldRecords
      .filter(
        (r: Record<string, unknown>) =>
          typeof r.tabId === "string" && r.tabId.length > 0
      )
      .map((r: Record<string, unknown>) => ({
        ...r,
        tabId: r.tabId as string,
      }));

    if (validRecords.length > 0) {
      await db.tabStates.bulkPut(validRecords);
    }
  } finally {
    oldDb.close();
  }
}
