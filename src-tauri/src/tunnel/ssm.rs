use crate::tunnel::AwsCredentials;
use anyhow::{bail, Context, Result};
use std::time::Duration;
use tokio::process::Child;

pub struct SsmBastionTunnel {
    local_port: u16,
    ecs_task_arn: String,
    ssm_instance_id: String,
    ssh_process: Child,
    #[allow(dead_code)]
    region: String,
    _key_dir: tempfile::TempDir,
}

impl SsmBastionTunnel {
    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub async fn health_check(&self) -> Result<()> {
        if crate::ssh::is_port_listening(self.local_port).await {
            Ok(())
        } else {
            bail!("SSM tunnel port {} not listening", self.local_port)
        }
    }

    pub async fn close(mut self) -> Result<()> {
        let _ = self.ssh_process.kill().await;
        let _ = self.ssh_process.wait().await;
        tracing::info!(
            "SSM bastion tunnel closed (task: {}, instance: {})",
            self.ecs_task_arn,
            self.ssm_instance_id
        );
        Ok(())
    }
}

pub async fn establish(
    credentials: &AwsCredentials,
    cluster_name: Option<&str>,
    task_definition: Option<&str>,
    region: &str,
    remote_host: &str,
    remote_port: u16,
) -> Result<SsmBastionTunnel> {
    let cluster = cluster_name.unwrap_or("ecs-ssm-bastion-cluster");
    let task_def = task_definition.unwrap_or("ecs-ssm-bastion");

    // Step 1: Generate RSA keypair
    let private_key = ssh_key::PrivateKey::random(
        &mut rand::thread_rng(),
        ssh_key::Algorithm::Rsa { hash: None },
    )
    .context("Failed to generate RSA keypair")?;
    let public_key_openssh = private_key
        .public_key()
        .to_openssh()
        .context("Failed to format public key")?;

    // Build AWS SDK config
    let sdk_config = build_aws_config(credentials, region).await;
    let ecs_client = aws_sdk_ecs::Client::new(&sdk_config);
    let ssm_client = aws_sdk_ssm::Client::new(&sdk_config);

    // Step 2: Discover subnet and security group
    let (subnet_id, security_group_id) = discover_network(&ssm_client).await?;

    // Step 3: Launch ECS task
    let unique_id = uuid::Uuid::new_v4().to_string();
    tracing::info!("Launching bastion ECS task with ID: {}", unique_id);

    let run_task_resp = ecs_client
        .run_task()
        .cluster(cluster)
        .task_definition(task_def)
        .launch_type(aws_sdk_ecs::types::LaunchType::Fargate)
        .network_configuration(
            aws_sdk_ecs::types::NetworkConfiguration::builder()
                .awsvpc_configuration(
                    aws_sdk_ecs::types::AwsVpcConfiguration::builder()
                        .subnets(&subnet_id)
                        .security_groups(&security_group_id)
                        .assign_public_ip(aws_sdk_ecs::types::AssignPublicIp::Disabled)
                        .build()
                        .context("Failed to build VPC config")?,
                )
                .build(),
        )
        .overrides(
            aws_sdk_ecs::types::TaskOverride::builder()
                .container_overrides(
                    aws_sdk_ecs::types::ContainerOverride::builder()
                        .name("ecs-ssm-bastion")
                        .environment(
                            aws_sdk_ecs::types::KeyValuePair::builder()
                                .name("UNIQUE_ID")
                                .value(&unique_id)
                                .build(),
                        )
                        .build(),
                )
                .build(),
        )
        .send()
        .await
        .context("ECS RunTask failed")?;

    let task = run_task_resp
        .tasks()
        .first()
        .context("No task returned from RunTask")?;
    let task_arn = task.task_arn().context("No task ARN")?.to_string();

    // Step 4: Wait for RUNNING
    let task_arn_clone = task_arn.clone();
    let cluster_str = cluster.to_string();
    wait_for_bool(Duration::from_secs(90), Duration::from_secs(2), || {
        let ecs = ecs_client.clone();
        let ta = task_arn_clone.clone();
        let cl = cluster_str.clone();
        async move {
            let desc = ecs.describe_tasks().cluster(&cl).tasks(&ta).send().await?;
            let status = desc
                .tasks()
                .first()
                .and_then(|t| t.last_status())
                .unwrap_or("UNKNOWN");
            if status == "RUNNING" {
                Ok(true)
            } else if status == "STOPPED" || status == "DEPROVISIONING" {
                bail!("ECS task stopped unexpectedly: {}", status);
            } else {
                Ok(false)
            }
        }
    })
    .await
    .context("Timed out waiting for ECS task to reach RUNNING")?;

    // Step 5: Wait for SSM instance registration
    let unique_id_clone = unique_id.clone();
    let ssm_instance_id = wait_for_value(Duration::from_secs(60), Duration::from_secs(2), || {
        let ssm = ssm_client.clone();
        let uid = unique_id_clone.clone();
        async move {
            let instances = ssm
                .describe_instance_information()
                .filters(
                    aws_sdk_ssm::types::InstanceInformationStringFilter::builder()
                        .key("tag:UniqueId")
                        .values(&uid)
                        .build()
                        .context("Failed to build SSM filter")?,
                )
                .send()
                .await?;
            if let Some(instance) = instances.instance_information_list().first() {
                if let Some(id) = instance.instance_id() {
                    return Ok(Some(id.to_string()));
                }
            }
            Ok(None)
        }
    })
    .await
    .context("Timed out waiting for SSM instance registration")?;

    tracing::info!("SSM instance registered: {}", ssm_instance_id);

    // Step 6: Send public key via SSM
    ssm_client
        .send_command()
        .instance_ids(&ssm_instance_id)
        .document_name("AWS-RunShellScript")
        .parameters(
            "commands",
            vec![format!(
                "/usr/local/bin/configure-key '{}'",
                public_key_openssh
            )],
        )
        .send()
        .await
        .context("Failed to send public key via SSM")?;

    tokio::time::sleep(Duration::from_secs(2)).await;

    // Step 7: Allocate local port and start SSH tunnel
    let local_port = crate::ssh::allocate_local_port().context("Failed to allocate local port")?;

    // Write private key to temp file
    let key_dir = tempfile::tempdir().context("Failed to create temp dir")?;
    let key_path = key_dir.path().join("bastion_key");
    use ssh_key::LineEnding;
    let key_pem = private_key
        .to_openssh(LineEnding::LF)
        .context("Failed to serialize private key")?;
    std::fs::write(&key_path, key_pem.as_bytes()).context("Failed to write private key")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
    }

    let ssh_process = tokio::process::Command::new("ssh")
        .args([
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
            "-o",
            &format!(
                "ProxyCommand=session-manager-plugin '{{\"Target\":\"{}\",\"DocumentName\":\"AWS-StartSSHSession\",\"Parameters\":{{\"portNumber\":[\"22\"]}}}}' {} StartSession '' '{{\"Target\":\"{}\"}}'",
                ssm_instance_id, region, ssm_instance_id
            ),
            "-i",
            key_path.to_str().unwrap(),
            "-N",
            "-L",
            &format!("127.0.0.1:{}:{}:{}", local_port, remote_host, remote_port),
            &format!("root@{}", ssm_instance_id),
        ])
        // AWS credentials are passed via env vars — this is the only supported mechanism
        // for session-manager-plugin when used as an SSH ProxyCommand. Credential files
        // cannot be used here as they would overwrite the user's ~/.aws/credentials.
        // On macOS, process env vars are not accessible to other users without root.
        // These are short-lived session credentials, not long-lived keys.
        .env("AWS_ACCESS_KEY_ID", &credentials.access_key_id)
        .env("AWS_SECRET_ACCESS_KEY", &credentials.secret_access_key)
        .env(
            "AWS_SESSION_TOKEN",
            credentials.session_token.as_deref().unwrap_or(""),
        )
        .env("AWS_DEFAULT_REGION", region)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("Failed to start SSH tunnel via session-manager-plugin. Is session-manager-plugin installed?")?;

    // Step 8: Wait for port to be listening
    wait_for_bool(Duration::from_secs(30), Duration::from_millis(500), || {
        let p = local_port;
        async move { Ok(crate::ssh::is_port_listening(p).await) }
    })
    .await
    .context("SSH tunnel via SSM never started listening")?;

    tracing::info!("SSM bastion tunnel established on port {}", local_port);

    Ok(SsmBastionTunnel {
        local_port,
        ecs_task_arn: task_arn,
        ssm_instance_id,
        ssh_process,
        region: region.to_string(),
        _key_dir: key_dir,
    })
}

