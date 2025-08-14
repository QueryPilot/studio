use zeroize::{Zeroize, ZeroizeOnDrop};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Secure string that zeros memory on drop
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecureString(String);

impl SecureString {
    pub fn new(s: String) -> Self {
        SecureString(s)
    }

    pub fn from_str(s: &str) -> Self {
        SecureString(s.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn to_string(&self) -> String {
        self.0.clone()
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl fmt::Debug for SecureString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SecureString(***)")
    }
}

impl fmt::Display for SecureString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "***")
    }
}

/// Secure bytes that zero memory on drop
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecureBytes(Vec<u8>);

impl SecureBytes {
    pub fn new(bytes: Vec<u8>) -> Self {
        SecureBytes(bytes)
    }

    pub fn from_slice(slice: &[u8]) -> Self {
        SecureBytes(slice.to_vec())
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    pub fn to_vec(&self) -> Vec<u8> {
        self.0.clone()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for SecureBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SecureBytes({} bytes)", self.0.len())
    }
}

impl AsRef<[u8]> for SecureBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

/// Constant-time comparison for secure data
pub fn secure_compare(a: &[u8], b: &[u8]) -> bool {
    constant_time_eq::constant_time_eq(a, b)
}