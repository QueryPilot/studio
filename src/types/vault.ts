import type { StoredConnection, GroupTag } from "./connection";

export interface VaultSecretRecord {
  name: string;
  /** "s3" | "gcs" | "azure" | "http" | "huggingface" | ... */
  type: string;
  provider?: string;
  persistent?: boolean;
  params: Record<string, string>;
  connection_id: string;
}
import type { AuthProfile, TunnelProfile } from "./tunnel";
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
  /** Reusable authentication profiles (e.g. AWS, Azure AD) */
  auth_profiles?: AuthProfile[];
  /** Reusable tunnel profiles (SSH, SSM bastion) */
  tunnel_profiles?: TunnelProfile[];
  /** BYOK provider API keys (provider ID → key) */
  apiKeys?: Record<string, string>;
  /** DuckDB-scoped vault secret records (used by Phase 3 replay) */
  secrets?: VaultSecretRecord[];
  /** Timestamp when data was migrated to this format */
  migratedAt?: string;
  /** Source of migration (for debugging) */
  migratedFrom?: 'localStorage' | 'legacy_vault';
}

export const VAULT_VERSION = 2;
