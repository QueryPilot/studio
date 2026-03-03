#!/bin/bash

# Version Bump Script for Query Pilot
# Uses DataGrip-style versioning: YYYY.MAJOR.MINOR[-beta.BUILD]
#
# Usage: ./scripts/bump-version.sh <new-version>
#
# Examples:
#   ./scripts/bump-version.sh 2026.1.0           # stable release
#   ./scripts/bump-version.sh 2026.1.0-beta.1    # beta build
#   ./scripts/bump-version.sh 2026.2.0-beta.42   # beta with build number

set -e

if [ -z "$1" ]; then
  echo "Error: No version specified"
  echo ""
  echo "Usage: $0 <version>"
  echo ""
  echo "Format: YYYY.MAJOR.MINOR[-beta.BUILD]"
  echo ""
  echo "Examples:"
  echo "  $0 2026.1.0            # stable release"
  echo "  $0 2026.1.0-beta.1     # first beta"
  echo "  $0 2026.2.0-beta.42    # beta build 42"
  exit 1
fi

NEW_VERSION="$1"

# Remove 'v' prefix if present
NEW_VERSION="${NEW_VERSION#v}"

# Validate version format: YYYY.MAJOR.MINOR or YYYY.MAJOR.MINOR-{alpha,beta,rc}.BUILD
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]{4}\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$'; then
  echo "Error: Invalid version format '$NEW_VERSION'"
  echo ""
  echo "Expected: YYYY.MAJOR.MINOR (e.g., 2026.1.0)"
  echo "Or pre:   YYYY.MAJOR.MINOR-{alpha,beta,rc}.BUILD (e.g., 2026.1.0-beta.3)"
  exit 1
fi

# Extract year for sanity check
YEAR=$(echo "$NEW_VERSION" | cut -d. -f1)
CURRENT_YEAR=$(date +%Y)
if [ "$YEAR" -lt 2025 ] || [ "$YEAR" -gt $((CURRENT_YEAR + 1)) ]; then
  echo "Warning: Year $YEAR seems unusual (current year: $CURRENT_YEAR)"
  echo "Press Enter to continue or Ctrl+C to abort..."
  read -r
fi

echo "Bumping version to $NEW_VERSION..."
echo ""

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Files to update
PACKAGE_JSON="$ROOT_DIR/package.json"
CARGO_TOML="$ROOT_DIR/src-tauri/Cargo.toml"
TAURI_CONF="$ROOT_DIR/src-tauri/tauri.conf.json"

# Backup files
echo "Creating backups..."
cp "$PACKAGE_JSON" "$PACKAGE_JSON.backup"
cp "$CARGO_TOML" "$CARGO_TOML.backup"
cp "$TAURI_CONF" "$TAURI_CONF.backup"

# Function to restore backups on error
restore_backups() {
  echo "Error occurred, restoring backups..."
  mv "$PACKAGE_JSON.backup" "$PACKAGE_JSON"
  mv "$CARGO_TOML.backup" "$CARGO_TOML"
  mv "$TAURI_CONF.backup" "$TAURI_CONF"
  exit 1
}

trap restore_backups ERR

# Update package.json
echo "Updating package.json..."
if command -v jq &> /dev/null; then
  jq --arg version "$NEW_VERSION" '.version = $version' "$PACKAGE_JSON" > "$PACKAGE_JSON.tmp"
  mv "$PACKAGE_JSON.tmp" "$PACKAGE_JSON"
else
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
  else
    sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
  fi
fi

# Update Cargo.toml
echo "Updating src-tauri/Cargo.toml..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
else
  sed -i "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
fi

# Update tauri.conf.json
echo "Updating src-tauri/tauri.conf.json..."
if command -v jq &> /dev/null; then
  jq --arg version "$NEW_VERSION" '.version = $version' "$TAURI_CONF" > "$TAURI_CONF.tmp"
  mv "$TAURI_CONF.tmp" "$TAURI_CONF"
else
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI_CONF"
  else
    sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI_CONF"
  fi
fi

# Remove backups
rm "$PACKAGE_JSON.backup" "$CARGO_TOML.backup" "$TAURI_CONF.backup"

echo ""
echo "Version updated successfully!"
echo ""
echo "Updated files:"
echo "  - package.json"
echo "  - src-tauri/Cargo.toml"
echo "  - src-tauri/tauri.conf.json"
echo ""
echo "Verifying changes..."
echo ""

# Verify changes
PACKAGE_VERSION=$(grep '"version"' "$PACKAGE_JSON" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
CARGO_VERSION=$(grep '^version' "$CARGO_TOML" | head -1 | sed 's/version = "\(.*\)"/\1/')
TAURI_VERSION=$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

echo "  package.json:           $PACKAGE_VERSION"
echo "  Cargo.toml:             $CARGO_VERSION"
echo "  tauri.conf.json:        $TAURI_VERSION"
echo ""

if [ "$PACKAGE_VERSION" = "$NEW_VERSION" ] && [ "$CARGO_VERSION" = "$NEW_VERSION" ] && [ "$TAURI_VERSION" = "$NEW_VERSION" ]; then
  echo "All versions match!"
else
  echo "Version mismatch detected!"
  exit 1
fi

# Determine if this is a beta
IS_BETA=false
if echo "$NEW_VERSION" | grep -qE '\-beta\.'; then
  IS_BETA=true
fi

echo ""
echo "Next steps:"
echo ""
if [ "$IS_BETA" = true ]; then
  echo "  [Beta release - skip changelog update]"
  echo ""
  echo "  1. Commit and tag:"
  echo "     git add ."
  echo "     git commit -m \"chore: bump version to v$NEW_VERSION\""
  echo "     git tag v$NEW_VERSION"
  echo "     git push origin master"
  echo "     git push origin v$NEW_VERSION"
else
  echo "  1. Update CHANGELOG.md:"
  echo "     vim CHANGELOG.md"
  echo ""
  echo "  2. Commit and tag:"
  echo "     git add ."
  echo "     git commit -m \"chore: bump version to v$NEW_VERSION\""
  echo "     git tag v$NEW_VERSION"
  echo "     git push origin master"
  echo "     git push origin v$NEW_VERSION"
fi
echo ""
echo "  Monitor release build:"
echo "   https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
