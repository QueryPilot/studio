#!/bin/bash

# Cross-Repository Release Publisher
# Downloads artifacts from QueryPilot/studio and publishes to QueryPilot/QueryPilot
# Usage: ./scripts/publish-to-app-repo.sh v1.0.0

set -e

command -v jq >/dev/null 2>&1 || { echo "jq is required. Run: brew install jq"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "GitHub CLI (gh) is required. Run: brew install gh"; exit 1; }

VERSION="$1"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 v0.5.0"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SOURCE_REPO="QueryPilot/studio"
TARGET_REPO="QueryPilot/QueryPilot"

echo -e "${CYAN}🚀 Cross-Repository Release Publisher${NC}"
echo "======================================"
echo ""
echo -e "${BLUE}Version:${NC} $VERSION"
echo -e "${BLUE}Source:${NC}  $SOURCE_REPO"
echo -e "${BLUE}Target:${NC}  $TARGET_REPO"
echo ""

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Create temporary working directory
WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

echo -e "${BLUE}📥 Downloading release artifacts from $SOURCE_REPO...${NC}"

# Check if release exists in source repo
if ! gh release view "$VERSION" --repo "$SOURCE_REPO" &> /dev/null; then
    echo -e "${RED}❌ Release $VERSION not found in $SOURCE_REPO${NC}"
    echo ""
    echo "Make sure the GitHub Actions build has completed."
    echo "Check: https://github.com/$SOURCE_REPO/releases"
    exit 1
fi

# Download all assets from source release
gh release download "$VERSION" \
    --repo "$SOURCE_REPO" \
    --dir "$WORK_DIR" \
    --pattern "*.dmg"

gh release download "$VERSION" \
    --repo "$SOURCE_REPO" \
    --dir "$WORK_DIR" \
    --pattern "*.app.tar.gz"

gh release download "$VERSION" \
    --repo "$SOURCE_REPO" \
    --dir "$WORK_DIR" \
    --pattern "*.app.tar.gz.sig"

echo -e "${GREEN}✓${NC} Downloaded release artifacts"
echo ""

# List downloaded files
echo -e "${BLUE}📦 Downloaded files:${NC}"
ls -lh "$WORK_DIR"
echo ""

# Extract release notes from CHANGELOG.md
echo -e "${BLUE}📝 Extracting release notes...${NC}"

RELEASE_NOTES_FILE="$WORK_DIR/RELEASE_NOTES.md"

# Extract the section for this version from CHANGELOG.md
if [ -f "CHANGELOG.md" ]; then
    # Get content between this version header and the next version header
    awk "/^## \[${VERSION#v}\]/{flag=1; next} /^## \[[0-9]/{flag=0} flag" CHANGELOG.md > "$RELEASE_NOTES_FILE"

    # If empty, use full entry including header
    if [ ! -s "$RELEASE_NOTES_FILE" ]; then
        awk "/^## \[${VERSION#v}\]/,/^## \[[0-9]/" CHANGELOG.md | head -n -1 > "$RELEASE_NOTES_FILE"
    fi

    # Add footer
    cat >> "$RELEASE_NOTES_FILE" << EOF

---

## Installation

