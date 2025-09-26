use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::types::ConnectionProfile;

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
    connections: Arc<DashMap<String, StoredConnection>>,
    encryption_key: Option<Vec<u8>>,
    storage_path: PathBuf,
    use_encryption: bool,
}

impl SecureStorage {
    pub fn new() -> Self {
        let storage_path = Self::get_storage_path();
        let connections = Self::load_from_file(&storage_path).unwrap_or_default();

        Self {
            connections: Arc::new(connections),
            encryption_key: None,
            storage_path,
            use_encryption: false,
        }
    }

    pub fn with_encryption(key: Vec<u8>) -> Self {
        let storage_path = Self::get_storage_path();
        let connections = Self::load_from_file(&storage_path).unwrap_or_default();

        Self {
            connections: Arc::new(connections),
            encryption_key: Some(key),
            storage_path,
            use_encryption: true,
        }
    }

    fn get_storage_path() -> PathBuf {
        // Use local .devdb directory in the repository for development
        let app_dir = PathBuf::from(".devdb");

        // Ensure directory exists
        let _ = fs::create_dir_all(&app_dir);

        app_dir.join("connections.json")
    }

    fn load_from_file(path: &PathBuf) -> Result<DashMap<String, StoredConnection>> {
        if !path.exists() {
            return Ok(DashMap::new());
        }

        let content = fs::read_to_string(path)
            .map_err(|e| AppError::internal(&format!("Failed to read connections file: {}", e)))?;

        let connections: HashMap<String, StoredConnection> = serde_json::from_str(&content)
            .map_err(|e| AppError::internal(&format!("Failed to parse connections: {}", e)))?;

        let dash_map = DashMap::new();
        for (id, conn) in connections {
            dash_map.insert(id, conn);
        }

        Ok(dash_map)
    }

    fn save_to_file(&self) -> Result<()> {
        println!("DEBUG: save_to_file started, collecting connections...");
        let connections: HashMap<String, StoredConnection> = self
            .connections
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect();

        println!(
            "DEBUG: Collected {} connections, serializing...",
            connections.len()
        );
        let content = serde_json::to_string_pretty(&connections)
            .map_err(|e| AppError::internal(&format!("Failed to serialize connections: {}", e)))?;

        println!("DEBUG: Serialized successfully, writing to temp file...");
        // Atomic write: write to temp file then rename
        let temp_path = self.storage_path.with_extension("json.tmp");
        fs::write(&temp_path, content)
            .map_err(|e| AppError::internal(&format!("Failed to write temp file: {}", e)))?;

        println!("DEBUG: Temp file written, renaming to final location...");
        fs::rename(&temp_path, &self.storage_path)
            .map_err(|e| AppError::internal(&format!("Failed to save connections: {}", e)))?;

        println!("DEBUG: File saved successfully to {:?}", self.storage_path);
        Ok(())
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

        // Store in memory and persist to file
        self.connections.insert(profile.id.clone(), stored);
        self.save_to_file()?;

        Ok(profile.id)
    }

    pub async fn get_connection(&self, id: &str) -> Result<StoredConnection> {
        self.connections
            .get(id)
            .map(|entry| entry.clone())
            .ok_or_else(|| AppError::not_found(&format!("Connection {} not found", id)))
    }

    pub async fn list_connections(&self) -> Result<Vec<StoredConnection>> {
        Ok(self
            .connections
            .iter()
            .map(|entry| entry.value().clone())
            .collect())
    }

    pub async fn update_connection(&self, id: &str, profile: ConnectionProfile) -> Result<()> {
        // Update the connection and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            entry.profile = profile;
            entry.metadata.last_used = Some(chrono::Utc::now());
            entry.metadata.use_count += 1;
            true
        } else {
            false
        };

        if found {
            self.save_to_file()?;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        self.connections
            .remove(id)
            .ok_or_else(|| AppError::not_found(&format!("Connection {} not found", id)))?;

        self.save_to_file()?;
        Ok(())
    }

    pub async fn clear_all(&self) -> Result<()> {
        self.connections.clear();
        self.save_to_file()?;
        Ok(())
    }

    pub async fn update_metadata(&self, id: &str, metadata: ConnectionMetadata) -> Result<()> {
        // Update the metadata and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata = metadata;
            true
        } else {
            false
        };

        if found {
            self.save_to_file()?;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn mark_as_used(&self, id: &str) -> Result<()> {
        // Update the usage data and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.last_used = Some(chrono::Utc::now());
            entry.metadata.use_count += 1;
            true
        } else {
            false
        };

        if found {
            self.save_to_file()?;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn toggle_favorite(&self, id: &str) -> Result<bool> {
        // Toggle favorite and drop the mutable reference before saving
        let result = if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.is_favorite = !entry.metadata.is_favorite;
            Some(entry.metadata.is_favorite)
        } else {
            None
        };

        if let Some(is_favorite) = result {
            self.save_to_file()?;
            Ok(is_favorite)
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn add_tag(&self, id: &str, tag: String) -> Result<()> {
        // Add tag and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            if !entry.metadata.tags.contains(&tag) {
                entry.metadata.tags.push(tag);
            }
            true
        } else {
            false
        };

        if found {
            self.save_to_file()?;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn remove_tag(&self, id: &str, tag: &str) -> Result<()> {
        // Remove tag and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.tags.retain(|t| t != tag);
            true
        } else {
            false
        };

        if found {
            self.save_to_file()?;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn update_tags(&self, id: &str, tags: Vec<String>) -> Result<()> {
        println!("DEBUG: update_tags called for connection {}", id);

        // Update the tags and drop the mutable reference before saving
        let found = if let Some(mut entry) = self.connections.get_mut(id) {
            println!("DEBUG: Found connection, updating tags to {:?}", tags);
            entry.metadata.tags = tags;
            entry.metadata.last_used = Some(chrono::Utc::now());
            true
        } else {
            false
        };

        if found {
            println!("DEBUG: About to save to file...");
            self.save_to_file()?;
            println!("DEBUG: File saved successfully");
            Ok(())
        } else {
            println!("DEBUG: Connection {} not found", id);
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }

    pub async fn search(&self, query: &str) -> Result<Vec<StoredConnection>> {
        let query_lower = query.to_lowercase();

        Ok(self
            .connections
            .iter()
            .filter(|entry| {
                let conn = entry.value();
                conn.profile.name.to_lowercase().contains(&query_lower)
                    || conn.profile.host.to_lowercase().contains(&query_lower)
                    || conn.profile.database.to_lowercase().contains(&query_lower)
                    || conn
                        .metadata
                        .tags
                        .iter()
                        .any(|t| t.to_lowercase().contains(&query_lower))
            })
            .map(|entry| entry.value().clone())
            .collect())
    }

    // Phase 4: These will be implemented with actual encryption
    fn encrypt_password(&self, password: &str) -> Result<Vec<u8>> {
        // Placeholder for Phase 4
        Ok(password.as_bytes().to_vec())
    }

    fn decrypt_password(&self, encrypted: &[u8]) -> Result<String> {
        // Placeholder for Phase 4
        String::from_utf8(encrypted.to_vec())
            .map_err(|e| AppError::internal(&format!("Failed to decrypt: {}", e)))
    }
}
