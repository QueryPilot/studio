use std::collections::HashMap;
use std::error::Error;
use uuid::Uuid;
use chrono::{DateTime, Utc, Duration};
use serde::{Deserialize, Serialize};
use crate::crypto::secure_string::{SecureBytes, SecureString};
use crate::crypto::key_derive::{derive_key_hkdf, derive_key_argon2};
use crate::crypto::nonce::generate_salt;

/// Key hierarchy for managing encryption keys
#[derive(Debug)]
pub struct KeyHierarchy {
    pub master_key: SecureBytes,
    pub app_key: SecureBytes,
    pub database_keys: HashMap<Uuid, SecureBytes>,
    pub field_keys: HashMap<String, SecureBytes>,
}

/// Key metadata for rotation tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMetadata {
    pub key_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub rotated_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub version: u32,
    pub key_type: KeyType,
}

/// Types of keys in the system
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum KeyType {
    Master,
    Application,
    Database,
    Field,
    Session,
}

/// Key rotation policies
#[derive(Debug, Clone, Copy)]
pub struct RotationPolicy {
    pub master_key_days: i64,
    pub database_key_days: i64,
    pub session_key_days: i64,
    pub field_key_days: i64,
}

impl Default for RotationPolicy {
    fn default() -> Self {
        RotationPolicy {
            master_key_days: 365,
            database_key_days: 90,
            session_key_days: 30,
            field_key_days: 90,
        }
    }
}

/// Key manager for handling key lifecycle
pub struct KeyManager {
    hierarchy: KeyHierarchy,
    metadata: HashMap<Uuid, KeyMetadata>,
    rotation_policy: RotationPolicy,
}

impl KeyManager {
    /// Create a new key manager with a master key
    pub fn new(master_key: SecureBytes) -> Result<Self, Box<dyn Error>> {
        let app_key = derive_key_hkdf(&master_key, b"app_key", 32)?;
        
        let hierarchy = KeyHierarchy {
            master_key,
            app_key,
            database_keys: HashMap::new(),
            field_keys: HashMap::new(),
        };
        
        Ok(KeyManager {
            hierarchy,
            metadata: HashMap::new(),
            rotation_policy: RotationPolicy::default(),
        })
    }

    /// Initialize from a password
    pub fn from_password(password: &SecureString) -> Result<Self, Box<dyn Error>> {
        let salt = generate_salt();
        let master_key = derive_key_argon2(password, &salt)?;
        Self::new(master_key)
    }

    /// Get or create a database key
    pub fn get_database_key(&mut self, database_id: Uuid) -> Result<&SecureBytes, Box<dyn Error>> {
        if !self.hierarchy.database_keys.contains_key(&database_id) {
            let db_key = derive_key_hkdf(
                &self.hierarchy.app_key,
                format!("database:{}", database_id).as_bytes(),
                32,
            )?;
            
            let metadata = KeyMetadata {
                key_id: database_id,
                created_at: Utc::now(),
                rotated_at: None,
                expires_at: Utc::now() + Duration::days(self.rotation_policy.database_key_days),
                version: 1,
                key_type: KeyType::Database,
            };
            
            self.hierarchy.database_keys.insert(database_id, db_key);
            self.metadata.insert(database_id, metadata);
        }
        
        Ok(self.hierarchy.database_keys.get(&database_id).unwrap())
    }

    /// Get or create a field encryption key
    pub fn get_field_key(&mut self, field_name: &str) -> Result<&SecureBytes, Box<dyn Error>> {
        if !self.hierarchy.field_keys.contains_key(field_name) {
            let field_key = derive_key_hkdf(
                &self.hierarchy.app_key,
                format!("field:{}", field_name).as_bytes(),
                32,
            )?;
            
            self.hierarchy.field_keys.insert(field_name.to_string(), field_key);
        }
        
        Ok(self.hierarchy.field_keys.get(field_name).unwrap())
    }

    /// Check if a key needs rotation
    pub fn needs_rotation(&self, key_id: &Uuid) -> bool {
        if let Some(metadata) = self.metadata.get(key_id) {
            metadata.expires_at <= Utc::now()
        } else {
            false
        }
    }

    /// Rotate a database key
    pub fn rotate_database_key(&mut self, database_id: Uuid) -> Result<SecureBytes, Box<dyn Error>> {
        let old_metadata = self.metadata.get(&database_id).cloned();
        let version = old_metadata.as_ref().map(|m| m.version + 1).unwrap_or(1);
        
        // Generate new key with version suffix
        let new_key = derive_key_hkdf(
            &self.hierarchy.app_key,
            format!("database:{}:v{}", database_id, version).as_bytes(),
            32,
        )?;
        
        let metadata = KeyMetadata {
            key_id: database_id,
            created_at: old_metadata.as_ref().map(|m| m.created_at).unwrap_or_else(Utc::now),
            rotated_at: Some(Utc::now()),
            expires_at: Utc::now() + Duration::days(self.rotation_policy.database_key_days),
            version,
            key_type: KeyType::Database,
        };
        
        self.hierarchy.database_keys.insert(database_id, new_key.clone());
        self.metadata.insert(database_id, metadata);
        
        Ok(new_key)
    }

    /// Get all keys that need rotation
    pub fn get_keys_needing_rotation(&self) -> Vec<Uuid> {
        self.metadata
            .iter()
            .filter(|(_, meta)| meta.expires_at <= Utc::now())
            .map(|(id, _)| *id)
            .collect()
    }

    /// Export key metadata (without actual keys)
    pub fn export_metadata(&self) -> HashMap<Uuid, KeyMetadata> {
        self.metadata.clone()
    }

    /// Set custom rotation policy
    pub fn set_rotation_policy(&mut self, policy: RotationPolicy) {
        self.rotation_policy = policy;
    }
}

/// Key versioning for supporting multiple key versions during rotation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionedKey {
    pub version: u32,
    pub key_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub deprecated_at: Option<DateTime<Utc>>,
    pub is_active: bool,
}

/// Key rotation tracker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRotationLog {
    pub rotation_id: Uuid,
    pub key_id: Uuid,
    pub old_version: u32,
    pub new_version: u32,
    pub rotated_at: DateTime<Utc>,
    pub reason: RotationReason,
}

/// Reasons for key rotation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RotationReason {
    Scheduled,
    Emergency,
    UserRequested,
    Compromise,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::nonce::generate_random_key;

    #[test]
    fn test_key_hierarchy() {
        let master_key = SecureBytes::new(generate_random_key().to_vec());
        let mut manager = KeyManager::new(master_key).unwrap();
        
        let db_id = Uuid::new_v4();
        let db_key1 = manager.get_database_key(db_id).unwrap();
        let db_key1_slice = db_key1.as_slice().to_vec();
        let db_key2 = manager.get_database_key(db_id).unwrap();
        
        // Same database should get same key
        assert_eq!(db_key1_slice, db_key2.as_slice());
    }

    #[test]
    fn test_key_rotation() {
        let master_key = SecureBytes::new(generate_random_key().to_vec());
        let mut manager = KeyManager::new(master_key).unwrap();
        
        let db_id = Uuid::new_v4();
        let original_key = manager.get_database_key(db_id).unwrap().clone();
        let rotated_key = manager.rotate_database_key(db_id).unwrap();
        
        // Rotated key should be different
        assert_ne!(original_key.as_slice(), rotated_key.as_slice());
    }
}