#!/bin/bash

# Cross-Repository Release Publisher
# Downloads artifacts from QueryPilot/studio and publishes to QueryPilot/studio-app
# Usage: ./scripts/publish-to-app-repo.sh v1.0.0

set -e

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
TARGET_REPO="QueryPilot/studio-app"
UPDATER_KEY_PATH=".tauri/query-pilot.key"

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

**macOS:**
- Download \`QueryPilot_${VERSION}.dmg\` (works on both Intel and Apple Silicon)
- Open DMG and drag Query Pilot to Applications folder
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

# Generate update manifest (latest.json)
echo -e "${BLUE}📄 Generating update manifest...${NC}"

MANIFEST_FILE="$WORK_DIR/latest.json"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Find DMG file (universal or arch-specific)
UNIVERSAL_DMG=$(find "$WORK_DIR" -name "QueryPilot_*.dmg" | head -1)
DARWIN_AARCH64_DMG=$(find "$WORK_DIR" -name "*aarch64.dmg" -o -name "*arm64.dmg" | head -1)
DARWIN_X64_DMG=$(find "$WORK_DIR" -name "*x86_64.dmg" -o -name "*x64.dmg" | head -1)

# Use universal DMG for both platforms if no arch-specific DMGs found
if [ -n "$UNIVERSAL_DMG" ] && [ -z "$DARWIN_AARCH64_DMG" ] && [ -z "$DARWIN_X64_DMG" ]; then
    echo -e "${BLUE}Found universal DMG: $(basename "$UNIVERSAL_DMG")${NC}"
    DMG_NAME=$(basename "$UNIVERSAL_DMG")
    DMG_URL="https://github.com/$TARGET_REPO/releases/download/$VERSION/$DMG_NAME"
    DMG_PATH="$UNIVERSAL_DMG"

    SIGNATURE=""
    if [ -f "$UPDATER_KEY_PATH" ] && [ "$SIGN_UPDATES" != "false" ]; then
        echo -e "${BLUE}🔐 Signing $DMG_NAME...${NC}"
        SIGNATURE=$(pnpm tauri signer sign "$DMG_PATH" --private-key "$UPDATER_KEY_PATH" 2>/dev/null || echo "")
        if [ -n "$SIGNATURE" ]; then
            echo -e "${GREEN}✓${NC} Signed universal DMG"
        else
            echo -e "${YELLOW}⚠️  Failed to sign, creating unsigned manifest${NC}"
        fi
    fi

    if [ -n "$SIGNATURE" ]; then
        cat > "$MANIFEST_FILE" << EOF
{
  "version": "${VERSION#v}",
  "notes": "$(head -5 "$RELEASE_NOTES_FILE" | sed 's/"/\\"/g' | tr '\n' ' ')",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "$DMG_URL"
    },
    "darwin-x86_64": {
      "signature": "$SIGNATURE",
      "url": "$DMG_URL"
    }
  }
}
EOF
    else
        cat > "$MANIFEST_FILE" << EOF
{
  "version": "${VERSION#v}",
  "notes": "$(head -5 "$RELEASE_NOTES_FILE" | sed 's/"/\\"/g' | tr '\n' ' ')",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "url": "$DMG_URL"
    },
    "darwin-x86_64": {
      "url": "$DMG_URL"
    }
  }
}
EOF
    fi
else
    # Arch-specific DMGs - build manifest per-platform
    cat > "$MANIFEST_FILE" << EOF
{
  "version": "${VERSION#v}",
  "notes": "$(head -5 "$RELEASE_NOTES_FILE" | sed 's/"/\\"/g' | tr '\n' ' ')",
  "pub_date": "$PUB_DATE",
  "platforms": {
EOF

    FIRST_ENTRY=true

    for ARCH_LABEL in "darwin-aarch64" "darwin-x86_64"; do
        if [ "$ARCH_LABEL" = "darwin-aarch64" ]; then
            DMG_PATH="$DARWIN_AARCH64_DMG"
        else
            DMG_PATH="$DARWIN_X64_DMG"
        fi

        [ -z "$DMG_PATH" ] && continue

        DMG_NAME=$(basename "$DMG_PATH")
        DMG_URL="https://github.com/$TARGET_REPO/releases/download/$VERSION/$DMG_NAME"

        if [ "$FIRST_ENTRY" = false ]; then
            # Append comma to previous entry
            sed -i '$ s/}$/},/' "$MANIFEST_FILE"
        fi
        FIRST_ENTRY=false

        SIGNATURE=""
        if [ -f "$UPDATER_KEY_PATH" ] && [ "$SIGN_UPDATES" != "false" ]; then
            echo -e "${BLUE}🔐 Signing $DMG_NAME...${NC}"
            SIGNATURE=$(pnpm tauri signer sign "$DMG_PATH" --private-key "$UPDATER_KEY_PATH" 2>/dev/null || echo "")
        fi

        if [ -n "$SIGNATURE" ]; then
            cat >> "$MANIFEST_FILE" << EOF
    "$ARCH_LABEL": {
      "signature": "$SIGNATURE",
      "url": "$DMG_URL"
    }
EOF
            echo -e "${GREEN}✓${NC} Signed $ARCH_LABEL"
        else
            cat >> "$MANIFEST_FILE" << EOF
    "$ARCH_LABEL": {
      "url": "$DMG_URL"
    }
EOF
        fi
    done

    cat >> "$MANIFEST_FILE" << EOF
  }
}
EOF
fi

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

# Determine if prerelease
PRERELEASE_FLAG=""
if [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"rc"* ]]; then
    PRERELEASE_FLAG="--prerelease"
fi

# Create release in target repo
gh release create "$VERSION" \
    --repo "$TARGET_REPO" \
    --title "Query Pilot $VERSION" \
    --notes-file "$RELEASE_NOTES_FILE" \
    $PRERELEASE_FLAG \
    "$WORK_DIR"/*.dmg \
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
