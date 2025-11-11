use crate::error::{AppError, Result};
use tokio::task;
use zeroize::Zeroize;

const SERVICE_NAME: &str = "query-pilot-ssh";

fn map_keyring_error(err: keyring::Error) -> AppError {
    AppError::Crypto(format!("Keyring error: {err}"))
}

fn join_error(context: &str, err: tokio::task::JoinError) -> AppError {
    AppError::Internal(format!("{context}: {err}"))
}

pub async fn store_ssh_passphrase(conn_id: &str, passphrase: String) -> Result<()> {
    let id = conn_id.to_string();
    task::spawn_blocking(move || -> Result<()> {
        let entry = keyring::Entry::new(SERVICE_NAME, &id).map_err(map_keyring_error)?;
        entry.set_password(&passphrase).map_err(map_keyring_error)?;

        let mut secret = passphrase;
        secret.zeroize();
        Ok(())
    })
    .await
    .map_err(|err| join_error("Failed to store SSH passphrase", err))??;

    Ok(())
}

pub async fn get_ssh_passphrase(conn_id: &str) -> Result<Option<String>> {
    let id = conn_id.to_string();
    let result = task::spawn_blocking(move || -> Result<Option<String>> {
        let entry = keyring::Entry::new(SERVICE_NAME, &id).map_err(map_keyring_error)?;

        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(map_keyring_error(err)),
        }
    })
    .await
    .map_err(|err| join_error("Failed to read SSH passphrase", err))??;

    Ok(result)
}

pub async fn delete_ssh_passphrase(conn_id: &str) -> Result<()> {
    let id = conn_id.to_string();
    task::spawn_blocking(move || -> Result<()> {
        let entry = keyring::Entry::new(SERVICE_NAME, &id).map_err(map_keyring_error)?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(map_keyring_error(err)),
        }
    })
    .await
    .map_err(|err| join_error("Failed to delete SSH passphrase", err))??;

    Ok(())
}
