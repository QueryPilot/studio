# SSH & AWS SSM Bastion Support - Implementation Summary

**Status**: ✅ Complete (Phase 1)  
**Version**: 0.2.0  
**Date**: November 11, 2025

## Overview

Query Pilot now supports connecting to databases through:
1. **SSH Tunnels** – Traditional SSH port forwarding with key-based authentication
2. **AWS SSM Bastions** – AWS Systems Manager Session Manager (foundation in place)

## What's Implemented

### ✅ Backend (Rust)

#### SSH Module (`src-tauri/src/ssh/`)
- **Core tunneling** (`tunnel.rs`): `ssh2`-based async SSH with port forwarding, health checks, and concurrent connections
- **Key support**: RSA, Ed25519, ECDSA natively supported via libssh2 v1.11.1
- **SSH config** (`mod.rs`): Automatic parsing of `~/.ssh/config`
- **Known hosts** (`mod.rs`): Strict host key verification with `KnownHosts::Strict`
- **Secrets storage** (`secrets.rs`): OS keychain integration for passphrases (via `keyring`)
- **Rate limiting** (`rate_limiter.rs`): Prevents brute-force testing

**Supported Authentication**:
- ✅ SSH Agent (recommended)
- ✅ Unencrypted key files
- ❌ Password auth (rejected for security)
- ❌ Encrypted keys without agent (rejected - use agent instead)

#### AWS Module (`src-tauri/src/aws/`)
- **SSM Tunnel** (`ssm_tunnel.rs`): Skeleton implementation with AWS SDK integration
- **OAuth/OIDC** (`oauth.rs`): Generic OAuth token storage (device flow TODO)
- **Vendored plugin**: `session-manager-plugin` bundled for all platforms (Linux, macOS x64/ARM, Windows)

#### Connection Manager
- **`ManagedTunnel` enum**: Unified interface for SSH and SSM tunnels
- **`BastionConfig` support**: Handles both `Ssh` and `AwsSsm` variants
- **Health checks**: Auto-reconnect on tunnel failure
- **Lifecycle management**: Tunnels created on-demand, cleaned up on disconnect

#### Tauri Commands
- `test_ssh_connection`: Verify SSH tunnel with timeout
- `start_oauth_flow`: Placeholder for OAuth device flow
- `get_oauth_token_status`: Check if OAuth token exists
- `clear_oauth_token`: Remove stored OAuth token

### ✅ Frontend (TypeScript/React)

#### ConnectionDialog Enhancements
- **Bastion type selector**: Radio buttons for SSH vs AWS SSM
- **SSH fields**: Host, port, user, key file selection, passphrase input
- **SSH Agent checkbox**: Toggle for agent-based auth
- **AWS SSM fields**: Region, target ID, remote host/port
- **Auth method selector**: AWS Profile vs SSO/OAuth
- **OAuth configuration**: Provider dropdown (Microsoft, Google, Okta, Auth0, Keycloak), client ID, tenant ID, IAM role ARN
- **Unified Test button**: Tests bastion → database in sequence
- **Status indicators**: Shows tunnel establishment progress

#### Type Definitions
- `BastionConfig`: Union type for SSH vs SSM
- `AwsSsmConfig`: AWS-specific configuration
- `OAuthProvider`: Generic provider enum with custom support
- `OAuthConfig`: OAuth/OIDC configuration

### ✅ Testing Infrastructure

#### Docker Compose
- `ssh-bastion-password`: Password-based SSH (not used by app)
- `ssh-bastion-key`: Key-based SSH for integration tests
- `postgres-private`: Internal PostgreSQL for tunnel testing

#### Test Keys
- **Generation script**: `tests/ssh-keys/generate-test-keys.sh`
  - RSA 4096-bit (unencrypted)
  - Ed25519 (encrypted with `testpass123`)
  - ECDSA P-521 (unencrypted)
- **`.gitignore`**: Excludes generated keys from version control

#### Integration Tests
- **`src-tauri/tests/ssh_tunnel_test.rs`**: Unit tests for SSH module
  - Password auth rejection
  - Encrypted key rejection  
  - Missing host rejection
  - Full PostgreSQL tunnel test

#### CI/CD
- **`.github/workflows/unit-tests.yml`**: Includes `integration-ssh` job
  - Runs on ubuntu-latest and macos-latest
  - Spins up Docker containers (ubuntu only)
  - Executes `make test-ssh` target

### ✅ Documentation

- **User Guide** (`docs/ssh-and-ssm-user-guide.md`):
  - SSH tunnel setup
  - Key types and authentication methods
  - SSH agent usage
  - AWS SSM configuration
  - OAuth provider setup
  - Security best practices

- **Troubleshooting** (`docs/ssh-and-ssm-troubleshooting.md`):
  - Common SSH errors
  - AWS SSM issues
  - Database connection problems
  - Platform-specific fixes
  - Debugging tips