**macOS (Apple Silicon / M1+):**
- Download \`QueryPilot_${VERSION}_aarch64.dmg\`

**macOS (Intel):**
- Download \`QueryPilot_${VERSION}_x86_64.dmg\`

- Open the DMG and drag Query Pilot to Applications folder
- On first launch, right-click the app and select "Open" if you see a security warning

**Windows & Linux:** Coming soon

## Full Changelog

See [CHANGELOG.md](https://github.com/$TARGET_REPO/blob/main/CHANGELOG.md) for complete version history.
EOF

    echo -e "${GREEN}✓${NC} Release notes prepared"
else
    echo -e "${YELLOW}⚠️  CHANGELOG.md not found, using default notes${NC}"
    cat > "$RELEASE_NOTES_FILE" << EOF
## Query Pilot $VERSION

See the [full changelog](https://github.com/$TARGET_REPO/blob/main/CHANGELOG.md) for details.
EOF
fi

echo ""

# Generate update manifest (latest.json) — uses .app.tar.gz + .sig (matches CI and release-local.sh)
echo -e "${BLUE}📄 Generating update manifest...${NC}"

MANIFEST_FILE="$WORK_DIR/latest.json"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION_NUMBER="${VERSION#v}"

# Extract release notes for manifest
RAW_NOTES=$(awk "/^## \[$VERSION_NUMBER\]/{found=1;next} found && /^## \[/{exit} found" CHANGELOG.md || true)
if [ -z "$RAW_NOTES" ]; then
    RAW_NOTES="See CHANGELOG.md for details"
fi

BASE_URL="https://github.com/$TARGET_REPO/releases/download/$VERSION"

# Arch-specific updater archives
AARCH64_ARCHIVE=$(find "$WORK_DIR" -name "*aarch64.app.tar.gz" | head -1)
AARCH64_SIG=$(find "$WORK_DIR" -name "*aarch64.app.tar.gz.sig" | head -1)
X86_64_ARCHIVE=$(find "$WORK_DIR" -name "*x86_64.app.tar.gz" | head -1)
X86_64_SIG=$(find "$WORK_DIR" -name "*x86_64.app.tar.gz.sig" | head -1)

for f in "$AARCH64_ARCHIVE" "$AARCH64_SIG" "$X86_64_ARCHIVE" "$X86_64_SIG"; do
    [ -n "$f" ] && [ -f "$f" ] || { echo -e "${RED}❌ Missing updater artifact: $f${NC}"; exit 1; }
done

AARCH64_SIGNATURE=$(tr -d '\r\n' < "$AARCH64_SIG")
X86_64_SIGNATURE=$(tr -d '\r\n' < "$X86_64_SIG")

jq -n \
    --arg version "$VERSION_NUMBER" \
    --arg notes "$RAW_NOTES" \
    --arg pub_date "$PUB_DATE" \
    --arg aarch64_sig "$AARCH64_SIGNATURE" \
    --arg aarch64_url "$BASE_URL/$(basename "$AARCH64_ARCHIVE")" \
    --arg x86_64_sig "$X86_64_SIGNATURE" \
    --arg x86_64_url "$BASE_URL/$(basename "$X86_64_ARCHIVE")" \
    '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        platforms: {
            "darwin-aarch64": { signature: $aarch64_sig, url: $aarch64_url },
            "darwin-x86_64": { signature: $x86_64_sig, url: $x86_64_url }
        }
    }' > "$MANIFEST_FILE"

echo -e "${GREEN}✓${NC} Update manifest generated"
echo ""

# Show manifest
echo -e "${BLUE}📄 Update manifest:${NC}"
cat "$MANIFEST_FILE"
echo ""

# Copy CHANGELOG.md to work dir for publishing
cp CHANGELOG.md "$WORK_DIR/CHANGELOG.md"

# Create or update release in target repo
echo -e "${BLUE}🚀 Publishing to $TARGET_REPO...${NC}"
echo ""

# Check if release already exists in target repo
if gh release view "$VERSION" --repo "$TARGET_REPO" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Release $VERSION already exists in $TARGET_REPO${NC}"
    read -p "Delete and recreate? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh release delete "$VERSION" --repo "$TARGET_REPO" --yes
        echo -e "${GREEN}✓${NC} Deleted existing release"
    else
        echo "Aborted."
        exit 1
    fi
fi

# Create release (always as full release so /releases/latest works for updater)
gh release create "$VERSION" \
    --repo "$TARGET_REPO" \
    --title "Query Pilot $VERSION" \
    --notes-file "$RELEASE_NOTES_FILE" \
    "$WORK_DIR"/*.dmg \
    "$WORK_DIR"/*.app.tar.gz \
    "$WORK_DIR"/*.app.tar.gz.sig \
    "$MANIFEST_FILE" \
    "$WORK_DIR/CHANGELOG.md"

echo ""
echo -e "${GREEN}✅ Release published successfully!${NC}"
echo ""
echo -e "${BLUE}🔗 Release URL:${NC}"
echo -e "   ${CYAN}https://github.com/$TARGET_REPO/releases/tag/$VERSION${NC}"
echo ""
echo -e "${BLUE}📥 Download URL:${NC}"
echo -e "   ${CYAN}https://github.com/$TARGET_REPO/releases/latest${NC}"
echo ""
echo -e "${BLUE}🔄 Update manifest:${NC}"
echo -e "   ${CYAN}https://github.com/$TARGET_REPO/releases/latest/download/latest.json${NC}"
echo ""

# Verify update manifest is accessible
echo -e "${BLUE}🔍 Verifying update manifest...${NC}"
sleep 5  # Wait for GitHub to process

if curl -sf "https://github.com/$TARGET_REPO/releases/latest/download/latest.json" > /dev/null; then
    echo -e "${GREEN}✓${NC} Update manifest is accessible"
else
    echo -e "${YELLOW}⚠️  Update manifest not yet accessible (may take a few moments)${NC}"
fi

echo ""
echo -e "${GREEN}Done!${NC}"
