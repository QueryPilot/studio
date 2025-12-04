//! ECS Bastion Tunnel module.
//!
//! Implements ephemeral bastion access via ECS Fargate + SSM + SSH:
//! 1. Generate ephemeral SSH keypair
//! 2. Launch ECS Fargate task (bastion server)
//! 3. Wait for task RUNNING status
//! 4. Wait for SSM hybrid activation (task registers itself)
//! 5. Send SSH public key via SSM RunCommand
//! 6. Connect via SSH through SSM tunnel with port forwarding
//! 7. Clean up on disconnect

use std::process::Stdio;
use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials as AwsCredentials;
use aws_sdk_ec2::Client as Ec2Client;
use aws_sdk_ecs::types::{
    AssignPublicIp, AwsVpcConfiguration, ContainerOverride, KeyValuePair, LaunchType,
    NetworkConfiguration, PropagateTags, TaskOverride,
};
use aws_sdk_ecs::Client as EcsClient;
use aws_sdk_ssm::Client as SsmClient;
use aws_types::region::Region;
use aws_types::SdkConfig;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::ssh::{allocate_local_port, is_port_listening};
use crate::types::EcsBastionConfig;

/// Timeout for ECS task to reach RUNNING state
const TASK_RUNNING_TIMEOUT: Duration = Duration::from_secs(120);
/// Timeout for SSM activation to appear
const SSM_ACTIVATION_TIMEOUT: Duration = Duration::from_secs(60);
/// Timeout for SSM command to complete
const SSM_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for SSH tunnel to become ready (increased for ECS startup + SSM activation)
const SSH_READY_TIMEOUT: Duration = Duration::from_secs(90);
/// Poll interval for status checks
const POLL_INTERVAL: Duration = Duration::from_millis(2000);

/// ECS Bastion Tunnel manages the full lifecycle of an ephemeral bastion connection
pub struct EcsBastionTunnel {
    /// Unique identifier for this bastion session
    unique_id: String,
    /// ECS task ARN
    task_arn: String,
    /// SSM managed instance ID (mi-xxxxx)
    instance_id: String,
    /// SSH process handle
    ssh_process: Option<Child>,
    /// Local port for database connection
    local_port: u16,
    /// AWS SDK config for API calls
    sdk_config: SdkConfig,
    /// ECS cluster name for cleanup
    cluster_name: String,
}

impl EcsBastionTunnel {
    /// Establish an ECS bastion tunnel
    pub async fn establish(
        app_handle: &AppHandle,
        config: &EcsBastionConfig,
        credentials: AwsCredentials,
    ) -> Result<Self> {
        let unique_id = Uuid::new_v4().to_string();
        tracing::info!("Starting ECS bastion tunnel with ID: {}", unique_id);

        // Build AWS SDK config with provided credentials
        let sdk_config = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials.clone())
            .load()
            .await;

        let ecs_client = EcsClient::new(&sdk_config);
        let ssm_client = SsmClient::new(&sdk_config);
        let ec2_client = Ec2Client::new(&sdk_config);

        // Step 1: Generate ephemeral SSH keypair
        tracing::info!("Generating ephemeral SSH keypair");
        let (private_key, public_key) = generate_ssh_keypair()?;

        // Step 2: Discover network configuration
        tracing::info!("Discovering VPC network configuration");
        let (subnet_ids, security_group_ids) = discover_network_config(&ec2_client, config).await?;

        // Step 3: Launch ECS task
        tracing::info!("Launching ECS Fargate task");
        let task_arn = launch_ecs_task(
            &ecs_client,
            config,
            &unique_id,
            &subnet_ids,
            &security_group_ids,
        )
        .await?;

        // Step 4: Wait for task to be RUNNING
        tracing::info!("Waiting for ECS task to reach RUNNING state");
        wait_for_task_running(&ecs_client, &config.cluster_name, &task_arn).await?;

        // Step 5: Wait for SSM activation
        tracing::info!("Waiting for SSM hybrid activation");
        let instance_id = wait_for_ssm_activation(&ssm_client, &unique_id).await?;

