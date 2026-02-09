use std::collections::HashMap;
use std::path::PathBuf;

use query_pilot::core::ConnectionManager;
use query_pilot::types::{
    BastionConfig, ConnectionProfile, DbType, SshAuthMethod, SshTunnelConfig, SslMode,
};

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

fn parse_port(name: &str, default: u16) -> u16 {
    env_var(name, &default.to_string())
        .parse()
        .unwrap_or(default)
}

fn localhost_port_ready(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

fn resolve_known_hosts_path() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("QUERY_PILOT_SSH_KNOWN_HOSTS") {
        let path = expand_tilde(&custom);
        if path.exists() {
            return Some(path);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(home).join(".ssh/known_hosts");
        if path.exists() {
            return Some(path);
        }
    }

    None
}

fn ssh_skip_reason() -> Option<String> {
    if !ssh_tests_enabled() {
        return Some("TEST_SSH_ENABLED not set".to_string());
    }

    let ssh_port = parse_port("TEST_SSH_PORT", 2222);
    if !localhost_port_ready(ssh_port) {
        return Some(format!("127.0.0.1:{} is unreachable", ssh_port));
    }

    if resolve_known_hosts_path().is_none() {
        return Some(
            "known_hosts not found (set QUERY_PILOT_SSH_KNOWN_HOSTS or create ~/.ssh/known_hosts)"
                .to_string(),
        );
    }

    None
}

fn ssh_tunnel_config() -> SshTunnelConfig {
    SshTunnelConfig {
        host: env_var("TEST_SSH_HOST", "127.0.0.1"),
        port: parse_port("TEST_SSH_PORT", 2222),
        user: env_var("TEST_SSH_USER", "sshuser"),
        auth: SshAuthMethod::Password(env_var("TEST_SSH_PASSWORD", "bastionpass123")),
    }
}

fn with_ssh(mut profile: ConnectionProfile) -> ConnectionProfile {
    let tunnel = ssh_tunnel_config();
    profile.ssh_tunnel = Some(tunnel.clone());
    profile.bastion = Some(BastionConfig::Ssh(tunnel));
    profile
}

fn base_profile(
    id: &str,
    name: &str,
    db_type: DbType,
    host: &str,
    port: u16,
    database: &str,
    username: &str,
    password: Option<&str>,
    ssl_mode: Option<SslMode>,
    options: HashMap<String, String>,
) -> ConnectionProfile {
    ConnectionProfile {
        id: id.to_string(),
        name: name.to_string(),
        db_type,
        host: host.to_string(),
        port,
        database: database.to_string(),
        username: username.to_string(),
        password: password.map(|s| s.to_string()),
        ssl_mode,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        options,
        group: None,
    }
}

async fn assert_profile_connects_over_ssh(
    profile: ConnectionProfile,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager = ConnectionManager::new();
    let conn_id = manager.get_or_create_connection(&profile).await?;
    let conn = manager.get_connection_with_retry(&conn_id, 2).await?;
    let test_result = conn.adapter.test_connection().await?;
    assert!(
        test_result.success,
        "Connection test failed for {:?}: {}",
        profile.db_type, test_result.message
    );
    drop(conn);
    manager.disconnect(&conn_id).await?;
    Ok(())
}

#[tokio::test]
async fn ssh_tunnel_supports_postgres() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping Postgres SSH integration test ({})", reason);
        return Ok(());
    }

    let profile = with_ssh(base_profile(
        "ssh-postgres",
        "SSH Postgres",
        DbType::PostgreSQL,
        "query-pilot-postgres",
        5432,
        "todoapp",
        "devuser",
        Some("devpass123"),
        Some(SslMode::Disable),
        HashMap::new(),
    ));

    assert_profile_connects_over_ssh(profile).await
}

#[tokio::test]
async fn ssh_tunnel_supports_mysql() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping MySQL SSH integration test ({})", reason);
        return Ok(());
    }

    let profile = with_ssh(base_profile(
        "ssh-mysql",
        "SSH MySQL",
        DbType::MySQL,
        "query-pilot-mysql",
        3306,
        "todoapp",
        "devuser",
        Some("devpass123"),
        Some(SslMode::Disable),
        HashMap::new(),
    ));

    assert_profile_connects_over_ssh(profile).await
}

#[tokio::test]
async fn ssh_tunnel_supports_mariadb() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping MariaDB SSH integration test ({})", reason);
        return Ok(());
    }

    let profile = with_ssh(base_profile(
        "ssh-mariadb",
        "SSH MariaDB",
        DbType::MariaDB,
        "query-pilot-mariadb",
        3306,
        "todoapp",
        "devuser",
        Some("devpass123"),
        Some(SslMode::Disable),
        HashMap::new(),
    ));

    assert_profile_connects_over_ssh(profile).await
}

#[tokio::test]
async fn ssh_tunnel_supports_sqlserver() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping SQL Server SSH integration test ({})", reason);
        return Ok(());
    }

    let mut options = HashMap::new();
    options.insert("trust_cert".to_string(), "true".to_string());

    let profile = with_ssh(base_profile(
        "ssh-sqlserver",
        "SSH SQL Server",
        DbType::SQLServer,
        "query-pilot-sqlserver",
        1433,
        "todoapp",
        "sa",
        Some("DevPass123"),
        Some(SslMode::Disable),
        options,
    ));

    assert_profile_connects_over_ssh(profile).await
}

#[tokio::test]
async fn ssh_tunnel_supports_mongodb() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping MongoDB SSH integration test ({})", reason);
        return Ok(());
    }

    let mut options = HashMap::new();
    options.insert("authSource".to_string(), "admin".to_string());
    options.insert("directConnection".to_string(), "true".to_string());

    let profile = with_ssh(base_profile(
        "ssh-mongodb",
        "SSH MongoDB",
        DbType::MongoDB,
        "query-pilot-mongodb",
        27017,
        "todoapp",
        "devuser",
        Some("devpass123"),
        None,
        options,
    ));

    assert_profile_connects_over_ssh(profile).await
}

#[tokio::test]
async fn ssh_tunnel_supports_redis() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(reason) = ssh_skip_reason() {
        eprintln!("Skipping Redis SSH integration test ({})", reason);
        return Ok(());
    }

    let profile = with_ssh(base_profile(
        "ssh-redis",
        "SSH Redis",
        DbType::Redis,
        "query-pilot-redis",
        6379,
        "0",
        "",
        Some("devpass123"),
        None,
        HashMap::new(),
    ));

    assert_profile_connects_over_ssh(profile).await
}
