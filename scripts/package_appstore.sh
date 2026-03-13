#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${APP_PATH:-$ROOT_DIR/src-tauri/target/release/bundle/macos/Foundry Vox.app}"
PKG_PATH="${PKG_PATH:-$ROOT_DIR/src-tauri/target/release/bundle/macos/Foundry-Vox-AppStore.pkg}"
APP_SIGN_IDENTITY="${APP_SIGN_IDENTITY:-}"
INSTALLER_SIGN_IDENTITY="${INSTALLER_SIGN_IDENTITY:-}"

if [[ -z "$APP_SIGN_IDENTITY" ]]; then
  echo "APP_SIGN_IDENTITY is required." >&2
  exit 1
fi

if [[ -z "$INSTALLER_SIGN_IDENTITY" ]]; then
  echo "INSTALLER_SIGN_IDENTITY is required." >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found at: $APP_PATH" >&2
  echo "Build the app first with: npx tauri build --bundles app --config src-tauri/tauri.appstore.conf.json" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
SIGNED_APP_PATH="$TMP_DIR/Foundry Vox.app"
cp -R "$APP_PATH" "$SIGNED_APP_PATH"

echo "Signing app bundle with: $APP_SIGN_IDENTITY"
codesign \
  --force \
  --deep \
  --options runtime \
  --entitlements "$ROOT_DIR/src-tauri/entitlements.plist" \
  --sign "$APP_SIGN_IDENTITY" \
  "$SIGNED_APP_PATH"

echo "Building App Store installer with: $INSTALLER_SIGN_IDENTITY"
productbuild \
  --component "$SIGNED_APP_PATH" /Applications \
  --sign "$INSTALLER_SIGN_IDENTITY" \
  "$PKG_PATH"

echo "Created App Store package:"
echo "  $PKG_PATH"
