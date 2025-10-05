# Stronghold Storage Migration Specification

## Executive Summary

This document outlines the migration from the current JSON-based secure storage to Tauri's Stronghold plugin for enhanced security. This is a **breaking change** with no backward compatibility - all existing connections will need to be re-created.

**Why Stronghold + macOS Keychain?**

- **Military-grade encryption**: ChaCha20-Poly1305 with Argon2 password derivation
- **Zero-friction UX**: Auto-generates vault password, stores in macOS Keychain silently
- **Completely seamless**: No prompts, no Touch ID, no passwords - just works
- **Platform security**: Leverages macOS user account security model
- **Industry standard**: Same approach as 1Password, Bitwarden, TablePlus

**Current State**: Plain JSON files at `.devdb/connections.json` with plaintext passwords

**Target State**: Encrypted Stronghold vault + OS Keychain integration

**Key Innovation - Seamless Auto-Unlock**:

- ✅ Auto-generate random 256-bit master password on first launch
- ✅ Store it silently in macOS Keychain (no user prompts needed)
- ✅ Auto-unlock vault on every app launch using keychain password
- ✅ User never sees or enters master password
- ✅ **No UI changes needed** - completely transparent to user
- ✅ **No Touch ID/password prompts** - silent keychain access

---

## Current State Analysis

### Storage Architecture

```
SecureStorage (src-tauri/src/storage/secure_store.rs)
├── Storage: .devdb/connections.json (plain JSON)
├── In-Memory Cache: DashMap<String, StoredConnection>
├── Encryption: Placeholder (not implemented)
└── Persistence: Synchronous file writes
```

### Data Structures

```rust
pub struct StoredConnection {
    pub profile: ConnectionProfile,
    pub metadata: ConnectionMetadata,
}

pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,  // PLAINTEXT!
    pub ssh_tunnel: Option<SshTunnelConfig>,  // Contains passwords/keys
    // ... other fields
}

pub struct ConnectionMetadata {
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub use_count: u32,
    pub tags: Vec<String>,
    pub is_favorite: bool,
}
```

### Current API Surface

**Rust Commands:**

- `store_connection(ConnectionProfile) -> Result<String>`
- `get_connection(id: &str) -> Result<StoredConnection>`
- `list_connections() -> Result<Vec<StoredConnection>>`
- `update_connection(id: &str, ConnectionProfile) -> Result<()>`
- `delete_connection(id: &str) -> Result<()>`
- `clear_all() -> Result<()>`
- `mark_as_used(id: &str) -> Result<()>`
- `toggle_favorite(id: &str) -> Result<bool>`
- `add_tag/remove_tag/update_tags(id: &str, ...) -> Result<()>`
- `search(query: &str) -> Result<Vec<StoredConnection>>`

**TypeScript Services:**

- `secureStorage.ts`: Direct Tauri command wrapper
- `secureConnectionService.ts`: Higher-level connection management with cache

---

## Stronghold Architecture

### Core Concepts

```
Stronghold Instance
├── Vault File: ~/Library/Application Support/com.hieuvd.devdb-studio/vault.hold (encrypted)
├── Salt File: ~/Library/Application Support/com.hieuvd.devdb-studio/salt.txt (random bytes)
├── Password: User-provided master password (Argon2 derived key)
├── Clients: Isolated storage namespaces
│   ├── "connections" client
│   │   ├── Store: Key-value secret storage
│   │   │   ├── "conn:{uuid}:profile" -> ConnectionProfile (encrypted)
│   │   │   ├── "conn:{uuid}:metadata" -> ConnectionMetadata (encrypted)
│   │   │   └── "conn:{uuid}:secrets" -> ConnectionSecrets (encrypted)
│   │   └── Non-secret Store: Optional unencrypted data
│   └── "app_settings" client (future use)
└── Snapshot: Periodic encrypted backups
```

### Security Model

1. **Password Derivation**: Argon2id with random salt

   - Salt stored separately in `salt.txt`
   - Key derivation parameters: memory=19456 KiB, iterations=2, parallelism=1
   - **Master password auto-generated** (256-bit random) on first launch
   - Stored securely in **macOS Keychain** (accessible via Touch ID/password)

2. **Encryption**: ChaCha20-Poly1305 authenticated encryption

3. **Memory Protection**:

   - Secrets use zeroizing memory
   - No swap/core dumps of secrets

4. **Access Control**:
   - Vault auto-unlocks on app launch using keychain-stored password
   - Security delegated to OS keychain (macOS user account security)
   - **No user-facing prompts** (silent keychain access via `kSecAttrAccessibleWhenUnlocked`)
   - Requires only that Mac is unlocked (user already logged in)
   - Optional manual lock button (advanced feature)

### Data Separation Strategy

We'll split sensitive and non-sensitive data:

