#!/bin/bash
set -e

# AI-Powered Local Release Script
# Builds universal macOS binary (Intel + Apple Silicon), signs, notarizes, and uploads to GitHub
# with AI-assisted versioning and changelog
# Usage: make relc V=0.7.1  (optional version override)

# Load .env if exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Also load .env.local for overrides
if [ -f .env.local ]; then
    set -a
    source .env.local
    set +a
fi

VERSION="${1:-}"
TARGET="${2:-universal-apple-darwin}"
ARCH="universal"  # Universal build supports both Intel and Apple Silicon

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# AI CLI detection
AI_CLI=""
AI_EXEC=""

log() { echo -e "${BLUE}[relc]${NC} $1" >&2; }
success() { echo -e "${GREEN}[relc]${NC} $1" >&2; }
warn() { echo -e "${YELLOW}[relc]${NC} $1" >&2; }
error() { echo -e "${RED}[relc]${NC} $1" >&2; exit 1; }

# Check required tools
check_requirements() {
    log "Checking requirements..."

    command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) not installed. Run: brew install gh"
    command -v pnpm >/dev/null 2>&1 || error "pnpm not installed"
    command -v cargo >/dev/null 2>&1 || error "Rust/Cargo not installed"
    command -v bun >/dev/null 2>&1 || error "Bun not installed"
    command -v jq >/dev/null 2>&1 || error "jq not installed. Run: brew install jq"

    # Check gh auth
    gh auth status >/dev/null 2>&1 || error "Not logged into GitHub CLI. Run: gh auth login"

    # Check codesign identity
    if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
        error "No Developer ID Application certificate found in keychain"
    fi

    # Check Rust targets for universal build
    if ! rustup target list --installed | grep -q "aarch64-apple-darwin"; then
        log "Installing aarch64-apple-darwin target..."
        rustup target add aarch64-apple-darwin
    fi
    if ! rustup target list --installed | grep -q "x86_64-apple-darwin"; then
        log "Installing x86_64-apple-darwin target..."
        rustup target add x86_64-apple-darwin
    fi

    # Check for AI CLI (codex or claude)
    if command -v codex &> /dev/null; then
        AI_CLI="codex"
        AI_EXEC="codex exec"
        log "Using AI CLI: codex"
    elif command -v claude &> /dev/null; then
        AI_CLI="claude"
        AI_EXEC="claude -p"
        log "Using AI CLI: claude"
    else
        echo ""
        error "Neither codex nor claude CLI found.

Install one of:
  - Codex: npm install -g @openai/codex-cli
  - Claude: See https://docs.anthropic.com/claude-code

Cannot proceed without AI CLI for version and changelog generation."
    fi

    success "All requirements met"
}

# Run all tests before release
run_tests() {
    log "Running tests before release..."
    echo ""

    # Build AI sidecar first (required for some tests)
    log "Building AI sidecar for tests..."
    bash scripts/build-ai-sidecar.sh >/dev/null 2>&1 || error "Failed to build AI sidecar"

    # Run Rust backend tests
    log "Running Rust backend tests..."
    if ! (cd src-tauri && cargo test --lib --bins 2>&1); then
        error "Rust tests failed! Fix tests before releasing."
    fi
    success "Rust tests passed"

    # Run Frontend tests
    log "Running Frontend tests..."
    if ! pnpm test:unit 2>&1; then
        error "Frontend tests failed! Fix tests before releasing."
    fi
    success "Frontend tests passed"

    # Run integration tests if PostgreSQL is available
    if nc -z 127.0.0.1 15432 2>/dev/null; then
        log "Running integration tests (PostgreSQL available)..."
        if ! (cd src-tauri && cargo test --test binary_types_test 2>&1); then
            error "Integration tests failed! Fix tests before releasing."
        fi
        success "Integration tests passed"
    else
        warn "Skipping integration tests (PostgreSQL not available at localhost:15432)"
    fi

    echo ""
    success "All tests passed ✓"
    echo ""
}

