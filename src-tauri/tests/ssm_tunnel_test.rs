use query_pilot::aws::ssm_tunnel::SsmTunnel;
use query_pilot::error::AppError;
use query_pilot::types::{AwsAuthMethod, AwsSsmConfig};

#[tokio::test]
async fn aws_ssm_tunnel_is_not_yet_supported() {
    let config = AwsSsmConfig {
        target_id: "test".into(),
        region: "us-east-1".into(),
        auth: AwsAuthMethod::AwsProfile {
            profile_name: "default".into(),
        },
        remote_host: "localhost".into(),
        remote_port: 5432,
    };

    let result = SsmTunnel::establish(&config).await;
    assert!(matches!(result, Err(AppError::Unsupported(_))));
}
