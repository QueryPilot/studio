pub mod rate_limiter;
pub mod secrets;
mod tunnel;

mod port_allocator;
pub use port_allocator::{allocate_local_port, is_port_listening};
pub use tunnel::{verify_connection, SshTunnel};

use crate::types::{SshAuthMethod, SshTunnelConfig};
#[cfg(not(target_os = "windows"))]
use std::collections::HashMap;
use std::process::Command;

/// Parse effective SSH settings for a host/alias.
/// Prefers `ssh -G <host>` (OpenSSH canonical view), with file-based fallback.
#[derive(Default, Debug)]
pub struct SshConfigOverrides {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

pub fn parse_ssh_config(host: &str) -> Option<SshConfigOverrides> {
    if let Some(overrides) = parse_ssh_config_via_ssh_binary(host) {
        return Some(overrides);
    }

    #[cfg(target_os = "windows")]
    {
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        parse_ssh_config_from_file(host)
    }
}

fn parse_ssh_config_via_ssh_binary(host: &str) -> Option<SshConfigOverrides> {
    let host = host.trim();
    if host.is_empty() || host.starts_with('-') {
        return None;
    }

    let output = Command::new("ssh").arg("-G").arg(host).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_ssh_g_output(&stdout)
}

fn normalize_ssh_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        return None;
    }

    let unquoted = if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    };

    if unquoted.is_empty() || unquoted.eq_ignore_ascii_case("none") {
        return None;
    }

    Some(unquoted.to_string())
}

fn parse_ssh_g_output(stdout: &str) -> Option<SshConfigOverrides> {
    let mut overrides = SshConfigOverrides::default();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(key) = parts.next() else {
            continue;
        };
        let value_raw = parts.collect::<Vec<_>>().join(" ");
        let Some(value) = normalize_ssh_value(&value_raw) else {
            continue;
        };

        if key.eq_ignore_ascii_case("hostname") {
            overrides.host = Some(value);
            continue;
        }
        if key.eq_ignore_ascii_case("port") {
            if let Ok(port) = value.parse::<u16>() {
                overrides.port = Some(port);
            }
            continue;
        }
        if key.eq_ignore_ascii_case("user") {
            overrides.user = Some(value);
            continue;
        }
        if key.eq_ignore_ascii_case("identityfile") && overrides.identity_file.is_none() {
            let expanded = shellexpand::tilde(&value);
            overrides.identity_file = Some(expanded.to_string());
        }
    }

    if overrides.host.is_none()
        && overrides.port.is_none()
        && overrides.user.is_none()
        && overrides.identity_file.is_none()
    {
        None
    } else {
        Some(overrides)
    }
}

#[cfg(not(target_os = "windows"))]
fn parse_ssh_config_from_file(host: &str) -> Option<SshConfigOverrides> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".ssh/config");
    let contents = std::fs::read_to_string(&config_path).ok()?;
    parse_ssh_config_overrides_from_text(&contents, host)
}

#[cfg(not(target_os = "windows"))]
fn parse_ssh_config_overrides_from_text(contents: &str, host: &str) -> Option<SshConfigOverrides> {
    if let Ok(parsed) = ssh_config::SSHConfig::parse_str(contents) {
        if let Some(overrides) = extract_overrides_for_host(parsed.query(host)) {
            return Some(overrides);
        }
    }

    // The parser crate fails fast on global directives (for example: Include),
    // so fallback to parsing only Host blocks for robust alias support.
    let host_block_only = filter_to_host_blocks(contents);
    if host_block_only.trim().is_empty() {
        return None;
    }

    let parsed = ssh_config::SSHConfig::parse_str(&host_block_only).ok()?;
    extract_overrides_for_host(parsed.query(host))
}

#[cfg(not(target_os = "windows"))]
fn extract_overrides_for_host(host_settings: HashMap<&str, &str>) -> Option<SshConfigOverrides> {
    fn get_case_insensitive<'a>(
        host_settings: &HashMap<&'a str, &'a str>,
        key: &str,
    ) -> Option<&'a str> {
        host_settings.iter().find_map(|(existing_key, value)| {
            if existing_key.eq_ignore_ascii_case(key) {
                Some(*value)
            } else {
                None
            }
        })
    }

    if host_settings.is_empty() {
        return None;
    }

    let mut overrides = SshConfigOverrides::default();
    if let Some(hostname) = get_case_insensitive(&host_settings, "HostName") {
        overrides.host = Some(hostname.to_string());
    }
    if let Some(port) =
        get_case_insensitive(&host_settings, "Port").and_then(|value| value.parse::<u16>().ok())
    {
        overrides.port = Some(port);
    }
    if let Some(user) = get_case_insensitive(&host_settings, "User")
        .or_else(|| get_case_insensitive(&host_settings, "Username"))
    {
        overrides.user = Some(user.to_string());
    }
    if let Some(identity) = get_case_insensitive(&host_settings, "IdentityFile") {
        let expanded = shellexpand::tilde(identity);
        overrides.identity_file = Some(expanded.to_string());
    }

    Some(overrides)
}

