use std::collections::HashMap;
use std::sync::Arc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use tokio::sync::RwLock;

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
}

impl SecureStorage {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            encryption_key: None,
        }
    }
    
    pub fn with_encryption(key: Vec<u8>) -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            encryption_key: Some(key),
        }
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
        
        // In Phase 4, we'll encrypt the password here
        // For now, just store in memory
        self.connections.insert(profile.id.clone(), stored);
        
        Ok(profile.id)
    }
    
    pub async fn get_connection(&self, id: &str) -> Result<StoredConnection> {
        self.connections
            .get(id)
            .map(|entry| entry.clone())
            .ok_or_else(|| AppError::not_found(&format!("Connection {} not found", id)))
    }
    
    pub async fn list_connections(&self) -> Result<Vec<StoredConnection>> {
        Ok(self.connections
            .iter()
            .map(|entry| entry.value().clone())
            .collect())
    }
    
    pub async fn update_connection(&self, id: &str, profile: ConnectionProfile) -> Result<()> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            entry.profile = profile;
            entry.metadata.last_used = Some(chrono::Utc::now());
            entry.metadata.use_count += 1;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| AppError::not_found(&format!("Connection {} not found", id)))
    }
    
    pub async fn clear_all(&self) -> Result<()> {
        self.connections.clear();
        Ok(())
    }
    
    pub async fn update_metadata(&self, id: &str, metadata: ConnectionMetadata) -> Result<()> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata = metadata;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn mark_as_used(&self, id: &str) -> Result<()> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.last_used = Some(chrono::Utc::now());
            entry.metadata.use_count += 1;
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn toggle_favorite(&self, id: &str) -> Result<bool> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.is_favorite = !entry.metadata.is_favorite;
            Ok(entry.metadata.is_favorite)
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn add_tag(&self, id: &str, tag: String) -> Result<()> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            if !entry.metadata.tags.contains(&tag) {
                entry.metadata.tags.push(tag);
            }
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn remove_tag(&self, id: &str, tag: &str) -> Result<()> {
        if let Some(mut entry) = self.connections.get_mut(id) {
            entry.metadata.tags.retain(|t| t != tag);
            Ok(())
        } else {
            Err(AppError::not_found(&format!("Connection {} not found", id)))
        }
    }
    
    pub async fn search(&self, query: &str) -> Result<Vec<StoredConnection>> {
        let query_lower = query.to_lowercase();
        
        Ok(self.connections
            .iter()
            .filter(|entry| {
                let conn = entry.value();
                conn.profile.name.to_lowercase().contains(&query_lower) ||
                conn.profile.host.to_lowercase().contains(&query_lower) ||
                conn.profile.database.to_lowercase().contains(&query_lower) ||
                conn.metadata.tags.iter().any(|t| t.to_lowercase().contains(&query_lower))
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