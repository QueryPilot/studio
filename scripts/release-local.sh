#!/bin/bash
set -e

# Local Release Script
# Builds, signs, notarizes, and uploads to GitHub
# Usage: make relc V=0.7.1

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
TARGET="${2:-aarch64-apple-darwin}"
ARCH="${TARGET%%-*}"  # Extract arch from target (aarch64 or x86_64)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[relc]${NC} $1"; }
success() { echo -e "${GREEN}[relc]${NC} $1"; }
warn() { echo -e "${YELLOW}[relc]${NC} $1"; }
error() { echo -e "${RED}[relc]${NC} $1"; exit 1; }

# Check required tools
check_requirements() {
    log "Checking requirements..."

    command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) not installed. Run: brew install gh"
    command -v pnpm >/dev/null 2>&1 || error "pnpm not installed"
    command -v cargo >/dev/null 2>&1 || error "Rust/Cargo not installed"
    command -v bun >/dev/null 2>&1 || error "Bun not installed"

    # Check gh auth
    gh auth status >/dev/null 2>&1 || error "Not logged into GitHub CLI. Run: gh auth login"

    # Check codesign identity
    if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
        error "No Developer ID Application certificate found in keychain"
    fi

    success "All requirements met"
}

# Get version - auto-increment patch if not specified
get_version() {
    CURRENT=$(jq -r '.version' package.json)

    if [ -z "$VERSION" ]; then
        # Auto-increment patch version
        IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT%%-*}"  # Strip any suffix
        PATCH=$((PATCH + 1))
        VERSION="$MAJOR.$MINOR.$PATCH"
        log "Auto-incrementing: $CURRENT → $VERSION"
    else
        log "Using specified version: $VERSION"
    fi

    # Validate semver format
    if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        error "Invalid version format: $VERSION (expected: X.Y.Z or X.Y.Z-suffix)"
    fi

    log "Building version: v$VERSION"
}

# Bump version in all files and commit
bump_version() {
    log "Bumping version to $VERSION..."
    bash scripts/bump-version.sh "$VERSION"

    log "Committing version bump..."
    git add .
    git commit -m "chore: release v$VERSION"

    log "Creating tag v$VERSION..."
    git tag "v$VERSION"

    log "Pushing to remote..."
    git push origin master
    git push origin "v$VERSION"

    success "Version bumped, committed and pushed"
}

# Build AI sidecar
build_sidecar() {
    log "Building AI sidecar for $TARGET..."
    bash scripts/build-ai-sidecar.sh

    SIDECAR="src-tauri/sidecars/qp-ai-$TARGET"
    [ -f "$SIDECAR" ] || error "Sidecar not found: $SIDECAR"
    success "AI sidecar built"
}

# Download SSM plugin
download_ssm() {
    log "Downloading AWS Session Manager plugin..."
    bash scripts/download-ssm-plugin.sh
    success "SSM plugin downloaded"
}

# Build Tauri app with signing
build_app() {
    log "Building Tauri app for $TARGET..."

    # Check for update checker token (compiled into binary)
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

    DMG_PATH=$(find "src-tauri/target/$TARGET/release/bundle/dmg" -name "*.dmg" | head -n 1)
    [ -n "$DMG_PATH" ] || error "No DMG file found!"

    DMG_NAME="Query-Pilot_${ARCH}.dmg"
    cp "$DMG_PATH" "$DMG_NAME"

    success "DMG ready: $DMG_NAME"
}

# Create GitHub release
create_release() {
    log "Creating GitHub release v$VERSION..."

    # Delete existing release if exists
    if gh release view "v$VERSION" &>/dev/null; then
        warn "Release v$VERSION exists, deleting..."
        gh release delete "v$VERSION" --yes
    fi

    # Determine prerelease flag
    PRERELEASE=""
    if [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"rc"* ]]; then
        PRERELEASE="--prerelease"
    fi

    # Extract changelog for this version
    CHANGELOG_CONTENT=$(awk "/^## \[$VERSION\]/{found=1;next} found && /^## \[/{exit} found" CHANGELOG.md || echo "See CHANGELOG.md for details")

    # Create release notes
    cat > /tmp/release-notes.md << EOF
## Query Pilot v$VERSION

$CHANGELOG_CONTENT

---

### Installation

