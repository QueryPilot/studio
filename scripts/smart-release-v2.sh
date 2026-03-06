#!/bin/bash

# Smart Release Script V2 - Cross-Repository Publishing
# Builds in QueryPilot/studio, publishes to QueryPilot/studio-app
#
# Usage:
#   ./scripts/smart-release-v2.sh          # stable release (AI-assisted)
#   ./scripts/smart-release-v2.sh beta     # beta release (auto-bump)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
SOURCE_REPO="QueryPilot/studio"
TARGET_REPO="QueryPilot/studio-app"
IS_BETA=false

if [ "$1" = "beta" ]; then
  IS_BETA=true
fi

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Get current version
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

if [ "$IS_BETA" = true ]; then
  echo -e "${BLUE}Beta Release${NC}"
  echo "============"
else
  echo "Stable Release"
  echo "=============="
fi
echo ""
echo -e "Current version: ${BLUE}v$CURRENT_VERSION${NC}"
echo ""

# ============================================
# Determine next version
# ============================================

if [ "$IS_BETA" = true ]; then
  # Auto-compute next beta version — no prompts
  if echo "$CURRENT_VERSION" | grep -qE '\-beta\.[0-9]+$'; then
    # Already a beta: bump the build number (2026.1.0-beta.1 → 2026.1.0-beta.2)
    BASE=$(echo "$CURRENT_VERSION" | sed 's/-beta\.[0-9]*//')
    BUILD=$(echo "$CURRENT_VERSION" | grep -oE '[0-9]+$')
    NEXT_BUILD=$((BUILD + 1))
    NEXT_VERSION="${BASE}-beta.${NEXT_BUILD}"
  else
    # Stable version: start beta.1 (2026.1.0 → 2026.1.0-beta.1)
    NEXT_VERSION="${CURRENT_VERSION}-beta.1"
  fi
  echo -e "Next version:    ${GREEN}v$NEXT_VERSION${NC}"
  echo ""
else
  # Stable release: use AI to suggest version
  # Prefer claude, fall back to codex
  AI_CLI=""
  if command -v claude &> /dev/null; then
    AI_CLI="claude"
  elif command -v codex &> /dev/null; then
    AI_CLI="codex"
  fi

  # Get last git tag
  LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  if [ -z "$LAST_TAG" ]; then
    COMMIT_RANGE="HEAD"
  else
    echo -e "Last tag: ${BLUE}$LAST_TAG${NC}"
    COMMIT_RANGE="$LAST_TAG..HEAD"
  fi

  COMMITS=$(git log $COMMIT_RANGE --pretty=format:"%h|%s|%b" --no-merges)
  COMMIT_COUNT=$(echo "$COMMITS" | grep -c '^' || echo "0")
  echo "$COMMIT_COUNT commits since last release"
  echo ""

  if [ -n "$AI_CLI" ]; then
    echo -e "${BLUE}Asking $AI_CLI to suggest next version...${NC}"

    CURRENT_YEAR=$(date +%Y)
    CONTEXT="Current version: $CURRENT_VERSION
Commits since last release:
$COMMITS"

    VERSION_PROMPT="Analyze the git commits above and determine the next version.

We use DataGrip-style versioning: YYYY.MAJOR.MINOR (e.g., 2026.1.0, 2026.2.0)
Current version: $CURRENT_VERSION

Rules:
- The year prefix is always the current year: $CURRENT_YEAR
- If current version is a beta (e.g., 2026.1.0-beta.1), the stable release drops the beta suffix (2026.1.0)
- MAJOR bump (YYYY.x.0): New features, breaking changes
- MINOR bump (YYYY.0.x): Bug fixes, improvements

