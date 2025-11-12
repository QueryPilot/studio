# SSH Tunnels & AWS SSM Bastion User Guide

This guide covers how to connect to databases through SSH tunnels and AWS Systems Manager (SSM) bastions in Query Pilot.

## Table of Contents

- [SSH Tunnels](#ssh-tunnels)
  - [Key-Based Authentication](#key-based-authentication)
  - [SSH Agent](#ssh-agent)
  - [Password Authentication](#password-authentication)
  - [SSH Config File](#ssh-config-file)
- [AWS SSM Bastions](#aws-ssm-bastions)
  - [Prerequisites](#prerequisites)
  - [AWS Profile Authentication](#aws-profile-authentication)
  - [SSO / OAuth Authentication](#sso--oauth-authentication)
- [Testing Connections](#testing-connections)
- [Troubleshooting](#troubleshooting)

---

## SSH Tunnels

SSH tunnels allow you to securely connect to databases that are not directly accessible from your machine. Query Pilot establishes a local port forward through an SSH bastion host.

### Key-Based Authentication

**Recommended approach** for security and convenience.

1. Open the connection dialog and enable **SSH Tunnel**
2. Fill in the SSH bastion details:
   - **Host**: Your SSH bastion hostname or IP
   - **Port**: SSH port (default: 22)
   - **User**: SSH username
3. Check **Use Key File**
4. Click **Browse** to select your private key file (e.g., `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`)
5. If your key is encrypted, enter the **Passphrase**

**Supported Key Types:**
- RSA (2048-bit or higher)
- Ed25519 ✨ (recommended for security and performance)
- ECDSA (P-256, P-384, P-521)

**Note:** Query Pilot uses the `ssh2` library (libssh2 v1.11.1), ensuring compatibility with all standard OpenSSH key formats including RSA, Ed25519, and ECDSA.

### SSH Agent

**Best for convenience** – no need to enter passphrases repeatedly.

1. Ensure your SSH agent is running and your key is added:
   ```bash
   # Start SSH agent (if not running)
   eval "$(ssh-agent -s)"
   
   # Add your key
   ssh-add ~/.ssh/id_ed25519
   ```

2. In Query Pilot:
   - Enable **SSH Tunnel**
   - Check **Use SSH Agent**
   - The agent will automatically provide your keys

### Password Authentication

**Not supported** for security reasons. Please use key-based authentication or SSH agent.

If you must use passwords, configure your SSH bastion to accept key auth and use one of the methods above.

### SSH Config File

Query Pilot automatically reads `~/.ssh/config` and applies matching configuration:

```ssh-config
Host prod-bastion
    HostName 203.0.113.42
    User ubuntu
    Port 2222
    IdentityFile ~/.ssh/prod_key
```

When you enter `prod-bastion` as the SSH host, Query Pilot will:
- Resolve the actual hostname
- Use the configured user and port
- Auto-select the identity file

---

## AWS SSM Bastions

AWS Systems Manager Session Manager provides secure, auditable access to EC2 instances or ECS tasks without exposing SSH ports.

### Prerequisites

1. **AWS SSM Session Manager Plugin**: Query Pilot bundles this automatically for all platforms
2. **AWS IAM Permissions**: Your AWS role/profile must have:
   - `ssm:StartSession`
   - `ssm:TerminateSession`
   - Access to the target instance/task

### AWS Profile Authentication

**Simplest approach** if you have AWS CLI configured:

1. Configure your AWS profile:
   ```bash
   aws configure --profile my-profile
   ```

2. In Query Pilot:
   - Enable **AWS SSM Bastion**
   - Set **Authentication Method** to **AWS Profile**
   - Enter your **Profile Name** (e.g., `my-profile` or `default`)
   - Fill in:
     - **Region**: AWS region (e.g., `us-east-1`)
     - **Target ID**: Instance ID (e.g., `i-0123456789abcdef0`) or ECS task ARN
     - **Remote Host**: Database hostname (as seen from the bastion)
     - **Remote Port**: Database port

### SSO / OAuth Authentication

**For enterprise SSO** (Microsoft Entra ID, Google Workspace, Okta, etc.):

1. In Query Pilot:
   - Enable **AWS SSM Bastion**
   - Set **Authentication Method** to **SSO / OAuth**
   - Select your **SSO Provider**
   - Enter your **Client ID** (from your OAuth app registration)
   - For Microsoft: optionally provide **Tenant ID**
   - Enter **AWS IAM Role ARN** to assume after authentication

2. **OAuth Flow** (coming soon):
   - Currently, you must configure OAuth tokens via the AWS CLI
   - Future versions will support in-app device code flow

**Example Role ARN:**
```
arn:aws:iam::123456789012:role/SSMAccessRole
```

This role should have a trust policy allowing web identity federation:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity"
  }]
}
```

---

## Testing Connections

The **Test** button performs a unified flow:

1. **Bastion Test** (if enabled):
   - SSH tunnel: Verifies SSH connection and host key
   - AWS SSM: Validates credentials and starts a session

2. **Database Test**:
   - Connects to the database through the tunnel
   - Executes a simple query to verify connectivity

**Status Indicators:**
- 🔵 **Establishing SSH tunnel...** – SSH handshake in progress
- 🟢 **SSH tunnel ok** – Tunnel established successfully
- 🔵 **Connecting to database...** – Database connection in progress
- ✅ **Success** – Database is reachable

---

## Troubleshooting

See [SSH & SSM Troubleshooting Guide](./ssh-and-ssm-troubleshooting.md) for common issues and solutions.

### Quick Checks

1. **SSH tunnel fails:**
   - Verify SSH host/port/user are correct
   - Check that your private key matches the public key on the bastion
   - Ensure the bastion allows SSH connections from your IP

2. **Database connection fails after SSH succeeds:**
   - Verify the database host/port are reachable **from the bastion**
   - Check database credentials (username/password)
   - Ensure the database allows connections from the bastion's IP

3. **AWS SSM fails:**
   - Verify your AWS credentials are valid
   - Check that the target instance/task is running
   - Ensure SSM agent is running on the target
   - Confirm IAM permissions for `ssm:StartSession`

---

## Security Best Practices

✅ **Do:**
- Use Ed25519 keys for best security and performance
- Encrypt your SSH private keys with strong passphrases
- Use SSH agent to avoid storing passphrases in memory
- Leverage AWS SSM for auditable, keyless access
- Rotate your SSH keys and AWS credentials regularly

❌ **Don't:**
- Share SSH private keys between team members
- Use unencrypted private keys in production environments
- Store passphrases in plain text
- Use password-based SSH authentication

---

## Additional Resources

- [OpenSSH Documentation](https://www.openssh.com/manual.html)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [SSH Config File Reference](https://man.openbsd.org/ssh_config)

---

**Need Help?** Open an issue on [GitHub](https://github.com/yourusername/query-pilot/issues) or check the [troubleshooting guide](./ssh-and-ssm-troubleshooting.md).


