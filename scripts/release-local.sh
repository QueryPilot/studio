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
VERSION="${VERSION#v}"  # Strip v prefix if present (e.g., v2026.1.0 → 2026.1.0)
TARGETS="aarch64-apple-darwin x86_64-apple-darwin universal-apple-darwin"

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
CONTEXT_FILE=""

log() { echo -e "${BLUE}[relc]${NC} $1" >&2; }
success() { echo -e "${GREEN}[relc]${NC} $1" >&2; }
warn() { echo -e "${YELLOW}[relc]${NC} $1" >&2; }
error() { echo -e "${RED}[relc]${NC} $1" >&2; exit 1; }

# Auto-load Tauri updater signing key from .tauri/updater/ if not already set
UPDATER_KEY_DIR=".tauri/updater"
if [ -z "$TAURI_PRIVATE_KEY" ] && [ -f "$UPDATER_KEY_DIR/query-pilot.key" ]; then
    export TAURI_PRIVATE_KEY=$(cat "$UPDATER_KEY_DIR/query-pilot.key")
    log "Loaded TAURI_PRIVATE_KEY from $UPDATER_KEY_DIR/query-pilot.key"
fi

# Tauri 2 expects these env var names during build
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_PRIVATE_KEY:-}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_KEY_PASSWORD:-}"

# Check required tools
check_requirements() {
    log "Checking requirements..."

    command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) not installed. Run: brew install gh"
    command -v pnpm >/dev/null 2>&1 || error "pnpm not installed"
    command -v cargo >/dev/null 2>&1 || error "Rust/Cargo not installed"
    command -v jq >/dev/null 2>&1 || error "jq not installed. Run: brew install jq"

    # Check gh auth
    gh auth status >/dev/null 2>&1 || error "Not logged into GitHub CLI. Run: gh auth login"

    # Check codesign identity
    if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
        error "No Developer ID Application certificate found in keychain"
    fi

    # Check Rust targets for cross-compilation
    for t in aarch64-apple-darwin x86_64-apple-darwin; do
        if ! rustup target list --installed | grep -q "$t"; then
            log "Installing $t target..."
            rustup target add "$t"
        fi
    done

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
    success "All tests passed"
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
            if gh release view "v$CURRENT_VERSION" --repo QueryPilot/QueryPilot &>/dev/null 2>&1; then
                gh release delete "v$CURRENT_VERSION" --repo QueryPilot/QueryPilot --yes
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

    VERSION_PROMPT="Analyze the git commits above and determine the next version.

Current version: $CURRENT_VERSION

This project uses DataGrip-style versioning: YYYY.MAJOR.MINOR[-PRERELEASE.N]
- YYYY = current year (e.g., 2026)
- MAJOR = major feature release number within the year
- MINOR = minor release or patch within the major
- Optional pre-release: -alpha.N, -beta.N, or -rc.N

Examples: 2026.1.0, 2026.1.1, 2026.2.0, 2026.2.0-beta.1

Rules for version bump:
- If commits contain breaking changes or major new features: bump MAJOR (e.g., 2026.1.0 -> 2026.2.0)
- If commits contain new features (feat:): bump MINOR (e.g., 2026.1.0 -> 2026.1.1)
- If commits are fixes/chores only: bump MINOR (e.g., 2026.1.0 -> 2026.1.1)
- If current version is a pre-release (e.g., -beta.1): bump the pre-release number (e.g., -beta.2)
- If entering a new year: use the new year (e.g., 2025.3.0 -> 2026.1.0)

Based on the commits, respond with ONLY the next version number (e.g., 2026.1.1).
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

    # Validate version format (must match bump-version.sh regex)
    if ! echo "$SUGGESTED_VERSION" | grep -qE '^[0-9]{4}\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$'; then
        warn "AI returned invalid version: $SUGGESTED_VERSION"
        echo ""
        read -p "Enter version manually (e.g., 2026.1.0 or 2026.1.0-beta.1): " MANUAL_VERSION
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

    # Regenerate Cargo.lock after version bump
    log "Regenerating Cargo.lock..."
    cargo update -w

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
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md Cargo.lock

    # Create commit message with changelog summary
    COMMIT_MSG="chore: release v$version

$(echo "$changelog" | sed 's/^## \[.*\] - .*//; s/^### /- /; s/^- $//; /^$/d' | head -20)"

    git commit -m "$COMMIT_MSG"

    log "Creating tag v$version..."
    git tag -fa "v$version" -m "Release v$version"

    success "Version bumped and tagged (not pushed — local release only uploads artifacts)"
}

