# Complete Release Guide

This comprehensive guide explains the Query Pilot release system with cross-repository publishing and auto-updates.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [Release Process](#release-process)
5. [Testing Updates](#testing-updates)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Topics](#advanced-topics)

---

## Architecture Overview

### Repository Structure

```
┌─────────────────────────────────────┐
│  QueryPilot/studio (Private)        │
│  • Source code                      │
│  • Development workflow             │
│  • Build & CI/CD                    │
│  • Smart release automation         │
└──────────────┬──────────────────────┘
               │
               │ Cross-repo publish
               ▼
┌─────────────────────────────────────┐
│  QueryPilot/studio (Public)     │
│  • Release binaries (DMG, exe)      │
│  • User documentation               │
│  • CHANGELOG.md                     │
│  • Update manifest (latest.json)    │
│  • Public download page             │
└─────────────────────────────────────┘
               │
               │ Update checks
               ▼
┌─────────────────────────────────────┐
│  Query Pilot App                    │
│  • Checks latest.json on startup    │
│  • Downloads updates in background  │
│  • Verifies signatures              │
│  • Prompts user to install          │
└─────────────────────────────────────┘
```

### Key Components

1. **Smart Release Script** (`scripts/smart-release-v2.sh`)
   - Automated version bumping
   - Professional changelog generation
   - Automated git tagging
   - Cross-repo publish orchestration

2. **GitHub Actions** (`.github/workflows/release.yml`)
   - Builds binaries for all platforms
   - Signs binaries with Apple Developer ID
   - Generates update manifest with Tauri signatures
   - Publishes to both repositories

3. **Update Manifest** (`latest.json`)
   - JSON file with version info and download URLs
   - Cryptographically signed for security
   - Served from GitHub Releases
   - Checked by Tauri updater plugin

4. **UpdateChecker Component** (`src/components/UpdateChecker.tsx`)
   - Frontend UI for update checks
   - Download progress indicator
   - Install and relaunch functionality

---

## Prerequisites

### Required Tools

- **Node.js** 20+
- **pnpm** (package manager)
- **Tauri CLI** (via pnpm)
- **GitHub CLI** (`gh`)
- **Codex CLI** (for changelog generation)
- **Rust** toolchain

Install missing tools:

```bash
# GitHub CLI
brew install gh
gh auth login

# Codex CLI
npm install -g @openai/codex-cli
codex auth

# Or set up alternative: Use Zen MCP or manual changelog
```

### Required Secrets

Set up these secrets in GitHub:

#### In `QueryPilot/studio` repository:

1. **TAURI_PRIVATE_KEY** - Tauri updater signing key (private)
2. **TAURI_KEY_PASSWORD** - Password for the signing key
3. **RELEASE_PAT** - Personal Access Token with `repo` scope for QueryPilot/studio
4. **APPLE_CERTIFICATE** - Apple Developer ID certificate (base64)
5. **APPLE_CERTIFICATE_PASSWORD** - Certificate password
6. **APPLE_DEVELOPER_ID** - Apple ID email
7. **APPLE_PASSWORD** - App-specific password
8. **APPLE_TEAM_ID** - Apple Developer Team ID

Optional (for telemetry): 9. **SENTRY_DSN** - Sentry project DSN 10. **SENTRY_AUTH_TOKEN** - Sentry API token

---

## Initial Setup

### Step 1: Generate Tauri Updater Keys

```bash
# Run the interactive key generator
./scripts/generate-updater-keys.sh

# This will prompt for a password and generate:
# - Private key: .tauri/query-pilot.key (keep secret!)
# - Public key: Printed to console
```

**Copy the public key** (starts with `dW50cnVzdGVkIGNvbW1lbnQ6...`)

### Step 2: Update Tauri Configuration

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

### Step 3: Set GitHub Secrets

```bash
# Add Tauri signing key to GitHub Secrets
gh secret set TAURI_PRIVATE_KEY < .tauri/query-pilot.key

# Add key password (you'll be prompted)
gh secret set TAURI_KEY_PASSWORD

# Generate and set release PAT
gh secret set RELEASE_PAT
# (Create token at: https://github.com/settings/tokens)
```

### Step 4: Set Up QueryPilot/studio Repository

Follow the complete guide in [release-repo-setup.md](./release-repo-setup.md).

Quick checklist:

- [ ] Create `QueryPilot/studio` repository (public)
- [ ] Add README.md and CHANGELOG.md
- [ ] Configure GitHub Releases
- [ ] Set up issue templates
- [ ] Verify `RELEASE_PAT` has access

### Step 5: Install Frontend Dependencies

```bash
# Install @tauri-apps/plugin-process (required for relaunch)
pnpm add @tauri-apps/plugin-process
```

### Step 6: Add UpdateChecker to Your App

Edit `src/main.tsx` or your preferences component:

```tsx
import { UpdateChecker } from "@/components/UpdateChecker";

// Add to your component tree
<UpdateChecker checkOnMount={true} />;
```

Or use the hook for manual checks:

```tsx
import { useUpdateChecker } from "@/components/UpdateChecker";

function PreferencesPanel() {
  const { checkForUpdates, isChecking } = useUpdateChecker();

  return (
    <Button onClick={checkForUpdates} disabled={isChecking}>
      Check for Updates
    </Button>
  );
}
```

---

## Release Process

### Automated Release (Recommended)

The smart release script handles everything:

```bash
./scripts/smart-release-v2.sh
```

**What it does:**

1. ✅ Analyzes commits since last release
2. ✅ Suggests semantic version using AI
3. ✅ Generates professional, user-friendly changelog
4. ✅ Updates version in all files
5. ✅ Commits changes and creates git tag
6. ✅ Pushes to GitHub (triggers Actions)
7. ✅ Waits for build completion (optional)
8. ✅ Publishes to QueryPilot/studio (optional)

**Interactive prompts:**

```
🤖 Smart Release V2 - Cross-Repository Publishing
==================================================

📦 Current version: v0.4.0
🏷️  Last tag: v0.4.0
📋 Analyzing commits since last release...
✓ Found 15 commits

🤖 Asking Codex to analyze commits and suggest next version...
✓ Suggested version: v0.5.0

Use this version? (Y/n) _
```

The AI will generate a changelog like:

```markdown
## [0.5.0] - 2025-11-20

### New Features

- Connect to remote databases securely through SSH tunnels. Automatic health
  monitoring ensures connections stay stable.

### Improvements

- Query editor autocomplete is now 50% faster with improved caching and smarter
  suggestions for table names and columns.
- Connection dialog remembers your last 10 connections for quick access.

### Bug Fixes

- Fixed crash when disconnecting during an active query
- Table grid now scrolls smoothly with 10,000+ rows
```

### Manual Release

If you prefer more control:

```bash
# 1. Bump version manually
./scripts/bump-version.sh 0.5.0

# 2. Update CHANGELOG.md manually

# 3. Commit and tag
git add .
git commit -m "chore: release v0.5.0"
git tag -a v0.5.0 -m "Release v0.5.0"

# 4. Push
git push origin master
git push origin v0.5.0

# 5. Wait for GitHub Actions to complete (10-15 minutes)

# 6. Publish to QueryPilot
./scripts/publish-to-app-repo.sh v0.5.0
```

### GitHub Actions Workflow

When you push a tag, the workflow:

1. **Creates draft release** in QueryPilot/studio
2. **Builds binaries** for all platforms (macOS, Windows, Linux)
3. **Signs binaries** with Apple Developer ID (macOS)
4. **Uploads to release**
5. **Generates update manifest** with Tauri signatures
6. **Publishes to QueryPilot/studio** (if enabled)

Monitor progress:

```bash
open https://github.com/QueryPilot/studio/actions
```

---

## Testing Updates

### Test Update Detection

1. **Lower your app version** temporarily:

```bash
# Edit package.json
"version": "0.1.0"

# Edit src-tauri/tauri.conf.json
"version": "0.1.0"

# Rebuild
pnpm tauri build
```

2. **Open the app** and check for updates
3. **Watch console** for update check logs

### Test Update Download

```bash
# In the app, open DevTools (Cmd+Opt+I)
# Watch Network tab for:
GET https://github.com/QueryPilot/studio/releases/latest/download/latest.json
```

### Verify Update Manifest

```bash
curl -s https://github.com/QueryPilot/studio/releases/latest/download/latest.json | jq .
```

Expected output:

```json
{
  "version": "0.5.0",
  "notes": "See CHANGELOG.md for details",
  "pub_date": "2025-11-20T10:30:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "url": "https://github.com/QueryPilot/studio/releases/download/v0.5.0/QueryPilot_v0.5.0_aarch64.app.tar.gz"
    }
  }
}
```

### Manual Update Test

```bash
# Download DMG from release
curl -LO https://github.com/QueryPilot/studio/releases/latest/download/QueryPilot_latest_aarch64.dmg

# Mount and install
open QueryPilot_latest_aarch64.dmg
```

---

## Troubleshooting

### Update Check Fails

**Symptom:** App says "Failed to check for updates"

**Causes:**

1. No internet connection
2. GitHub is down
3. latest.json is missing or malformed
4. Wrong endpoint URL in tauri.conf.json

**Fix:**

```bash
# Verify endpoint is accessible
curl -I https://github.com/QueryPilot/studio/releases/latest/download/latest.json

# Check tauri.conf.json
cat src-tauri/tauri.conf.json | grep -A 5 updater
```

### Signature Verification Fails

**Symptom:** "Invalid signature" error

**Causes:**

1. Public key in tauri.conf.json doesn't match private key
2. Update manifest was not signed with correct key
3. Binary was modified after signing

**Fix:**

```bash
# Regenerate keys
./scripts/generate-updater-keys.sh

# Update public key in tauri.conf.json
# Re-sign all releases with new key
```

### Cross-Repo Publish Fails

**Symptom:** GitHub Actions fails at "Publish to QueryPilot/studio" step

**Causes:**

1. `RELEASE_PAT` secret is invalid or expired
2. Token doesn't have `repo` scope
3. QueryPilot/studio repository doesn't exist

**Fix:**

```bash
# Test PAT manually
export GITHUB_TOKEN="your_pat_here"
gh repo view QueryPilot/studio

# If fails, regenerate token with correct scopes
```

### Build Artifacts Missing

**Symptom:** "No DMG file found" error

**Causes:**

1. Tauri build failed
2. Code signing failed

**Fix:**

```bash
# Check GitHub Actions logs
gh run list --workflow release.yml

# View specific run
gh run view <run_id> --log

# Common issues:
# - Signing failed: Verify Apple certificates
# - Build errors: Check Rust/TypeScript compilation
```

---

## Advanced Topics

### Custom Changelog Templates

Edit the changelog prompt in `scripts/smart-release-v2.sh`:

```bash
CHANGELOG_PROMPT="Generate a professional, user-friendly changelog...

Custom instructions:
- Use specific terminology for your domain
- Highlight performance metrics
- Include migration guides for breaking changes
..."
```

### Prerelease Versions

Create beta/alpha releases:

```bash
# Tag with prerelease suffix
git tag v0.5.0-beta.1

# Push
git push origin v0.5.0-beta.1

# GitHub Actions will mark it as prerelease
```

### Rollback a Release

If a release has critical bugs:

```bash
# Delete tag locally and remotely
git tag -d v0.5.0
git push origin :refs/tags/v0.5.0

# Delete release in QueryPilot/studio
gh release delete v0.5.0 --repo QueryPilot/studio --yes

# Revert version bump commit
git revert HEAD
git push
```

### Multiple Update Channels

Support stable, beta, and nightly channels:

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/QueryPilot/studio/releases/latest/download/stable.json",
        "https://github.com/QueryPilot/studio/releases/latest/download/beta.json"
      ]
    }
  }
}
```

Generate separate manifests for each channel in the workflow.

### Automated Release Schedule

Run releases on a schedule:

```yaml
# .github/workflows/scheduled-release.yml
on:
  schedule:
    - cron: "0 10 * * 1" # Every Monday at 10 AM UTC

