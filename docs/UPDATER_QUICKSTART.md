# Auto-Updater Quick Start

Get your cross-repository release system with auto-updates up and running in 30 minutes.

## What You'll Achieve

- ✅ Secure, cryptographically signed updates
- ✅ Professional, AI-generated changelogs
- ✅ Automated cross-repo publishing
- ✅ In-app update notifications
- ✅ One-command releases

---

## 5-Step Setup

### Step 1: Generate Signing Keys (5 minutes)

```bash
# Run the interactive key generator
./scripts/generate-updater-keys.sh

# When prompted, enter a strong password
# Copy the PUBLIC key that's printed (starts with dW50cnVzdGVkIGNvbW1lbnQ6...)
```

**Update Tauri config:**

```bash
# Open src-tauri/tauri.conf.json
# Find plugins.updater.pubkey
# Replace "PASTE_YOUR_PUBLIC_KEY_HERE" with your public key
```

**Add to GitHub Secrets:**

```bash
# Store private key
gh secret set TAURI_PRIVATE_KEY < .tauri/query-pilot.key

# Store password (you'll be prompted)
gh secret set TAURI_KEY_PASSWORD
```

---

### Step 2: Set Up studio-app Repository (10 minutes)

```bash
# Create repository at: https://github.com/QueryPilot/studio-app
# Settings:
# - Public
# - Initialize with README
```

**Generate Personal Access Token:**

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: "Query Pilot Release Publisher"
4. Scopes: ✅ `repo`
5. Generate and copy token

**Add to GitHub Secrets:**

```bash
gh secret set RELEASE_PAT
# Paste the token when prompted
```

**Add README and CHANGELOG:**

Copy templates from `docs/STUDIO_APP_SETUP.md` to the studio-app repository.

---

### Step 3: Install Frontend Dependencies (2 minutes)

```bash
# Add required package for app relaunch
pnpm add @tauri-apps/plugin-process
```

---

### Step 4: Add Update Checker to Your App (5 minutes)

**Option A: Automatic check on startup**

Edit `src/main.tsx`:

```tsx
import { UpdateChecker } from "@/components/UpdateChecker";

function App() {
  return (
    <>
      {/* Your existing app */}
      <UpdateChecker checkOnMount={true} />
    </>
  );
}
```

**Option B: Manual check button in preferences**

Edit your preferences component:

```tsx
import { useUpdateChecker } from "@/components/UpdateChecker";

function PreferencesDialog() {
  const { checkForUpdates, isChecking } = useUpdateChecker();

  return (
    <Button onClick={checkForUpdates} disabled={isChecking}>
      {isChecking ? "Checking..." : "Check for Updates"}
    </Button>
  );
}
```

---

### Step 5: Test the Setup (5 minutes)

**Test build locally:**

```bash
# Build the app
pnpm tauri build

# Open the DMG
open src-tauri/target/release/bundle/dmg/*.dmg
```

**Test update check (after first release):**

1. Lower your app version to 0.1.0 in `package.json` and `tauri.conf.json`
2. Build and run: `pnpm tauri build`
3. Open app and check for updates
4. Should detect your latest release

---

## Create Your First Release

### One Command Release

```bash
./scripts/smart-release-v2.sh
```

**Follow the prompts:**

```
📦 Current version: v0.4.0
🤖 Asking Codex to analyze commits...
✓ Suggested version: v0.5.0

Use this version? (Y/n) y

✓ Generated changelog:
## [0.5.0] - 2025-11-20
### New Features
- [AI-generated changelog here]

Use this changelog? (Y/n) y

📝 Updating version files...
✓ Changes committed
✓ Tag created: v0.5.0

⬆️  Push to origin? (Y/n) y
✓ Pushed to QueryPilot/studio
```

**Wait for build (10-15 minutes):**

Monitor at: https://github.com/QueryPilot/studio/actions

**The workflow will automatically:**

1. Build for macOS (and other platforms)
2. Sign with Apple Developer ID
3. Generate update manifest
4. Publish to QueryPilot/studio-app

---

## Verify It Works

### Check Release

```bash
# View releases in studio-app
gh release list --repo QueryPilot/studio-app

# View latest release
gh release view --repo QueryPilot/studio-app --web
```

### Check Update Manifest

```bash
curl https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json | jq .
```

Expected:

```json
{
  "version": "0.5.0",
  "notes": "...",
  "pub_date": "2025-11-20T...",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVk...",
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v0.5.0/Query-Pilot_aarch64.dmg"
    }
  }
}
```

### Test In-App Update

1. Open your built app
2. Update checker runs on startup (if configured)
3. Or click "Check for Updates" button
4. Should show "Update Available" dialog
5. Download and install
6. App restarts with new version

---

## Common Issues & Fixes

### "Update check failed"

```bash
# Check if manifest is accessible
curl -I https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json

# If 404, verify release was published
gh release view --repo QueryPilot/studio-app
```

### "Invalid signature"

```bash
# Verify public key matches
cat src-tauri/tauri.conf.json | grep pubkey

# Regenerate keys if needed
./scripts/generate-updater-keys.sh
```

### "Permission denied" when pushing to studio-app

```bash
# Check PAT has correct scope
gh auth status

# Regenerate with 'repo' scope
# Update secret: gh secret set RELEASE_PAT
```

---

## Next Steps

### Enable Telemetry (Optional)

See [SENTRY.md](../SENTRY.md) for Sentry integration.

### Customize Changelogs

Edit the AI prompt in `scripts/smart-release-v2.sh`:

```bash
# Line 159: CHANGELOG_PROMPT
# Add your custom instructions
```

### Set Up Issue Templates

Copy templates from `docs/STUDIO_APP_SETUP.md` to studio-app.

### Create Documentation Wiki

In studio-app repository:

1. Go to Settings → Features
2. Enable Wikis
3. Create pages for user guides

---

## Resources

- 📚 [Complete Release Guide](./RELEASE_GUIDE.md) - In-depth documentation
- 🏗️ [studio-app Setup](./STUDIO_APP_SETUP.md) - Repository setup details
- 🐛 [Troubleshooting](./RELEASE_GUIDE.md#troubleshooting) - Common problems
- 🔐 [Tauri Updater Docs](https://tauri.app/plugin/updater/) - Official documentation

---

## Support

Need help?

- Review docs above
- Check GitHub Actions logs
- Open issue in QueryPilot/studio (private)

---

**That's it!** 🎉

Your app now has:

- Secure auto-updates
- Professional changelogs
- Cross-repo publishing
- One-command releases

Run `./scripts/smart-release-v2.sh` whenever you're ready to release!