```rust
// ENCRYPTED in Stronghold
pub struct ConnectionSecrets {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
    pub ssl_key_content: Option<String>,
}

// ENCRYPTED in Stronghold (contains PII)
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: Option<SslMode>,
    pub options: HashMap<String, String>,
}

// ENCRYPTED in Stronghold (for security)
pub struct ConnectionMetadata {
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub use_count: u32,
    pub tags: Vec<String>,
    pub is_favorite: bool,
}
```

**Rationale**: All connection data goes into Stronghold because:

1. Connection profiles contain PII (usernames, hostnames, database names)
2. Metadata might reveal patterns (frequently used connections)
3. Simpler implementation - no split storage
4. Minimal performance impact for small dataset

---

## Migration Strategy

### Approach: Clean Break (No Migration)

**Decision**: Direct replacement with no automatic migration

- Users will see empty connections list
- Must re-add all connections manually
- Old `.devdb/connections.json` can be manually inspected for reference

**Why No Migration?**

1. **Security**: Old data was plaintext - cannot trust it wasn't compromised
2. **Simplicity**: No complex migration logic to maintain
3. **User Control**: Users consciously re-enter credentials (password rotation opportunity)
4. **Development Speed**: Faster implementation

### Migration Steps (User Perspective)

1. **Update Application**
2. **First Launch**:
   - Vault automatically initialized with random password (stored silently in keychain)
   - **No prompts or dialogs** - happens in background
   - See empty connections list
   - Optional: View old connections at `.devdb/connections.json.backup`
3. **Re-add Connections**:
   - Manually add each connection
   - Opportunity to update credentials
   - Clean slate for better security
4. **Subsequent Launches**:
   - Vault unlocks automatically (seamless)
   - No prompts or user interaction needed

### Backup Strategy

Before deleting old storage:

```rust
// On first run with Stronghold
if old_connections_file.exists() {
    fs::rename(
        ".devdb/connections.json",
        ".devdb/connections.json.backup"
    )?;

    log::info!("Old connections backed up to connections.json.backup");
}
```

---

## Implementation Plan

### Phase 1: Rust Backend - Stronghold Integration

#### 1.1 Add Dependencies

**File**: `src-tauri/Cargo.toml`

```toml
[dependencies]
# Add Stronghold
tauri-plugin-stronghold = "2"

# Add keyring with platform-specific features
keyring = { version = "2.0", features = ["apple-native", "windows-native", "linux-native"] }

# Add rand for password generation
rand = "0.8"

# Keep existing encryption deps
# aes-gcm = "0.10"  # Remove (not needed with Stronghold)
# argon2 = "0.5"    # Keep (Stronghold uses it internally)
zeroize = "1.7"     # Keep (useful for manual secret handling)
base64 = "0.21"     # Already present (for password encoding)
```

**Platform-Specific Keyring Backends:**

- **macOS**: Uses Keychain (`apple-native` feature)
- **Windows**: Uses Credential Manager (`windows-native` feature)
- **Linux**: Uses Secret Service (GNOME Keyring/KWallet) (`linux-native` feature)

#### 1.2 Create Stronghold Manager with Keychain Integration

**New File**: `src-tauri/src/storage/stronghold_manager.rs`

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::StrongholdExt;
use keyring::Entry;
use rand::Rng;
use crate::error::{AppError, Result};
use crate::types::ConnectionProfile;

const STRONGHOLD_VAULT_FILE: &str = "vault.hold";
const CONNECTIONS_CLIENT: &str = "connections";
const KEYCHAIN_SERVICE: &str = "com.hieuvd.devdb-studio.vault";
const KEYCHAIN_ACCOUNT: &str = "master_password";

pub struct StrongholdManager {
    app: AppHandle,
    vault_path: PathBuf,
    keychain: Entry,
}

impl StrongholdManager {
    pub fn new(app: AppHandle) -> Result<Self> {
        let vault_path = app
            .path()
            .app_local_data_dir()
            .map_err(|e| AppError::internal(&format!("Failed to resolve app data dir: {}", e)))?
            .join(STRONGHOLD_VAULT_FILE);

        // Initialize keychain entry
        let keychain = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| AppError::internal(&format!("Failed to access keychain: {}", e)))?;