# Analyze commits since last tag
analyze_commits() {
    log "Analyzing commits since last release..."

    CURRENT_VERSION=$(jq -r '.version' package.json)
    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    if [ -z "$LAST_TAG" ]; then
        warn "No previous tags found - this will be the first release"
        COMMIT_RANGE="HEAD"
    else
        log "Last tag: $LAST_TAG"
        COMMIT_RANGE="$LAST_TAG..HEAD"
    fi

    # Get commits since last tag
    COMMITS=$(git log $COMMIT_RANGE --pretty=format:"%h|%s|%b" --no-merges 2>/dev/null || echo "")

    if [ -z "$COMMITS" ]; then
        warn "No new commits since last release"
        echo "" >&2
        echo "Options:" >&2
        echo "  y - Create release anyway" >&2
        echo "  r - Delete current release (v$CURRENT_VERSION) and redo" >&2
        echo "  N - Abort" >&2
        echo "" >&2
        read -p "Choose option (y/r/N): " -n 1 -r
        echo >&2
        if [[ $REPLY =~ ^[Rr]$ ]]; then
            log "Deleting current release v$CURRENT_VERSION..."
            # Delete GitHub release if exists
            if gh release view "v$CURRENT_VERSION" &>/dev/null; then
                gh release delete "v$CURRENT_VERSION" --yes
                success "GitHub release deleted"
            fi
            # Delete from studio-app repo if exists
            if gh release view "v$CURRENT_VERSION" --repo QueryPilot/studio-app &>/dev/null 2>&1; then
                gh release delete "v$CURRENT_VERSION" --repo QueryPilot/studio-app --yes
                success "GitHub release deleted from studio-app"
            fi
            # Delete local and remote tag
            if git tag -l "v$CURRENT_VERSION" | grep -q .; then
                git tag -d "v$CURRENT_VERSION" >&2
                git push origin --delete "v$CURRENT_VERSION" >&2 2>/dev/null || true
                success "Git tag deleted"
            fi
            # Reset commit range to include all commits since previous tag
            LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
            if [ -n "$LAST_TAG" ]; then
                COMMIT_RANGE="$LAST_TAG..HEAD"
            else
                COMMIT_RANGE="HEAD"
            fi
            COMMITS=$(git log $COMMIT_RANGE --pretty=format:"%h|%s|%b" --no-merges 2>/dev/null || echo "")
            success "Ready to redo release"
        elif [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted." >&2
            exit 1
        fi
    fi

    COMMIT_COUNT=$(echo "$COMMITS" | grep -c '^' || echo "0")
    success "Found $COMMIT_COUNT commits to analyze"

    # Create context file for AI
    CONTEXT_FILE=$(mktemp)
    cat > "$CONTEXT_FILE" << EOF
# Project Context
Project: Query Pilot (DevDB Studio)
Current Version: $CURRENT_VERSION
Last Tag: ${LAST_TAG:-none}

# Recent Commits (since last release)
$COMMITS

# Current Git Status
$(git status --short)

# Files Changed
$(git diff --stat $COMMIT_RANGE 2>/dev/null || echo "First release")
EOF

    echo "$CONTEXT_FILE"
}

# Use AI to suggest version
suggest_version() {
    local context_file="$1"

    log "Asking $AI_CLI to analyze commits and suggest version..."

    VERSION_PROMPT="Analyze the git commits above and determine the next semantic version.

Current version: $CURRENT_VERSION

Rules:
- MAJOR bump (x.0.0): Breaking changes, API changes, major refactors
- MINOR bump (0.x.0): New features, enhancements (feat:, feature:)
- PATCH bump (0.0.x): Bug fixes, docs, chores (fix:, chore:, docs:)

Look for conventional commit prefixes:
- feat: / feature: → MINOR bump
- fix: / bugfix: → PATCH bump
- BREAKING CHANGE: → MAJOR bump
- refactor:, perf: → evaluate context
- chore:, docs:, style: → PATCH bump

Based on the commits, respond with ONLY the next version number (e.g., 1.2.0).
No explanation, just the version number."

    local context
    context=$(cat "$context_file")

    if [ "$AI_CLI" = "codex" ]; then
        SUGGESTED_VERSION=$(codex exec "$context

$VERSION_PROMPT" 2>/dev/null | tail -1 | tr -d '[:space:]' | sed 's/^v//')
    else
        SUGGESTED_VERSION=$(echo "$context

$VERSION_PROMPT" | claude -p 2>/dev/null | tail -1 | tr -d '[:space:]' | sed 's/^v//')
    fi

    # Validate version format
    if ! echo "$SUGGESTED_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
        warn "AI returned invalid version: $SUGGESTED_VERSION"
        echo ""
        read -p "Enter version manually (e.g., 1.2.0): " MANUAL_VERSION
        SUGGESTED_VERSION="$MANUAL_VERSION"
    fi

    success "Suggested version: v$SUGGESTED_VERSION"
    echo "" >&2

    # Confirm version
    read -p "Use this version? (Y/n) " -n 1 -r
    echo >&2
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        read -p "Enter version: " MANUAL_VERSION
        SUGGESTED_VERSION="${MANUAL_VERSION#v}"
    fi

    echo "$SUGGESTED_VERSION"
}

# Use AI to generate changelog
generate_changelog() {
    local context_file="$1"
    local version="$2"

    log "Asking $AI_CLI to generate professional changelog..."

    CHANGELOG_PROMPT="Generate a professional, user-friendly changelog for Query Pilot v$version based on the commits above.

Audience: End users (developers, DBAs, data analysts)
Tone: Professional, clear, conversational (but no emojis in the markdown)
Format: Clean markdown with clear sections

Categories (only include if relevant):
### New Features
Major new capabilities users will love

### Improvements
Enhancements to existing features

### Bug Fixes
Issues resolved in this release

### Breaking Changes
Changes requiring user action (if any)

### Security
Security improvements (if any)

Rules for content:
1. Write for humans, not developers (\"You can now...\" vs \"Implemented...\")
2. Focus on user benefits, not implementation details
3. Group related changes together
4. Start with most impactful changes
5. Keep each item to 1-2 sentences max
6. Use active voice (\"Added...\" not \"Support was added...\")
7. Skip internal changes (chores, refactors, deps) unless user-visible
8. Highlight performance improvements with context
9. Be specific about what changed and why it matters
10. NO EMOJIS in the markdown output

Format:
## [$version] - $(date +%Y-%m-%d)

### New Features
- Feature description that explains what users can do now

### Improvements
- Enhancement description that shows the benefit

### Bug Fixes
- Bug fix description explaining what was wrong and now works

Example tone:
- BAD: \"Implemented SSH tunnel support with health checks\"
- GOOD: \"Connect to remote databases securely through SSH tunnels. Automatic health monitoring ensures connections stay stable.\"

Output ONLY the changelog entry, starting with ## [$version]"

    local context
    context=$(cat "$context_file")

    if [ "$AI_CLI" = "codex" ]; then
        NEW_CHANGELOG=$(codex exec "$context

$CHANGELOG_PROMPT" 2>/dev/null)
    else
        NEW_CHANGELOG=$(echo "$context

$CHANGELOG_PROMPT" | claude -p 2>/dev/null)
    fi

    echo "" >&2
    success "Generated changelog:"
    echo "" >&2
    echo "$NEW_CHANGELOG" >&2
    echo "" >&2

    # Confirm changelog
    read -p "Use this changelog? (Y/n) " -n 1 -r
    echo >&2
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "" >&2
        warn "Opening editor to customize changelog..."
        TEMP_CHANGELOG=$(mktemp)
        echo "$NEW_CHANGELOG" > "$TEMP_CHANGELOG"
        ${EDITOR:-vim} "$TEMP_CHANGELOG"
        NEW_CHANGELOG=$(cat "$TEMP_CHANGELOG")
        rm -f "$TEMP_CHANGELOG"
    fi

    echo "$NEW_CHANGELOG"
}

# Update CHANGELOG.md with new entry
update_changelog() {
    local changelog_content="$1"

    log "Updating CHANGELOG.md..."

    if [ -f "CHANGELOG.md" ]; then
        TEMP_CHANGELOG=$(mktemp)
        echo "$changelog_content" > "$TEMP_CHANGELOG"

        TEMP_FILE=$(mktemp)

        if grep -q "^## \[[0-9]" CHANGELOG.md; then
            # Insert before first version entry
            awk '
                /^## \[[0-9]/ && !inserted {
                    system("cat '"$TEMP_CHANGELOG"'")
                    print ""
                    inserted=1
                }
                {print}
            ' CHANGELOG.md > "$TEMP_FILE"
        else
            # No version entries yet, append after header
            cat CHANGELOG.md > "$TEMP_FILE"
            echo "" >> "$TEMP_FILE"
            cat "$TEMP_CHANGELOG" >> "$TEMP_FILE"
        fi

        mv "$TEMP_FILE" CHANGELOG.md
        rm -f "$TEMP_CHANGELOG"
        success "CHANGELOG.md updated"
    else
        warn "CHANGELOG.md not found, creating..."
        echo "# Changelog

All notable changes to Query Pilot will be documented in this file.

$changelog_content
" > CHANGELOG.md
        success "CHANGELOG.md created"
    fi
}

# Bump version in all files and commit
bump_version() {
    local version="$1"
    local changelog="$2"

    log "Bumping version to $version..."
    bash scripts/bump-version.sh "$version"

    echo ""
    log "Changes to commit:"
    git diff --stat
    echo ""

    read -p "Commit these changes? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        error "Aborted. Changes not committed."
    fi

    log "Committing version bump..."
    git add .

    # Create commit message with changelog summary
    COMMIT_MSG="chore: release v$version

$(echo "$changelog" | sed 's/^## \[.*\] - .*//; s/^### /- /; s/^- $//; /^$/d' | head -20)"

    git commit -m "$COMMIT_MSG"

    log "Creating tag v$version..."
    git tag -a "v$version" -m "Release v$version"

    log "Pushing to remote..."
    git push origin master
    git push origin "v$version"

    success "Version bumped, committed and pushed"
}

# Build AI sidecar
build_sidecar() {
    log "Building AI sidecars for universal macOS build..."
    BUILD_ALL=true bash scripts/build-ai-sidecar.sh

    # Verify both architectures for universal build
    for arch_target in aarch64-apple-darwin x86_64-apple-darwin; do
        SIDECAR="src-tauri/sidecars/qp-ai-$arch_target"
        [ -f "$SIDECAR" ] || error "Sidecar not found: $SIDECAR"
    done
    success "AI sidecars built for both architectures"
}

# Download SSM plugin
download_ssm() {
    log "Downloading AWS Session Manager plugins for universal build..."
    BUILD_ALL=true bash scripts/download-ssm-plugin.sh
    success "SSM plugins downloaded for both architectures"
}

# Build Tauri app with signing
build_app() {
    log "Building Tauri app for $TARGET..."

    # Check for update checker token
    if [ -z "$GITHUB_RELEASE_TOKEN" ]; then
        warn "GITHUB_RELEASE_TOKEN not set - update checker will be disabled"
    else
        log "Update checker token configured"
    fi

    # Check for notarization credentials
    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        warn "Notarization env vars not set - app will be signed but NOT notarized"
    else
        log "Notarization credentials found"
    fi

    # Build with telemetry if SENTRY_DSN is set
    BUILD_FEATURES=""
    if [ -n "$SENTRY_DSN" ]; then
        log "Sentry DSN found - building with telemetry"
        BUILD_FEATURES="--features telemetry"
    fi

    # Build
    NODE_OPTIONS="--max-old-space-size=6144" \
    VITE_DISABLE_SOURCEMAPS="true" \
    pnpm tauri build --target "$TARGET" -- $BUILD_FEATURES

    success "Tauri app built"
}

# Find and rename DMG
prepare_dmg() {
    log "Preparing DMG..."

    # Universal builds output to universal-apple-darwin directory
    DMG_PATH=$(find "src-tauri/target/$TARGET/release/bundle/dmg" -name "*.dmg" | head -n 1)
    [ -n "$DMG_PATH" ] || error "No DMG file found!"

    # DMG_NAME will be set after version is determined
    cp "$DMG_PATH" "QueryPilot_v${NEXT_VERSION}.dmg"

    success "DMG ready: QueryPilot_v${NEXT_VERSION}.dmg (universal binary)"
}

# Create GitHub release
create_release() {
    local version="$1"
    local changelog="$2"

    log "Creating GitHub release v$version..."

    # Delete existing release if exists
    if gh release view "v$version" &>/dev/null; then
        warn "Release v$version exists, deleting..."
        gh release delete "v$version" --yes
    fi

    # Determine prerelease flag
    PRERELEASE=""
    if [[ "$version" == *"alpha"* ]] || [[ "$version" == *"beta"* ]] || [[ "$version" == *"rc"* ]]; then
        PRERELEASE="--prerelease"
    fi

    # Create release notes
    cat > /tmp/release-notes.md << EOF
$changelog

---

### Installation

**macOS**
- Download \`QueryPilot_v$version.dmg\` (works on both Intel and Apple Silicon)
- Open DMG and drag Query Pilot to Applications

### Code Signing
- Signed with Apple Developer ID
$([ -n "$APPLE_ID" ] && echo "- Notarized with Apple" || echo "- **Not notarized** (local build)")

### Full Changelog
See [CHANGELOG.md](https://github.com/QueryPilot/studio/blob/master/CHANGELOG.md)
EOF

    # Create draft release
    gh release create "v$version" \
        --draft \
        $PRERELEASE \
        --title "Query Pilot v$version" \
        --notes-file /tmp/release-notes.md

    success "Draft release created"
}

# Upload DMG to release
upload_dmg() {
    local version="$1"
    local dmg_file="QueryPilot_v${version}.dmg"

    log "Uploading $dmg_file to release..."
    gh release upload "v$version" "$dmg_file" --clobber
    success "DMG uploaded"
}

# Generate update manifest
generate_manifest() {
    local version="$1"

    log "Generating update manifest..."

    PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    NOTES=$(awk "/^## \[$version\]/,/^## \[[0-9]/" CHANGELOG.md | head -n 10 | sed 's/"/\\"/g' | tr '\n' ' ' || echo "See CHANGELOG.md")
    DMG_NAME="QueryPilot_v${version}.dmg"

    # Check for Tauri signing key
    if [ -n "$TAURI_PRIVATE_KEY" ]; then
        log "Signing DMG with Tauri key..."
        echo "$TAURI_PRIVATE_KEY" > /tmp/tauri-key
        chmod 600 /tmp/tauri-key

        SIGNATURE=$(pnpm tauri signer sign "$DMG_NAME" --private-key /tmp/tauri-key --password "${TAURI_KEY_PASSWORD:-}" 2>/dev/null || echo "")
        rm -f /tmp/tauri-key

        if [ -n "$SIGNATURE" ]; then
            # Universal DMG works for both architectures
            cat > latest.json << EOF
{
  "version": "$version",
  "notes": "$NOTES",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$version/$DMG_NAME"
    },
    "darwin-x86_64": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$version/$DMG_NAME"
    }
  }
}
EOF
        else
            warn "Failed to sign, creating unsigned manifest"
            create_unsigned_manifest "$version" "$NOTES" "$PUB_DATE"
        fi
    else
        warn "TAURI_PRIVATE_KEY not set, creating unsigned manifest"
        create_unsigned_manifest "$version" "$NOTES" "$PUB_DATE"
    fi

    success "Manifest generated: latest.json"
    cat latest.json
}

create_unsigned_manifest() {
    local version="$1"
    local notes="$2"
    local pub_date="$3"
    local dmg_name="QueryPilot_v${version}.dmg"

    # Universal DMG works for both architectures
    cat > latest.json << EOF
{
  "version": "$version",
  "notes": "$notes",
  "pub_date": "$pub_date",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$version/$dmg_name"
    },
    "darwin-x86_64": {
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$version/$dmg_name"
    }
  }
}
EOF
}

# Upload manifest
upload_manifest() {
    local version="$1"

    log "Uploading manifest to release..."
    gh release upload "v$version" latest.json --clobber
    success "Manifest uploaded"
}

# Publish to studio-app repo
publish_to_app_repo() {
    local version="$1"

    log "Publishing to QueryPilot/studio-app..."

    # Check if we have access
    if ! gh repo view QueryPilot/studio-app &>/dev/null; then
        warn "No access to QueryPilot/studio-app, skipping cross-repo publish"
        return
    fi

    # Delete existing release in app repo
    if gh release view "v$version" --repo QueryPilot/studio-app &>/dev/null; then
        warn "Release exists in studio-app, deleting..."
        gh release delete "v$version" --repo QueryPilot/studio-app --yes
    fi

    PRERELEASE=""
    [[ "$version" == *"alpha"* ]] || [[ "$version" == *"beta"* ]] || [[ "$version" == *"rc"* ]] && PRERELEASE="--prerelease"

    gh release create "v$version" \
        --repo QueryPilot/studio-app \
        --title "Query Pilot v$version" \
        --notes-file /tmp/release-notes.md \
        $PRERELEASE \
        "QueryPilot_v${version}.dmg" \
        latest.json \
        CHANGELOG.md

    success "Published to QueryPilot/studio-app"
}

# Finalize release
finalize_release() {
    local version="$1"

    log "Publishing release..."
    gh release edit "v$version" --draft=false
    success "Release published!"

    # Auto-publish to studio-app
    publish_to_app_repo "$version"
}

# Cleanup
cleanup() {
    rm -f /tmp/release-notes.md /tmp/tauri-key "$CONTEXT_FILE" 2>/dev/null || true
}

# Main
main() {
    trap cleanup EXIT

    echo ""
    echo -e "${MAGENTA}==========================================${NC}"
    echo -e "${MAGENTA}  Query Pilot AI-Powered Local Release${NC}"
    echo -e "${MAGENTA}==========================================${NC}"
    echo ""

    check_requirements
    run_tests

    # If version provided via arg, skip AI version suggestion
    if [ -n "$VERSION" ]; then
        log "Using specified version: $VERSION"
        NEXT_VERSION="$VERSION"

        # Still analyze commits for changelog
        CONTEXT_FILE=$(analyze_commits)
        NEW_CHANGELOG=$(generate_changelog "$CONTEXT_FILE" "$NEXT_VERSION")
    else
        # Full AI flow
        CONTEXT_FILE=$(analyze_commits)
        NEXT_VERSION=$(suggest_version "$CONTEXT_FILE")
        NEW_CHANGELOG=$(generate_changelog "$CONTEXT_FILE" "$NEXT_VERSION")
    fi

    update_changelog "$NEW_CHANGELOG"
    bump_version "$NEXT_VERSION" "$NEW_CHANGELOG"

    echo ""
    log "Starting local build..."
    echo ""

    build_sidecar
    download_ssm
    build_app
    prepare_dmg

    create_release "$NEXT_VERSION" "$NEW_CHANGELOG"
    upload_dmg "$NEXT_VERSION"
    generate_manifest "$NEXT_VERSION"
    upload_manifest "$NEXT_VERSION"
    finalize_release "$NEXT_VERSION"

    echo ""
    echo -e "${GREEN}==========================================${NC}"
    echo -e "${GREEN}  Release v$NEXT_VERSION complete!${NC}"
    echo -e "${GREEN}==========================================${NC}"
    echo ""
    echo "  Source release: https://github.com/QueryPilot/studio/releases/tag/v$NEXT_VERSION"
    echo "  App release:    https://github.com/QueryPilot/studio-app/releases/tag/v$NEXT_VERSION"
    echo ""
}

main
