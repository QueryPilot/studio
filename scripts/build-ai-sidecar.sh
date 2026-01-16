#!/bin/bash
set -e

echo "Building AI Sidecar..."

cd src-tauri/sidecar-ai

# Install dependencies
echo "Installing dependencies..."
npm install --legacy-peer-deps

# Create sidecars directory if it doesn't exist
mkdir -p ../sidecars

# Detect platform and build
OS="$(uname -s)"
ARCH="$(uname -m)"

build_for_platform() {
    local target=$1
    local triple=$2

    echo "Building for $target (triple: $triple)..."
    bun build index.ts \
        --compile \
        --minify \
        --sourcemap \
        --target="bun-$target" \
        --outfile="../sidecars/qp-ai-$triple"

    if [[ "$target" != "windows"* ]]; then
        chmod +x "../sidecars/qp-ai-$triple"
    fi

    echo "✅ Built qp-ai-$triple"
}

# Build for current platform first
case "$OS-$ARCH" in
    Darwin-arm64)
        build_for_platform "darwin-arm64" "aarch64-apple-darwin"
        ;;
    Darwin-x86_64)
        build_for_platform "darwin-x64" "x86_64-apple-darwin"
        ;;
    Linux-x86_64)
        build_for_platform "linux-x64" "x86_64-unknown-linux-gnu"
        ;;
    Linux-aarch64)
        build_for_platform "linux-arm64" "aarch64-unknown-linux-gnu"
        ;;
    MINGW*-x86_64|MSYS*-x86_64)
        build_for_platform "windows-x64" "x86_64-pc-windows-msvc.exe"
        ;;
    *)
        echo "Warning: Unknown platform $OS-$ARCH, building for darwin-arm64 as fallback"
        build_for_platform "darwin-arm64" "aarch64-apple-darwin"
        ;;
esac

# If building for release, build for all platforms
if [ "$BUILD_ALL" = "true" ]; then
    echo ""
    echo "Building for all platforms..."
    build_for_platform "darwin-arm64" "aarch64-apple-darwin"
    build_for_platform "darwin-x64" "x86_64-apple-darwin"
    build_for_platform "linux-x64" "x86_64-unknown-linux-gnu"
    build_for_platform "windows-x64" "x86_64-pc-windows-msvc.exe"

    # Create universal binary for macOS
    if [[ "$OS" == "Darwin" ]]; then
        echo ""
        echo "Creating universal macOS binary..."
        lipo -create \
            "../sidecars/qp-ai-aarch64-apple-darwin" \
            "../sidecars/qp-ai-x86_64-apple-darwin" \
            -output "../sidecars/qp-ai-universal-apple-darwin"
        chmod +x "../sidecars/qp-ai-universal-apple-darwin"
        echo "✅ Created qp-ai-universal-apple-darwin"
    fi
fi

echo ""
echo "✅ AI Sidecar build complete!"
ls -lh ../sidecars/