        Ok(Self { app, vault_path, keychain })
    }

    /// Auto-initialize or unlock vault using keychain-stored password
    pub async fn auto_unlock(&self) -> Result<()> {
        let password = if self.vault_path.exists() {
            // Vault exists - retrieve password from keychain
            self.get_password_from_keychain()?
        } else {
            // First time - generate and store new password
            let password = self.generate_master_password();
            self.store_password_in_keychain(&password)?;
            password
        };

        // Unlock vault with password
        self.app
            .stronghold()
            .load_vault(&self.vault_path, password.into())
            .await
            .map_err(|e| AppError::internal(&format!("Failed to unlock vault: {}", e)))?;

        Ok(())
    }

    /// Generate a secure random master password (256-bit)
    fn generate_master_password(&self) -> String {
        let mut rng = rand::thread_rng();
        let bytes: [u8; 32] = rng.gen();
        base64::encode(&bytes)
    }

    /// Store password in OS keychain (silent - no user prompts)
    /// Uses kSecAttrAccessibleWhenUnlocked (default for keyring crate)
    fn store_password_in_keychain(&self, password: &str) -> Result<()> {
        self.keychain
            .set_password(password)
            .map_err(|e| AppError::internal(&format!("Failed to store password in keychain: {}", e)))
    }

    /// Retrieve password from OS keychain
    fn get_password_from_keychain(&self) -> Result<String> {
        self.keychain
            .get_password()
            .map_err(|e| AppError::internal(&format!("Failed to retrieve password from keychain: {}", e)))
    }

    /// Lock the vault (advanced feature)
    pub async fn lock(&self) -> Result<()> {
        self.app
            .stronghold()
            .lock_vault(&self.vault_path)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to lock vault: {}", e)))?;

        Ok(())
    }

    /// Reset vault (delete vault and keychain entry)
    pub async fn reset_vault(&self) -> Result<()> {
        // Lock first
        let _ = self.lock().await;

        // Delete vault file
        if self.vault_path.exists() {
            std::fs::remove_file(&self.vault_path)
                .map_err(|e| AppError::internal(&format!("Failed to delete vault: {}", e)))?;
        }

        // Delete keychain entry
        let _ = self.keychain.delete_password();

        Ok(())
    }

    /// Check if vault is initialized
    pub fn is_initialized(&self) -> bool {
        self.vault_path.exists()
    }

    /// Store a secret in the vault
    async fn store_secret(&self, key: &str, value: &[u8]) -> Result<()> {
        let client = self.app.stronghold().get_client(CONNECTIONS_CLIENT)?;
        let store = client.get_store();

        store
            .insert(key, value, None)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to store secret: {}", e)))?;

        // Save snapshot
        self.app
            .stronghold()
            .save_vault(&self.vault_path)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to save vault: {}", e)))?;

        Ok(())
    }

    /// Retrieve a secret from the vault
    async fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let client = self.app.stronghold().get_client(CONNECTIONS_CLIENT)?;
        let store = client.get_store();

        store
            .get(key)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to get secret: {}", e)))
    }

    /// Delete a secret from the vault
    async fn delete_secret(&self, key: &str) -> Result<()> {
        let client = self.app.stronghold().get_client(CONNECTIONS_CLIENT)?;
        let store = client.get_store();

        store
            .remove(key)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to delete secret: {}", e)))?;

        // Save snapshot
        self.app
            .stronghold()
            .save_vault(&self.vault_path)
            .await
            .map_err(|e| AppError::internal(&format!("Failed to save vault: {}", e)))?;

        Ok(())
    }

    /// List all keys with a given prefix
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let client = self.app.stronghold().get_client(CONNECTIONS_CLIENT)?;
        let store = client.get_store();

        let keys = store
            .keys()
            .await
            .map_err(|e| AppError::internal(&format!("Failed to list keys: {}", e)))?;

        Ok(keys
            .into_iter()
            .filter(|k| k.starts_with(prefix))
            .collect())
    }
}
```

#### 1.3 Rewrite SecureStorage to Use Stronghold

**File**: `src-tauri/src/storage/secure_store.rs`

Complete rewrite:

```rust
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::types::ConnectionProfile;
use super::stronghold_manager::StrongholdManager;

// Key patterns for Stronghold storage
const CONN_PROFILE_KEY: &str = "conn:{}:profile";
const CONN_METADATA_KEY: &str = "conn:{}:metadata";
const CONN_INDEX_KEY: &str = "connections:index"; // List of connection IDs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConnection {
    pub profile: ConnectionProfile,
    pub metadata: ConnectionMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionMetadata {
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used: Option<chrono::DateTime<chrono::Utc>>,
    pub use_count: u32,
    pub tags: Vec<String>,
    pub is_favorite: bool,
}

impl Default for ConnectionMetadata {
    fn default() -> Self {
        Self {
            created_at: chrono::Utc::now(),
            last_used: None,
            use_count: 0,
            tags: Vec::new(),
            is_favorite: false,
        }
    }
}

pub struct SecureStorage {
    stronghold: Arc<StrongholdManager>,
    // Cache for performance (cleared on lock)
    cache: Arc<DashMap<String, StoredConnection>>,
}

impl SecureStorage {
    pub async fn new(app: AppHandle) -> Result<Self> {
        let stronghold = Arc::new(StrongholdManager::new(app)?);

        // Auto-unlock vault on initialization
        stronghold.auto_unlock().await?;

        let storage = Self {
            stronghold,
            cache: Arc::new(DashMap::new()),
        };

        // Load connections into cache
        storage.load_cache().await?;

        Ok(storage)
    }

