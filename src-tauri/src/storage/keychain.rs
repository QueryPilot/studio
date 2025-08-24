use std::error::Error;
use keyring::Entry;
use uuid::Uuid;
use crate::crypto::nonce::generate_random_key;

// Use the same bundle identifier as the app to maintain keychain access across rebuilds
const SERVICE_NAME: &str = "com.hieuvd.devdb-studio";
const MASTER_KEY_ACCOUNT: &str = "master_key";

/// Keychain manager for OS-level secure storage
pub struct KeychainManager {
    service_name: String,
}

impl KeychainManager {
    /// Create a new keychain manager
    pub fn new() -> Self {
        KeychainManager {
            service_name: SERVICE_NAME.to_string(),
        }
    }
    
    /// Get or create the master key
    pub fn get_or_create_master_key(&self) -> Result<Vec<u8>, Box<dyn Error>> {
        println!("[KeychainManager] Creating keyring entry for service: {}, account: {}", 
                 &self.service_name, MASTER_KEY_ACCOUNT);
        
        let entry = Entry::new(&self.service_name, MASTER_KEY_ACCOUNT)?;
        
        // Try to get existing master key
        match entry.get_password() {
            Ok(key_str) => {
                println!("[KeychainManager] Found existing master key in keychain");
                // Decode from base64
                use base64::{Engine as _, engine::general_purpose};
                let key = general_purpose::STANDARD.decode(&key_str)?;
                Ok(key)
            }
            Err(e) => {
                println!("[KeychainManager] No existing key found ({}), creating new master key", e);
                // Generate new master key
                let key = generate_random_key();
                use base64::{Engine as _, engine::general_purpose};
                let key_str = general_purpose::STANDARD.encode(&key);
                
                // Store in keychain with proper access control
                println!("[KeychainManager] Attempting to store master key in keychain...");
                entry.set_password(&key_str)?;
                println!("[KeychainManager] Successfully stored master key in keychain");
                
                Ok(key.to_vec())
            }
        }
    }
    
    /// Store a password in the keychain
    pub fn store_password(&self, connection_id: &Uuid, password: &str) -> Result<(), Box<dyn Error>> {
        let entry = Entry::new(&self.service_name, &connection_id.to_string())?;
        entry.set_password(password)?;
        Ok(())
    }
    
    /// Retrieve a password from the keychain
    pub fn get_password(&self, connection_id: &Uuid) -> Result<String, Box<dyn Error>> {
        let entry = Entry::new(&self.service_name, &connection_id.to_string())?;
        let password = entry.get_password()?;
        Ok(password)
    }
    
    /// Delete a password from the keychain
    pub fn delete_password(&self, connection_id: &Uuid) -> Result<(), Box<dyn Error>> {
        let entry = Entry::new(&self.service_name, &connection_id.to_string())?;
        entry.delete_credential()?;
        Ok(())
    }
    
    /// Check if master key exists
    pub fn has_master_key(&self) -> bool {
        let entry = Entry::new(&self.service_name, MASTER_KEY_ACCOUNT).ok();
        if let Some(entry) = entry {
            entry.get_password().is_ok()
        } else {
            false
        }
    }
    
    /// Rotate the master key (requires re-encryption of all data)
    pub fn rotate_master_key(&self) -> Result<Vec<u8>, Box<dyn Error>> {
        let entry = Entry::new(&self.service_name, MASTER_KEY_ACCOUNT)?;
        
        // Generate new master key
        let new_key = generate_random_key();
        use base64::{Engine as _, engine::general_purpose};
        let key_str = general_purpose::STANDARD.encode(&new_key);
        
        // Store new key (overwrites old one)
        entry.set_password(&key_str)?;
        
        Ok(new_key.to_vec())
    }
    
    /// Clear all stored credentials (emergency reset)
    pub fn clear_all_credentials(&self) -> Result<(), Box<dyn Error>> {
        // This would need to iterate through all stored entries
        // For now, just clear the master key
        let entry = Entry::new(&self.service_name, MASTER_KEY_ACCOUNT)?;
        entry.delete_credential().ok(); // Ignore error if doesn't exist
        
        Ok(())
    }
}