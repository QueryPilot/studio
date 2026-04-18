import type { ConnectionProfile, Attachment } from "@/types/connection";

/**
 * Strip secret-related fields from a profile before exporting.
 * Removes `secret_refs` from DatabaseEntry and `secret_ref` from Attachments
 * to avoid leaking secret names (and certainly never the actual values).
 */
export function stripSecretsForExport(profile: ConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    databases: profile.databases.map((db) => ({
      ...db,
      secret_refs: undefined,
      attachments: (db.attachments ?? []).map(
        (att): Attachment => ({ ...att, secret_ref: undefined }),
      ),
    })),
  };
}

export interface ImportWarnings {
  warnings: string[];
}

/**
 * Validate an imported profile. Returns a list of warnings for any
 * attachments that reference secrets not present in the supplied vault secrets.
 */
export function validateImportedProfile(
  profile: ConnectionProfile,
  existingSecretNames: string[],
): ImportWarnings {
  const warnings: string[] = [];
  const knownSecrets = new Set(existingSecretNames);

  for (const db of profile.databases) {
    for (const ref of db.secret_refs ?? []) {
      if (!knownSecrets.has(ref)) {
        warnings.push(
          `Secret "${ref}" referenced by database "${db.name}" is not in the destination vault.`,
        );
      }
    }
    for (const att of db.attachments ?? []) {
      if (att.secret_ref && !knownSecrets.has(att.secret_ref)) {
        warnings.push(
          `Secret "${att.secret_ref}" referenced by attachment "${att.alias}" is not in the destination vault.`,
        );
      }
    }
  }

  return { warnings };
}
