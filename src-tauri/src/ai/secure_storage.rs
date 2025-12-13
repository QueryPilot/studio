use keyring::Entry;
use std::collections::HashMap;

const AI_KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.ai";
const AI_KEYCHAIN_USER: &str = "api_keys";
const LEGACY_PROVIDERS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "xai",
    "gateway",
    "openrouter",
];

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(AI_KEYCHAIN_SERVICE, AI_KEYCHAIN_USER)
        .map_err(|e| format!("Failed to access keychain: {}", e))
}

fn read_all_api_keys_from_store() -> Result<HashMap<String, String>, String> {
    let entry = keychain_entry()?;

    match entry.get_password() {
        Ok(serialized) => match serde_json::from_str::<HashMap<String, String>>(&serialized) {
            Ok(keys) => Ok(keys),
            Err(err) => {
                tracing::warn!("Failed to parse stored AI API keys, resetting entry: {}", err);
                let _ = entry.delete_credential();
                Ok(HashMap::new())
            }
        },
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(e) => Err(format!("Failed to read from keychain: {}", e)),
    }
}

fn write_all_api_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    let entry = keychain_entry()?;

    if keys.is_empty() {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete AI keys from keychain: {}", e)),
        }
    } else {
        let serialized = serde_json::to_string(keys)
            .map_err(|e| format!("Failed to serialize API keys: {}", e))?;

        entry
            .set_password(&serialized)
            .map_err(|e| format!("Failed to store in keychain: {}", e))
    }
}

fn delete_legacy_entry(provider: &str) {
    if let Ok(entry) = Entry::new(&format!("{}.{}", AI_KEYCHAIN_SERVICE, provider), "api_key") {
        if let Err(err) = entry.delete_credential() {
            if !matches!(err, keyring::Error::NoEntry) {
                tracing::warn!(
                    "Failed to delete legacy AI keychain entry for {}: {}",
                    provider,
                    err
                );
            }
        }
    }
}

fn migrate_legacy_keys(keys: &mut HashMap<String, String>) -> Result<(), String> {
    let mut migrated = false;

    for provider in LEGACY_PROVIDERS {
        if keys.contains_key(*provider) {
            delete_legacy_entry(provider);
            continue;
        }

        if let Ok(entry) = Entry::new(&format!("{}.{}", AI_KEYCHAIN_SERVICE, provider), "api_key") {
            match entry.get_password() {
                Ok(key) => {
                    keys.insert((*provider).to_string(), key);
                    migrated = true;
                    delete_legacy_entry(provider);
                    tracing::info!("Migrated AI API key for provider {}", provider);
                }
                Err(keyring::Error::NoEntry) => {}
                Err(err) => tracing::warn!(
                    "Failed to read legacy AI key for provider {}: {}",
                    provider,
                    err
                ),
            }
        }
    }

    if migrated {
        write_all_api_keys(keys)?;
    }

    Ok(())
}

pub fn get_all_ai_api_keys() -> Result<HashMap<String, String>, String> {
    let mut keys = read_all_api_keys_from_store()?;
    migrate_legacy_keys(&mut keys)?;
    Ok(keys)
}

#[tauri::command]
pub fn get_ai_api_key(provider: String) -> Result<Option<String>, String> {
    let keys = get_all_ai_api_keys()?;
    Ok(keys.get(&provider).cloned())
}

#[tauri::command]
pub fn set_ai_api_key(provider: String, api_key: String) -> Result<(), String> {
    let mut keys = get_all_ai_api_keys()?;
    keys.insert(provider.clone(), api_key);

    write_all_api_keys(&keys)?;
    delete_legacy_entry(&provider);

    Ok(())
}

#[tauri::command]
pub fn delete_ai_api_key(provider: String) -> Result<(), String> {
    let mut keys = get_all_ai_api_keys()?;
    keys.remove(&provider);

    write_all_api_keys(&keys)?;
    delete_legacy_entry(&provider);

    Ok(())
}