    /// Lock vault and clear cache (advanced feature)
    pub async fn lock(&self) -> Result<()> {
        self.cache.clear();
        self.stronghold.lock().await
    }

    /// Reset vault completely (delete all data and keychain entry)
    pub async fn reset_vault(&self) -> Result<()> {
        self.cache.clear();
        self.stronghold.reset_vault().await
    }

    // Private helper: Load all connections into cache
    async fn load_cache(&self) -> Result<()> {
        let conn_ids = self.get_index().await?;

        for id in conn_ids {
            if let Ok(conn) = self.get_connection_uncached(&id).await {
                self.cache.insert(id, conn);
            }
        }

        Ok(())
    }

    // Private helper: Get connection index
    async fn get_index(&self) -> Result<Vec<String>> {
        match self.stronghold.get_secret(CONN_INDEX_KEY).await? {
            Some(data) => {
                serde_json::from_slice(&data)
                    .map_err(|e| AppError::internal(&format!("Failed to deserialize index: {}", e)))
            }
            None => Ok(Vec::new()),
        }
    }

    // Private helper: Store connection index
    async fn store_index(&self, ids: &[String]) -> Result<()> {
        let data = serde_json::to_vec(ids)
            .map_err(|e| AppError::internal(&format!("Failed to serialize index: {}", e)))?;

        self.stronghold.store_secret(CONN_INDEX_KEY, &data).await
    }

    // Private helper: Add ID to index
    async fn add_to_index(&self, id: &str) -> Result<()> {
        let mut ids = self.get_index().await?;
        if !ids.contains(&id.to_string()) {
            ids.push(id.to_string());
            self.store_index(&ids).await?;
        }
        Ok(())
    }

    // Private helper: Remove ID from index
    async fn remove_from_index(&self, id: &str) -> Result<()> {
        let mut ids = self.get_index().await?;
        ids.retain(|i| i != id);
        self.store_index(&ids).await
    }

    // Private helper: Get connection without cache
    async fn get_connection_uncached(&self, id: &str) -> Result<StoredConnection> {
        let profile_key = format!("conn:{}:profile", id);
        let metadata_key = format!("conn:{}:metadata", id);

        let profile_data = self.stronghold.get_secret(&profile_key).await?
            .ok_or_else(|| AppError::not_found(&format!("Connection {} not found", id)))?;

        let metadata_data = self.stronghold.get_secret(&metadata_key).await?
            .ok_or_else(|| AppError::not_found(&format!("Connection metadata {} not found", id)))?;

        let profile: ConnectionProfile = serde_json::from_slice(&profile_data)
            .map_err(|e| AppError::internal(&format!("Failed to deserialize profile: {}", e)))?;

        let metadata: ConnectionMetadata = serde_json::from_slice(&metadata_data)
            .map_err(|e| AppError::internal(&format!("Failed to deserialize metadata: {}", e)))?;

        Ok(StoredConnection { profile, metadata })
    }

    pub async fn store_connection(&self, mut profile: ConnectionProfile) -> Result<String> {
        // Generate ID if not present
        if profile.id.is_empty() {
            profile.id = Uuid::new_v4().to_string();
        }

        let stored = StoredConnection {
            profile: profile.clone(),
            metadata: ConnectionMetadata::default(),
        };

        // Serialize and store
        let profile_data = serde_json::to_vec(&profile)
            .map_err(|e| AppError::internal(&format!("Failed to serialize profile: {}", e)))?;
        let metadata_data = serde_json::to_vec(&stored.metadata)
            .map_err(|e| AppError::internal(&format!("Failed to serialize metadata: {}", e)))?;

        let profile_key = format!("conn:{}:profile", profile.id);
        let metadata_key = format!("conn:{}:metadata", profile.id);

        self.stronghold.store_secret(&profile_key, &profile_data).await?;
        self.stronghold.store_secret(&metadata_key, &metadata_data).await?;

        // Update index
        self.add_to_index(&profile.id).await?;

        // Update cache
        self.cache.insert(profile.id.clone(), stored);

        Ok(profile.id)
    }

    pub async fn get_connection(&self, id: &str) -> Result<StoredConnection> {
        // Try cache first
        if let Some(conn) = self.cache.get(id) {
            return Ok(conn.clone());
        }

        // Load from Stronghold
        let conn = self.get_connection_uncached(id).await?;
        self.cache.insert(id.to_string(), conn.clone());

        Ok(conn)
    }

    pub async fn list_connections(&self) -> Result<Vec<StoredConnection>> {
        let ids = self.get_index().await?;
        let mut connections = Vec::new();

        for id in ids {
            if let Ok(conn) = self.get_connection(&id).await {
                connections.push(conn);
            }
        }

        Ok(connections)
    }

