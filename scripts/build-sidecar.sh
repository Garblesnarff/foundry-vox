#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  ARCH="aarch64"
fi
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
TARGET_TRIPLE="${ARCH}-apple-darwin"
if [ "$OS" != "darwin" ]; then
  TARGET_TRIPLE="${ARCH}-${OS}"
fi

EXTRAS="--extra build"
if [ "${FOUNDRY_VOX_INCLUDE_ML:-1}" = "1" ]; then
  EXTRAS="$EXTRAS --extra ml --extra mlx"
fi

uv sync --project backend $EXTRAS >/dev/null
uv run --project backend pyinstaller backend/foundry_vox_backend.spec --noconfirm >/dev/null

mkdir -p src-tauri/binaries
rm -rf "src-tauri/resources/backend/foundry-vox-backend-${TARGET_TRIPLE}"
mkdir -p src-tauri/resources/backend
cp -R "dist/foundry-vox-backend" "src-tauri/resources/backend/foundry-vox-backend-${TARGET_TRIPLE}"

echo "Bundled backend resources at src-tauri/resources/backend/foundry-vox-backend-${TARGET_TRIPLE}"
