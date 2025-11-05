#!/bin/bash
# Package Query Pilot for distribution with helper files
set -e

VERSION="0.1.0"
ARCH="aarch64"
DMG_PATH="src-tauri/target/release/bundle/dmg/Query Pilot_${VERSION}_${ARCH}.dmg"
DIST_DIR="dist-release"

echo "📦 Packaging Query Pilot for distribution..."
echo ""

# Check if DMG exists
if [ ! -f "$DMG_PATH" ]; then
    echo "❌ Error: DMG not found at $DMG_PATH"
    echo "Please run 'make build' first."
    exit 1
fi

# Create distribution directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Copying files..."

# Copy DMG
cp "$DMG_PATH" "$DIST_DIR/"

# Copy installation instructions
cp INSTALLATION.md "$DIST_DIR/"

# Copy fix script
cp scripts/fix-damaged-app.sh "$DIST_DIR/"

# Create README for the distribution package
cat > "$DIST_DIR/README.txt" << 'EOF'
Query Pilot v0.1.0
==================

Thank you for downloading Query Pilot!

Installation:
1. Open the DMG file
2. Drag Query Pilot to Applications
3. Launch from Applications folder

If you see "damaged and can't be opened" error:
- Open Terminal and run:
  xattr -cr "/Applications/Query Pilot.app"

OR use the included fix script:
  bash fix-damaged-app.sh

For detailed instructions, see INSTALLATION.md

System Requirements:
- macOS 10.15+
- Apple Silicon (M1/M2/M3)

Questions? Visit: https://github.com/your-repo

Enjoy! 🚀
EOF

# Calculate checksums
echo ""
echo "Calculating checksums..."
cd "$DIST_DIR"
md5 "Query Pilot_${VERSION}_${ARCH}.dmg" > checksums.txt
shasum -a 256 "Query Pilot_${VERSION}_${ARCH}.dmg" >> checksums.txt
cd ..

# Create ZIP for easy distribution
echo ""
echo "Creating distribution archive..."
zip -r "Query-Pilot-${VERSION}-macOS-ARM64.zip" "$DIST_DIR"

echo ""
echo "✅ Distribution package ready!"
echo ""
echo "Contents:"
ls -lh "$DIST_DIR"
echo ""
echo "Distribution archive:"
ls -lh "Query-Pilot-${VERSION}-macOS-ARM64.zip"
echo ""
echo "📤 You can now distribute:"
echo "   - Query-Pilot-${VERSION}-macOS-ARM64.zip (includes instructions)"
echo "   - Or just the DMG from: $DIST_DIR/"
