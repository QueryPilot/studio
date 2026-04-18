import { invoke } from "@tauri-apps/api/core";
import { vaultStorage } from "./vaultStorage";
import type { Attachment, AttachmentKind, ConnectionProfile } from "@/types/connection";
import type { VaultSecretRecord } from "@/types/vault";

interface DecryptedSecretPayload {
  name: string;
  type: string;
  provider?: string;
  persistent?: boolean;
  params: Record<string, string>;
}

function toPayload(r: VaultSecretRecord): DecryptedSecretPayload {
  return {
    name: r.name,
    type: r.type,
    provider: r.provider,
    persistent: r.persistent,
    params: r.params,
  };
}

function withAppendedAttachment(
  profile: ConnectionProfile,
  attachment: Attachment,
): ConnectionProfile {
  const databases = profile.databases;
  const db0 = databases[0];
  if (!db0) {
    return {
      ...profile,
      databases: [
        {
          name: profile.database,
          visible_schemas: ["main"],
          attachments: [attachment],
        },
      ],
    };
  }
  const existing = db0.attachments ?? [];
  const filtered = existing.filter((a) => a.alias !== attachment.alias);
  return {
    ...profile,
    databases: [{ ...db0, attachments: [...filtered, attachment] }, ...databases.slice(1)],
  };
}

function withRemovedAttachment(
  profile: ConnectionProfile,
  alias: string,
): ConnectionProfile {
  const databases = profile.databases;
  const db0 = databases[0];
  if (!db0) return profile;
  const nextAttachments = (db0.attachments ?? []).filter((a) => a.alias !== alias);
  return {
    ...profile,
    databases: [{ ...db0, attachments: nextAttachments }, ...databases.slice(1)],
  };
}

function attachmentKindFromAttachInput(
  dbType: string | undefined,
  uri: string,
): AttachmentKind {
  const normalizedType = dbType?.trim().toUpperCase();
  switch (normalizedType) {
    case "POSTGRES":
    case "POSTGRESQL":
      return "postgres";
    case "MYSQL":
    case "MARIADB":
      return "mysql";
    case "SQLITE":
      return "sqlite";
    case "DUCKDB":
      return "duckdb";
    default:
      break;
  }

  const normalizedUri = uri.trim().toLowerCase();
  if (normalizedUri.startsWith("postgres://") || normalizedUri.startsWith("postgresql://")) {
    return "postgres";
  }
  if (normalizedUri.startsWith("mysql://") || normalizedUri.startsWith("mariadb://")) {
    return "mysql";
  }
  if (normalizedUri.endsWith(".sqlite") || normalizedUri.endsWith(".sqlite3")) {
    return "sqlite";
  }
  return "duckdb";
}

export async function addDatabaseAttachment(args: {
  connectionId: string;
  path: string;
  alias: string;
  dbType?: string | undefined;
  readOnly: boolean;
}): Promise<Attachment> {
  const attachment: Attachment = {
    alias: args.alias,
    kind: attachmentKindFromAttachInput(args.dbType, args.path),
    uri: args.path,
    ...(args.readOnly ? { read_only: true } : {}),
  };

  await addAttachmentWithSecret({
    connectionId: args.connectionId,
    attachment,
  });

  return attachment;
}

/**
 * Transactional attach: persist secret in vault, issue on adapter, persist
 * attachment to profile, then run ATTACH. Rolls back on any failure.
 *
 * @param connectionId  Connection ID
 * @param attachment    The Attachment to persist and execute
 * @param secret        Optional VaultSecretRecord; if provided, `attachment.secret_ref` must equal `secret.name`
 */
export async function addAttachmentWithSecret(args: {
  connectionId: string;
  attachment: Attachment;
  secret?: VaultSecretRecord;
}): Promise<void> {
  const { connectionId, attachment, secret } = args;
  const prior = await vaultStorage.getConnection(connectionId);
  if (!prior) throw new Error("connection missing");

  // Step 1 — vault secret upsert (no rollback needed if subsequent steps fail — vault is persistent storage)
  if (secret) await vaultStorage.upsertSecret(secret);

  try {
    // Step 2 — issue decrypted secret on adapter
    if (secret)
      await invoke("duckdb_issue_secret", {
        connId: connectionId,
        secret: toPayload(secret),
      });

    // Step 3 — append attachment to profile and persist
    const nextProfile = withAppendedAttachment(prior.profile, attachment);
    await vaultStorage.updateConnection(connectionId, nextProfile);

    try {
      // Step 4 — run ATTACH
      await invoke("duckdb_run_attach", {
        connId: connectionId,
        attachment,
        secret: secret ? toPayload(secret) : null,
      });
    } catch (err) {
      // Roll back step 3 — restore prior profile
      await vaultStorage.updateConnection(connectionId, prior.profile);
      throw err;
    }
  } catch (err) {
    // Roll back step 1 — delete vault secret if we added it
    if (secret) await vaultStorage.deleteSecret(connectionId, secret.name);
    throw err;
  }
}

/**
 * Remove a persisted attachment. Calls DETACH on the adapter, updates profile,
 * and optionally removes orphaned vault secret.
 */
export async function removeAttachment(
  connectionId: string,
  alias: string,
): Promise<void> {
  const prior = await vaultStorage.getConnection(connectionId);
  if (!prior) throw new Error("connection missing");

  // DETACH on the live adapter. If the live session already lost the catalog,
  // still remove the persisted profile entry so it does not reappear on replay.
  try {
    await invoke("duckdb_run_detach", { connId: connectionId, alias });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("database not found") && !message.includes("does not exist")) {
      throw error;
    }
  }

  // Find the attachment to check for orphaned secrets
  const db0 = prior.profile.databases[0];
  const att = (db0?.attachments ?? []).find((a) => a.alias === alias);

  // Remove from profile
  const nextProfile = withRemovedAttachment(prior.profile, alias);
  await vaultStorage.updateConnection(connectionId, nextProfile);

  // Clean up orphaned secret if no other attachment references it
  if (att?.secret_ref) {
    const remaining = (db0?.attachments ?? []).filter(
      (a) => a.alias !== alias && a.secret_ref === att.secret_ref,
    );
    if (remaining.length === 0) {
      await vaultStorage.deleteSecret(connectionId, att.secret_ref);
    }
  }
}
