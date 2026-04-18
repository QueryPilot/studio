import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { vaultStorage } from "./vaultStorage";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";
import type { ConnectionProfile, Attachment, DatabaseEntry } from "@/types/connection";
import { logger } from "@/lib/logger";

interface DecryptedSecretPayload {
  name: string;
  type: string;
  provider?: string;
  persistent?: boolean;
  params: Record<string, string>;
}

export interface DuckDbReplayResult {
  runtime_databases: DatabaseEntry[];
  errors: { alias: string; message: string }[];
}

interface ReplayProgressEvent {
  connection_id: string;
  step: "extension" | "secret" | "attach";
  name: string;
  status: "started" | "ok" | "error";
}

/**
 * Subscribe to `duckdb-replay-progress` Tauri events globally.
 * Call once at app boot. Returns an unlisten function.
 */
export async function subscribeDuckDbReplayProgress(): Promise<() => void> {
  return listen<ReplayProgressEvent>("duckdb-replay-progress", (event) => {
    const { connection_id, step, name, status } = event.payload;
    logger.debug(`[DuckDB Replay] ${step}:${name} → ${status} (${connection_id})`);
    if (status === "error" && step === "attach") {
      useRuntimeDatabasesStore.getState().appendError(connection_id, {
        alias: name,
        message: `Failed to attach: ${name}`,
      });
    }
  });
}

/**
 * Subscribe to `duckdb-connection-reestablished` events emitted when the
 * backend silently reconnects a DuckDB adapter (idle reaper eviction, tunnel
 * reconnect, per-tab fresh connection). The fresh connection only ran the
 * backend's non-secret attachment replay in `DuckDbAdapter::connect`;
 * secret-backed attachments still need the decrypted payloads from the
 * frontend vault, so we re-invoke `runDuckDbReplay` for that connection.
 *
 * The resolver is injected so this module stays free of store imports that
 * would create circular dependencies.
 */
export async function subscribeDuckDbConnectionReestablished(
  resolveProfile: (
    connectionId: string,
  ) => Promise<ConnectionProfile | undefined> | ConnectionProfile | undefined,
): Promise<() => void> {
  // Debounce per connection_id — reaper reconnects frequently fire for several
  // sibling keys in quick succession; one replay per wave is enough.
  const inFlight = new Set<string>();
  return listen<{ connection_id: string }>(
    "duckdb-connection-reestablished",
    (event) => {
      const connId = event.payload.connection_id;
      if (!connId || inFlight.has(connId)) return;
      inFlight.add(connId);
      void (async () => {
        try {
          const profile = await resolveProfile(connId);
          if (!profile) {
            logger.debug(
              `[DuckDB Reconnect] no profile for ${connId}, skipping replay`,
            );
            return;
          }
          await runDuckDbReplay(profile);
        } catch (err) {
          logger.warn(
            `[DuckDB Reconnect] replay for ${connId} failed:`,
            err,
          );
        } finally {
          inFlight.delete(connId);
        }
      })();
    },
  );
}

/**
 * Runs the DuckDB replay setup after a successful connect.
 * Reads encrypted secret records from the vault, decrypts them (they are
 * already in plaintext in vault — vault encryption is at-rest via keychain),
 * and invokes `duckdb_replay_setup` with the decrypted payloads.
 *
 * The Rust backend never touches the vault directly.
 */
export async function runDuckDbReplay(
  profile: ConnectionProfile,
): Promise<DuckDbReplayResult> {
  const db0 = profile.databases[0];
  const attachments: Attachment[] = db0?.attachments ?? [];
  const neededRefs = new Set<string>();
  for (const a of attachments) {
    if (a.secret_ref) neededRefs.add(a.secret_ref);
  }
  for (const r of db0?.secret_refs ?? []) {
    neededRefs.add(r);
  }

  const records = await vaultStorage.listSecrets(profile.id);
  const secrets: DecryptedSecretPayload[] = records
    .filter((r) => neededRefs.has(r.name))
    .map((r) => ({
      name: r.name,
      type: r.type,
      provider: r.provider,
      persistent: r.persistent,
      params: r.params,
    }));

  const result = await invoke<DuckDbReplayResult>("duckdb_replay_setup", {
    connId: profile.id,
    secrets,
    attachments,
  });

  useRuntimeDatabasesStore.getState().setRuntime(profile.id, {
    databases: result.runtime_databases,
    errors: result.errors,
  });

  return result;
}