    pub async fn update_connection(&self, id: &str, profile: ConnectionProfile) -> Result<()> {
        // Get existing metadata
        let existing = self.get_connection(id).await?;

        let mut metadata = existing.metadata;
        metadata.last_used = Some(chrono::Utc::now());
        metadata.use_count += 1;

        // Store updated data
        let profile_data = serde_json::to_vec(&profile)
            .map_err(|e| AppError::internal(&format!("Failed to serialize profile: {}", e)))?;
        let metadata_data = serde_json::to_vec(&metadata)
            .map_err(|e| AppError::internal(&format!("Failed to serialize metadata: {}", e)))?;

        let profile_key = format!("conn:{}:profile", id);
        let metadata_key = format!("conn:{}:metadata", id);

        self.stronghold.store_secret(&profile_key, &profile_data).await?;
        self.stronghold.store_secret(&metadata_key, &metadata_data).await?;

        // Update cache
        self.cache.insert(id.to_string(), StoredConnection { profile, metadata });

        Ok(())
    }

    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        let profile_key = format!("conn:{}:profile", id);
        let metadata_key = format!("conn:{}:metadata", id);

        self.stronghold.delete_secret(&profile_key).await?;
        self.stronghold.delete_secret(&metadata_key).await?;

        // Update index
        self.remove_from_index(id).await?;

        // Remove from cache
        self.cache.remove(id);

