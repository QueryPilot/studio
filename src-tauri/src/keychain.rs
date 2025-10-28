use base64::Engine as _;
use keyring::Entry;
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "app.querypilot.desktop.vault";
const KEYCHAIN_ACCOUNT: &str = "master_password";

/// Get or generate vault master password from OS keychain (cross-platform via keyring)
#[tauri::command]
pub fn get_vault_password() -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(_) => {
            // Generate new password if not found (32 random bytes base64)
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let password = base64::engine::general_purpose::STANDARD.encode(bytes);
            entry
                .set_password(&password)
                .map_err(|e| format!("Failed to store password in keychain: {}", e))?;
            Ok(password)
        }
    }
}

/// Delete vault password from keychain (ignore not-found)
#[tauri::command]
pub fn delete_vault_password() -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete password from keychain: {}", e)),
    }
}
