#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Verifying sidecar binaries..."

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  darwin-arm64)
    AI_BINARY="ai-server-aarch64-apple-darwin"
    SSM_BINARY="session-manager-plugin-aarch64-apple-darwin"
    ;;
  darwin-x86_64)
    AI_BINARY="ai-server-x86_64-apple-darwin"
    SSM_BINARY="session-manager-plugin-x86_64-apple-darwin"
    ;;
  linux-x86_64)
    AI_BINARY="ai-server-x86_64-unknown-linux-gnu"
    SSM_BINARY="session-manager-plugin-x86_64-unknown-linux-gnu"
    ;;
  mingw*|msys*|cygwin*)
    AI_BINARY="ai-server-x86_64-pc-windows-msvc.exe"
    SSM_BINARY="session-manager-plugin-x86_64-pc-windows-msvc.exe"
    ;;
  *)
    echo "❌ Unsupported platform: ${OS}-${ARCH}"
    exit 1
    ;;
esac

SIDECAR_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/sidecars"
MISSING=0

# Check AI sidecar
if [ -f "${SIDECAR_DIR}/${AI_BINARY}" ]; then
  SIZE=$(du -h "${SIDECAR_DIR}/${AI_BINARY}" | cut -f1)
  echo "✅ AI sidecar:           ${AI_BINARY} (${SIZE})"
else
  echo "❌ AI sidecar:           ${AI_BINARY} - NOT FOUND"
  MISSING=1
fi

# Check Session Manager plugin
if [ -f "${SIDECAR_DIR}/${SSM_BINARY}" ]; then
  SIZE=$(du -h "${SIDECAR_DIR}/${SSM_BINARY}" | cut -f1)
  echo "✅ Session Manager:      ${SSM_BINARY} (${SIZE})"
else
  echo "❌ Session Manager:      ${SSM_BINARY} - NOT FOUND"
  MISSING=1
fi

echo ""
if [ $MISSING -eq 0 ]; then
  echo "✅ All sidecars present and ready for bundling!"
  exit 0
else
  echo "❌ Some sidecars are missing. Run 'make build' to build them."
  exit 1
fi