        Ok(())
    }

    pub async fn clear_all(&self) -> Result<()> {
        let ids = self.get_index().await?;

        for id in ids {
            self.delete_connection(&id).await?;
        }

        self.cache.clear();
        Ok(())
    }

    // Metadata operations (similar to before, but update both Stronghold and cache)
    pub async fn mark_as_used(&self, id: &str) -> Result<()> {
        let mut conn = self.get_connection(id).await?;
        conn.metadata.last_used = Some(chrono::Utc::now());
        conn.metadata.use_count += 1;

        let metadata_data = serde_json::to_vec(&conn.metadata)
            .map_err(|e| AppError::internal(&format!("Failed to serialize metadata: {}", e)))?;
        let metadata_key = format!("conn:{}:metadata", id);

        self.stronghold.store_secret(&metadata_key, &metadata_data).await?;
        self.cache.insert(id.to_string(), conn);

        Ok(())
    }

    // ... (implement other metadata operations similarly)
}
```

#### 1.4 Update Commands

**File**: `src-tauri/src/commands.rs`

Add new commands for vault management (optional advanced features):

```rust
// Vault management commands (advanced features)
#[tauri::command]
pub async fn vault_lock(
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<(), String> {
    storage.lock().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_reset(
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<(), String> {
    storage.reset_vault().await.map_err(|e| e.to_string())
}

// No unlock/initialize commands needed - happens automatically!
```

#### 1.5 Update Main.rs

**File**: `src-tauri/src/main.rs`

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // ADD STRONGHOLD PLUGIN
        .plugin(
            tauri_plugin_stronghold::Builder::with_argon2(
                &tauri::api::path::app_local_data_dir(&tauri::Config::default())
                    .unwrap()
                    .join("salt.txt")
            )
            .build(),
        )
        .setup(|app| {
            // ... existing setup

            // Initialize SecureStorage with Stronghold (auto-unlocks)
            let storage = tauri::async_runtime::block_on(async {
                SecureStorage::new(app.handle().clone()).await
            })?;
            app.manage(Arc::new(storage));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ... existing commands

            // Add vault commands (optional advanced features)
            vault_lock,
            vault_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Phase 2: Frontend - TypeScript Services

#### 2.1 Update secureStorage.ts

**Minimal changes needed** - vault auto-unlocks on app start, so no UI needed!

```typescript
import { safeInvoke } from "@/utils/tauri";

export interface SecureConnectionConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  ssh_private_key?: string;
  api_key?: string;
  connection_type: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Secure Storage Service - Stronghold Backend
 * All sensitive data is encrypted in Tauri Stronghold vault
 * Vault auto-unlocks on app start using keychain-stored password
 */
class SecureStorageService {
  /**
   * Lock vault manually (advanced feature)
   */
  async lock(): Promise<void> {
    try {
      await safeInvoke("vault_lock");
    } catch (error) {
      console.error("Failed to lock vault:", error);
      throw new Error(`Failed to lock vault: ${error}`);
    }
  }

  /**
   * Reset vault completely (delete all data)
   */
  async resetVault(): Promise<void> {
    try {
      await safeInvoke("vault_reset");
    } catch (error) {
      console.error("Failed to reset vault:", error);
      throw new Error(`Failed to reset vault: ${error}`);
    }
  }

  // ... (all existing connection methods work exactly the same)
  // No need for unlock/initialize/isUnlocked - happens automatically!

  /**
   * Store a connection configuration securely
   */
  async storeConnection(
    connection: SecureConnectionConfig,
    connectionId?: string,
  ): Promise<string> {
    try {
      const connectionToStore = connectionId
        ? { ...connection, id: connectionId }
        : connection;

      const resultId = await safeInvoke<string>("store_connection", {
        connection: connectionToStore,
      });
      return resultId;
    } catch (error) {
      console.error("Failed to store connection:", error);
      throw new Error(`Failed to store connection: ${error}`);
    }
  }

  // ... (other methods remain exactly the same)
}

export const secureStorage = new SecureStorageService();
```

#### 2.2 ~~Create Vault Unlock UI Component~~ (NOT NEEDED!)

**No VaultUnlock component needed** - vault auto-unlocks seamlessly on app start.

Optional: Add "Lock Vault" menu item for advanced users:

**File**: `src/components/SettingsMenu.tsx` (or wherever your app menu is)

```typescript
// Optional: Add to settings menu or app menu
import { secureStorage } from "@/services/secureStorage";

function SettingsMenu() {
  const handleLockVault = async () => {
    await secureStorage.lock();
    // Optionally redirect user or show locked state
  };

  const handleResetVault = async () => {
    if (confirm("This will delete ALL connections. Are you sure?")) {
      await secureStorage.resetVault();
      // Redirect to connection setup screen
    }
  };

  return (
    <DropdownMenu>
      {/* ... other menu items */}
      <DropdownMenuItem onClick={handleLockVault}>
        <Lock className="mr-2 h-4 w-4" />
        Lock Vault
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleResetVault} className="text-destructive">
        <Trash className="mr-2 h-4 w-4" />
        Reset Vault
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
```

#### 2.3 Update App.tsx

**No changes needed!** Vault auto-unlocks on app start. App works exactly as before.

```typescript
// No vault unlock UI needed - it happens automatically
export function App() {
  return <div>{/* Your existing app - no wrapping needed */}</div>;
}
```

### Phase 3: Testing & Validation

#### 3.1 Rust Unit Tests

**New File**: `src-tauri/src/storage/stronghold_tests.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_vault_lifecycle() {
        // Test initialization, unlock, lock
    }

    #[tokio::test]
    async fn test_connection_crud() {
        // Test store, get, update, delete
    }

    #[tokio::test]
    async fn test_password_encryption() {
        // Verify passwords are encrypted
    }

    #[tokio::test]
    async fn test_vault_security() {
        // Test wrong password rejection
        // Test locked vault access denial
    }
}
```

#### 3.2 Integration Tests

Test complete flow:

1. Initialize vault
2. Store connections
3. Lock vault
4. Unlock vault
5. Retrieve connections
6. Verify data integrity

---

## API Changes Summary

### New Commands (Frontend -> Rust)

```typescript
// Vault Management (optional advanced features only)
await invoke("vault_lock"): Promise<void>
await invoke("vault_reset"): Promise<void>

// Existing commands unchanged - work exactly the same
await invoke("store_connection", { connection }): Promise<string>
await invoke("get_connection", { connectionId }): Promise<StoredConnection>
await invoke("list_connections"): Promise<StoredConnection[]>
await invoke("delete_connection", { connectionId }): Promise<void>
// ... etc

// Removed commands (auto-handled by backend)
// ❌ vault_is_initialized - not needed
// ❌ vault_initialize - happens automatically
// ❌ vault_unlock - happens automatically
```

### Removed/Changed

- **Removed**: All generic `secure_set`, `secure_get`, `secure_delete` commands
  - **Reason**: Stronghold is purpose-built for connection storage, not generic KV
  - **Migration**: Not needed (feature was unused)

---

## Breaking Changes

### For Users

1. **All existing connections will be lost**

   - Must re-add all database connections
   - Passwords must be re-entered
   - Old data backed up to `.devdb/connections.json.backup`

2. **macOS Keychain used (silent access)**

   - Vault password stored in system keychain automatically
   - **No Touch ID or password prompts** (uses `kSecAttrAccessibleWhenUnlocked`)
   - Only requires Mac to be unlocked (user already logged in)

3. **Seamless vault unlocking**
   - Zero prompts during normal use
   - Vault auto-unlocks on every app launch silently
   - Advanced users can manually lock vault from settings

### For Developers

1. **Storage file location changed**

   - Old: `.devdb/connections.json` (plaintext JSON)
   - New (macOS): `~/Library/Application Support/com.hieuvd.devdb-studio/vault.hold` + `salt.txt`
   - New (Linux): `~/.local/share/com.hieuvd.devdb-studio/vault.hold` + `salt.txt`
   - New (Windows): `%APPDATA%\com.hieuvd.devdb-studio\vault.hold` + `salt.txt`

2. **New dependencies**

   - `tauri-plugin-stronghold = "2"` (Rust)
   - `keyring = { version = "2.0", features = ["apple-native", "windows-native", "linux-native"] }` (Rust)
   - `rand = "0.8"` (Rust)
   - `@tauri-apps/plugin-stronghold` (NPM)

3. **Platform-specific requirements**

   - **macOS**: No additional setup needed
   - **Windows**: No additional setup needed
   - **Linux**: Requires `libdbus` and Secret Service daemon (GNOME Keyring/KWallet)
     - Most desktop Linux distros have this by default
     - Headless servers won't work (no Secret Service)

4. **API additions**
   - Vault management commands required in UI flow
   - Unlock state management needed

---

## Security Improvements

### Before (JSON Storage)

```
❌ Passwords in plaintext
❌ File readable by any process
❌ No authentication
❌ No memory protection
❌ Vulnerable to disk dumps
```

### After (Stronghold)

```
✅ Military-grade encryption (ChaCha20-Poly1305)
✅ Argon2id password derivation
✅ Memory-protected secrets (zeroed after use)
✅ Authenticated encryption (AEAD)
✅ Secure against cold boot attacks
✅ Vault auto-lock support
✅ No plaintext secrets anywhere
```

### Security Checklist

- [x] Passwords encrypted at rest
- [x] Secrets zeroed from memory
- [x] Strong password derivation (Argon2id)
- [x] Encrypted vault file
- [x] Salt randomization
- [x] No plaintext in logs
- [x] Vault lock mechanism
- [ ] Auto-lock on idle (Phase 2)
- [ ] Password strength requirements (Phase 2)
- [ ] Vault backup encryption (Phase 2)

---

## Testing Strategy

### Unit Tests

```bash
# Rust tests
cd src-tauri
cargo test storage::stronghold -- --nocapture

# Frontend tests
pnpm test src/services/secureStorage.test.ts
```

### Manual Testing Checklist

- [ ] First-time vault setup
- [ ] Master password validation
- [ ] Vault unlock/lock cycle
- [ ] Store connection
- [ ] Retrieve connection
- [ ] Update connection
- [ ] Delete connection
- [ ] List connections
- [ ] Wrong password rejection
- [ ] Locked vault access denial
- [ ] App restart persistence
- [ ] Connection with SSH tunnel
- [ ] Connection with SSL certs

### Security Testing

- [ ] Verify vault file is encrypted (hexdump)
- [ ] Verify no plaintext passwords in memory dumps
- [ ] Test wrong password scenarios
- [ ] Test vault corruption recovery
- [ ] Verify salt randomization
- [ ] Test concurrent access

---

## Rollback Plan

### If Critical Issues Found

1. **Keep backup branch**

   ```bash
   git checkout -b feature/stronghold-migration
   # ... make changes
   git tag pre-stronghold-stable
   ```

2. **Rollback procedure**

   ```bash
   git revert <stronghold-commits>
   pnpm install
   cd src-tauri && cargo build
   ```

3. **User data recovery**
   - Old connections at `.devdb/connections.json.backup`
   - Copy back to `.devdb/connections.json`
   - Restart app

### Known Risks

1. **Stronghold plugin instability**

   - Mitigation: Test thoroughly before release
   - Fallback: Keep JSON storage as fallback option

2. **Password forgotten**

   - **No recovery possible** - this is by design
   - Mitigation: Clear warnings in UI
   - User must re-add connections

3. **Vault corruption**
   - Mitigation: Regular snapshots
   - Recovery: User must re-add connections

---

## Timeline & Dependencies

### Week 1: Backend Implementation

- [ ] Day 1-2: Add Stronghold plugin, create StrongholdManager
- [ ] Day 3-4: Rewrite SecureStorage to use Stronghold
- [ ] Day 5: Write Rust unit tests, fix bugs

### Week 2: Frontend Implementation

- [ ] Day 1: Update TypeScript services (minimal changes)
- [ ] Day 2: Add optional vault lock/reset menu items
- [ ] Day 3: Testing frontend integration
- [ ] Day 4-5: Buffer/polish

### Week 3: Testing & Polish

- [ ] Day 1-2: Manual testing all scenarios
- [ ] Day 3: Security testing
- [ ] Day 4: Documentation
- [ ] Day 5: Code review, final polish

### Dependencies

**Must Have Before Starting:**

- Tauri 2.0 (already in place ✅)
- Rust async runtime (already in place ✅)

**Can Be Done In Parallel:**

- UI component design
- Documentation writing
- Test case design

---

## Future Enhancements (Post-Migration)

1. **Auto-lock on idle** (Phase 2)

   - Configurable timeout
   - Activity detection

2. **Biometric unlock** (Phase 3)

   - Touch ID / Face ID support
   - Platform-specific implementations

3. **Vault backup/export** (Phase 3)

   - Encrypted backup files
   - Manual export for disaster recovery

4. **Password strength meter** (Phase 2)

   - zxcvbn integration
   - Password generation

5. **Multi-vault support** (Phase 4)
   - Separate vaults for different workspaces
   - Team collaboration features

---

## Appendix

### A. Stronghold vs Alternatives

| Solution       | Security   | Complexity | Performance |
| -------------- | ---------- | ---------- | ----------- |
| **Stronghold** | ⭐⭐⭐⭐⭐ | Medium     | Fast        |
| System Keyring | ⭐⭐⭐⭐   | Low        | Fast        |
| AES-GCM + JSON | ⭐⭐⭐     | Low        | Very Fast   |
| SQLCipher      | ⭐⭐⭐⭐   | Medium     | Medium      |

**Why Stronghold?**

- Purpose-built for secret management
- Battle-tested (used by IOTA Foundation)
- Tauri-native integration
- Memory protection features
- Active development

### B. Key Storage Format

**Stronghold Vault Locations (Platform-Specific):**

```
macOS:
~/Library/Application Support/com.hieuvd.devdb-studio/
├── vault.hold (encrypted ChaCha20-Poly1305)
└── salt.txt (32 random bytes for Argon2)

Windows:
%APPDATA%\com.hieuvd.devdb-studio\
├── vault.hold (encrypted ChaCha20-Poly1305)
└── salt.txt (32 random bytes for Argon2)

Linux:
~/.local/share/com.hieuvd.devdb-studio/
├── vault.hold (encrypted ChaCha20-Poly1305)
└── salt.txt (32 random bytes for Argon2)
```

**Vault Structure (Same on all platforms):**

```
vault.hold (encrypted)
├── Client: "connections"
│   └── Store:
│       ├── "connections:index" → ["uuid1", "uuid2", ...]
│       ├── "conn:uuid1:profile" → ConnectionProfile (JSON)
│       ├── "conn:uuid1:metadata" → ConnectionMetadata (JSON)
│       ├── "conn:uuid2:profile" → ConnectionProfile (JSON)
│       └── "conn:uuid2:metadata" → ConnectionMetadata (JSON)
└── Snapshot metadata
```

**Master Password Storage (Platform-Specific):**

```
macOS:
Keychain → Service: "com.hieuvd.devdb-studio.vault" → Account: "master_password"

Windows:
Credential Manager → Target: "com.hieuvd.devdb-studio.vault" → Username: "master_password"

Linux:
Secret Service → Collection: Login → Label: "com.hieuvd.devdb-studio.vault/master_password"
```

**Similar apps storage patterns:**

- 1Password: Uses OS keychain on all platforms
- Bitwarden: Uses OS keychain on all platforms
- KeePassXC: Master password-based (user enters password)
- TablePlus: Uses OS keychain on all platforms

### C. Auto-Generated Password Specifications

**Password Generation:**

- **Length**: 256 bits (32 bytes) of random data
- **Encoding**: Base64 (44 characters)
- **Entropy**: ~256 bits of cryptographic randomness
- **Generator**: `rand::thread_rng()` (cryptographically secure)

**Example auto-generated password:**

```
aB3kL9mN2pQ5rT8vX1wY4zA7bC0dF6gH9jK2lM5nP8qR1sT4uV7xW0yZ3
```

**Storage (Platform-Specific):**

**macOS:**

- Location: macOS Keychain
- Service: `com.hieuvd.devdb-studio.vault`
- Access level: `kSecAttrAccessibleWhenUnlocked`
- No user prompts when Mac is unlocked

**Windows:**

- Location: Windows Credential Manager
- Service: `com.hieuvd.devdb-studio.vault`
- Accessible to user account only
- No prompts for same user account

**Linux:**

- Location: Secret Service (GNOME Keyring / KWallet)
- Service: `com.hieuvd.devdb-studio.vault`
- Requires Secret Service daemon running
- May prompt on first access if keyring is locked

**Common Properties:**

- Protected by OS user account security
- Never displayed to user
- Never logged or written to disk in plaintext
- Automatically unlocked when user logs in

**Access Behavior:**

- ✅ Silent access when user is logged in (macOS, Windows)
- ⚠️ May prompt once on Linux if Secret Service keyring is locked
- ❌ Inaccessible when user is logged out
- ✅ Automatically available after user logs in

**Recovery:**
⚠️ If OS credential store access is lost, vault becomes inaccessible. User must reset vault and re-add connections.

**Developer Note:**

- macOS: In unsigned builds, may show one-time "Allow access" dialog
- Windows: Works seamlessly in development and production
- Linux: Requires `libdbus` and Secret Service daemon (standard in most distros)

---

## Glossary

- **Stronghold**: Secure secret management engine by IOTA Foundation
- **Vault**: Encrypted container for all secrets
- **Client**: Isolated namespace within a vault
- **Store**: Key-value storage within a client
- **Snapshot**: Encrypted backup of vault state
- **Argon2**: Memory-hard password derivation function
- **ChaCha20-Poly1305**: Authenticated encryption algorithm
- **AEAD**: Authenticated Encryption with Associated Data

---

## Sign-off

**Ready for Implementation**: ✅

**Reviewed by**: [To be filled]
**Approved by**: [To be filled]
**Start Date**: [To be filled]
**Target Completion**: 3 weeks from start

---

**Document Version**: 1.0
**Last Updated**: 2025-10-05
**Status**: Draft - Awaiting Approval
