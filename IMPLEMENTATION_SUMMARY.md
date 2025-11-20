# Cross-Repository Release & Auto-Updater Implementation Summary

## ✅ What Was Implemented

This implementation adds a complete cross-repository release system with cryptographically signed auto-updates for Query Pilot.

---

## 📦 Files Created

### Scripts

1. **`scripts/generate-updater-keys.sh`** ✨ NEW
   - Interactive script to generate Tauri updater signing keys
   - Creates `.tauri/query-pilot.key` (private key)
   - Prints public key for configuration
   - Usage: `./scripts/generate-updater-keys.sh`

2. **`scripts/smart-release-v2.sh`** ✨ NEW
   - Enhanced version of smart-release with cross-repo support
   - AI-powered version bumping and changelog generation
   - Orchestrates GitHub Actions and cross-repo publishing
   - Usage: `./scripts/smart-release-v2.sh`

3. **`scripts/publish-to-app-repo.sh`** ✨ NEW
   - Downloads artifacts from QueryPilot/studio
   - Generates update manifest with signatures
   - Publishes to QueryPilot/studio-app
   - Usage: `./scripts/publish-to-app-repo.sh v0.5.0`

### Workflows

4. **`.github/workflows/release-enhanced.yml`** ✨ NEW
   - Enhanced GitHub Actions workflow
   - Builds, signs, and publishes releases
   - Generates update manifest with Tauri signatures
   - Publishes to both studio and studio-app repositories
   - Jobs:
     - `create-release`: Creates draft release
     - `build-release`: Builds binaries for all platforms
     - `generate-updater-manifest`: Creates latest.json
     - `publish-to-app-repo`: Cross-repo publishing
     - `finalize-release`: Summary and links

### Frontend Components

5. **`src/components/UpdateChecker.tsx`** ✨ NEW
   - React component for in-app update checks
   - Download progress indicator
   - Install and relaunch functionality
   - Includes `useUpdateChecker` hook for programmatic access
   - Features:
     - Automatic check on mount (configurable)
     - Manual check button
     - Update available dialog
     - Download progress bar
     - Install and restart prompt
     - Error handling

### Documentation

6. **`docs/UPDATER_QUICKSTART.md`** ✨ NEW
   - 30-minute quick start guide
   - Step-by-step setup instructions
   - Common issues and fixes

7. **`docs/RELEASE_GUIDE.md`** ✨ NEW
   - Comprehensive release documentation
   - Architecture overview
   - Detailed workflows
   - Troubleshooting guide
   - Advanced topics

8. **`docs/STUDIO_APP_SETUP.md`** ✨ NEW
   - Complete guide for setting up QueryPilot/studio-app
   - Repository structure templates
   - README, CHANGELOG, and issue templates
   - GitHub configuration instructions

### Configuration

9. **`src-tauri/tauri.conf.json`** 🔧 MODIFIED
   - Added `updater` plugin configuration
   - Added `updater-capability` to security capabilities
   - Endpoint: `https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json`
   - Public key placeholder (needs to be filled)

10. **`.gitignore`** 🔧 MODIFIED
    - Added `.tauri/` directory to protect private keys
    - Added `*.key` pattern

---

## 🎯 What You Need to Do Next

### Phase 1: Initial Setup (30 minutes)

Follow **`docs/UPDATER_QUICKSTART.md`** for the fastest path, or:

#### 1. Generate Signing Keys

```bash
./scripts/generate-updater-keys.sh
```

- When prompted, enter a strong password
- Copy the PUBLIC key (starts with `dW50cnVzdGVkIGNvbW1lbnQ6...`)

#### 2. Update Configuration

Edit `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

#### 3. Set GitHub Secrets

```bash
# Private signing key
gh secret set TAURI_PRIVATE_KEY < .tauri/query-pilot.key

# Key password
gh secret set TAURI_KEY_PASSWORD

# Personal Access Token for cross-repo publishing
# (Create at: https://github.com/settings/tokens with 'repo' scope)
gh secret set RELEASE_PAT
```

#### 4. Create studio-app Repository

1. Go to https://github.com/QueryPilot
2. Create new repository: **studio-app**
3. **Public** repository
4. Initialize with README
5. Follow templates in `docs/STUDIO_APP_SETUP.md`

#### 5. Install Frontend Dependencies

```bash
# Required for app relaunch after update
pnpm add @tauri-apps/plugin-process
```

#### 6. Add Update Checker to Your App

**Option A: Automatic check on startup**

Edit `src/main.tsx`:

```tsx
import { UpdateChecker } from '@/components/UpdateChecker';

function App() {
  return (
    <>
      {/* Your existing app */}
      <UpdateChecker checkOnMount={true} />
    </>
  );
}
```

**Option B: Manual button in preferences**

```tsx
import { useUpdateChecker } from '@/components/UpdateChecker';

function PreferencesDialog() {
  const { checkForUpdates, isChecking } = useUpdateChecker();

  return (
    <Button onClick={checkForUpdates} disabled={isChecking}>
      Check for Updates
    </Button>
  );
}
```

---

### Phase 2: First Release (15 minutes + build time)

#### Run the Release Script

```bash
./scripts/smart-release-v2.sh
```

The script will:
1. ✅ Analyze commits and suggest version
2. ✅ Generate professional changelog
3. ✅ Commit, tag, and push
4. ✅ Trigger GitHub Actions
5. ⏳ Wait for build (10-15 minutes)
6. ✅ Publish to studio-app

#### Monitor Progress

```bash
# Watch GitHub Actions
open https://github.com/QueryPilot/studio/actions