        // Step 6: Install SSH public key via SSM command
        tracing::info!("Installing SSH public key on bastion");
        install_ssh_key(&ssm_client, &instance_id, &public_key).await?;

        // Step 7: Allocate local port
        let local_port = allocate_local_port()
            .map_err(|e| AppError::SshTunnelError(format!("Failed to allocate local port: {e}")))?;

        // Step 8: Start SSH tunnel via SSM
        tracing::info!(
            "Starting SSH tunnel via SSM to {}:{}",
            config.remote_host,
            config.remote_port
        );
        let ssh_process = start_ssh_tunnel(
            app_handle,
            &instance_id,
            &private_key,
            &credentials,
            &config.region,
            local_port,
            &config.remote_host,
            config.remote_port,
        )
        .await?;

        // Step 9: Wait for local port to be listening
        tracing::info!("Waiting for SSH tunnel to be ready on port {}", local_port);
        wait_for_port_ready(local_port).await?;

        tracing::info!("ECS bastion tunnel established. Local port: {}", local_port);

        Ok(Self {
            unique_id,
            task_arn,
            instance_id,
            ssh_process: Some(ssh_process),
            local_port,
            sdk_config,
            cluster_name: config.cluster_name.clone(),
        })
    }

    /// Get the local port for database connections
    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    /// Close the tunnel and clean up resources
    pub async fn close(mut self) -> Result<()> {
        tracing::info!("Closing ECS bastion tunnel: {}", self.unique_id);

        // Kill SSH process
        if let Some(mut process) = self.ssh_process.take() {
            let _ = process.kill().await;
            let _ = process.wait().await;
        }

        // Stop ECS task
        let ecs_client = EcsClient::new(&self.sdk_config);
        if let Err(e) = ecs_client
            .stop_task()
            .cluster(&self.cluster_name)
            .task(&self.task_arn)
            .reason("Query Pilot session ended")
            .send()
            .await
        {
            tracing::warn!("Failed to stop ECS task: {}", e);
        }

        // Deregister SSM managed instance
        let ssm_client = SsmClient::new(&self.sdk_config);
        if let Err(e) = ssm_client
            .deregister_managed_instance()
            .instance_id(&self.instance_id)
            .send()
            .await
        {
            tracing::warn!("Failed to deregister SSM instance: {}", e);
        }

        Ok(())
    }
}

impl Drop for EcsBastionTunnel {
    fn drop(&mut self) {
        // Emergency cleanup - kill SSH process
        if let Some(process) = self.ssh_process.take() {
            let _ = std::process::Command::new("kill")
                .arg("-9")
                .arg(process.id().unwrap_or(0).to_string())
                .spawn();
        }
    }
}

/// Generate an ephemeral Ed25519 SSH keypair
fn generate_ssh_keypair() -> Result<(String, String)> {
    use ssh_key::{Algorithm, LineEnding, PrivateKey};

    // Use Ed25519 for ephemeral keys - faster, more secure, and simpler than RSA
    let private_key = PrivateKey::random(&mut rand::thread_rng(), Algorithm::Ed25519)
        .map_err(|e| AppError::Internal(format!("Failed to generate SSH key: {e}")))?;

    let private_pem = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|e| AppError::Internal(format!("Failed to encode private key: {e}")))?
        .to_string();

    let public_key = private_key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::Internal(format!("Failed to encode public key: {e}")))?;

    Ok((private_pem, public_key))
}