jobs:
  check-for-changes:
    runs-on: ubuntu-latest
    steps:
      - name: Check if commits since last release
        run: |
          LAST_TAG=$(git describe --tags --abbrev=0)
          COMMITS=$(git log $LAST_TAG..HEAD --oneline)
          if [ -n "$COMMITS" ]; then
            # Trigger smart-release-v2.sh
          fi
```

---

## Checklist for Each Release

- [ ] All tests passing locally (`pnpm test`, `make test`)
- [ ] CHANGELOG.md is up to date (or will be generated)
- [ ] No uncommitted changes
- [ ] Version follows semantic versioning
- [ ] GitHub Actions are green
- [ ] Apple certificates are valid
- [ ] Tauri signing keys are configured
- [ ] QueryPilot/studio repository is accessible
- [ ] Update manifest will be signed

---

## Resources

- [Tauri Updater Documentation](https://tauri.app/plugin/updater/)
- [GitHub CLI Documentation](https://cli.github.com/manual/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub Actions Workflows](https://docs.github.com/en/actions)

---

## Support

For issues with the release system:

1. Check [GitHub Actions logs](https://github.com/QueryPilot/studio/actions)
2. Review this guide's [Troubleshooting](#troubleshooting) section
3. Open an issue in QueryPilot/studio (private)

For user-facing issues:

1. Check [QueryPilot discussions](https://github.com/QueryPilot/studio/discussions)
2. Search [existing issues](https://github.com/QueryPilot/studio/issues)
3. Open a new issue with bug/feature template
