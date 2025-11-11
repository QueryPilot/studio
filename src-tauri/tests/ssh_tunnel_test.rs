use query_pilot::error::AppError;
use query_pilot::ssh;
use query_pilot::types::{SshAuthMethod, SshTunnelConfig};
use tokio_postgres::NoTls;

fn ssh_tests_enabled() -> bool {
    matches!(
        std::env::var("TEST_SSH_ENABLED")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
        true
    )
}

fn env_var(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn localhost_port_ready(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn password_config() -> SshTunnelConfig {
    SshTunnelConfig {
        host: "example.com".into(),
        port: 22,
        user: "ubuntu".into(),
        auth: SshAuthMethod::Password("secret".into()),
    }
}

#[tokio::test]
async fn password_auth_with_invalid_credentials_fails() {
    // Password auth is now supported, but should fail with bad credentials
    let result = ssh::verify_connection(&password_config()).await;
    // Will fail to connect to example.com or with wrong credentials
    assert!(result.is_err());
}

#[tokio::test]
async fn encrypted_key_with_missing_file_fails() {
    // Encrypted keys are now supported, but this should fail because file doesn't exist
    let config = SshTunnelConfig {
        host: "example.com".into(),
        port: 22,
        user: "ubuntu".into(),
        auth: SshAuthMethod::KeyFile {
            path: "/tmp/nonexistent_key_file_12345".into(),
            passphrase: Some("hunter2".into()),
        },
    };

    let result = ssh::verify_connection(&config).await;
    assert!(matches!(result, Err(AppError::SshKeyError(_))));
}

#[tokio::test]
async fn missing_host_fails() {
    let config = SshTunnelConfig {
        host: "".into(),
        port: 22,
        user: "ubuntu".into(),
        auth: SshAuthMethod::Agent,
    };

    let result = ssh::verify_connection(&config).await;
    // Should fail when trying to connect to empty host
    assert!(result.is_err());
}

#[tokio::test]
async fn tunnel_can_proxy_postgres() -> Result<(), Box<dyn std::error::Error>> {
    if !ssh_tests_enabled() {
        eprintln!("Skipping SSH integration test (TEST_SSH_ENABLED not set)");
        return Ok(());
    }

    let ssh_host = env_var("TEST_SSH_KEY_HOST", "127.0.0.1");
    let ssh_port: u16 = env_var("TEST_SSH_KEY_PORT", "2223").parse().unwrap_or(2223);

    if !localhost_port_ready(ssh_port) {
        eprintln!(
            "Skipping SSH integration test ({}:{} unreachable)",
            ssh_host, ssh_port
        );
        return Ok(());
    }

    let ssh_user = env_var("TEST_SSH_KEY_USER", "sshuser");
    let ssh_key_path = env_var("TEST_SSH_KEY_PATH", "../tests/ssh-keys/test_rsa_key");

    let config = SshTunnelConfig {
        host: ssh_host.clone(),
        port: ssh_port,
        user: ssh_user,
        auth: SshAuthMethod::KeyFile {
            path: ssh_key_path,
            passphrase: None,
        },
    };

    let db_host = env_var("TEST_DB_POSTGRES_HOST", "postgres-private");
    let db_port: u16 = env_var("TEST_DB_POSTGRES_PORT", "5432")
        .parse()
        .unwrap_or(5432);
    let db_user = env_var("TEST_DB_POSTGRES_USER", "devuser");
    let db_password = env_var("TEST_DB_POSTGRES_PASSWORD", "devpass123");
    let db_name = env_var("TEST_DB_POSTGRES_DB", "todoapp");

    let tunnel = ssh::SshTunnel::establish(&config, &db_host, db_port).await?;
    assert!(tunnel.health_check().await.is_ok());

    let local_port = tunnel.local_port();
    let mut pg_config = tokio_postgres::Config::new();
    pg_config.host("127.0.0.1");
    pg_config.port(local_port);
    pg_config.user(db_user);
    pg_config.password(db_password);
    pg_config.dbname(&db_name);

    let (client, connection) = pg_config.connect(NoTls).await?;
    let connection_handle = tokio::spawn(connection);

    let row = client.query_one("SELECT 1::INT", &[]).await?;
    let value: i32 = row.get(0);
    assert_eq!(value, 1);

    drop(client);
    connection_handle.await??;

    tunnel.close().await?;
    Ok(())
}