/// Discover VPC subnets and security groups for bastion placement
async fn discover_network_config(
    ec2_client: &Ec2Client,
    config: &EcsBastionConfig,
) -> Result<(Vec<String>, Vec<String>)> {
    // Discover subnets by tag
    let subnet_tags = if config.subnet_tags.is_empty() {
        vec!["private-a".to_string(), "private-b".to_string()]
    } else {
        config.subnet_tags.clone()
    };

    let subnet_filter = aws_sdk_ec2::types::Filter::builder()
        .name("tag:Name")
        .set_values(Some(subnet_tags))
        .build();

    let subnets_response = ec2_client
        .describe_subnets()
        .filters(subnet_filter)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to describe subnets: {e}")))?;

    let subnet_ids: Vec<String> = subnets_response
        .subnets()
        .iter()
        .filter_map(|s| s.subnet_id().map(|id| id.to_string()))
        .collect();

    if subnet_ids.is_empty() {
        return Err(AppError::Internal(
            "No subnets found matching the configured tags".into(),
        ));
    }

    // Discover security group by tag
    let sg_tag = config
        .security_group_tag
        .as_deref()
        .unwrap_or("Bastion=SSM");
    let (tag_key, tag_value) = sg_tag.split_once('=').unwrap_or(("Bastion", "SSM"));

    let sg_filter = aws_sdk_ec2::types::Filter::builder()
        .name(format!("tag:{}", tag_key))
        .values(tag_value)
        .build();

    let sgs_response = ec2_client
        .describe_security_groups()
        .filters(sg_filter)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to describe security groups: {e}")))?;

    let security_group_ids: Vec<String> = sgs_response
        .security_groups()
        .iter()
        .filter_map(|sg| sg.group_id().map(|id| id.to_string()))
        .collect();

    if security_group_ids.is_empty() {
        return Err(AppError::Internal(format!(
            "No security group found with tag {}={}",
            tag_key, tag_value
        )));
    }

    Ok((subnet_ids, security_group_ids))
}

/// Launch ECS Fargate task
async fn launch_ecs_task(
    ecs_client: &EcsClient,
    config: &EcsBastionConfig,
    unique_id: &str,
    subnet_ids: &[String],
    security_group_ids: &[String],
) -> Result<String> {
    let network_config = NetworkConfiguration::builder()
        .awsvpc_configuration(
            AwsVpcConfiguration::builder()
                .set_subnets(Some(subnet_ids.to_vec()))
                .set_security_groups(Some(security_group_ids.to_vec()))
                .assign_public_ip(AssignPublicIp::Disabled)
                .build()
                .map_err(|e| AppError::Internal(format!("Invalid VPC config: {e}")))?,
        )
        .build();

    // Container environment overrides
    let container_override = ContainerOverride::builder()
        .name("bastion") // Assumes container is named "bastion" in task def
        .environment(
            KeyValuePair::builder()
                .name("UNIQUE_ID")
                .value(unique_id)
                .build(),
        )
        .build();

    let task_override = TaskOverride::builder()
        .container_overrides(container_override)
        .build();

    let response = ecs_client
        .run_task()
        .cluster(&config.cluster_name)
        .task_definition(&config.task_definition)
        .launch_type(LaunchType::Fargate)
        .network_configuration(network_config)
        .overrides(task_override)
        .propagate_tags(PropagateTags::TaskDefinition)
        .reference_id(unique_id)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to launch ECS task: {e}")))?;

    let task = response
        .tasks()
        .first()
        .ok_or_else(|| AppError::Internal("No task returned from ECS RunTask".into()))?;

    let task_arn = task
        .task_arn()
        .ok_or_else(|| AppError::Internal("Task missing ARN".into()))?
        .to_string();

    // Check for failures
    if !response.failures().is_empty() {
        let failure = &response.failures()[0];
        return Err(AppError::Internal(format!(
            "ECS task launch failed: {} - {}",
            failure.reason().unwrap_or("unknown"),
            failure.detail().unwrap_or("")
        )));
    }

    Ok(task_arn)
}

