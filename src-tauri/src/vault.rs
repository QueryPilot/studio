use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::ChaCha20Poly1305;
use chacha20poly1305::Nonce;
use rand_core::RngCore;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const VAULT_FILE: &str = "vault.bin";

fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    Ok(dir.join(VAULT_FILE))
}

fn key_from_keychain() -> Result<[u8; 32], String> {
    let pwd = crate::keychain::get_vault_password()?; // base64 string
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pwd)
        .map_err(|e| format!("Failed to decode key: {}", e))?;
    let mut key = [0u8; 32];
    if bytes.len() < 32 {
        return Err("Key from keychain is too short".into());
    }
    key.copy_from_slice(&bytes[..32]);
    Ok(key)
}

#[tauri::command]
pub fn vault_write(app: tauri::AppHandle, plaintext_json: String) -> Result<(), String> {
    let key = key_from_keychain()?;
    let cipher = ChaCha20Poly1305::new(&key.into());

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext_json.as_bytes())
        .map_err(|e| format!("Encrypt failed: {}", e))?;

    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    let path = vault_path(&app)?;
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Write tmp failed: {}", e))?;
        f.write_all(&out)
            .map_err(|e| format!("Write tmp failed: {}", e))?;
        f.flush().map_err(|e| format!("Flush tmp failed: {}", e))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("Atomic rename failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn vault_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = vault_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|e| format!("Read vault failed: {}", e))?;
    if bytes.len() < 12 {
        return Err("Vault file too small".into());
    }
    let (nonce_bytes, ct) = bytes.split_at(12);
    let key = key_from_keychain()?;
    let cipher = ChaCha20Poly1305::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ct)
        .map_err(|e| format!("Decrypt failed: {}", e))?;
    let s = String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))?;
    Ok(Some(s))
}

#[tauri::command]
pub fn vault_reset(app: tauri::AppHandle) -> Result<(), String> {
    let path = vault_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete vault: {}", e))?;
    }
    Ok(())
}
