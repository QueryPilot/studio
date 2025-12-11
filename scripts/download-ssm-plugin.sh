#!/usr/bin/env bash
set -euo pipefail

VERSION="1.2.553.0"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/sidecars"
mkdir -p "$DEST"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

download_plugin() {
  local url="$1"
  local out="$2"
  local label="$3"

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' RETURN

  echo "📥 Downloading session-manager-plugin ${VERSION} for ${label}..."
  curl -sSL "$url" -o "${TMP_DIR}/download"

  if [[ "$url" == *.zip ]]; then
    unzip -q "${TMP_DIR}/download" -d "${TMP_DIR}/extract"
    BIN_PATH="$(find "${TMP_DIR}/extract" -name session-manager-plugin -type f | head -n 1)"
  elif [[ "$url" == *.deb ]]; then
    dpkg-deb -x "${TMP_DIR}/download" "${TMP_DIR}/extract"
    BIN_PATH="$(find "${TMP_DIR}/extract" -name session-manager-plugin -type f | head -n 1)"
  else
    echo "Unknown archive format: ${url}"
    return 1
  fi

  if [[ -z "${BIN_PATH}" || ! -f "${BIN_PATH}" ]]; then
    echo "Failed to locate session-manager-plugin in downloaded archive."
    return 1
  fi

  cp "${BIN_PATH}" "${out}"
  chmod +x "${out}"

  echo "✅ Installed session-manager-plugin to ${out}"
}

# If BUILD_ALL is set, download both macOS architectures for universal builds
if [[ "${BUILD_ALL:-}" == "true" ]] && [[ "$OS" == "darwin" ]]; then
  echo "🔧 Building SSM plugins for universal macOS build..."
  download_plugin \
    "https://s3.amazonaws.com/session-manager-downloads/plugin/${VERSION}/mac_arm64/sessionmanager-bundle.zip" \
    "${DEST}/session-manager-plugin-aarch64-apple-darwin" \
    "darwin-arm64"
  download_plugin \
    "https://s3.amazonaws.com/session-manager-downloads/plugin/${VERSION}/mac/sessionmanager-bundle.zip" \
    "${DEST}/session-manager-plugin-x86_64-apple-darwin" \
    "darwin-x86_64"

  # Create universal binary using lipo
  echo "🔧 Creating universal binary..."
  lipo -create \
    "${DEST}/session-manager-plugin-aarch64-apple-darwin" \
    "${DEST}/session-manager-plugin-x86_64-apple-darwin" \
    -output "${DEST}/session-manager-plugin-universal-apple-darwin"
  chmod +x "${DEST}/session-manager-plugin-universal-apple-darwin"
  echo "✅ Created session-manager-plugin-universal-apple-darwin"

  echo "✅ All macOS SSM plugins downloaded"
  exit 0
fi

# Single architecture download
case "${OS}-${ARCH}" in
  darwin-arm64)
    URL="https://s3.amazonaws.com/session-manager-downloads/plugin/${VERSION}/mac_arm64/sessionmanager-bundle.zip"
    OUT="${DEST}/session-manager-plugin-aarch64-apple-darwin"
    ;;
  darwin-x86_64)
    URL="https://s3.amazonaws.com/session-manager-downloads/plugin/${VERSION}/mac/sessionmanager-bundle.zip"
    OUT="${DEST}/session-manager-plugin-x86_64-apple-darwin"
    ;;
  linux-x86_64)
    URL="https://s3.amazonaws.com/session-manager-downloads/plugin/${VERSION}/ubuntu_64bit/session-manager-plugin.deb"
    OUT="${DEST}/session-manager-plugin-x86_64-unknown-linux-gnu"
    ;;
  *)
    echo "Unsupported platform: ${OS}-${ARCH}"
    echo "On Windows, run scripts/download-ssm-plugin.ps1 instead."
    exit 0
    ;;
esac

download_plugin "$URL" "$OUT" "${OS}-${ARCH}"

