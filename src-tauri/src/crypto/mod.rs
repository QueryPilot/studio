pub mod encryption;
pub mod key_derive;
pub mod secure_string;
pub mod nonce;
pub mod key_manager;
pub mod batch_operations;

pub use encryption::{EncryptionService, EncryptedData, encrypt_field, decrypt_field};
pub use key_derive::{derive_key_argon2, derive_key_hkdf};
pub use secure_string::{SecureString, SecureBytes};
pub use nonce::generate_nonce;
pub use key_manager::{KeyManager, KeyHierarchy};
pub use batch_operations::{batch_encrypt_fields, batch_decrypt_fields, BatchConnectionProcessor};