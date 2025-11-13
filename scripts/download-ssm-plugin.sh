#!/usr/bin/env bash
set -euo pipefail

VERSION="1.2.553.0"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/sidecars"
mkdir -p "$DEST"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "📥 Downloading session-manager-plugin ${VERSION} for ${OS}-${ARCH}..."
curl -sSL "$URL" -o "${TMP_DIR}/download"

if [[ "$URL" == *.zip ]]; then
  unzip -q "${TMP_DIR}/download" -d "${TMP_DIR}/extract"
  BIN_PATH="$(find "${TMP_DIR}/extract" -name session-manager-plugin -type f | head -n 1)"
elif [[ "$URL" == *.deb ]]; then
  dpkg-deb -x "${TMP_DIR}/download" "${TMP_DIR}/extract"
  BIN_PATH="$(find "${TMP_DIR}/extract" -name session-manager-plugin -type f | head -n 1)"
else
  echo "Unknown archive format: ${URL}"
  exit 1
fi

if [[ -z "${BIN_PATH}" || ! -f "${BIN_PATH}" ]]; then
  echo "Failed to locate session-manager-plugin in downloaded archive."
  exit 1
fi

cp "${BIN_PATH}" "${OUT}"
chmod +x "${OUT}"

echo "✅ Installed session-manager-plugin to ${OUT}"

