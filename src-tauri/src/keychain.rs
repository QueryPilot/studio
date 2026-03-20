use base64::Engine as _;
use keyring::Entry;
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.vault";
const KEYCHAIN_ACCOUNT: &str = "master_password";

/// Get existing vault password from OS keychain. Never creates a new one.
/// Returns Err if the password doesn't exist or keychain is inaccessible.
/// Used by vault_read (where vault.bin already exists) and vault_write
/// (when vault.bin already exists) to ensure we never use a wrong key.
pub fn get_existing_vault_password() -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    entry.get_password().map_err(|e| match &e {
        keyring::Error::NoEntry => {
            "Vault encryption key not found in keychain. \
             If you use iCloud Keychain, ensure it is accessible in System Settings."
                .to_string()
        }
        _ => format!(
            "Keychain access denied: {}. \
             Grant Full Disk Access or Keychain permission in System Settings.",
            e
        ),
    })
}

/// Get or create vault password. Only for initial vault creation (no vault.bin yet).
/// Creates a new random key ONLY when the keychain entry truly doesn't exist.
/// Any other error (permission denied, iCloud inaccessible) is propagated.
pub fn get_or_create_vault_password() -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => {
            // Truly no entry — safe to generate a new key for a fresh vault.
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let password = base64::engine::general_purpose::STANDARD.encode(bytes);
            entry
                .set_password(&password)
                .map_err(|e| format!("Failed to store password in keychain: {}", e))?;
            Ok(password)
        }
        Err(e) => Err(format!(
            "Keychain access denied: {}. \
             Grant Full Disk Access or Keychain permission in System Settings.",
            e
        )),
    }
}

/// Delete vault password from keychain (ignore not-found)
/// Used for vault reset - not exposed as a Tauri command
pub fn delete_vault_password() -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete password from keychain: {}", e)),
    }
}
