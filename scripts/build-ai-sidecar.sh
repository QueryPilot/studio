#!/bin/bash
set -e

echo "Building AI Sidecar..."

cd src-tauri/sidecar-ai

# Install dependencies
echo "Installing dependencies..."
bun install

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
        --outfile="../sidecars/ai-server-$triple"
    
    echo "✅ Built ai-server-$triple"
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
fi

echo ""
echo "✅ AI Sidecar build complete!"
ls -lh ../sidecars/

