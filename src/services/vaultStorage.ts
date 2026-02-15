import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";
import {
  type ConnectionMetadata,
  type ConnectionProfile,
  type StoredConnection,
  type GroupTag,
} from "@/types/connection";
import type { WorkspaceConfig } from "@/types/workspace";
import { type VaultData, VAULT_VERSION } from "@/types/vault";

const OPERATION_TIMEOUT = 15000; // general non-critical ops
const READ_TIMEOUT = 180000; // 3 minutes for keychain prompt
const STORE_TIMEOUT = 60000; // background snapshot write

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs),
    ),
  ]);
}

class VaultStorageService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private saveScheduled = false;
  private indexCache: string[] | null = null;
  private connectionCache: Map<string, StoredConnection> = new Map();
  private dirtyIds: Set<string> = new Set();
  private deletedIds: Set<string> = new Set();
  private indexDirty = false;
  private keychainAccessible = true; // Track if keychain is accessible
  private groupTagsCache: GroupTag[] | null = null;
  private groupTagsDirty = false;
  private workspacesCache: WorkspaceConfig[] | null = null;
  private workspacesDirty = false;

  private scheduleSave(): void {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    setTimeout(() => {
      this.flushPendingChanges().catch((err: unknown) => {
        logger.error("Background save failed", err);
      });
    }, 250);
  }

  async flushPendingChanges(): Promise<void> {
    await this.ensureInitialized();

    if (
      !this.indexDirty &&
      this.dirtyIds.size === 0 &&
      this.deletedIds.size === 0 &&
      !this.groupTagsDirty &&
      !this.workspacesDirty
    ) {
      this.saveScheduled = false;
      return;
    }

    if (!this.keychainAccessible) {
      logger.warn("Keychain not accessible, skipping vault write to prevent data loss");
      this.saveScheduled = false;
      return;
    }

    try {
      await this.writeVaultData();
    } catch (err) {
      logger.error("Failed to write snapshot", err);
      if (err instanceof Error && (
        err.message.includes("keychain") ||
        err.message.includes("Keychain") ||
        err.message.includes("access denied")
      )) {
        this.keychainAccessible = false;
      }
    } finally {
      this.dirtyIds.clear();
      this.deletedIds.clear();
      this.indexDirty = false;
      this.groupTagsDirty = false;
      this.workspacesDirty = false;
      this.saveScheduled = false;
    }
  }

  private async writeVaultData(): Promise<void> {
    const vaultData: VaultData = {
      version: VAULT_VERSION,
      connections: Array.from(this.connectionCache.values()),
      groupTags: this.groupTagsCache || [],
      workspaces: this.workspacesCache || [],
      migratedAt: new Date().toISOString(),
    };

    await withTimeout(
      invoke("vault_write", { plaintextJson: JSON.stringify(vaultData) }),
      STORE_TIMEOUT,
      "Write encrypted vault",
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      try {
        await this.preloadAllInternal();
        this.initialized = true;
      } finally {
        // Always clear initPromise to allow retry on failure
        this.initPromise = null;
      }
    })();
    await this.initPromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async getIndex(): Promise<string[]> {
    await this.ensureInitialized();
    if (this.indexCache) return this.indexCache;
    const ids = Array.from(this.connectionCache.keys());
    this.indexCache = ids;
    return ids;
  }

  async storeConnection(profile: ConnectionProfile): Promise<string> {
    await this.ensureInitialized();

    if (!this.keychainAccessible) {
      throw new Error("Cannot store connection: keychain access denied. Please grant access and retry.");
    }

    const profileToStore: ConnectionProfile = { ...profile };
    if (!profileToStore.id) {
      profileToStore.id = crypto.randomUUID();
    }

    const stored: StoredConnection = {
      profile: profileToStore,
      metadata: {
        created_at: new Date().toISOString(),
        last_used: null,
        use_count: 0,
        tags: [],
        is_favorite: false,
      },
    };

    // Immediately update in-memory cache (synchronous)
    this.connectionCache.set(profileToStore.id, stored);

    // Update index in-memory (synchronous)
    const index = await this.getIndex();
    if (!index.includes(profileToStore.id)) {
      index.push(profileToStore.id);
      this.indexCache = [...index];
      this.indexDirty = true;
    }

    // Mark as dirty
    this.dirtyIds.add(profileToStore.id);

    // CRITICAL: Flush immediately for new connection to prevent data loss
    await this.flushPendingChanges();

    return profileToStore.id;
  }

  async getConnection(id: string): Promise<StoredConnection | null> {
    await this.ensureInitialized();
    return withTimeout(
      Promise.resolve(this.connectionCache.get(id) ?? null),
      READ_TIMEOUT,
      `Get connection ${id}`,
    );
  }

  async listConnections(): Promise<StoredConnection[]> {
    await this.ensureInitialized();
    return withTimeout(
      Promise.resolve(Array.from(this.connectionCache.values())),
      OPERATION_TIMEOUT,
      "List connections",
    );
  }

  async updateConnection(
    id: string,
    profile: ConnectionProfile,
  ): Promise<void> {
    await this.ensureInitialized();

    if (!this.keychainAccessible) {
      throw new Error("Cannot update connection: keychain access denied. Please grant access and retry.");
    }

    const existing = this.connectionCache.get(id);
    if (!existing) {
      throw new Error(`Connection ${id} not found`);
    }
    const profileToStore: ConnectionProfile = { ...profile, id };
    const metadata: ConnectionMetadata = { ...existing.metadata };

    // Immediately update in-memory cache (synchronous)
    this.connectionCache.set(id, { profile: profileToStore, metadata });

    // Mark as dirty
    this.dirtyIds.add(id);

    // CRITICAL: Flush immediately for connection profile changes to prevent data loss
    await this.flushPendingChanges();
  }

  async deleteConnection(id: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.keychainAccessible) {
      throw new Error("Cannot delete connection: keychain access denied. Please grant access and retry.");
    }

    // Clean up workspace references to this connection
    if (this.workspacesCache) {
      let workspacesDirty = false;
      for (const ws of this.workspacesCache) {
        if (ws.connectionIds.includes(id)) {
          ws.connectionIds = ws.connectionIds.filter((cid) => cid !== id);
          workspacesDirty = true;
        }
      }
      if (workspacesDirty) {
        this.workspacesDirty = true;
      }
    }

    // Immediately update in-memory cache (synchronous)
    const index = await this.getIndex();
    const newIndex = index.filter((connId) => connId !== id);
    this.indexCache = [...newIndex];
    this.indexDirty = true;
    this.connectionCache.delete(id);

    // Mark as dirty
    this.deletedIds.add(id);

    // CRITICAL: Flush immediately for deletion to prevent data loss
    await this.flushPendingChanges();
  }

  private async updateMetadataInternal(
    id: string,
    metadata: ConnectionMetadata,
  ): Promise<void> {
    await this.ensureInitialized();
    const conn = this.connectionCache.get(id);
    if (conn) {
      conn.metadata = metadata;
      this.connectionCache.set(id, conn);
    }
    this.dirtyIds.add(id);
  }

  async updateMetadata(
    id: string,
    metadata: ConnectionMetadata,
  ): Promise<void> {
    await this.updateMetadataInternal(id, metadata);
    this.scheduleSave();
  }

  async toggleFavorite(id: string): Promise<boolean> {
    const conn = await this.getConnection(id);
    if (!conn) {
      throw new Error(`Connection ${id} not found`);
    }
    conn.metadata.is_favorite = !conn.metadata.is_favorite;
    await this.updateMetadata(id, conn.metadata);
    return conn.metadata.is_favorite;
  }

  async updateTags(id: string, tags: string[]): Promise<void> {
    const conn = await this.getConnection(id);
    if (!conn) {
      throw new Error(`Connection ${id} not found`);
    }
    conn.metadata.tags = tags;
    await this.updateMetadataInternal(id, conn.metadata);
    // CRITICAL: Flush immediately when updating tags during connection save
    await this.flushPendingChanges();
  }

  async markAsUsed(id: string): Promise<void> {
    const conn = await this.getConnection(id);
    if (!conn) {
      throw new Error(`Connection ${id} not found`);
    }
    conn.metadata.last_used = new Date().toISOString();
    conn.metadata.use_count += 1;
    await this.updateMetadataInternal(id, conn.metadata);
  }

  async resetVault(): Promise<void> {
    await this.ensureInitialized();
    const index = await this.getIndex();
    for (const id of index) {
      await this.deleteConnection(id);
    }
    await invoke("vault_reset");
    this.initialized = false;
    this.indexCache = null;
    this.connectionCache.clear();
    this.dirtyIds.clear();
    this.deletedIds.clear();
    this.indexDirty = false;
  }

  private async preloadAllInternal(): Promise<void> {
    try {
      const data = await withTimeout(
        invoke<string | null>("vault_read"),
        READ_TIMEOUT,
        "Read vault snapshot",
      );

      this.keychainAccessible = true;

      if (data) {
        const parsed = JSON.parse(data);

        // Detect legacy format (array) vs new format (object)
        if (Array.isArray(parsed)) {
          logger.info("[VaultStorage] Detected legacy vault format, migrating...");
          await this.migrateLegacyVault(parsed);
        } else {
          // New format: VaultData
          const vaultData = parsed as VaultData;
          this.connectionCache.clear();
          for (const sc of vaultData.connections) {
            if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
          }
          this.groupTagsCache = vaultData.groupTags || [];
          this.workspacesCache = vaultData.workspaces || [];
          if (!this.indexCache) {
            this.indexCache = vaultData.connections.map(s => s.profile.id).filter(Boolean);
          }
        }
        return;
      }

      // No data exists (null returned) - initialize with empty state
      this.connectionCache.clear();
      this.indexCache = [];
      this.groupTagsCache = [];
      this.workspacesCache = [];
      await this.writeVaultData();
    } catch (err) {
      logger.error("Failed to read vault - keychain may be inaccessible", err);

      // Check if this is a keychain access error
      if (err instanceof Error && (
        err.message.includes("keychain") ||
        err.message.includes("Keychain") ||
        err.message.includes("access denied") ||
        err.message.includes("timed out")
      )) {
        this.keychainAccessible = false;
        logger.warn("Keychain access failed - running in read-only mode to prevent data loss");

        // Throw to allow caller to handle UI feedback
        throw new Error("Keychain access required. Please grant access in System Settings.");
      }

      // CRITICAL: Do NOT clear cache or write empty data on error
      // Leave existing in-memory state intact (or empty if first load)
      if (!this.indexCache) {
        this.indexCache = [];
      }
      if (!this.groupTagsCache) {
        this.groupTagsCache = [];
      }
      if (!this.workspacesCache) {
        this.workspacesCache = [];
      }
    }
  }

  private async migrateLegacyVault(connections: StoredConnection[]): Promise<void> {
    logger.info("[VaultStorage] Starting migration from legacy format");

    // Load connections
    this.connectionCache.clear();
    for (const sc of connections) {
      if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
    }

    // Migrate group tags from localStorage
    try {
      const groupTagsJson = localStorage.getItem("query_pilot_group_tags");
      this.groupTagsCache = groupTagsJson ? JSON.parse(groupTagsJson) : [];
      logger.info(`[VaultStorage] Migrated ${this.groupTagsCache?.length || 0} group tags`);
    } catch (err) {
      logger.warn("Failed to migrate group tags", err);
      this.groupTagsCache = [];
    }

    // Migrate workspaces from localStorage
    try {
      const workspacesJson = localStorage.getItem("qp:workspaces");
      const workspaces: WorkspaceConfig[] = workspacesJson ? JSON.parse(workspacesJson) : [];
      this.workspacesCache = workspaces;
      logger.info(`[VaultStorage] Migrated ${workspaces.length} workspaces`);
    } catch (err) {
      logger.warn("Failed to migrate workspaces", err);
      this.workspacesCache = [];
    }

    // Mark dirty and schedule async flush (non-blocking)
    this.groupTagsDirty = true;
    this.workspacesDirty = true;
    this.indexDirty = true;

    // Don't await - schedule the flush to happen in the background
    this.scheduleSave();
    logger.info("[VaultStorage] Migration complete (saving in background)");
  }

  async preloadAll(): Promise<void> {
    await this.initialize();
  }

  hasPendingChanges(): boolean {
    return (
      this.indexDirty || this.dirtyIds.size > 0 || this.deletedIds.size > 0
    );
  }

  isKeychainAccessible(): boolean {
    return this.keychainAccessible;
  }

  async retryKeychainAccess(): Promise<boolean> {
    try {
      const data = await withTimeout(
        invoke<string | null>("vault_read"),
        READ_TIMEOUT,
        "Retry vault read",
      );

      this.keychainAccessible = true;

      if (data) {
        const parsed = JSON.parse(data);

        if (Array.isArray(parsed)) {
          // Legacy format
          this.connectionCache.clear();
          for (const sc of parsed) {
            if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
          }
          this.indexCache = parsed.map((s: StoredConnection) => s.profile.id).filter(Boolean);
        } else {
          // New format
          const vaultData = parsed as VaultData;
          this.connectionCache.clear();
          for (const sc of vaultData.connections) {
            if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
          }
          this.groupTagsCache = vaultData.groupTags || [];
          this.workspacesCache = vaultData.workspaces || [];
          this.indexCache = vaultData.connections.map(s => s.profile.id).filter(Boolean);
        }
      }

      return true;
    } catch (err) {
      logger.error("Retry keychain access failed", err);
      this.keychainAccessible = false;
      return false;
    }
  }

  async requestKeychainAccess(): Promise<boolean> {
    try {
      // Trigger keychain prompt by attempting read
      await invoke<string | null>("vault_read");
      this.keychainAccessible = true;
      return true;
    } catch (err) {
      logger.error("Keychain access request failed", err);
      this.keychainAccessible = false;
      return false;
    }
  }

  // ============================================================================
  // Group Tags Storage
  // ============================================================================

  async listGroupTags(): Promise<GroupTag[]> {
    await this.ensureInitialized();
    return this.groupTagsCache || [];
  }

  async storeGroupTag(tag: GroupTag): Promise<void> {
    await this.ensureInitialized();
    const tags = this.groupTagsCache || [];
    const existing = tags.findIndex(t => t.name === tag.name);

    if (existing >= 0) {
      tags[existing] = tag;
    } else {
      tags.push(tag);
    }

    this.groupTagsCache = tags;
    this.groupTagsDirty = true;
    await this.flushPendingChanges();  // Immediate flush for UX
  }

  async deleteGroupTag(name: string): Promise<void> {
    await this.ensureInitialized();
    const tags = this.groupTagsCache || [];
    this.groupTagsCache = tags.filter(t => t.name !== name);
    this.groupTagsDirty = true;
    this.scheduleSave();
  }

  // ============================================================================
  // Workspace Storage (migrated to vault)
  // ============================================================================

  async listWorkspaces(): Promise<WorkspaceConfig[]> {
    await this.ensureInitialized();
    return this.workspacesCache || [];
  }

  async getWorkspace(id: string): Promise<WorkspaceConfig | null> {
    const workspaces = await this.listWorkspaces();
    return workspaces.find((ws) => ws.id === id) || null;
  }

  async storeWorkspace(config: WorkspaceConfig): Promise<string> {
    await this.ensureInitialized();
    const workspaces = this.workspacesCache || [];
    const existing = workspaces.findIndex((ws) => ws.id === config.id);

    if (existing >= 0) {
      workspaces[existing] = config;
    } else {
      workspaces.push(config);
    }

    this.workspacesCache = [...workspaces];
    this.workspacesDirty = true;

    await this.flushPendingChanges();  // Immediate flush
    logger.info(`[VaultStorage] Stored workspace: ${config.name} (${config.id})`);
    return config.id;
  }

  async updateWorkspace(
    id: string,
    updates: Partial<WorkspaceConfig>,
  ): Promise<void> {
    await this.ensureInitialized();
    const workspaces = this.workspacesCache || [];
    const index = workspaces.findIndex((ws) => ws.id === id);
    const existing = workspaces[index];

    if (index >= 0 && existing) {
      const updated = {
        ...existing,
        ...updates,
        id: existing.id,
        connectionIds: updates.connectionIds ?? existing.connectionIds,
        updatedAt: new Date().toISOString(),
      };
      workspaces[index] = updated;
      this.workspacesCache = [...workspaces];
      this.workspacesDirty = true;
      this.scheduleSave();
    }
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.ensureInitialized();
    this.workspacesCache = (this.workspacesCache || []).filter(ws => ws.id !== id);
    this.workspacesDirty = true;
    await this.flushPendingChanges();
    logger.info(`[VaultStorage] Deleted workspace: ${id}`);
  }

}

export const vaultStorage = new VaultStorageService();
export type { StoredConnection, ConnectionProfile, ConnectionMetadata };