# Build MCP sidecar (mirrors CI: .github/workflows/release.yml)
build_mcp_sidecar() {
    log "Building MCP sidecar (all targets)..."

    cargo build --release --package querypilot-mcp --target aarch64-apple-darwin
    cargo build --release --package querypilot-mcp --target x86_64-apple-darwin

    mkdir -p target/release

    # Create arch-specific copies for Tauri bundling
    cp target/aarch64-apple-darwin/release/querypilot-mcp target/release/querypilot-mcp-aarch64-apple-darwin
    cp target/x86_64-apple-darwin/release/querypilot-mcp target/release/querypilot-mcp-x86_64-apple-darwin

    # Create universal binary
    lipo -create \
        target/aarch64-apple-darwin/release/querypilot-mcp \
        target/x86_64-apple-darwin/release/querypilot-mcp \
        -output target/release/querypilot-mcp-universal-apple-darwin

    success "MCP sidecar built (arm64 + x64 + universal)"
}

# Build Tauri app for all targets
build_app() {
    # Check for notarization credentials
    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        warn "Notarization env vars not set - app will be signed but NOT notarized"
    else
        log "Notarization credentials found"
    fi

    # Signing key is required for updater artifacts
    if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
        error "TAURI_SIGNING_PRIVATE_KEY not set. Run scripts/generate-updater-keys.sh or set TAURI_PRIVATE_KEY in .env"
    else
        log "Tauri signing key configured"
    fi

    # Build with telemetry if SENTRY_DSN is set
    BUILD_FEATURES=""
    if [ -n "$SENTRY_DSN" ]; then
        log "Sentry DSN found - building with telemetry"
        BUILD_FEATURES="--features telemetry"
    fi

    for target in $TARGETS; do
        log "Building Tauri app for $target..."
        NODE_OPTIONS="--max-old-space-size=6144" \
        VITE_DISABLE_SOURCEMAPS="true" \
        pnpm tauri build --target "$target" -- $BUILD_FEATURES
        success "Built: $target"
    done

    success "All targets built"
}

# Map target triple to arch suffix for artifact naming
arch_suffix() {
    case "$1" in
        aarch64-apple-darwin) echo "aarch64" ;;
        x86_64-apple-darwin)  echo "x86_64" ;;
        universal-apple-darwin) echo "universal" ;;
        *) echo "$1" ;;
    esac
}

