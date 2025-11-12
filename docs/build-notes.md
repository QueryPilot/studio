# Build Notes

## SSH / OpenSSL Dependencies

### Vendored OpenSSL

The project uses `ssh2` crate with the `vendored-openssl` feature enabled:

```toml
ssh2 = { version = "0.9.5", features = ["vendored-openssl"] }
```

**What this means:**
- OpenSSL is **statically linked** into the binary during build
- No need for system OpenSSL installation
- Consistent builds across different platforms
- Self-contained binary (no external runtime dependencies)

### Build Requirements

**All platforms:** Just Rust toolchain
- No need to install OpenSSL separately
- No need to configure OpenSSL paths
- No version conflicts with system OpenSSL

### Benefits

1. **Cross-platform Consistency**
   - Same OpenSSL version on Linux, macOS, Windows
   - No "OpenSSL not found" errors
   - No version mismatch issues

2. **CI/CD Simplicity**
   - GitHub Actions builds work out of the box
   - No need to install OpenSSL in CI containers
   - Faster build times (cached vendored build)

3. **Distribution**
   - Single self-contained binary
   - Users don't need OpenSSL installed
   - No dependency conflicts with user's system

### Trade-offs

**Pros:**
- ✅ Reliable, reproducible builds
- ✅ No runtime dependencies
- ✅ Cross-platform compatibility
- ✅ Security: controlled OpenSSL version

**Cons:**
- ⚠️ Slightly longer initial build time (first time only)
- ⚠️ Slightly larger binary (~2-3MB for OpenSSL)

**Overall:** The trade-offs are worth it for a desktop application that needs to work reliably on all platforms without user configuration.

## Build Performance

### First Build
```bash
cd src-tauri
cargo build --release
# ~3-4 minutes (includes building vendored OpenSSL)
```

### Incremental Builds
```bash
cargo build --release
# ~30-60 seconds (OpenSSL is cached)
```

### Clean Build
```bash
cargo clean
cargo build --release
# ~3-4 minutes again
```

## Platform-Specific Notes

### macOS
- No issues, works out of the box
- Uses vendored OpenSSL regardless of system OpenSSL

### Linux
- No issues, works out of the box
- No need for `libssl-dev` or `openssl-dev` packages
- Works on any distro

### Windows
- No issues, works out of the box
- No need to install OpenSSL manually
- No need to configure `OPENSSL_DIR` environment variable

## Troubleshooting

### Build Fails with OpenSSL Errors

This shouldn't happen with `vendored-openssl`, but if it does:

```bash
# Clean and rebuild
cargo clean
cargo build --release
```

### Binary Size Concerns

If binary size is critical, you can use system OpenSSL instead:

```toml
# In Cargo.toml, change:
ssh2 = { version = "0.9.5", features = ["vendored-openssl"] }

# To:
ssh2 = "0.9.5"  # Uses system OpenSSL
```

**Note:** This requires users to have OpenSSL installed, which defeats the purpose of a self-contained app.

### CI/CD Configuration

**GitHub Actions** - No special config needed:

```yaml
- name: Build Tauri app
  run: |
    cd src-tauri
    cargo build --release
  # OpenSSL is built automatically
```

**Docker** - No need to install OpenSSL:

```dockerfile
FROM rust:latest
# No need for: RUN apt-get install libssl-dev
WORKDIR /app
COPY . .
RUN cargo build --release
```

## Security

### OpenSSL Version

The vendored OpenSSL version is controlled by the `openssl-src` crate used by `ssh2`:

- Check current version: `cargo tree | grep openssl-src`
- Updates: Run `cargo update` to get security patches
- Version pinning: Handled by `Cargo.lock`

### Security Updates

To update OpenSSL:

```bash
# Update all dependencies (including openssl-src)
cargo update

# Rebuild
cargo build --release
```

### CVE Monitoring

Monitor these sources for OpenSSL CVEs:
- https://www.openssl.org/news/vulnerabilities.html
- GitHub Security Advisories
- `cargo audit` tool

```bash
# Install cargo-audit
cargo install cargo-audit

# Check for vulnerabilities
cargo audit
```

## Alternative: System OpenSSL

If you need to use system OpenSSL for any reason:

### Pros
- Smaller binary size
- System updates handle OpenSSL patches
- May be required for some corporate environments

### Cons
- Requires OpenSSL installed on build machine
- Requires OpenSSL installed on user machines
- Version conflicts possible
- Cross-compilation complexity

### How to Switch

1. Update `Cargo.toml`:
```toml
ssh2 = "0.9.5"  # Remove vendored-openssl feature
```

2. Install OpenSSL on build machine:
```bash
# macOS
brew install openssl

# Ubuntu/Debian
sudo apt-get install libssl-dev pkg-config

# Fedora/RHEL
sudo dnf install openssl-devel

# Windows
# Download from https://slproweb.com/products/Win32OpenSSL.html
```

3. Set environment variables (Windows only):
```bash
set OPENSSL_DIR=C:\Program Files\OpenSSL-Win64
```

## Recommendation

**Keep `vendored-openssl` enabled** for desktop applications. It provides:
- Better user experience (no dependency issues)
- Easier distribution
- Consistent behavior across platforms
- Simpler build process

Only consider system OpenSSL if:
- You're building server software
- Binary size is absolutely critical
- Corporate policy requires system libraries

