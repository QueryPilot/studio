#!/bin/bash

# Version Bump Script for Query Pilot
# Usage: ./scripts/bump-version.sh <new-version>
# Example: ./scripts/bump-version.sh 1.2.3

set -e

if [ -z "$1" ]; then
  echo "❌ Error: No version specified"
  echo ""
  echo "Usage: $0 <version>"
  echo "Example: $0 1.2.3"
  exit 1
fi

NEW_VERSION="$1"

# Remove 'v' prefix if present
NEW_VERSION="${NEW_VERSION#v}"

# Validate version format (semantic versioning)
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "❌ Error: Invalid version format"
  echo "Expected: MAJOR.MINOR.PATCH (e.g., 1.2.3)"
  echo "Or with pre-release: 1.2.3-beta.1"
  exit 1
fi

echo "🔄 Bumping version to $NEW_VERSION..."
echo ""

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Files to update
PACKAGE_JSON="$ROOT_DIR/package.json"
CARGO_TOML="$ROOT_DIR/src-tauri/Cargo.toml"
TAURI_CONF="$ROOT_DIR/src-tauri/tauri.conf.json"

# Backup files
echo "📦 Creating backups..."
cp "$PACKAGE_JSON" "$PACKAGE_JSON.backup"
cp "$CARGO_TOML" "$CARGO_TOML.backup"
cp "$TAURI_CONF" "$TAURI_CONF.backup"

# Function to restore backups on error
restore_backups() {
  echo "⚠️  Error occurred, restoring backups..."
  mv "$PACKAGE_JSON.backup" "$PACKAGE_JSON"
  mv "$CARGO_TOML.backup" "$CARGO_TOML"
  mv "$TAURI_CONF.backup" "$TAURI_CONF"
  exit 1
}

trap restore_backups ERR

# Update package.json
echo "📝 Updating package.json..."
if command -v jq &> /dev/null; then
  # Use jq if available (more reliable)
  jq --arg version "$NEW_VERSION" '.version = $version' "$PACKAGE_JSON" > "$PACKAGE_JSON.tmp"
  mv "$PACKAGE_JSON.tmp" "$PACKAGE_JSON"
else
  # Fallback to sed
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
  else
    # Linux
    sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
  fi
fi

# Update Cargo.toml
echo "📝 Updating src-tauri/Cargo.toml..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
else
  # Linux
  sed -i "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
fi

# Update tauri.conf.json
echo "📝 Updating src-tauri/tauri.conf.json..."
if command -v jq &> /dev/null; then
  # Use jq if available
  jq --arg version "$NEW_VERSION" '.version = $version' "$TAURI_CONF" > "$TAURI_CONF.tmp"
  mv "$TAURI_CONF.tmp" "$TAURI_CONF"
else
  # Fallback to sed
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI_CONF"
  else
    # Linux
    sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI_CONF"
  fi
fi

# Remove backups
rm "$PACKAGE_JSON.backup" "$CARGO_TOML.backup" "$TAURI_CONF.backup"

echo ""
echo "✅ Version updated successfully!"
echo ""
echo "📋 Updated files:"
echo "  - package.json"
echo "  - src-tauri/Cargo.toml"
echo "  - src-tauri/tauri.conf.json"
echo ""
echo "🔍 Verifying changes..."
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
  echo "✅ All versions match!"
else
  echo "❌ Version mismatch detected!"
  exit 1
fi

echo ""
echo "🎯 Next steps:"
echo ""
echo "1. Update CHANGELOG.md:"
echo "   vim CHANGELOG.md"
echo ""
echo "2. Review changes:"
echo "   git diff"
echo ""
echo "3. Commit and tag:"
echo "   git add ."
echo "   git commit -m \"chore: bump version to v$NEW_VERSION\""
echo "   git tag v$NEW_VERSION"
echo "   git push origin master"
echo "   git push origin v$NEW_VERSION"
echo ""
echo "4. Monitor release build:"
echo "   https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
