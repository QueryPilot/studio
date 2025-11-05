# Query Pilot - macOS Release Guide

## 🎯 Quick Start (Testing/Development)

```bash
# Build for your Mac
make build

# Find your DMG at:
# src-tauri/target/release/bundle/dmg/Query Pilot_0.1.0_aarch64.dmg
```

---

## 📦 Full Release Process (Public Distribution)

### Prerequisites

- [ ] macOS development machine
- [ ] Xcode Command Line Tools: `xcode-select --install`
- [ ] Bun installed (for AI sidecar)
- [ ] Node.js & pnpm installed
- [ ] Apple Developer Account ($99/year) for signing & notarization

### Step 1: Pre-Release Checks

```bash
# Test the app locally
make dev

# Run tests
make test

# Check Rust code
cd src-tauri && cargo check
```

### Step 2: Update Version

Update version in these files:
- `package.json` → `"version": "0.1.0"`
- `src-tauri/tauri.conf.json` → `"version": "0.1.0"`
- `src-tauri/Cargo.toml` → `version = "0.1.0"`

### Step 3: Build

```bash
# Build AI sidecar for all platforms (optional, for universal binary)
make build-ai-all

# Build macOS app
make build
```

**Output locations:**
- DMG: `src-tauri/target/release/bundle/dmg/`
- App bundle: `src-tauri/target/release/bundle/macos/`
- Updater bundle: `src-tauri/target/release/bundle/macos/Query Pilot.app.tar.gz`

### Step 4: Code Signing (Required)

#### Option A: With Apple Developer Account (Recommended)

1. **Create Signing Certificate**
   - Open Xcode → Settings → Accounts → Manage Certificates
   - Add "Developer ID Application" certificate
   - Note your Team ID from developer.apple.com

2. **Update `src-tauri/tauri.conf.json`:**

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "entitlements": null
    }
  }
}
```

3. **Rebuild with signing:**

```bash
make build
```

#### Option B: Ad-hoc Signing (Free, Limited)

- Default behavior (no changes needed)
- ⚠️ Users will see "unidentified developer" warning
- Good for testing only

### Step 5: Notarization (Required for macOS 10.15+)

1. **Get App-Specific Password**
   - Go to https://appleid.apple.com
   - Sign In → App-Specific Passwords → Generate

2. **Set Environment Variables**

```bash
export APPLE_ID="your-email@example.com"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_APP_PASSWORD="abcd-efgh-ijkl-mnop"
```

3. **Run Notarization**

```bash
bash scripts/notarize.sh
```

This takes 5-15 minutes. Apple will email you when complete.

### Step 6: Test the Build

```bash
# Mount the DMG
open "src-tauri/target/release/bundle/dmg/Query Pilot_0.1.0_aarch64.dmg"

# Drag to Applications and test
```

**Test checklist:**
- [ ] App opens without Gatekeeper warning
- [ ] AI assistant works (check sidecar connection)
- [ ] Database connections work
- [ ] No crashes on cold start
- [ ] Check Console.app for errors

---

## 🌐 Distribution Options

### Option 1: Direct Download (Website/GitHub)

Upload the signed & notarized DMG to:
- Your website
- GitHub Releases
- Cloud storage (Google Drive, Dropbox)

### Option 2: Homebrew Cask

Create a cask for `brew install --cask query-pilot`:

```ruby
cask "query-pilot" do
  version "0.1.0"

  url "https://github.com/your-username/query-pilot/releases/download/v#{version}/Query.Pilot_#{version}_aarch64.dmg"
  name "Query Pilot"
  desc "Modern database IDE with AI assistant"
  homepage "https://querypilot.dev"

  app "Query Pilot.app"
end
```

### Option 3: Mac App Store

**Requirements:**
- Mac App Store distribution certificate
- App Store provisioning profile
- Update `tauri.conf.json` with App Store entitlements
- Remove private APIs (`"macOSPrivateApi": false`)

⚠️ **Note:** Mac App Store requires additional sandboxing that may break AI sidecar functionality. Direct distribution is recommended.

---

## 🔄 Auto-Update Setup (Future)

Tauri supports auto-updates via the updater plugin.

1. **Update `tauri.conf.json`:**

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://releases.querypilot.dev/{{target}}/{{current_version}}"
      ],
      "dialog": true,
      "pubkey": "YOUR_PUBLIC_KEY"
    }
  }
}
```

2. **Generate signing keys:**

```bash
pnpm tauri signer generate -w ~/.tauri/query-pilot.key
```

3. **Sign releases:**

```bash
pnpm tauri signer sign "Query Pilot.app.tar.gz"
```

---

## 🐛 Troubleshooting

### "App is damaged and can't be opened"

```bash
# Remove quarantine attribute
xattr -cr "/Applications/Query Pilot.app"
```

### AI Sidecar not starting

```bash
# Check sidecar binary exists
ls -lh src-tauri/sidecars/ai-server-*

# Test sidecar manually
./src-tauri/sidecars/ai-server-aarch64-apple-darwin
```

### Notarization fails

```bash
# Check notarization status
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD"
```

Common issues:
- Unsigned dependencies in AI sidecar
- Missing entitlements
- Hardened runtime issues

---

## 📋 Release Checklist

### Pre-Release
- [ ] All tests passing
- [ ] Version numbers updated
- [ ] CHANGELOG.md updated
- [ ] Icons/assets finalized

### Build
- [ ] AI sidecar built for macOS
- [ ] Tauri app built successfully
- [ ] DMG created

### Signing & Notarization
- [ ] Code signed with Developer ID
- [ ] Notarization submitted & approved
- [ ] Notarization ticket stapled to DMG

### Testing
- [ ] Fresh install on clean Mac
- [ ] No Gatekeeper warnings
- [ ] AI assistant functional
- [ ] Database connections work
- [ ] No crashes or errors

### Distribution
- [ ] DMG uploaded to distribution channel
- [ ] Release notes published
- [ ] Download link tested
- [ ] Users notified

---

## 📚 Resources

- [Tauri Docs: Distribution](https://v2.tauri.app/distribute/)
- [Apple: Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Apple: Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Bun: Compile to Binary](https://bun.sh/docs/bundler/executables)

---

## 🆘 Need Help?

- Open an issue at: https://github.com/your-username/query-pilot/issues
- Email: support@querypilot.dev
