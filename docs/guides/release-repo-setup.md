# Studio-App Repository Setup Guide

This guide explains how to set up the `QueryPilot/studio-app` repository for public release distribution and auto-updates.

## Overview

The **studio-app** repository serves as the public-facing release distribution point:

- 📦 **Hosts release binaries** (DMG, exe, AppImage)
- 📝 **User-facing documentation** (README, CHANGELOG)
- 🔄 **Update manifest endpoint** (`latest.json`)
- 🌐 **Public download page** (GitHub Releases)

**Source code** remains private in `QueryPilot/studio`, while **releases** are published to `QueryPilot/studio-app`.

---

## Step 1: Create the Repository

1. Go to https://github.com/QueryPilot
2. Click "New repository"
3. Repository name: **studio-app**
4. Description: "Query Pilot - A modern database IDE for developers"
5. **Public** repository
6. Initialize with README: ✅
7. Click "Create repository"

---

## Step 2: Set Up Repository Structure

Clone the repository and create the initial structure:

```bash
git clone https://github.com/QueryPilot/studio-app.git
cd studio-app
```

### Create README.md

```markdown
# Query Pilot

<p align="center">
  <img src="https://github.com/QueryPilot/studio-app/raw/main/assets/logo.png" width="200" alt="Query Pilot Logo">
</p>

<p align="center">
  <strong>A modern, local-first database IDE built for developers</strong>
</p>

<p align="center">
  <a href="https://github.com/QueryPilot/studio-app/releases/latest">
    <img src="https://img.shields.io/github/v/release/QueryPilot/studio-app?style=for-the-badge" alt="Latest Release">
  </a>
  <a href="https://github.com/QueryPilot/studio-app/releases">
    <img src="https://img.shields.io/github/downloads/QueryPilot/studio-app/total?style=for-the-badge" alt="Downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/QueryPilot/studio-app?style=for-the-badge" alt="License">
  </a>
</p>

---

## ✨ Features

- 🔌 **Multi-Database Support**: PostgreSQL, MySQL, SQLite, SQL Server, Oracle
- 🔒 **Local-First**: All data stays on your machine
- 🚀 **High Performance**: Built with Tauri 2 + React 19
- 🌐 **SSH Tunneling**: Secure connections to remote databases
- 📊 **Advanced Query Tools**: Autocomplete, formatting, syntax highlighting
- 🎨 **Modern UI**: Beautiful, customizable interface
- 🔄 **Auto-Updates**: Seamless in-app updates

---

## 📥 Download

### macOS

**Apple Silicon (M1/M2/M3)**

[Download Query-Pilot_aarch64.dmg](https://github.com/QueryPilot/studio-app/releases/latest/download/Query-Pilot_aarch64.dmg)

**Installation:**

1. Download the DMG file
2. Open the DMG and drag Query Pilot to Applications
3. On first launch, right-click the app and select "Open" if you see a security warning
4. Grant permissions when prompted

**Requirements:** macOS 10.15 (Catalina) or later

### Windows

Coming soon

### Linux

Coming soon

---

## 🚀 Quick Start

1. **Connect to a Database**
   - Click "New Connection"
   - Choose your database type
   - Enter connection details
   - Test and save

2. **Run Queries**
   - Open a new query tab (Cmd/Ctrl + T)
   - Write SQL or ask the AI assistant
   - Execute with Cmd/Ctrl + Enter
   - View results in the data grid

3. **Explore Your Data**
   - Browse tables and schemas
   - View table structures
   - Generate ERD diagrams
   - Export data to CSV/JSON

---

## 📚 Documentation

- [User Guide](https://github.com/QueryPilot/studio-app/wiki)
- [Keyboard Shortcuts](https://github.com/QueryPilot/studio-app/wiki/Keyboard-Shortcuts)
- [SSH Tunneling Guide](https://github.com/QueryPilot/studio-app/wiki/SSH-Tunneling)
- [AI Assistant Guide](https://github.com/QueryPilot/studio-app/wiki/AI-Assistant)

---

## 🔄 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of changes.

---

## 💬 Community & Support

- 🐛 [Report a Bug](https://github.com/QueryPilot/studio-app/issues/new?template=bug_report.md)
- 💡 [Request a Feature](https://github.com/QueryPilot/studio-app/issues/new?template=feature_request.md)
- 💬 [Discussions](https://github.com/QueryPilot/studio-app/discussions)

---

## 🔒 Privacy & Security

- **No telemetry by default**: Opt-in only
- **Local-first architecture**: Your data never leaves your machine
- **Encrypted storage**: Connection credentials stored securely in OS keychain
- **No cloud dependencies**: Works completely offline

---

## 📄 License

[Apache 2.0 License](LICENSE)

---

## 🙏 Acknowledgments

Built with:

- [Tauri](https://tauri.app/) - Native app framework
- [React](https://react.dev/) - UI framework
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [CodeMirror](https://codemirror.net/) - Code editor

---

<p align="center">
  Made with ❤️ by the Query Pilot team
</p>
```

