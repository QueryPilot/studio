import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";
import {
  type ConnectionMetadata,
  type ConnectionProfile,
  type StoredConnection,
} from "@/types/connection";

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
      this.deletedIds.size === 0
    ) {
      this.saveScheduled = false;
      return;
    }

    if (!this.keychainAccessible) {
      logger.warn("Keychain not accessible, skipping vault write to prevent data loss");
      this.saveScheduled = false;
      return;
    }

    const snapshot = Array.from(this.connectionCache.values());
    try {
      await withTimeout(
        invoke("vault_write", { plaintextJson: JSON.stringify(snapshot) }),
        STORE_TIMEOUT,
        "Write encrypted snapshot",
      );
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
      this.saveScheduled = false;
    }
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
        "Read connections snapshot",
      );

      this.keychainAccessible = true;

      if (data) {
        const arr = JSON.parse(data) as StoredConnection[];
        this.connectionCache.clear();
        for (const sc of arr) {
          if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
        }
        if (!this.indexCache) {
          this.indexCache = arr.map((s) => s.profile.id).filter(Boolean);
        }
        return;
      }

      // No data exists (null returned) - initialize with empty state
      this.connectionCache.clear();
      this.indexCache = [];
      try {
        await invoke("vault_write", { plaintextJson: JSON.stringify([]) });
      } catch {
        // Ignore errors when initializing empty vault
      }
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
      // This prevents overwriting vault when keychain is slow/denied
      if (!this.indexCache) {
        this.indexCache = [];
      }
    }
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
        const arr = JSON.parse(data) as StoredConnection[];
        this.connectionCache.clear();
        for (const sc of arr) {
          if (sc.profile.id) this.connectionCache.set(sc.profile.id, sc);
        }
        this.indexCache = arr.map((s) => s.profile.id).filter(Boolean);
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
}

export const vaultStorage = new VaultStorageService();
export type { StoredConnection, ConnectionProfile, ConnectionMetadata };
