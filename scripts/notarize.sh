#!/bin/bash
# Notarization script for Query Pilot
# Prerequisites:
#   1. Apple Developer Account ($99/year)
#   2. App-specific password from https://appleid.apple.com
#   3. Xcode command line tools: xcode-select --install

set -e

# Configuration
APP_NAME="Query Pilot"
BUNDLE_ID="dev.querypilot.studio"
DMG_PATH="src-tauri/target/release/bundle/dmg/Query Pilot_0.1.0_aarch64.dmg"

# Required environment variables (set these in your shell or CI/CD)
# export APPLE_ID="your-email@example.com"
# export APPLE_TEAM_ID="TEAM_ID"
# export APPLE_APP_PASSWORD="abcd-efgh-ijkl-mnop"

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_TEAM_ID" ] || [ -z "$APPLE_APP_PASSWORD" ]; then
    echo "❌ Error: Required environment variables not set"
    echo "Please set: APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD"
    exit 1
fi

echo "🔐 Notarizing $APP_NAME..."

# Submit for notarization
echo "📤 Submitting to Apple..."
xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait

# Staple the notarization ticket
echo "📎 Stapling notarization ticket..."
xcrun stapler staple "$DMG_PATH"

echo "✅ Notarization complete!"
echo "Your DMG is ready for distribution: $DMG_PATH"
