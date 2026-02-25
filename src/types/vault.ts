import type { StoredConnection, GroupTag } from "./connection";
import type { WorkspaceConfig } from "./workspace";

/**
 * Structured vault data format (v1).
 * Replaces legacy array-based format with a versioned object structure
 * that supports connections, group tags, and workspaces.
 */
export interface VaultData {
  /** Schema version for migration tracking */
  version: number;
  /** All stored connections with metadata */
  connections: StoredConnection[];
  /** User-defined group tags for organizing connections */
  groupTags: GroupTag[];
  /** Saved workspace configurations */
  workspaces: WorkspaceConfig[];
  /** BYOK provider API keys (provider ID → key) */
  apiKeys?: Record<string, string>;
  /** Timestamp when data was migrated to this format */
  migratedAt?: string;
  /** Source of migration (for debugging) */
  migratedFrom?: 'localStorage' | 'legacy_vault';
}

export const VAULT_VERSION = 1;