- **Makefile targets**:
  - `make setup-ssm-plugin`: Download vendored session-manager-plugin
  - `make test-ssh-setup`: Generate keys and start Docker
  - `make test-ssh`: Run integration tests
  - `make test-ssh-clean`: Clean up test environment
  - `make test-ssh-full`: Full test cycle

## What's NOT Implemented (Future Work)

### Phase 2: AWS SSM Full Support
- [ ] Complete `SsmTunnel::establish()` implementation
- [ ] Integrate with `ManagedTunnel` enum
- [ ] Add `SsmTunnel` health checks
- [ ] Wire up in `ConnectionManager::ensure_bastion_tunnel()`

### Phase 3: OAuth Device Flow
- [ ] Implement device code flow in `aws/oauth.rs`
- [ ] In-app OAuth browser/redirect
- [ ] Auto-refresh for expired tokens
- [ ] Token expiry UI indicators

### Phase 4: Advanced Features
- [ ] SSH multiplexing optimization
- [ ] Custom `~/.ssh/known_hosts` location
- [ ] Verbose logging toggle
- [ ] Tunnel metrics (latency, bandwidth)

## Testing

### Unit Tests
```bash
cd src-tauri
cargo test --lib --bins
```

### SSH Integration Tests
```bash
# Full cycle (setup → test → cleanup)
make test-ssh-full

# Or step-by-step
make test-ssh-setup
make test-ssh
make test-ssh-clean
```

### Frontend Type Check
```bash
pnpm typecheck
```

## File Structure

```
src-tauri/
├── src/
│   ├── ssh/
│   │   ├── mod.rs               # Core SSH tunnel implementation
│   │   ├── key.rs               # SSH key parsing (RSA/Ed25519/ECDSA)
│   │   ├── secrets.rs           # OS keychain integration
│   │   ├── rate_limiter.rs      # Rate limiting for test commands
│   │   └── port_allocator.rs   # Dynamic local port allocation
│   ├── aws/
│   │   ├── mod.rs
│   │   ├── ssm_tunnel.rs        # AWS SSM tunnel (partial)
│   │   └── oauth.rs             # Generic OAuth/OIDC token storage
│   ├── core/manager.rs          # ManagedTunnel enum + lifecycle
│   └── commands.rs              # Tauri commands for SSH/OAuth
├── sidecars/
│   └── session-manager-plugin-* # Vendored AWS plugin binaries
└── tests/
    └── ssh_tunnel_test.rs       # Integration tests

src/
├── components/ConnectionDialog.tsx   # Bastion UI
└── types/connection.ts              # TypeScript types

docs/
├── ssh-and-ssm-user-guide.md        # User documentation
└── ssh-and-ssm-troubleshooting.md   # Troubleshooting guide

tests/
└── ssh-keys/
    ├── generate-test-keys.sh        # Key generation script
    └── .gitignore                   # Exclude generated keys

docker-compose.yml                   # SSH bastions + private DB
```

## Security Considerations

✅ **Implemented**:
- SSH password auth disabled (rejected by backend)
- Encrypted key passphrase entry (with keychain storage)
- SSH agent integration (recommended path)
- Strict host key verification (`KnownHosts::Strict`)
- Rate limiting on test commands
- Secure token storage in OS keychain

⚠️ **User Responsibility**:
- Use strong SSH passphrases
- Rotate keys regularly
- Don't share private keys
- Review SSH `authorized_keys` on bastions
- Monitor AWS SSM session logs

## Known Limitations

1. **Password SSH auth**: Not supported (by design)
2. **Encrypted keys without agent**: Not supported (use agent instead)
3. **OAuth device flow**: Placeholder only (CLI workaround required)
4. **AWS SSM**: Foundation in place, full implementation pending
5. **Windows SSH agent**: May require additional setup

## Migration Path for Existing Users

No breaking changes – SSH tunneling is an opt-in feature:
1. Existing connections work unchanged
2. Enable **SSH Tunnel** or **AWS SSM Bastion** checkbox to use new features
3. Legacy `ssh_tunnel` field still supported (auto-converted to `bastion.Ssh`)

## Performance Notes

- **SSH multiplexing**: `ssh2` library enables multiple channels over single connection
- **Tunnel reuse**: Health checks avoid unnecessary reconnects
- **Dynamic ports**: Automatic allocation prevents conflicts
- **Async design**: Non-blocking tunnels don't freeze UI

## Resources

- [ssh2 crate](https://docs.rs/ssh2/)
- [libssh2 documentation](https://www.libssh2.org/)
- [AWS Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [SSH Config Manual](https://man.openbsd.org/ssh_config)
- [OAuth 2.0 Device Flow](https://oauth.net/2/grant-types/device-code/)

---

**Questions or Issues?**  
- See [Troubleshooting Guide](./ssh-and-ssm-troubleshooting.md)
- Open an issue on GitHub
- Review `make test-ssh-full` output for diagnostic info