Respond with ONLY the version number. No explanation."

    if [ "$AI_CLI" = "claude" ]; then
      NEXT_VERSION=$(echo "$CONTEXT

$VERSION_PROMPT" | claude -p 2>/dev/null | tail -1 | tr -d '[:space:]' | sed 's/^v//')
    else
      NEXT_VERSION=$(codex exec "$CONTEXT

$VERSION_PROMPT" 2>/dev/null | tail -1 | tr -d '[:space:]' | sed 's/^v//')
    fi

    # Validate
    if ! echo "$NEXT_VERSION" | grep -qE '^[0-9]{4}\.[0-9]+\.[0-9]+$'; then
      echo -e "${RED}AI returned invalid version: $NEXT_VERSION${NC}"
      NEXT_VERSION=""
    fi
  fi

  if [ -z "$NEXT_VERSION" ]; then
    # Strip beta suffix as default suggestion
    DEFAULT_VERSION=$(echo "$CURRENT_VERSION" | sed 's/-beta\.[0-9]*//')
    read -p "Enter version [$DEFAULT_VERSION]: " MANUAL_VERSION
    NEXT_VERSION="${MANUAL_VERSION:-$DEFAULT_VERSION}"
    NEXT_VERSION="${NEXT_VERSION#v}"
  else
    echo -e "Suggested: ${GREEN}v$NEXT_VERSION${NC}"
    read -p "Use this version? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      read -p "Enter version: " MANUAL_VERSION
      NEXT_VERSION="${MANUAL_VERSION#v}"
    fi
  fi
fi

# ============================================
# Check for uncommitted changes
# ============================================

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
  git status --short
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ============================================
# Run tests
# ============================================

echo -e "${BLUE}Running tests...${NC}"
echo ""

# Build querypilot CLI first (required by externalBin)
echo "Building querypilot CLI..."
cargo build --release --package querypilot 2>&1 || { echo -e "${RED}Failed to build querypilot CLI${NC}"; exit 1; }
HOST_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
install -m 755 target/release/querypilot "target/release/querypilot-${HOST_TRIPLE}"
echo -e "${GREEN}OK${NC} querypilot CLI"

# Rust tests
echo "Running Rust tests..."
if ! (cd src-tauri && cargo test --lib --bins 2>&1); then
  echo -e "${RED}Rust tests failed!${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC} Rust tests"

# Frontend tests
echo "Running Frontend tests..."
if ! pnpm test:unit 2>&1; then
  echo -e "${RED}Frontend tests failed!${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC} Frontend tests"

# Integration tests (if available)
if nc -z 127.0.0.1 15432 2>/dev/null; then
  echo "Running integration tests..."
  if ! (cd src-tauri && cargo test --test binary_types_test 2>&1); then
    echo -e "${RED}Integration tests failed!${NC}"
    exit 1
  fi
  echo -e "${GREEN}OK${NC} Integration tests"
else
  echo -e "${YELLOW}Skipping integration tests (PostgreSQL not available)${NC}"
fi

echo ""
echo -e "${GREEN}All tests passed${NC}"
echo ""

# ============================================
# Bump version
# ============================================

echo -e "${BLUE}Bumping version to $NEXT_VERSION...${NC}"
bash "$SCRIPT_DIR/bump-version.sh" "$NEXT_VERSION"
echo ""

# ============================================
# Update changelog (stable only)
# ============================================

if [ "$IS_BETA" = false ] && [ -f "CHANGELOG.md" ]; then
  LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  if [ -z "$LAST_TAG" ]; then
    COMMIT_RANGE="HEAD"
  else
    COMMIT_RANGE="$LAST_TAG..HEAD"
  fi
  COMMITS=$(git log $COMMIT_RANGE --pretty=format:"%h|%s|%b" --no-merges)

  # Prefer claude, fall back to codex
  AI_CLI=""
  if command -v claude &> /dev/null; then
    AI_CLI="claude"
  elif command -v codex &> /dev/null; then
    AI_CLI="codex"
  fi

  if [ -n "$AI_CLI" ]; then
    echo -e "${BLUE}Generating changelog with $AI_CLI...${NC}"

    CHANGELOG_PROMPT="Generate a professional changelog for Query Pilot v$NEXT_VERSION based on these commits:

$COMMITS

Categories (only include if relevant): New Features, Improvements, Bug Fixes, Breaking Changes
Rules: Write for humans, focus on user benefits, no emojis, active voice, 1-2 sentences per item.

Format:
## [$NEXT_VERSION] - $(date +%Y-%m-%d)

### Category
- Description"

    if [ "$AI_CLI" = "claude" ]; then
      NEW_CHANGELOG=$(echo "$CHANGELOG_PROMPT" | claude -p 2>/dev/null)
    else
      NEW_CHANGELOG=$(codex exec "$CHANGELOG_PROMPT" 2>/dev/null)
    fi

    echo ""
    echo "$NEW_CHANGELOG"
    echo ""

    read -p "Use this changelog? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      TEMP_CHANGELOG=$(mktemp)
      echo "$NEW_CHANGELOG" > "$TEMP_CHANGELOG"
      ${EDITOR:-vim} "$TEMP_CHANGELOG"
      NEW_CHANGELOG=$(cat "$TEMP_CHANGELOG")
      rm -f "$TEMP_CHANGELOG"
    fi
  else
    NEW_CHANGELOG="## [$NEXT_VERSION] - $(date +%Y-%m-%d)

### Changes
$(git log $COMMIT_RANGE --pretty=format:"- %s" --no-merges)"

    echo "$NEW_CHANGELOG"
    echo ""
  fi

  # Insert into CHANGELOG.md
  TEMP_CHANGELOG=$(mktemp)
  echo "$NEW_CHANGELOG" > "$TEMP_CHANGELOG"
  TEMP_FILE=$(mktemp)

  if grep -q "^## \[[0-9]" CHANGELOG.md; then
    awk '
      /^## \[[0-9]/ && !inserted {
        system("cat '"$TEMP_CHANGELOG"'")
        print ""
        inserted=1
      }
      {print}
    ' CHANGELOG.md > "$TEMP_FILE"
  else
    awk '
      /^---$/ && !inserted {
        system("cat '"$TEMP_CHANGELOG"'")
        print ""
        print "---"
        inserted=1
        next
      }
      {print}
    ' CHANGELOG.md > "$TEMP_FILE"
  fi

  mv "$TEMP_FILE" CHANGELOG.md
  rm -f "$TEMP_CHANGELOG"
  echo -e "${GREEN}OK${NC} CHANGELOG.md updated"
  echo ""
fi

# ============================================
# Commit, tag, push
# ============================================

echo -e "${BLUE}Changes to commit:${NC}"
git diff --stat
echo ""

read -p "Commit and push v$NEXT_VERSION? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
  echo "Aborted. Version files already bumped — revert with git checkout if needed."
  exit 1
fi

git add .
if [ "$IS_BETA" = true ]; then
  git commit -m "chore: release v$NEXT_VERSION"
else
  git commit -m "chore: release v$NEXT_VERSION

$(echo "$NEW_CHANGELOG" | sed 's/^## \[.*\] - .*//; s/^### /- /; s/^- $//; /^$/d' | head -20)"
fi

git tag -a "v$NEXT_VERSION" -m "Release v$NEXT_VERSION"

echo ""
echo -e "${GREEN}OK${NC} Committed and tagged v$NEXT_VERSION"
echo ""

git push origin master
git push origin "v$NEXT_VERSION"

echo ""
echo "=================================================================="
echo -e "${GREEN}Release v$NEXT_VERSION pushed!${NC}"
echo "=================================================================="
echo ""
echo "GitHub Actions will build and publish the release."
echo ""
echo "Monitor: https://github.com/$SOURCE_REPO/actions"
echo "Release: https://github.com/$TARGET_REPO/releases/tag/v$NEXT_VERSION"
echo ""
