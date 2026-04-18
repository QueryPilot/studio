import { invoke } from "@tauri-apps/api/core";
import { vaultStorage } from "./vaultStorage";

/**
 * Install and load a DuckDB extension, then persist it to the connection profile.
 * After this, the extension will be replayed on every reconnect.
 */
export async function upsertExtension(
  connectionId: string,
  extension: string,
): Promise<void> {
  // Install and load via Tauri command
  await invoke("duckdb_install_load_extension", { connId: connectionId, extension });

  // Persist to profile
  const conn = await vaultStorage.getConnection(connectionId);
  if (!conn) throw new Error("connection missing");

  const databases = conn.profile.databases;
  const db0 = databases[0];
  if (!db0) return;

  const existing = db0.extensions ?? [];
  if (existing.includes(extension)) return; // already persisted

  await vaultStorage.updateConnection(connectionId, {
    ...conn.profile,
    databases: [
      { ...db0, extensions: [...existing, extension] },
      ...databases.slice(1),
    ],
  });
}

/**
 * Remove a persisted extension from the connection profile.
 * DuckDB has no UNLOAD command, so this only removes the persistence entry —
 * the extension remains loaded for the current session.
 */
export async function removeExtension(
  connectionId: string,
  extension: string,
): Promise<void> {
  const conn = await vaultStorage.getConnection(connectionId);
  if (!conn) throw new Error("connection missing");

  const databases = conn.profile.databases;
  const db0 = databases[0];
  if (!db0) return;

  const existing = db0.extensions ?? [];
  if (!existing.includes(extension)) return; // not persisted

  await vaultStorage.updateConnection(connectionId, {
    ...conn.profile,
    databases: [
      { ...db0, extensions: existing.filter((e) => e !== extension) },
      ...databases.slice(1),
    ],
  });
}
