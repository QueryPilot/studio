use rand::{RngCore, thread_rng};

/// Generate a cryptographically secure nonce
pub fn generate_nonce() -> [u8; 12] {
    let mut nonce = [0u8; 12];
    thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Generate a cryptographically secure nonce of custom size
pub fn generate_nonce_sized(size: usize) -> Vec<u8> {
    let mut nonce = vec![0u8; size];
    thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Generate a salt for key derivation
pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    thread_rng().fill_bytes(&mut salt);
    salt
}

/// Generate a random key
pub fn generate_random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    thread_rng().fill_bytes(&mut key);
    key
}