### Create CHANGELOG.md

```markdown
# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

<!-- Releases will be automatically added here by the release workflow -->
```

### Create .github/ISSUE_TEMPLATE/ directory

```bash
mkdir -p .github/ISSUE_TEMPLATE
```

**Bug Report Template** (`.github/ISSUE_TEMPLATE/bug_report.md`):

```markdown
---
name: Bug Report
about: Report a bug or issue
title: "[BUG] "
labels: bug
assignees: ""
---

## Description

A clear and concise description of the bug.

## Steps to Reproduce

1. Go to '...'
2. Click on '...'
3. See error

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened.

## Screenshots

If applicable, add screenshots to help explain the problem.

## Environment

- OS: [e.g., macOS 14.0, Windows 11]
- Query Pilot Version: [e.g., 0.4.0]
- Database: [e.g., PostgreSQL 15]

## Additional Context

Any other context about the problem.
```

**Feature Request Template** (`.github/ISSUE_TEMPLATE/feature_request.md`):

```markdown
---
name: Feature Request
about: Suggest a new feature
title: "[FEATURE] "
labels: enhancement
assignees: ""
---

## Feature Description

A clear and concise description of the feature you'd like.

## Use Case

Describe your use case and how this feature would help.

## Proposed Solution

How you envision this feature working.

## Alternatives Considered

Any alternative solutions you've considered.

## Additional Context

Any other context, mockups, or examples.
```

---

## Step 3: Configure GitHub Secrets

The cross-repository publish workflow in `QueryPilot/studio` needs access to `QueryPilot/studio-app`.

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: **Query Pilot Release Publisher**
4. Scopes:
   - ✅ `repo` (Full control of private repositories)
5. Click "Generate token"
6. Copy the token

7. Go to https://github.com/QueryPilot/studio/settings/secrets/actions
8. Click "New repository secret"
9. Name: **RELEASE_PAT**
10. Value: Paste the token
11. Click "Add secret"

---

## Step 4: Enable GitHub Releases

1. Go to https://github.com/QueryPilot/studio-app/settings
2. Scroll to "Features"
3. Ensure "Releases" is checked ✅

---

## Step 5: Set Up Branch Protection (Optional)

Protect the main branch to prevent accidental changes:

1. Go to https://github.com/QueryPilot/studio-app/settings/branches
2. Click "Add rule"
3. Branch name pattern: `main`
4. Enable:
   - ✅ Require pull request before merging
   - ✅ Require approvals: 1
5. Click "Create"

---

## Step 6: Create Initial Release (Optional)

Create a placeholder release to test the setup:

```bash
# In the studio-app repository
git tag v0.4.0
git push origin v0.4.0

gh release create v0.4.0 \
  --title "Query Pilot v0.4.0" \
  --notes "Initial release - Testing distribution setup" \
  --draft
```

---

## Step 7: Verify Setup

Test the update manifest endpoint:

```bash
# After publishing a release with latest.json
curl https://github.com/QueryPilot/studio-app/releases/latest/download/latest.json
```

Expected response:

```json
{
  "version": "0.4.0",
  "notes": "...",
  "pub_date": "2025-11-20T...",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v0.4.0/Query-Pilot_aarch64.dmg"
    }
  }
}
```

---

## Workflow Summary

Once set up, the release process works like this:

1. **Developer** runs `./scripts/smart-release-v2.sh` in `QueryPilot/studio`
2. **AI** analyzes commits and generates changelog
3. **Script** bumps version, commits, tags, and pushes
4. **GitHub Actions** builds binaries in `QueryPilot/studio`
5. **GitHub Actions** generates update manifest with signatures
6. **GitHub Actions** publishes to `QueryPilot/studio-app`
7. **Users** download from `QueryPilot/studio-app/releases`
8. **App** checks for updates via `latest.json` endpoint

---

## Troubleshooting

### Release Not Appearing in studio-app

- Verify `RELEASE_PAT` secret is set correctly
- Check GitHub Actions logs in `QueryPilot/studio`
- Ensure the token has `repo` scope
- Verify the workflow completed successfully

### Update Manifest Not Accessible

- Wait 1-2 minutes after release creation
- Check that `latest.json` was uploaded to the release
- Verify the release is published (not draft)

### App Not Detecting Updates

- Verify `tauri.conf.json` has correct endpoint URL
- Check that public key matches the signing key
- Look for errors in app console (Cmd+Opt+I on macOS)
- Ensure app version is lower than released version

---

## Next Steps

- [ ] Customize README.md with your branding
- [ ] Add logo and screenshots to `assets/` directory
- [ ] Create Wiki pages for documentation
- [ ] Set up GitHub Discussions for community
- [ ] Configure custom domain (optional)

---

## Resources

- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Tauri Updater Plugin](https://tauri.app/plugin/updater/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
