#!/bin/bash

# Smart Release Script - Uses Codex AI to automate versioning and changelog generation
# Usage: ./scripts/smart-release.sh

set -e

echo "🤖 Smart Release - AI-Powered Version & Changelog Generation"
echo "=============================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Check if codex is installed
if ! command -v codex &> /dev/null; then
    echo -e "${RED}❌ Error: codex CLI not found${NC}"
    echo ""
    echo "Install codex from: https://github.com/openai/codex"
    echo "Or install via npm: npm install -g @openai/codex-cli"
    echo ""
    echo -e "${YELLOW}Fallback: Use manual release instead:${NC}"
    echo "  make version VERSION=1.2.3"
    echo "  make release VERSION=1.2.3"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    echo ""
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Get current version
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${BLUE}📦 Current version: ${NC}v$CURRENT_VERSION"
echo ""

# Get last git tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LAST_TAG" ]; then
    echo -e "${YELLOW}⚠️  No previous tags found - this will be the first release${NC}"
    COMMIT_RANGE="HEAD"
else
    echo -e "${BLUE}🏷️  Last tag: ${NC}$LAST_TAG"
    COMMIT_RANGE="$LAST_TAG..HEAD"
fi
echo ""

# Get commits since last tag
echo -e "${BLUE}📋 Analyzing commits since last release...${NC}"
COMMITS=$(git log $COMMIT_RANGE --pretty=format:"%h|%s|%b" --no-merges)

if [ -z "$COMMITS" ]; then
    echo -e "${YELLOW}⚠️  No new commits since last release${NC}"
    echo ""
    read -p "Create release anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Count commits
COMMIT_COUNT=$(echo "$COMMITS" | grep -c '^' || echo "0")
echo -e "${GREEN}✓${NC} Found $COMMIT_COUNT commits"
echo ""

# Create temporary file with git context
CONTEXT_FILE=$(mktemp)
trap "rm -f $CONTEXT_FILE" EXIT

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

echo -e "${BLUE}🤖 Asking Codex to analyze commits and suggest next version...${NC}"
echo ""

# Use Codex to determine next version
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

# Get version from Codex
NEXT_VERSION=$(codex exec "$(cat $CONTEXT_FILE)

$VERSION_PROMPT" 2>/dev/null | tail -1 | tr -d '[:space:]' | sed 's/^v//')

# Validate version format
if ! echo "$NEXT_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo -e "${RED}❌ Codex returned invalid version: $NEXT_VERSION${NC}"
    echo ""
    read -p "Enter version manually (e.g., 1.2.0): " MANUAL_VERSION
    NEXT_VERSION="$MANUAL_VERSION"
fi

echo -e "${GREEN}✓ Suggested version: ${NC}v$NEXT_VERSION"
echo ""

# Confirm version
read -p "Use this version? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    read -p "Enter version: " MANUAL_VERSION
    NEXT_VERSION="${MANUAL_VERSION#v}"
fi

echo ""
echo -e "${BLUE}🤖 Generating changelog from commits...${NC}"
echo ""

# Use Codex to generate changelog
CHANGELOG_PROMPT="Generate a professional changelog entry for version $NEXT_VERSION based on the commits above.

Format:
## [$NEXT_VERSION] - $(date +%Y-%m-%d)

### Added
- Feature 1
- Feature 2

### Changed
- Change 1

### Fixed
- Bug fix 1

### Removed
- Removed feature

Rules:
1. Group commits by category (Added/Changed/Fixed/Removed)
2. Use clear, user-friendly descriptions (not raw commit messages)
3. Omit trivial changes (chore, docs unless significant)
4. Highlight breaking changes prominently
5. Be concise but informative
6. If no changes in a category, omit that section

Output ONLY the changelog entry, starting with ## [$NEXT_VERSION]"

# Generate changelog
NEW_CHANGELOG=$(codex exec "$(cat $CONTEXT_FILE)

$CHANGELOG_PROMPT" 2>/dev/null)

echo -e "${GREEN}✓ Generated changelog:${NC}"
echo ""
echo "$NEW_CHANGELOG"
echo ""

# Confirm changelog
read -p "Use this changelog? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo ""
    echo -e "${YELLOW}Opening editor to customize changelog...${NC}"
    TEMP_CHANGELOG=$(mktemp)
    echo "$NEW_CHANGELOG" > "$TEMP_CHANGELOG"
    ${EDITOR:-vim} "$TEMP_CHANGELOG"
    NEW_CHANGELOG=$(cat "$TEMP_CHANGELOG")
    rm -f "$TEMP_CHANGELOG"
fi

echo ""
echo -e "${BLUE}📝 Updating version files...${NC}"

# Update version in files
bash "$SCRIPT_DIR/bump-version.sh" "$NEXT_VERSION"

echo ""
echo -e "${BLUE}📝 Updating CHANGELOG.md...${NC}"

# Update CHANGELOG.md
if [ -f "CHANGELOG.md" ]; then
    # Write new changelog to temp file
    TEMP_CHANGELOG=$(mktemp)
    echo "$NEW_CHANGELOG" > "$TEMP_CHANGELOG"

    # Create output file
    TEMP_FILE=$(mktemp)

    # Find line number of first ## [version] or end of file
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
        # No version entries yet, insert after [Unreleased] section
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
    echo -e "${GREEN}✓${NC} CHANGELOG.md updated"
else
    echo -e "${YELLOW}⚠️  CHANGELOG.md not found, skipping${NC}"
fi

echo ""
echo -e "${BLUE}📦 Preparing release commit...${NC}"
echo ""

# Show what will be committed
git diff --stat

echo ""
read -p "Commit these changes? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Aborted. Changes not committed."
    exit 1
fi

# Commit changes
git add .
git commit -m "chore: release v$NEXT_VERSION

$(echo "$NEW_CHANGELOG" | sed 's/^## \[.*\] - .*//; s/^### /- /; s/^- $//; /^$/d' | head -20)"

echo -e "${GREEN}✓${NC} Changes committed"
echo ""

# Create tag
echo -e "${BLUE}🏷️  Creating git tag...${NC}"
git tag -a "v$NEXT_VERSION" -m "Release v$NEXT_VERSION"
echo -e "${GREEN}✓${NC} Tag created: v$NEXT_VERSION"
echo ""

# Push
echo -e "${BLUE}⬆️  Pushing to GitHub...${NC}"
read -p "Push to origin? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    git push origin master
    git push origin "v$NEXT_VERSION"
    echo -e "${GREEN}✓${NC} Pushed to origin"
else
    echo -e "${YELLOW}⚠️  Not pushed. Run manually:${NC}"
    echo "  git push origin master"
    echo "  git push origin v$NEXT_VERSION"
fi

echo ""
echo "=============================================================="
echo -e "${GREEN}✅ Release v$NEXT_VERSION created successfully!${NC}"
echo "=============================================================="
echo ""

# Get repo URL
REPO_URL=$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')

echo -e "${BLUE}🔗 Next steps:${NC}"
echo ""
echo "1. Monitor the build:"
echo -e "   ${BLUE}https://github.com/$REPO_URL/actions${NC}"
echo ""
echo "2. Review and publish the release:"
echo -e "   ${BLUE}https://github.com/$REPO_URL/releases${NC}"
echo ""

# Open URLs if on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    read -p "Open GitHub Actions in browser? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "https://github.com/$REPO_URL/actions"
    fi
fi

echo -e "${GREEN}Done!${NC}"