async fn build_aws_config(creds: &AwsCredentials, region: &str) -> aws_config::SdkConfig {
    aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .credentials_provider(StaticCreds::new(creds))
        .load()
        .await
}

async fn discover_network(ssm_client: &aws_sdk_ssm::Client) -> Result<(String, String)> {
    let subnet_param = ssm_client
        .get_parameter()
        .name("/base-infra/core/vpc-subnet-private-ids")
        .send()
        .await
        .context("Failed to get subnet parameter")?;
    let subnet_ids_str = subnet_param
        .parameter()
        .and_then(|p| p.value())
        .context("No subnet value")?;
    let subnet_id = subnet_ids_str
        .split(',')
        .next()
        .context("Empty subnet list")?
        .trim()
        .to_string();

    let sg_param = ssm_client
        .get_parameter()
        .name("/base-infra/ecs-ssm-bastion/security-group-id")
        .send()
        .await
        .context("Failed to get security group parameter")?;
    let sg_id = sg_param
        .parameter()
        .and_then(|p| p.value())
        .context("No SG value")?
        .to_string();

    Ok((subnet_id, sg_id))
}

async fn wait_for_bool<F, Fut>(timeout: Duration, interval: Duration, check: F) -> Result<()>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<bool>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        match check().await {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(e) if tokio::time::Instant::now() >= deadline => return Err(e),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            bail!("Timed out");
        }
        tokio::time::sleep(interval).await;
    }
}

async fn wait_for_value<F, Fut, T>(timeout: Duration, interval: Duration, check: F) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<Option<T>>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        match check().await {
            Ok(Some(val)) => return Ok(val),
            Ok(None) => {}
            Err(e) if tokio::time::Instant::now() >= deadline => return Err(e),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            bail!("Timed out");
        }
        tokio::time::sleep(interval).await;
    }
}

#[derive(Debug)]
struct StaticCreds {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

impl StaticCreds {
    fn new(creds: &AwsCredentials) -> Self {
        Self {
            access_key_id: creds.access_key_id.clone(),
            secret_access_key: creds.secret_access_key.clone(),
            session_token: creds.session_token.clone(),
        }
    }
}

impl aws_credential_types::provider::ProvideCredentials for StaticCreds {
    fn provide_credentials<'a>(
        &'a self,
    ) -> aws_credential_types::provider::future::ProvideCredentials<'a>
    where
        Self: 'a,
    {
        aws_credential_types::provider::future::ProvideCredentials::ready(Ok(
            aws_credential_types::Credentials::new(
                &self.access_key_id,
                &self.secret_access_key,
                self.session_token.clone(),
                None,
                "query-pilot-tunnel",
            ),
        ))
    }
}