/// Wait for ECS task to reach RUNNING state
async fn wait_for_task_running(
    ecs_client: &EcsClient,
    cluster_name: &str,
    task_arn: &str,
) -> Result<()> {
    timeout(TASK_RUNNING_TIMEOUT, async {
        loop {
            let response = ecs_client
                .describe_tasks()
                .cluster(cluster_name)
                .tasks(task_arn)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to describe task: {e}")))?;

            if let Some(task) = response.tasks().first() {
                let status = task.last_status().unwrap_or_default();
                tracing::debug!("ECS task status: {}", status);

                match status {
                    "RUNNING" => return Ok(()),
                    "STOPPED" | "DEPROVISIONING" => {
                        let reason = task.stopped_reason().unwrap_or("unknown");
                        return Err(AppError::Internal(format!(
                            "ECS task stopped unexpectedly: {}",
                            reason
                        )));
                    }
                    _ => {} // PENDING, PROVISIONING, etc - keep waiting
                }
            }

            sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .map_err(|_| AppError::Internal("Timeout waiting for ECS task to start".into()))?
}

/// Wait for SSM hybrid activation with matching unique ID
async fn wait_for_ssm_activation(ssm_client: &SsmClient, unique_id: &str) -> Result<String> {
    timeout(SSM_ACTIVATION_TIMEOUT, async {
        loop {
            // Find activation with our unique ID tag
            let activations = ssm_client
                .describe_activations()
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to describe activations: {e}")))?;

            for activation in activations.activation_list() {
                let has_matching_tag = activation
                    .tags()
                    .iter()
                    .any(|tag| tag.key() == "UniqueId" && tag.value() == unique_id);

                if has_matching_tag {
                    // Now find the instance registered with this activation
                    let activation_id = activation
                        .activation_id()
                        .ok_or_else(|| AppError::Internal("Activation missing ID".into()))?;

                    // Brief delay for registration propagation
                    sleep(Duration::from_secs(3)).await;

                    let instances = ssm_client
                        .describe_instance_information()
                        .filters(
                            aws_sdk_ssm::types::InstanceInformationStringFilter::builder()
                                .key("ActivationIds")
                                .values(activation_id)
                                .build()
                                .map_err(|e| AppError::Internal(format!("Invalid filter: {e}")))?,
                        )
                        .send()
                        .await
                        .map_err(|e| {
                            AppError::Internal(format!("Failed to describe instances: {e}"))
                        })?;

                    if let Some(instance) = instances.instance_information_list().first() {
                        if let Some(instance_id) = instance.instance_id() {
                            return Ok(instance_id.to_string());
                        }
                    }
                }
            }

            tracing::debug!("Waiting for SSM activation...");
            sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .map_err(|_| AppError::Internal("Timeout waiting for SSM activation".into()))?
}

/// Install SSH public key on bastion via SSM RunCommand
async fn install_ssh_key(
    ssm_client: &SsmClient,
    instance_id: &str,
    public_key: &str,
) -> Result<()> {
    let command = format!(
        r#"/usr/local/bin/configure-key '{}'"#,
        public_key.replace('\'', "'\\''") // Escape single quotes
    );

    let response = ssm_client
        .send_command()
        .instance_ids(instance_id)
        .document_name("AWS-RunShellScript")
        .parameters("commands", vec![command])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send SSM command: {e}")))?;

    let command_id = response
        .command()
        .and_then(|c| c.command_id())
        .ok_or_else(|| AppError::Internal("SSM command missing ID".into()))?
        .to_string();

    // Wait for command to complete
    timeout(SSM_COMMAND_TIMEOUT, async {
        loop {
            let invocation = ssm_client
                .get_command_invocation()
                .command_id(&command_id)
                .instance_id(instance_id)
                .send()
                .await;

            match invocation {
                Ok(inv) => {
                    let status = inv.status().map(|s| s.as_str()).unwrap_or("Unknown");
                    match status {
                        "Success" => return Ok(()),
                        "Failed" | "Cancelled" | "TimedOut" => {
                            let stderr = inv.standard_error_content().unwrap_or("");
                            return Err(AppError::Internal(format!(
                                "SSH key installation failed: {}",
                                stderr
                            )));
                        }
                        _ => {} // InProgress, Pending, etc
                    }
                }
                Err(e) => {
                    // May get InvocationDoesNotExist initially
                    tracing::debug!("Waiting for command invocation: {}", e);
                }
            }

            sleep(Duration::from_secs(1)).await;
        }
    })
    .await
    .map_err(|_| AppError::Internal("Timeout waiting for SSH key installation".into()))?
}

/// Start SSH tunnel via SSM ProxyCommand
async fn start_ssh_tunnel(
    app_handle: &AppHandle,
    instance_id: &str,
    private_key: &str,
    credentials: &AwsCredentials,
    region: &str,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> Result<Child> {
    // Write private key to temp file
    let key_file = std::env::temp_dir().join(format!("qp_ssh_{}.pem", Uuid::new_v4()));
    std::fs::write(&key_file, private_key)
        .map_err(|e| AppError::Internal(format!("Failed to write SSH key: {e}")))?;

    // Set permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| AppError::Internal(format!("Failed to set key permissions: {e}")))?;
    }

    // Resolve the bundled session-manager-plugin path and add to PATH
    let plugin_path = resolve_plugin_path(app_handle)?;
    let plugin_dir = plugin_path
        .parent()
        .ok_or_else(|| AppError::Internal("Invalid plugin path".into()))?;

    // Build PATH with plugin directory prepended
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", plugin_dir.display(), current_path);

    // Build ProxyCommand using aws ssm start-session (not direct plugin invocation)
    // The AWS CLI handles all the SSM API interaction and invokes the plugin properly
    // IMPORTANT: Must be wrapped with `sh -c "..."` for proper shell execution
    // Region is passed via AWS_DEFAULT_REGION environment variable
    let proxy_command = r#"sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'""#;

    let mut command = Command::new("ssh");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Match SSH config options from working ecs-ssm-bastion client
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-o")
        .arg("PubkeyAuthentication=yes")
        .arg("-o")
        .arg("IdentitiesOnly=yes")
        .arg("-o")
        .arg("LogLevel=ERROR")
        .arg("-o")
        .arg(format!("ProxyCommand={}", proxy_command))
        .arg("-i")
        .arg(&key_file)
        .arg("-N") // No remote command
        .arg("-L")
        .arg(format!(
            "0.0.0.0:{}:{}:{}",
            local_port, remote_host, remote_port
        ))
        .arg(format!("root@{}", instance_id));

    // Set PATH with bundled plugin directory
    command.env("PATH", new_path);

    // Set AWS credentials in environment
    command.env("AWS_ACCESS_KEY_ID", credentials.access_key_id());
    command.env("AWS_SECRET_ACCESS_KEY", credentials.secret_access_key());
    if let Some(token) = credentials.session_token() {
        command.env("AWS_SESSION_TOKEN", token);
    }
    command.env("AWS_DEFAULT_REGION", region);
    command.env("AWS_REGION", region);

    let mut child = command
        .spawn()
        .map_err(|e| AppError::SshTunnelError(format!("Failed to spawn SSH process: {e}")))?;

    // Monitor stderr for errors in background
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("SSH stderr: {}", line);
            }
        });
    }

    // Clean up key file after a delay (SSH has read it)
    let key_file_clone = key_file.clone();
    tokio::spawn(async move {
        sleep(Duration::from_secs(5)).await;
        let _ = std::fs::remove_file(key_file_clone);
    });

    Ok(child)
}

/// Wait for local port to start listening
async fn wait_for_port_ready(port: u16) -> Result<()> {
    timeout(SSH_READY_TIMEOUT, async {
        loop {
            if is_port_listening(port).await {
                return Ok(());
            }
            sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .map_err(|_| {
        AppError::SshTunnelError(format!(
            "SSH tunnel failed to become ready on port {} within {} seconds",
            port,
            SSH_READY_TIMEOUT.as_secs()
        ))
    })?
}

/// Resolve session-manager-plugin path from bundled sidecars
fn resolve_plugin_path(app_handle: &AppHandle) -> Result<std::path::PathBuf> {
    // In dev mode, the plugin is in target/debug or target/release
    // In production, it's in the Resources directory
    const CANDIDATES: &[&str] = &[
        "session-manager-plugin",
        "session-manager-plugin-aarch64-apple-darwin",
        "session-manager-plugin-x86_64-apple-darwin",
        "session-manager-plugin-x86_64-unknown-linux-gnu",
        "session-manager-plugin-x86_64-pc-windows-msvc.exe",
    ];

    for candidate in CANDIDATES {
        if let Ok(path) = app_handle
            .path()
            .resolve(candidate, BaseDirectory::Resource)
        {
            if path.exists() {
                tracing::debug!("Found session-manager-plugin at: {}", path.display());
                return Ok(path);
            }
        }
    }

    Err(AppError::Internal(
        "session-manager-plugin not found in application bundle. Run 'scripts/download-ssm-plugin.sh' to download it.".into(),
    ))
}
