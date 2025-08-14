use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params, Version,
};
use hkdf::Hkdf;
use sha2::Sha256;
use crate::crypto::secure_string::{SecureBytes, SecureString};
use std::error::Error;

/// Argon2id parameters for secure key derivation
/// Memory: 64MB, Time: 3 iterations, Parallelism: 4 threads
const ARGON2_MEMORY: u32 = 65536;  // 64MB
const ARGON2_TIME: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;
const ARGON2_OUTPUT_LEN: usize = 32;

/// Derive a key from password using Argon2id
pub fn derive_key_argon2(
    password: &SecureString,
    salt: &[u8],
) -> Result<SecureBytes, Box<dyn Error>> {
    let params = Params::new(
        ARGON2_MEMORY,
        ARGON2_TIME,
        ARGON2_PARALLELISM,
        Some(ARGON2_OUTPUT_LEN),
    ).map_err(|e| format!("Argon2 params error: {:?}", e))?;

    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        params,
    );

    let salt_string = SaltString::encode_b64(salt).map_err(|e| format!("Salt encoding error: {:?}", e))?;
    
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt_string).map_err(|e| format!("Password hashing error: {:?}", e))?
        .to_string();

    // Extract the hash from the PHC string format
    let parsed = PasswordHash::new(&password_hash).map_err(|e| format!("Password hash parsing error: {:?}", e))?;
    let hash_bytes = parsed.hash
        .ok_or("Failed to extract hash")?
        .as_bytes()
        .to_vec();

    Ok(SecureBytes::new(hash_bytes))
}

/// Verify a password against an Argon2id hash
pub fn verify_argon2(
    password: &SecureString,
    hash: &str,
) -> Result<bool, Box<dyn Error>> {
    let parsed_hash = PasswordHash::new(hash).map_err(|e| format!("Password hash parsing error: {:?}", e))?;
    let argon2 = Argon2::default();
    
    match argon2.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Derive a key using HKDF-SHA256
pub fn derive_key_hkdf(
    master_key: &SecureBytes,
    info: &[u8],
    output_len: usize,
) -> Result<SecureBytes, Box<dyn Error>> {
    let hk = Hkdf::<Sha256>::new(None, master_key.as_slice());
    let mut output = vec![0u8; output_len];
    
    hk.expand(info, &mut output)
        .map_err(|e| format!("HKDF expansion failed: {:?}", e))?;
    
    Ok(SecureBytes::new(output))
}

/// Derive multiple keys from a master key
pub fn derive_key_hierarchy(
    master_key: &SecureBytes,
    contexts: &[&str],
) -> Result<Vec<SecureBytes>, Box<dyn Error>> {
    let mut keys = Vec::new();
    
    for context in contexts {
        let key = derive_key_hkdf(master_key, context.as_bytes(), 32)?;
        keys.push(key);
    }
    
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::nonce::generate_salt;

    #[test]
    fn test_argon2_key_derivation() {
        let password = SecureString::from_str("test_password");
        let salt = generate_salt();
        
        let key1 = derive_key_argon2(&password, &salt).unwrap();
        let key2 = derive_key_argon2(&password, &salt).unwrap();
        
        // Same password and salt should produce same key
        assert_eq!(key1.as_slice(), key2.as_slice());
        
        // Key should be 32 bytes
        assert_eq!(key1.len(), 32);
    }

    #[test]
    fn test_hkdf_derivation() {
        let master = SecureBytes::new(vec![0x42; 32]);
        let key1 = derive_key_hkdf(&master, b"encryption", 32).unwrap();
        let key2 = derive_key_hkdf(&master, b"authentication", 32).unwrap();
        
        // Different contexts should produce different keys
        assert_ne!(key1.as_slice(), key2.as_slice());
        
        // Keys should be 32 bytes
        assert_eq!(key1.len(), 32);
        assert_eq!(key2.len(), 32);
    }
}