# Collect DMGs and updater artifacts from all targets
prepare_artifacts() {
    log "Collecting artifacts from all targets..."

    ARTIFACT_FILES=""

    for target in $TARGETS; do
        local suffix
        suffix=$(arch_suffix "$target")

        # Find DMG
        DMG_PATH=$(find "target/$target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -n 1)
        if [ -z "$DMG_PATH" ]; then
            DMG_PATH=$(find "src-tauri/target/$target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -n 1)
        fi
        [ -n "$DMG_PATH" ] || error "No DMG found for $target"

        DMG_NAME="QueryPilot_v${NEXT_VERSION}_${suffix}.dmg"
        cp "$DMG_PATH" "$DMG_NAME"
        ARTIFACT_FILES="$ARTIFACT_FILES $DMG_NAME"
        success "DMG: $DMG_NAME"

        # Find updater artifacts for each target
        UPDATER_ARCHIVE=$(find "target/$target/release/bundle" -name "*.app.tar.gz" 2>/dev/null | head -n 1)
        if [ -z "$UPDATER_ARCHIVE" ]; then
            UPDATER_ARCHIVE=$(find "src-tauri/target/$target/release/bundle" -name "*.app.tar.gz" 2>/dev/null | head -n 1)
        fi
        UPDATER_SIG=$(find "target/$target/release/bundle" -name "*.app.tar.gz.sig" 2>/dev/null | head -n 1)
        if [ -z "$UPDATER_SIG" ]; then
            UPDATER_SIG=$(find "src-tauri/target/$target/release/bundle" -name "*.app.tar.gz.sig" 2>/dev/null | head -n 1)
        fi

        if [ -z "$UPDATER_ARCHIVE" ] || [ -z "$UPDATER_SIG" ]; then
            error "Missing updater artifacts for $target. Ensure TAURI_SIGNING_PRIVATE_KEY is set."
        fi

        # Rename with arch suffix to avoid collisions
        ARCHIVE_NAME="QueryPilot_v${NEXT_VERSION}_${suffix}.app.tar.gz"
        SIG_NAME="QueryPilot_v${NEXT_VERSION}_${suffix}.app.tar.gz.sig"
        cp "$UPDATER_ARCHIVE" "$ARCHIVE_NAME"
        cp "$UPDATER_SIG" "$SIG_NAME"
        ARTIFACT_FILES="$ARTIFACT_FILES $ARCHIVE_NAME $SIG_NAME"

        success "Updater: $ARCHIVE_NAME + $SIG_NAME"
    done
}

# Generate update manifest (reads signature from .sig file, points at .app.tar.gz)
generate_manifest() {
    local version="$1"

    log "Generating update manifest..."

    PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Extract release notes (matches CI awk pattern)
    VERSION_NUMBER="${version#v}"
    RAW_NOTES=$(awk "/^## \[$VERSION_NUMBER\]/{found=1;next} found && /^## \[/{exit} found" CHANGELOG.md || true)
    if [ -z "$RAW_NOTES" ]; then
        RAW_NOTES="See CHANGELOG.md for details"
    fi

    BASE_URL="https://github.com/QueryPilot/QueryPilot/releases/download/v$version"

    # Arch-specific updater archives
    AARCH64_ARCHIVE="QueryPilot_v${version}_aarch64.app.tar.gz"
    AARCH64_SIG="QueryPilot_v${version}_aarch64.app.tar.gz.sig"
    X86_64_ARCHIVE="QueryPilot_v${version}_x86_64.app.tar.gz"
    X86_64_SIG="QueryPilot_v${version}_x86_64.app.tar.gz.sig"

    for f in "$AARCH64_SIG" "$X86_64_SIG"; do
        [ -f "$f" ] || error "Missing signature file: $f"
    done

    AARCH64_SIGNATURE=$(tr -d '\r\n' < "$AARCH64_SIG")
    X86_64_SIGNATURE=$(tr -d '\r\n' < "$X86_64_SIG")

    # Build manifest with arch-specific URLs (matches CI)
    jq -n \
        --arg version "$version" \
        --arg notes "$RAW_NOTES" \
        --arg pub_date "$PUB_DATE" \
        --arg aarch64_sig "$AARCH64_SIGNATURE" \
        --arg aarch64_url "$BASE_URL/$AARCH64_ARCHIVE" \
        --arg x86_64_sig "$X86_64_SIGNATURE" \
        --arg x86_64_url "$BASE_URL/$X86_64_ARCHIVE" \
        '{
            version: $version,
            notes: $notes,
            pub_date: $pub_date,
            platforms: {
                "darwin-aarch64": { signature: $aarch64_sig, url: $aarch64_url },
                "darwin-x86_64": { signature: $x86_64_sig, url: $x86_64_url }
            }
        }' > latest.json

    success "Manifest generated: latest.json"
    cat latest.json
}

# Publish release to QueryPilot/QueryPilot (public app repo)
# Local releases go directly here — no studio repo release (that's what CI does)
publish_release() {
    local version="$1"
    local changelog="$2"

    log "Publishing to QueryPilot/QueryPilot..."

    # Check if we have access
    if ! gh repo view QueryPilot/QueryPilot &>/dev/null; then
        error "No access to QueryPilot/QueryPilot"
    fi

    # Delete existing release if exists
    if gh release view "v$version" --repo QueryPilot/QueryPilot &>/dev/null; then
        warn "Release v$version exists, deleting..."
        gh release delete "v$version" --repo QueryPilot/QueryPilot --yes
    fi

    # Determine prerelease flag
    PRERELEASE=""
    if [[ "$version" == *"alpha"* ]] || [[ "$version" == *"beta"* ]] || [[ "$version" == *"rc"* ]]; then
        PRERELEASE="--prerelease"
    fi

    # Create release notes (changelog only)
    cat > /tmp/release-notes.md << EOF
$changelog
EOF

    # Create release with all artifacts
    # shellcheck disable=SC2086
    gh release create "v$version" \
        --repo QueryPilot/QueryPilot \
        --title "Query Pilot v$version" \
        --notes-file /tmp/release-notes.md \
        $PRERELEASE \
        $ARTIFACT_FILES \
        latest.json \
        CHANGELOG.md

    success "Published to QueryPilot/QueryPilot"
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

    build_mcp_sidecar
    build_app
    prepare_artifacts
    generate_manifest "$NEXT_VERSION"
    publish_release "$NEXT_VERSION" "$NEW_CHANGELOG"

    echo ""
    echo -e "${GREEN}==========================================${NC}"
    echo -e "${GREEN}  Release v$NEXT_VERSION complete!${NC}"
    echo -e "${GREEN}==========================================${NC}"
    echo ""
    echo "  https://github.com/QueryPilot/QueryPilot/releases/tag/v$NEXT_VERSION"
    echo ""
}

main
