use base64::Engine as _;
use keyring::Entry;
use rand::RngCore;
use std::path::Path;

const KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.vault";
const KEYCHAIN_ACCOUNT: &str = "master_password";

#[cfg(target_os = "linux")]
const LINUX_KEY_FILENAME: &str = "vault.key";

/// Get existing vault password from OS keychain. Never creates a new one.
///
/// Returns Err if the password doesn't exist or keychain is inaccessible.
/// Used by vault_read (where vault.bin already exists) and vault_write
/// (when vault.bin already exists) to ensure we never use a wrong key.
///
/// On Linux the OS keyring (Secret Service) is unreliable: many distros
/// ship no secret service at all, auto-login leaves the login collection
/// locked, and password drift silently breaks unlock. We therefore prefer
/// a file-based key stored alongside the vault (`vault.key`, `0600`),
/// falling back to the keyring only for older installs that still have
/// their key stored there (and migrating them on first successful read).
pub fn get_existing_vault_password(data_dir: &Path) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if let Some(pwd) = read_linux_key_file(data_dir) {
            return Ok(pwd);
        }
        // Migration path: older Linux installs stored the key in the
        // Secret Service. If it's still reachable, read it once and
        // persist it to disk so future launches don't depend on the
        // keyring being unlocked.
        if let Ok(pwd) = read_keyring_password() {
            let _ = write_linux_key_file(data_dir, &pwd);
            return Ok(pwd);
        }
        return Err(format!(
            "Vault encryption key not found. On Linux, Query Pilot stores \
             it at `{}` (mode 0600). If you deleted your user data directory \
             or lost the file, restore it from a backup or reset the vault \
             from Preferences.",
            data_dir.join(LINUX_KEY_FILENAME).display()
        ));
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = data_dir;
        read_keyring_password().map_err(format_keyring_error)
    }
}

/// Get or create vault password. Only for initial vault creation (no vault.bin yet).
///
/// Creates a new random key ONLY when no existing key is found. Any other
/// error (permission denied, iCloud inaccessible) is propagated.
pub fn get_or_create_vault_password(data_dir: &Path) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if let Some(pwd) = read_linux_key_file(data_dir) {
            return Ok(pwd);
        }
        // Migration path: pick up an existing keyring entry from older installs.
        if let Ok(pwd) = read_keyring_password() {
            write_linux_key_file(data_dir, &pwd)?;
            return Ok(pwd);
        }
        // Fresh install: generate a new key and persist it to disk. We
        // deliberately do NOT write to the Secret Service — the file is
        // the single source of truth on Linux going forward.
        let pwd = generate_random_key();
        write_linux_key_file(data_dir, &pwd)?;
        return Ok(pwd);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = data_dir;
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("Failed to access keychain: {}", e))?;

        match entry.get_password() {
            Ok(password) => Ok(password),
            Err(keyring::Error::NoEntry) => {
                let password = generate_random_key();
                entry
                    .set_password(&password)
                    .map_err(|e| format!("Failed to store password in keychain: {}", e))?;
                Ok(password)
            }
            Err(e) => Err(format_keyring_error(e)),
        }
    }
}

/// Delete vault password from storage (ignore not-found).
/// Used for vault reset - not exposed as a Tauri command.
pub fn delete_vault_password(data_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let path = data_dir.join(LINUX_KEY_FILENAME);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete vault key file: {}", e))?;
        }
        // Best-effort cleanup of the legacy keyring entry so a reset
        // doesn't leave an orphaned credential behind.
        if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            let _ = entry.delete_credential();
        }
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = data_dir;
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("Failed to access keychain: {}", e))?;

        match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete password from keychain: {}", e)),
        }
    }
}

fn generate_random_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn read_keyring_password() -> Result<String, keyring::Error> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?;
    entry.get_password()
}

#[cfg(not(target_os = "linux"))]
fn format_keyring_error(e: keyring::Error) -> String {
    match &e {
        keyring::Error::NoEntry => {
            #[cfg(target_os = "macos")]
            {
                "Vault encryption key not found in keychain. \
                 If you use iCloud Keychain, ensure it is accessible in System Settings."
                    .to_string()
            }
            #[cfg(target_os = "windows")]
            {
                "Vault encryption key not found in Windows Credential Manager. \
                 Ensure you are logged in with the same Windows user account."
                    .to_string()
            }
        }
        _ => {
            #[cfg(target_os = "macos")]
            {
                format!(
                    "Keychain access denied: {}. \
                     Grant Full Disk Access or Keychain permission in System Settings.",
                    e
                )
            }
            #[cfg(target_os = "windows")]
            {
                format!(
                    "Windows Credential Manager access denied: {}. \
                     Ensure the app has permission to access stored credentials.",
                    e
                )
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn read_linux_key_file(data_dir: &Path) -> Option<String> {
    let path = data_dir.join(LINUX_KEY_FILENAME);
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(target_os = "linux")]
fn write_linux_key_file(data_dir: &Path, key: &str) -> Result<(), String> {
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    fs::create_dir_all(data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;

    let path = data_dir.join(LINUX_KEY_FILENAME);
    let tmp = data_dir.join(format!("{}.tmp", LINUX_KEY_FILENAME));

    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| format!("Failed to create vault key file: {}", e))?;
        f.write_all(key.as_bytes())
            .map_err(|e| format!("Failed to write vault key file: {}", e))?;
        f.flush()
            .map_err(|e| format!("Failed to flush vault key file: {}", e))?;
    }

    // Extra belt-and-braces on hosts where umask or filesystems may have
    // loosened the mode at creation time.
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("Failed to chmod vault key file: {}", e))?;

    fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to finalize vault key file: {}", e))?;

    Ok(())
}