**macOS**
- Apple Silicon: Download \`Query-Pilot_aarch64.dmg\`
- Open DMG and drag Query Pilot to Applications

### Code Signing
- Signed with Apple Developer ID
$([ -n "$APPLE_ID" ] && echo "- Notarized with Apple" || echo "- **Not notarized** (manual build)")

### Full Changelog
See [CHANGELOG.md](https://github.com/QueryPilot/studio/blob/master/CHANGELOG.md)
EOF

    # Create draft release
    gh release create "v$VERSION" \
        --draft \
        $PRERELEASE \
        --title "Query Pilot v$VERSION" \
        --notes-file /tmp/release-notes.md

    success "Draft release created"
}

# Upload DMG to release
upload_dmg() {
    local DMG_FILE="$1"
    log "Uploading $DMG_FILE to release..."

    gh release upload "v$VERSION" "$DMG_FILE" --clobber

    success "DMG uploaded"
}

# Generate update manifest
generate_manifest() {
    log "Generating update manifest..."

    PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    NOTES=$(awk "/^## \[$VERSION\]/,/^## \[[0-9]/" CHANGELOG.md | head -n 10 | sed 's/"/\\"/g' | tr '\n' ' ' || echo "See CHANGELOG.md")

    # Check for Tauri signing key
    if [ -n "$TAURI_PRIVATE_KEY" ]; then
        log "Signing DMG with Tauri key..."
        echo "$TAURI_PRIVATE_KEY" > /tmp/tauri-key
        chmod 600 /tmp/tauri-key

        SIGNATURE=$(pnpm tauri signer sign "Query-Pilot_${ARCH}.dmg" --private-key /tmp/tauri-key --password "${TAURI_KEY_PASSWORD:-}" 2>/dev/null || echo "")
        rm -f /tmp/tauri-key

        if [ -n "$SIGNATURE" ]; then
            cat > latest.json << EOF
{
  "version": "$VERSION",
  "notes": "$NOTES",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-$ARCH": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$VERSION/Query-Pilot_${ARCH}.dmg"
    }
  }
}
EOF
        else
            warn "Failed to sign, creating unsigned manifest"
            create_unsigned_manifest
        fi
    else
        warn "TAURI_PRIVATE_KEY not set, creating unsigned manifest"
        create_unsigned_manifest
    fi

    success "Manifest generated: latest.json"
    cat latest.json
}

create_unsigned_manifest() {
    cat > latest.json << EOF
{
  "version": "$VERSION",
  "notes": "$NOTES",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-$ARCH": {
      "url": "https://github.com/QueryPilot/studio-app/releases/download/v$VERSION/Query-Pilot_${ARCH}.dmg"
    }
  }
}
EOF
}

# Upload manifest
upload_manifest() {
    log "Uploading manifest to release..."
    gh release upload "v$VERSION" latest.json --clobber
    success "Manifest uploaded"
}

# Publish to studio-app repo
publish_to_app_repo() {
    log "Publishing to QueryPilot/studio-app..."

    # Check if we have access
    if ! gh repo view QueryPilot/studio-app &>/dev/null; then
        warn "No access to QueryPilot/studio-app, skipping cross-repo publish"
        return
    fi

    # Delete existing release in app repo
    if gh release view "v$VERSION" --repo QueryPilot/studio-app &>/dev/null; then
        warn "Release exists in studio-app, deleting..."
        gh release delete "v$VERSION" --repo QueryPilot/studio-app --yes
    fi

    PRERELEASE=""
    [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"rc"* ]] && PRERELEASE="--prerelease"

    gh release create "v$VERSION" \
        --repo QueryPilot/studio-app \
        --title "Query Pilot v$VERSION" \
        --notes-file /tmp/release-notes.md \
        $PRERELEASE \
        "Query-Pilot_${ARCH}.dmg" \
        latest.json \
        CHANGELOG.md

    success "Published to QueryPilot/studio-app"
}

# Finalize release (remove draft and publish)
finalize_release() {
    log "Publishing release..."
    gh release edit "v$VERSION" --draft=false
    success "Release published!"

    # Auto-publish to studio-app if we have access
    publish_to_app_repo
}

# Cleanup
cleanup() {
    rm -f /tmp/release-notes.md /tmp/tauri-key
}

# Main
main() {
    trap cleanup EXIT

    echo ""
    echo "=========================================="
    echo "  Query Pilot Local Release Builder"
    echo "=========================================="
    echo ""

    check_requirements
    get_version
    bump_version
    build_sidecar
    download_ssm
    build_app
    prepare_dmg

    create_release
    upload_dmg "Query-Pilot_${ARCH}.dmg"
    generate_manifest
    upload_manifest
    finalize_release

    echo ""
    success "Release complete!"
    echo ""
    echo "  Source release: https://github.com/QueryPilot/studio/releases/tag/v$VERSION"
    echo "  App release:    https://github.com/QueryPilot/studio-app/releases/tag/v$VERSION"
    echo ""
}

main
