#!/bin/bash
# Fix "damaged" error for Query Pilot on macOS
# This removes the quarantine flag that causes the error

set -e

APP_NAME="Query Pilot"
APP_PATH="/Applications/${APP_NAME}.app"

echo "🔧 Query Pilot - Fix Damaged App Error"
echo "=========================================="
echo ""

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Query Pilot not found at $APP_PATH"
    echo ""
    echo "Please make sure Query Pilot is installed in your Applications folder."
    echo ""
    echo "If it's installed somewhere else, you can run:"
    echo "  xattr -cr \"/path/to/Query Pilot.app\""
    exit 1
fi

echo "Found: $APP_PATH"
echo ""
echo "Removing quarantine flag..."

# Remove quarantine attribute
xattr -cr "$APP_PATH"

# Verify it worked
if xattr -l "$APP_PATH" | grep -q "com.apple.quarantine"; then
    echo "⚠️  Warning: Quarantine flag still present"
    echo ""
    echo "You may need to run this script with sudo:"
    echo "  sudo bash fix-damaged-app.sh"
    exit 1
else
    echo "✅ Success! Quarantine flag removed."
    echo ""
    echo "You can now open Query Pilot normally."
    echo ""
    echo "To open now, run:"
    echo "  open \"$APP_PATH\""
fi
