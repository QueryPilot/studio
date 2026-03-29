use crate::ssh::SshTunnel;
use crate::types::SshTunnelConfig;
use anyhow::Result;

pub async fn establish(
    config: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
) -> Result<SshTunnel> {
    Ok(SshTunnel::establish(config, remote_host, remote_port).await?)
}
