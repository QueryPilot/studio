# Release Guide

## 🚀 Quick Start

### AI-Powered Release (Recommended)

```bash
make release
```

AI analyzes your commits, determines version, generates changelog, commits, tags, and pushes.

**First time?** Install [Codex CLI](https://github.com/openai/codex) first.

### Manual Release

```bash
make release-manual VERSION=1.2.3
```

You specify version and write changelog manually.

---

## How AI Release Works

1. **Analyzes commits** since last release
2. **Determines version** based on commit types:
   - `feat:` → MINOR bump (0.x.0)
   - `fix:` → PATCH bump (0.0.x)
   - `BREAKING CHANGE:` → MAJOR bump (x.0.0)
3. **Generates changelog** from commit messages
4. **Asks for confirmation** (you can edit/override)
5. **Updates files** (package.json, Cargo.toml, tauri.conf.json, CHANGELOG.md)
6. **Commits, tags, pushes** → triggers GitHub Actions

---

## Setup

### Install Codex

```bash
# Clone and install
git clone https://github.com/openai/codex.git
cd codex
# Follow installation instructions

# Configure API key
codex auth login
```

### Enable GitHub Actions

**Settings → Actions → General:**
- ✅ Allow all actions
- ✅ Workflow permissions: Read and write

---

## Usage

### Create Release

```bash
make release
```

**You'll see:**
```
🤖 Smart Release - AI-Powered Version & Changelog Generation
==============================================================

📦 Current version: v1.0.0
🏷️  Last tag: v1.0.0
📋 Analyzing commits since last release...
✓ Found 12 commits

🤖 Asking Codex to analyze commits and suggest next version...
✓ Suggested version: v1.1.0

Use this version? (Y/n)
```

**Then:**
```
🤖 Generating changelog from commits...
✓ Generated changelog:

## [1.1.0] - 2025-01-15

### Added
- Table editing with undo/redo
- SQL query history

### Fixed
- Connection pool leak
- Date formatting bug

Use this changelog? (Y/n)
```

**Finally:**
```
📝 Updating version files...
✓ All versions updated

📦 Preparing release commit...
Commit these changes? (Y/n)
```

### Override AI Suggestions

You can say `n` at any prompt to:
- Enter version manually
- Edit changelog in your editor
- Abort before committing

---

## Code Signing (Optional)

### Default: Self-Signed

Works out of the box! Users will see security warnings:
- **macOS**: Right-click → Open
- **Windows**: "More info" → "Run anyway"

### Production Signing

Add GitHub Secrets for signed builds:

**macOS** (requires Apple Developer $99/year):
```bash
# Export certificate as .p12, then:
base64 -i DeveloperID.p12 | pbcopy
# Add to GitHub: APPLE_CERTIFICATE

# Get signing identity
security find-identity -v -p codesigning
# Add to GitHub: APPLE_SIGNING_IDENTITY
```

**Windows** (requires code signing cert):
```powershell
$bytes = [System.IO.File]::ReadAllBytes("certificate.pfx")
[Convert]::ToBase64String($bytes) | Set-Clipboard
# Add to GitHub: WINDOWS_CERTIFICATE
```

**GitHub Secrets to add:**
- `APPLE_CERTIFICATE` - Base64 .p12
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE` - Base64 .pfx
- `WINDOWS_CERTIFICATE_PASSWORD`

Workflow auto-detects secrets and uses them if available.

---

## What Gets Built

Each release creates:
- `Query-Pilot_aarch64.dmg` (macOS Apple Silicon)
- `Query-Pilot_x86_64.dmg` (macOS Intel)
- `Query-Pilot_x64_setup.exe` (Windows)
- `Query-Pilot_amd64.AppImage` (Linux)

Build time: ~30-45 minutes (parallel builds)

---

## Troubleshooting

### Codex not installed

```bash
❌ Error: codex CLI not found
Fallback: Use manual release instead:
  make release-manual VERSION=1.2.3
```

**Fix:** Install Codex or use manual release.

### Invalid version suggested

```
❌ Codex returned invalid version: ...
Enter version manually (e.g., 1.2.0):
```

Just enter the version you want.

### Build failed on GitHub

Check Actions logs:
```bash
gh run view --log
```

Common issues:
- Outdated lockfiles → Run `pnpm install` locally
- Missing AI sidecar → Run `make build-ai`

---

## Best Practices

### Write Good Commits

✅ **Good** (AI understands):
```
feat: add table editing with undo/redo
fix: resolve connection pool leak in PostgreSQL adapter
```

❌ **Bad** (AI confused):
```
update stuff
changes
fix
```

### Use Conventional Commits

```
feat:     New features
fix:      Bug fixes
refactor: Code refactoring
perf:     Performance improvements
chore:    Maintenance tasks
docs:     Documentation only
```

### Version Numbering

Follow semantic versioning:
```
1.0.0     - Initial release
1.1.0     - New features
1.1.1     - Bug fixes
2.0.0     - Breaking changes

1.0.0-beta.1   - Pre-release
```

---

## Commands Reference

```bash
make release              # AI-powered (no version input)
make release-manual VERSION=1.2.3  # Manual version
make version VERSION=1.2.3         # Bump version only (no commit)
```

---

## Examples

### Scenario: Added features and fixed bugs

**Commits:**
```
feat: add table editing
feat: implement query history
fix: resolve connection leak
chore: update dependencies
```

**Run:**
```bash
make release
```

**Result:**
- Version: `1.0.0` → `1.1.0` (MINOR bump for features)
- Changelog: Includes table editing and query history, omits chore

### Scenario: Only bug fixes

**Commits:**
```
fix: correct date formatting
fix: resolve crash on startup
```

**Run:**
```bash
make release
```

**Result:**
- Version: `1.1.0` → `1.1.1` (PATCH bump)
- Changelog: Lists both fixes

---

## FAQ

**Q: Do I need internet?**
A: Yes, Codex makes API calls to OpenAI.

**Q: Can I undo a release?**
A: Yes: `git tag -d vX.Y.Z && git push origin :vX.Y.Z`

**Q: What if AI is wrong?**
A: Override at confirmation prompts.

**Q: Can I skip Codex?**
A: Yes: `make release-manual VERSION=1.2.3`

**Q: How much does Codex cost?**
A: Check OpenAI pricing. ~2 API calls per release (~1,000 tokens).

---

## Summary

**Simple release:**
```bash
make release
```

**Monitor build:**
```
https://github.com/YOUR_USERNAME/devdb-studio/actions
```

**Publish:**
```
https://github.com/YOUR_USERNAME/devdb-studio/releases
```

Done! 🎉
