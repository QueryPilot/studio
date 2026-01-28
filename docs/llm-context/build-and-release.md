# Build and Release

## Build Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build frontend only |
| `pnpm tauri:build` | Build full app |
| `make build` | Build production app |

## Release Process

```bash
# Create a new release
make release

# Manual release with specific version
make release-manual VERSION=1.2.3
```

See [Release Guide](../guides/release-guide.md) for complete instructions.

## Platform-Specific Notes

### macOS

- Code signing required for distribution
- Developer ID configured in `tauri.conf.json`
- Hardened runtime + entitlements in `entitlements.plist`
- Notarization required for Gatekeeper

See `MACOS_SIGNING_GUIDE.md` for setup.

### Windows

- PowerShell script for SSM plugin download
- Code signing recommended for SmartScreen bypass

### Linux

- AppImage distribution format
- `libssl` dependency for keychain

## Telemetry (Optional)

Sentry integration (disabled by default, opt-in via Preferences UI):

```bash
# Build with telemetry enabled
cargo build --release --features telemetry
```

**Environment variables**:
- `SENTRY_DSN` - Backend DSN
- `VITE_SENTRY_DSN` - Frontend DSN
- `SENTRY_AUTH_TOKEN` - Source map upload

See [SENTRY.md](../../SENTRY.md) for details.

## Important Files

| File | Purpose |
|------|---------|
| `tauri.conf.json` | Tauri config (windows, bundle, signing) |
| `Makefile` | Build and dev tasks |
| `package.json` | Frontend scripts and deps |
| `src-tauri/Cargo.toml` | Rust dependencies |
| `entitlements.plist` | macOS entitlements |
