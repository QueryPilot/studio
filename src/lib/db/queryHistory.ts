/**
 * Query History Database
 *
 * Dexie-based IndexedDB schema for query history and saved queries.
 * Includes retention policy to prevent unbounded growth.
 */

import Dexie, { type Table } from "dexie";
import { nanoid } from "nanoid";

// ============ Interfaces ============

export interface QueryHistoryEntry {
  id: string;
  query: string;
  connectionId: string;
  profileId: string; // Stable ID (survives reconnects)
  database: string;
  schema?: string;
  executedAt: number;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
  source: QuerySource;
}

export type QuerySource =
  | "editor"
  | "grid"
  | "ai"
  | "background"
  | "restore";

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  description?: string;
  tags: string[];
  profileId?: string;
  database?: string;
  schema?: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
}

// ============ Database ============

class QueryHistoryDB extends Dexie {
  history!: Table<QueryHistoryEntry>;
  saved!: Table<SavedQuery>;

  constructor() {
    super("QueryHistoryDB");

    this.version(1).stores({
      history: "id, profileId, executedAt, [profileId+executedAt]",
      saved: "id, profileId, updatedAt, *tags, starred",
    });
  }
}

export const queryHistoryDB = new QueryHistoryDB();

// ============ Retention Policy ============

const MAX_ENTRIES = 1000;
const MAX_AGE_DAYS = 30;

async function enforceRetentionPolicy(): Promise<void> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  // Delete old entries
  await queryHistoryDB.history.where("executedAt").below(cutoff).delete();

  // Keep only last N entries
  const count = await queryHistoryDB.history.count();
  if (count > MAX_ENTRIES) {
    const toDelete = await queryHistoryDB.history
      .orderBy("executedAt")
      .limit(count - MAX_ENTRIES)
      .primaryKeys();
    await queryHistoryDB.history.bulkDelete(toDelete);
  }
}

// ============ History API ============

export async function addHistoryEntry(
  entry: Omit<QueryHistoryEntry, "id">
): Promise<string> {
  const id = nanoid();
  await queryHistoryDB.history.add({ ...entry, id });
  // Run retention policy in background (don't await)
  enforceRetentionPolicy().catch(() => {
    // Ignore retention errors
  });
  return id;
}

export async function getHistory(options?: {
  profileId?: string;
  limit?: number;
  offset?: number;
  since?: number;
}): Promise<QueryHistoryEntry[]> {
  let collection = queryHistoryDB.history.orderBy("executedAt").reverse();

  if (options?.profileId) {
    collection = queryHistoryDB.history
      .where("profileId")
      .equals(options.profileId)
      .reverse();
  }

  let results = await collection.toArray();

  const sinceTime = options?.since;
  if (sinceTime !== undefined) {
    results = results.filter((e) => e.executedAt >= sinceTime);
  }

  const offset = options?.offset;
  if (offset !== undefined) {
    results = results.slice(offset);
  }

  return results.slice(0, options?.limit ?? 100);
}

export async function clearHistory(profileId?: string): Promise<void> {
  if (profileId) {
    await queryHistoryDB.history.where("profileId").equals(profileId).delete();
  } else {
    await queryHistoryDB.history.clear();
  }
}

// ============ Saved Queries API ============

export async function saveQuery(
  query: Omit<SavedQuery, "id">
): Promise<string> {
  const id = nanoid();
  await queryHistoryDB.saved.add({ ...query, id });
  return id;
}

export async function updateSavedQuery(
  id: string,
  updates: Partial<SavedQuery>
): Promise<void> {
  await queryHistoryDB.saved.update(id, updates);
}

export async function deleteSavedQuery(id: string): Promise<void> {
  await queryHistoryDB.saved.delete(id);
}

export async function getSavedQueries(options?: {
  profileId?: string;
  tag?: string;
}): Promise<SavedQuery[]> {
  const collection = queryHistoryDB.saved.orderBy("updatedAt").reverse();

  if (options?.profileId) {
    const results = await queryHistoryDB.saved
      .where("profileId")
      .equals(options.profileId)
      .toArray();
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  if (options?.tag) {
    const results = await queryHistoryDB.saved
      .where("tags")
      .equals(options.tag)
      .toArray();
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return collection.toArray();
}
