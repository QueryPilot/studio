pub mod rate_limiter;
pub mod secrets;
mod tunnel;

mod port_allocator;
pub use port_allocator::{allocate_local_port, is_port_listening};
pub use tunnel::{verify_connection, SshTunnel};

use crate::types::{SshAuthMethod, SshTunnelConfig};

/// Parse ~/.ssh/config for host-specific settings
#[derive(Default, Debug)]
pub struct SshConfigOverrides {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

#[cfg(target_os = "windows")]
pub fn parse_ssh_config(_host: &str) -> Option<SshConfigOverrides> {
    None
}

#[cfg(not(target_os = "windows"))]
pub fn parse_ssh_config(host: &str) -> Option<SshConfigOverrides> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".ssh/config");
    let contents = std::fs::read_to_string(&config_path).ok()?;

    let parsed = ssh_config::SSHConfig::parse_str(&contents).ok()?;
    let host_settings = parsed.query(host);

    if host_settings.is_empty() {
        return None;
    }

    let mut overrides = SshConfigOverrides::default();
    if let Some(hostname) = host_settings.get("Hostname") {
        overrides.host = Some((*hostname).to_string());
    }
    if let Some(port) = host_settings
        .get("Port")
        .and_then(|value| value.parse::<u16>().ok())
    {
        overrides.port = Some(port);
    }
    if let Some(user) = host_settings
        .get("User")
        .or_else(|| host_settings.get("Username"))
    {
        overrides.user = Some((*user).to_string());
    }
    if let Some(identity) = host_settings.get("IdentityFile") {
        let expanded = shellexpand::tilde(identity);
        overrides.identity_file = Some(expanded.to_string());
    }

    Some(overrides)
}

/// Apply SSH config overrides to a connection config
pub fn apply_ssh_config_overrides(config: &mut SshTunnelConfig, overrides: &SshConfigOverrides) {
    if let Some(ref host) = overrides.host {
        config.host = host.clone();
    }
    if let Some(port) = overrides.port {
        if config.port == 0 || config.port == 22 {
            config.port = port;
        }
    }
    if config.user.is_empty() {
        if let Some(ref user) = overrides.user {
            config.user = user.clone();
        }
    }
    if let Some(identity_file) = overrides.identity_file.as_ref() {
        // Respect explicit credentials from profile; only apply IdentityFile
        // when auth is currently SSH agent based.
        if matches!(config.auth, SshAuthMethod::Agent) {
            config.auth = SshAuthMethod::KeyFile {
                path: identity_file.clone(),
                passphrase: None,
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_identity_file_overrides_agent_auth() {
        let mut config = SshTunnelConfig {
            host: "db.example.com".into(),
            port: 22,
            user: "alice".into(),
            auth: SshAuthMethod::Agent,
        };
        let overrides = SshConfigOverrides {
            identity_file: Some("/tmp/test-key".into()),
            ..Default::default()
        };

        apply_ssh_config_overrides(&mut config, &overrides);

        match config.auth {
            SshAuthMethod::KeyFile { path, passphrase } => {
                assert_eq!(path, "/tmp/test-key");
                assert!(passphrase.is_none());
            }
            _ => panic!("expected key file auth from IdentityFile override"),
        }
    }

    #[test]
    fn identity_file_does_not_override_explicit_password_auth() {
        let mut config = SshTunnelConfig {
            host: "db.example.com".into(),
            port: 22,
            user: "alice".into(),
            auth: SshAuthMethod::Password("secret".into()),
        };
        let overrides = SshConfigOverrides {
            identity_file: Some("/tmp/test-key".into()),
            ..Default::default()
        };

        apply_ssh_config_overrides(&mut config, &overrides);

        match config.auth {
            SshAuthMethod::Password(password) => assert_eq!(password, "secret"),
            _ => panic!("expected explicit password auth to remain unchanged"),
        }
    }
}
