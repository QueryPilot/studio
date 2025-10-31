use keyring::Entry;

const AI_KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.ai";

#[tauri::command]
pub fn get_ai_api_key(provider: String) -> Result<Option<String>, String> {
    let entry = Entry::new(&format!("{}.{}", AI_KEYCHAIN_SERVICE, provider), "api_key")
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read from keychain: {}", e)),
    }
}

#[tauri::command]
pub fn set_ai_api_key(provider: String, api_key: String) -> Result<(), String> {
    let entry = Entry::new(&format!("{}.{}", AI_KEYCHAIN_SERVICE, provider), "api_key")
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    entry
        .set_password(&api_key)
        .map_err(|e| format!("Failed to store in keychain: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_ai_api_key(provider: String) -> Result<(), String> {
    let entry = Entry::new(&format!("{}.{}", AI_KEYCHAIN_SERVICE, provider), "api_key")
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete from keychain: {}", e)),
    }
}