#[cfg(not(target_os = "windows"))]
fn filter_to_host_blocks(contents: &str) -> String {
    let mut filtered = String::new();
    let mut in_host_block = false;

    for line in contents.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if in_host_block {
                filtered.push('\n');
            }
            continue;
        }

        if trimmed.starts_with('#') {
            if in_host_block {
                filtered.push_str(line);
                filtered.push('\n');
            }
            continue;
        }

        let first_word = trimmed.split_whitespace().next().unwrap_or_default();
        if first_word.eq_ignore_ascii_case("Host") {
            in_host_block = true;
            filtered.push_str(line);
            filtered.push('\n');
            continue;
        }

        if in_host_block {
            filtered.push_str(line);
            filtered.push('\n');
        }
    }

    filtered
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
    fn parse_ssh_g_output_extracts_core_fields() {
        let output = r#"
host ssh-bastion-key
user sshuser
hostname localhost
port 2223
identityfile ~/.ssh/test_key
"#;

        let overrides = parse_ssh_g_output(output).expect("expected ssh -G overrides");
        assert_eq!(overrides.host.as_deref(), Some("localhost"));
        assert_eq!(overrides.port, Some(2223));
        assert_eq!(overrides.user.as_deref(), Some("sshuser"));
        assert!(overrides
            .identity_file
            .as_deref()
            .is_some_and(|path| path.ends_with("/.ssh/test_key")));
    }

    #[test]
    fn parse_ssh_g_output_handles_case_and_ignores_none_values() {
        let output = r#"
HOSTNAME localhost
PORT 2223
USER sshuser
IdentityFile none
IdentityFile "~/.ssh/real_key"
"#;

        let overrides = parse_ssh_g_output(output).expect("expected ssh -G overrides");
        assert_eq!(overrides.host.as_deref(), Some("localhost"));
        assert_eq!(overrides.port, Some(2223));
        assert_eq!(overrides.user.as_deref(), Some("sshuser"));
        assert!(overrides
            .identity_file
            .as_deref()
            .is_some_and(|path| path.ends_with("/.ssh/real_key")));
    }

    #[test]
    fn parse_ssh_g_output_returns_none_when_no_supported_keys_present() {
        let output = r#"
addressfamily any
compression no
"#;

        let overrides = parse_ssh_g_output(output);
        assert!(overrides.is_none());
    }

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

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parse_ssh_config_handles_global_include_directive() {
        let config = r#"
Include ~/.orbstack/ssh/config

Host ssh-bastion-key
  HostName localhost
  Port 2223
  User sshuser
  IdentityFile ~/.ssh/test_key
"#;

        let overrides = parse_ssh_config_overrides_from_text(config, "ssh-bastion-key")
            .expect("expected parsed overrides");

        assert_eq!(overrides.host.as_deref(), Some("localhost"));
        assert_eq!(overrides.port, Some(2223));
        assert_eq!(overrides.user.as_deref(), Some("sshuser"));
        assert!(overrides
            .identity_file
            .as_deref()
            .is_some_and(|path| path.ends_with("/.ssh/test_key")));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parse_ssh_config_returns_none_for_unknown_alias() {
        let config = r#"
Host ssh-bastion-key
  HostName localhost
  Port 2223
  User sshuser
"#;

        let overrides = parse_ssh_config_overrides_from_text(config, "unknown-host");
        assert!(overrides.is_none());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parse_ssh_config_is_case_insensitive_for_keys() {
        let config = r#"
Host ssh-bastion-key
  hostname localhost
  port 2223
  user sshuser
  identityfile ~/.ssh/test_key
"#;

        let overrides = parse_ssh_config_overrides_from_text(config, "ssh-bastion-key")
            .expect("expected parsed overrides");

        assert_eq!(overrides.host.as_deref(), Some("localhost"));
        assert_eq!(overrides.port, Some(2223));
        assert_eq!(overrides.user.as_deref(), Some("sshuser"));
        assert!(overrides
            .identity_file
            .as_deref()
            .is_some_and(|path| path.ends_with("/.ssh/test_key")));
    }
}