# View releases
gh release list --repo QueryPilot/studio-app
```

---

### Phase 3: Test & Verify (10 minutes)

#### Test Update Manifest

```bash
curl https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json | jq .
```

#### Test In-App Update

1. Lower app version to 0.1.0 in `package.json` and `tauri.conf.json`
2. Build: `pnpm tauri build`
3. Open app
4. Should detect update and show dialog
5. Download and install
6. App restarts with new version

---

## 🔐 Security Notes

### Private Keys

**NEVER commit these files:**
- `.tauri/query-pilot.key` (private key)
- Any `*.key` files

These are protected by `.gitignore`, but be careful with:
- Backups
- Screenshots
- Log files
- Error messages

### GitHub Secrets

Store these in GitHub Secrets (never in code):
- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`
- `RELEASE_PAT`
- `APPLE_CERTIFICATE` (already set)
- `APPLE_CERTIFICATE_PASSWORD` (already set)

### Backup Your Keys

Store the private key securely:
```bash
# Encrypt and backup
gpg --encrypt .tauri/query-pilot.key
# Store .tauri/query-pilot.key.gpg in secure location
```

---

## 🚀 Using the System

### Creating a Release

**Automated (recommended):**
```bash
./scripts/smart-release-v2.sh
```

**Manual:**
```bash
# 1. Bump version
./scripts/bump-version.sh 0.5.0

# 2. Update CHANGELOG.md

# 3. Commit and tag
git add .
git commit -m "chore: release v0.5.0"
git tag -a v0.5.0 -m "Release v0.5.0"
git push origin master && git push origin v0.5.0

# 4. Wait for GitHub Actions

# 5. Publish to studio-app
./scripts/publish-to-app-repo.sh v0.5.0
```

### Workflow Summary

```
Developer                    GitHub Actions              Users
    |                              |                        |
    |--[smart-release-v2.sh]------>|                        |
    |                              |                        |
    |                         [Build & Sign]               |
    |                              |                        |
    |                    [Generate latest.json]            |
    |                              |                        |
    |                   [Publish to studio-app]            |
    |                              |                        |
    |                              |<------[Check Update]---|
    |                              |                        |
    |                              |------[Download DMG]--->|
    |                              |                        |
    |                              |<---[Verify Signature]--|
    |                              |                        |
    |                              |------[Install & -------|
    |                              |        Relaunch]------>|
```

---

## 📚 Documentation Index

1. **`docs/UPDATER_QUICKSTART.md`** - Start here! 30-minute setup
2. **`docs/RELEASE_GUIDE.md`** - Complete reference documentation
3. **`docs/STUDIO_APP_SETUP.md`** - Repository setup guide
4. **`scripts/smart-release-v2.sh`** - Main release script (read the comments)
5. **`src/components/UpdateChecker.tsx`** - Component documentation (JSDoc)

---

## ❓ Troubleshooting

### Update Check Fails

```bash
# Verify endpoint
curl -I https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json

# Check tauri config
cat src-tauri/tauri.conf.json | grep -A 5 updater
```

### Signature Verification Fails

```bash
# Regenerate keys
./scripts/generate-updater-keys.sh

# Update tauri.conf.json with new public key
# Update GitHub secret: gh secret set TAURI_PRIVATE_KEY
```

### Cross-Repo Publish Fails

```bash
# Verify PAT
gh auth status

# Test access
gh repo view QueryPilot/studio-app

# Regenerate if needed
gh secret set RELEASE_PAT
```

For more troubleshooting, see `docs/RELEASE_GUIDE.md#troubleshooting`.

---

## 🎉 Benefits

This implementation gives you:

- ✅ **Secure Updates**: Cryptographic signature verification
- ✅ **Professional Changelogs**: AI-generated, user-friendly release notes
- ✅ **One-Command Releases**: Fully automated workflow
- ✅ **Cross-Repo Publishing**: Source code private, releases public
- ✅ **In-App Updates**: Seamless user experience
- ✅ **Version Control**: Semantic versioning with AI assistance
- ✅ **Audit Trail**: Complete release history in both repos

---

## 🔄 Migration from Old System

If you were using the old `scripts/smart-release.sh`:

1. **New script**: Use `scripts/smart-release-v2.sh` instead
2. **Old workflow**: Replace with `.github/workflows/release-enhanced.yml`
3. **Workflow rename**: Update any documentation referencing old workflow
4. **Test thoroughly**: Run a test release to new studio-app repo

The old scripts are preserved for reference but deprecated.

---

## 📞 Support

**Questions?**
- Review documentation in `docs/`
- Check [GitHub Actions logs](https://github.com/QueryPilot/studio/actions)
- Open issue in QueryPilot/studio (private repo)

**Found a bug in the release system?**
- Check troubleshooting guides first
- Review script comments and logs
- Open detailed issue with reproduction steps

---

## ✨ What's Next?

### Immediate (Required)
- [ ] Generate signing keys
- [ ] Update tauri.conf.json with public key
- [ ] Set GitHub secrets
- [ ] Create studio-app repository
- [ ] Install @tauri-apps/plugin-process
- [ ] Add UpdateChecker to app
- [ ] Run first release

### Soon (Recommended)
- [ ] Test update flow end-to-end
- [ ] Customize changelog templates
- [ ] Add branding to studio-app README
- [ ] Create user documentation wiki
- [ ] Set up GitHub Discussions

### Future (Optional)
- [ ] Multiple update channels (stable, beta)
- [ ] Automated release schedule
- [ ] Custom domain for downloads
- [ ] Windows and Linux builds
- [ ] Telemetry integration

---

**Ready to get started?**

👉 Open `docs/UPDATER_QUICKSTART.md` and follow the 5-step setup!

Or jump straight to:
```bash
./scripts/generate-updater-keys.sh
```

Good luck! 🚀
