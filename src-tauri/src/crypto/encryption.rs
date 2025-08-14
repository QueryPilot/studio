use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use chacha20poly1305::ChaCha20Poly1305;
use serde::{Deserialize, Serialize};
use crate::crypto::secure_string::{SecureBytes, SecureString};
use crate::crypto::nonce::generate_nonce;
use std::error::Error;

/// Encrypted data structure containing ciphertext, nonce, and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub algorithm: EncryptionAlgorithm,
    pub version: u32,
}

/// Supported encryption algorithms
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EncryptionAlgorithm {
    Aes256Gcm,
    ChaCha20Poly1305,
}

/// Main encryption service
pub struct EncryptionService {
    algorithm: EncryptionAlgorithm,
}

impl EncryptionService {
    /// Create a new encryption service with the specified algorithm
    pub fn new(algorithm: EncryptionAlgorithm) -> Self {
        EncryptionService { algorithm }
    }

    /// Create a default encryption service using AES-256-GCM
    pub fn default() -> Self {
        EncryptionService {
            algorithm: EncryptionAlgorithm::Aes256Gcm,
        }
    }

    /// Encrypt data using the configured algorithm
    pub fn encrypt(
        &self,
        plaintext: &[u8],
        key: &SecureBytes,
    ) -> Result<EncryptedData, Box<dyn Error>> {
        if key.len() != 32 {
            return Err("Key must be 32 bytes".into());
        }

        let nonce = generate_nonce();
        
        let ciphertext = match self.algorithm {
            EncryptionAlgorithm::Aes256Gcm => {
                self.encrypt_aes256gcm(plaintext, key.as_slice(), &nonce)?
            }
            EncryptionAlgorithm::ChaCha20Poly1305 => {
                self.encrypt_chacha20(plaintext, key.as_slice(), &nonce)?
            }
        };

        Ok(EncryptedData {
            ciphertext,
            nonce: nonce.to_vec(),
            algorithm: self.algorithm,
            version: 1,
        })
    }

    /// Decrypt data
    pub fn decrypt(
        &self,
        encrypted: &EncryptedData,
        key: &SecureBytes,
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        if key.len() != 32 {
            return Err("Key must be 32 bytes".into());
        }

        match encrypted.algorithm {
            EncryptionAlgorithm::Aes256Gcm => {
                self.decrypt_aes256gcm(&encrypted.ciphertext, key.as_slice(), &encrypted.nonce)
            }
            EncryptionAlgorithm::ChaCha20Poly1305 => {
                self.decrypt_chacha20(&encrypted.ciphertext, key.as_slice(), &encrypted.nonce)
            }
        }
    }

    /// Encrypt a string
    pub fn encrypt_string(
        &self,
        plaintext: &str,
        key: &SecureBytes,
    ) -> Result<EncryptedData, Box<dyn Error>> {
        self.encrypt(plaintext.as_bytes(), key)
    }

    /// Decrypt to a string
    pub fn decrypt_string(
        &self,
        encrypted: &EncryptedData,
        key: &SecureBytes,
    ) -> Result<String, Box<dyn Error>> {
        let plaintext = self.decrypt(encrypted, key)?;
        String::from_utf8(plaintext).map_err(|e| e.into())
    }

    /// Encrypt using AES-256-GCM
    fn encrypt_aes256gcm(
        &self,
        plaintext: &[u8],
        key: &[u8],
        nonce: &[u8; 12],
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        let key = Key::<Aes256Gcm>::from_slice(key);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(nonce);
        
        cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed: {}", e).into())
    }

    /// Decrypt using AES-256-GCM
    fn decrypt_aes256gcm(
        &self,
        ciphertext: &[u8],
        key: &[u8],
        nonce: &[u8],
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        let key = Key::<Aes256Gcm>::from_slice(key);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(nonce);
        
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e).into())
    }

    /// Encrypt using ChaCha20-Poly1305
    fn encrypt_chacha20(
        &self,
        plaintext: &[u8],
        key: &[u8],
        nonce: &[u8; 12],
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        let key = Key::<ChaCha20Poly1305>::from_slice(key);
        let cipher = ChaCha20Poly1305::new(key);
        let nonce = Nonce::from_slice(nonce);
        
        cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed: {}", e).into())
    }

    /// Decrypt using ChaCha20-Poly1305
    fn decrypt_chacha20(
        &self,
        ciphertext: &[u8],
        key: &[u8],
        nonce: &[u8],
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        let key = Key::<ChaCha20Poly1305>::from_slice(key);
        let cipher = ChaCha20Poly1305::new(key);
        let nonce = Nonce::from_slice(nonce);
        
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e).into())
    }
}

/// Encrypt field-level data with additional metadata
pub fn encrypt_field(
    field_name: &str,
    value: &str,
    key: &SecureBytes,
) -> Result<String, Box<dyn Error>> {
    let service = EncryptionService::default();
    
    // Add field name as associated data for context
    let data_to_encrypt = format!("{}:{}", field_name, value);
    let encrypted = service.encrypt_string(&data_to_encrypt, key)?;
    
    // Serialize to base64 for storage
    let json = serde_json::to_string(&encrypted)?;
    use base64::{Engine as _, engine::general_purpose};
    Ok(general_purpose::STANDARD.encode(json))
}

/// Decrypt field-level data
pub fn decrypt_field(
    encrypted_value: &str,
    key: &SecureBytes,
) -> Result<String, Box<dyn Error>> {
    let service = EncryptionService::default();
    
    // Decode from base64
    use base64::{Engine as _, engine::general_purpose};
    let json = general_purpose::STANDARD.decode(encrypted_value)?;
    let json_str = String::from_utf8(json)?;
    let encrypted: EncryptedData = serde_json::from_str(&json_str)?;
    
    // Decrypt and extract value
    let decrypted = service.decrypt_string(&encrypted, key)?;
    let parts: Vec<&str> = decrypted.splitn(2, ':').collect();
    
    if parts.len() != 2 {
        return Err("Invalid field format".into());
    }
    
    Ok(parts[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::nonce::generate_random_key;

    #[test]
    fn test_aes256gcm_encryption() {
        let service = EncryptionService::new(EncryptionAlgorithm::Aes256Gcm);
        let key = SecureBytes::new(generate_random_key().to_vec());
        let plaintext = "Hello, World!";
        
        let encrypted = service.encrypt_string(plaintext, &key).unwrap();
        let decrypted = service.decrypt_string(&encrypted, &key).unwrap();
        
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_chacha20_encryption() {
        let service = EncryptionService::new(EncryptionAlgorithm::ChaCha20Poly1305);
        let key = SecureBytes::new(generate_random_key().to_vec());
        let plaintext = "Hello, ChaCha20!";
        
        let encrypted = service.encrypt_string(plaintext, &key).unwrap();
        let decrypted = service.decrypt_string(&encrypted, &key).unwrap();
        
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_field_encryption() {
        let key = SecureBytes::new(generate_random_key().to_vec());
        let field_name = "password";
        let value = "super_secret_password";
        
        let encrypted = encrypt_field(field_name, value, &key).unwrap();
        let decrypted = decrypt_field(&encrypted, &key).unwrap();
        
        assert_eq!(value, decrypted);
    }
}