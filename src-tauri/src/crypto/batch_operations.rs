use std::error::Error;
use rayon::prelude::*;
use crate::crypto::{EncryptionService, SecureBytes, encrypt_field, decrypt_field};

/// Batch encryption result
#[derive(Debug)]
pub struct BatchEncryptResult {
    pub field_name: String,
    pub encrypted_value: Result<String, String>,
}

/// Batch decryption result
#[derive(Debug)]
pub struct BatchDecryptResult {
    pub field_name: String,
    pub decrypted_value: Result<String, String>,
}

/// Perform batch encryption of multiple fields in parallel
pub fn batch_encrypt_fields(
    fields: Vec<(&str, &str)>,
    key: &SecureBytes,
) -> Vec<BatchEncryptResult> {
    fields
        .par_iter()
        .map(|(field_name, value)| {
            let result = encrypt_field(field_name, value, key)
                .map_err(|e| e.to_string());
            
            BatchEncryptResult {
                field_name: field_name.to_string(),
                encrypted_value: result,
            }
        })
        .collect()
}

/// Perform batch decryption of multiple fields in parallel
pub fn batch_decrypt_fields(
    encrypted_fields: Vec<(&str, &str)>,
    key: &SecureBytes,
) -> Vec<BatchDecryptResult> {
    encrypted_fields
        .par_iter()
        .map(|(field_name, encrypted_value)| {
            let result = decrypt_field(encrypted_value, key)
                .map_err(|e| e.to_string());
            
            BatchDecryptResult {
                field_name: field_name.to_string(),
                decrypted_value: result,
            }
        })
        .collect()
}

/// Batch process multiple connections for encryption
pub struct BatchConnectionProcessor {
    encryption_service: EncryptionService,
}

impl BatchConnectionProcessor {
    pub fn new() -> Self {
        Self {
            encryption_service: EncryptionService::default(),
        }
    }
    
    /// Encrypt multiple connections in parallel
    pub fn encrypt_connections(
        &self,
        connections: Vec<ConnectionData>,
        keys: Vec<SecureBytes>,
    ) -> Vec<EncryptedConnectionData> {
        connections
            .into_par_iter()
            .zip(keys.into_par_iter())
            .map(|(conn, key)| {
                self.encrypt_single_connection(conn, key)
            })
            .collect()
    }
    
    /// Decrypt multiple connections in parallel
    pub fn decrypt_connections(
        &self,
        encrypted_connections: Vec<EncryptedConnectionData>,
        keys: Vec<SecureBytes>,
    ) -> Vec<ConnectionData> {
        encrypted_connections
            .into_par_iter()
            .zip(keys.into_par_iter())
            .filter_map(|(enc_conn, key)| {
                self.decrypt_single_connection(enc_conn, key).ok()
            })
            .collect()
    }
    
    fn encrypt_single_connection(
        &self,
        conn: ConnectionData,
        key: SecureBytes,
    ) -> EncryptedConnectionData {
        let mut fields_to_encrypt = vec![];
        
        if let Some(password) = &conn.password {
            fields_to_encrypt.push(("password", password.as_str()));
        }
        
        if let Some(ssh_key) = &conn.ssh_private_key {
            fields_to_encrypt.push(("ssh_private_key", ssh_key.as_str()));
        }
        
        if let Some(api_key) = &conn.api_key {
            fields_to_encrypt.push(("api_key", api_key.as_str()));
        }
        
        let encrypted_results = batch_encrypt_fields(fields_to_encrypt, &key);
        
        EncryptedConnectionData {
            id: conn.id,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            encrypted_password: encrypted_results
                .iter()
                .find(|r| r.field_name == "password")
                .and_then(|r| r.encrypted_value.as_ref().ok())
                .cloned(),
            encrypted_ssh_key: encrypted_results
                .iter()
                .find(|r| r.field_name == "ssh_private_key")
                .and_then(|r| r.encrypted_value.as_ref().ok())
                .cloned(),
            encrypted_api_key: encrypted_results
                .iter()
                .find(|r| r.field_name == "api_key")
                .and_then(|r| r.encrypted_value.as_ref().ok())
                .cloned(),
            database: conn.database,
            connection_type: conn.connection_type,
        }
    }
    
    fn decrypt_single_connection(
        &self,
        enc_conn: EncryptedConnectionData,
        key: SecureBytes,
    ) -> Result<ConnectionData, Box<dyn Error>> {
        let mut fields_to_decrypt = vec![];
        
        if let Some(enc_password) = &enc_conn.encrypted_password {
            fields_to_decrypt.push(("password", enc_password.as_str()));
        }
        
        if let Some(enc_ssh) = &enc_conn.encrypted_ssh_key {
            fields_to_decrypt.push(("ssh_private_key", enc_ssh.as_str()));
        }
        
        if let Some(enc_api) = &enc_conn.encrypted_api_key {
            fields_to_decrypt.push(("api_key", enc_api.as_str()));
        }
        
        let decrypted_results = batch_decrypt_fields(fields_to_decrypt, &key);
        
        Ok(ConnectionData {
            id: enc_conn.id,
            name: enc_conn.name,
            host: enc_conn.host,
            port: enc_conn.port,
            username: enc_conn.username,
            password: decrypted_results
                .iter()
                .find(|r| r.field_name == "password")
                .and_then(|r| r.decrypted_value.as_ref().ok())
                .cloned(),
            ssh_private_key: decrypted_results
                .iter()
                .find(|r| r.field_name == "ssh_private_key")
                .and_then(|r| r.decrypted_value.as_ref().ok())
                .cloned(),
            api_key: decrypted_results
                .iter()
                .find(|r| r.field_name == "api_key")
                .and_then(|r| r.decrypted_value.as_ref().ok())
                .cloned(),
            database: enc_conn.database,
            connection_type: enc_conn.connection_type,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ConnectionData {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub password: Option<String>,
    pub ssh_private_key: Option<String>,
    pub api_key: Option<String>,
    pub database: Option<String>,
    pub connection_type: String,
}

#[derive(Debug, Clone)]
pub struct EncryptedConnectionData {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub encrypted_password: Option<String>,
    pub encrypted_ssh_key: Option<String>,
    pub encrypted_api_key: Option<String>,
    pub database: Option<String>,
    pub connection_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_batch_encryption() {
        let key = SecureBytes::new(vec![0u8; 32]);
        
        let fields = vec![
            ("password", "secret123"),
            ("api_key", "key456"),
            ("token", "token789"),
        ];
        
        let results = batch_encrypt_fields(fields, &key);
        
        assert_eq!(results.len(), 3);
        for result in results {
            assert!(result.encrypted_value.is_ok());
        }
    }
    
    #[test]
    fn test_batch_connection_processing() {
        let processor = BatchConnectionProcessor::new();
        let key = SecureBytes::new(vec![0u8; 32]);
        
        let connection = ConnectionData {
            id: "test-id".to_string(),
            name: "Test DB".to_string(),
            host: "localhost".to_string(),
            port: 5432,
            username: "user".to_string(),
            password: Some("password123".to_string()),
            ssh_private_key: None,
            api_key: Some("api123".to_string()),
            database: Some("testdb".to_string()),
            connection_type: "postgresql".to_string(),
        };
        
        let encrypted = processor.encrypt_single_connection(connection.clone(), key.clone());
        assert!(encrypted.encrypted_password.is_some());
        assert!(encrypted.encrypted_api_key.is_some());
        
        let decrypted = processor.decrypt_single_connection(encrypted, key).unwrap();
        assert_eq!(decrypted.password, connection.password);
        assert_eq!(decrypted.api_key, connection.api_key);
    }
}