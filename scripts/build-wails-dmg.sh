#!/bin/bash
# scripts/build-wails-dmg.sh
# Build wails app and package as DMG

set -e

ARCH="${1:-arm64}"
APP_NAME="Ropcode"
VERSION=$(python3 -c "import json; print(json.load(open('wails.json'))['info']['productVersion'])")
DMG_NAME="${APP_NAME}-${VERSION}-${ARCH}.dmg"
APP_PATH="release/bin/${APP_NAME}.app"
DMG_PATH="release/${DMG_NAME}"
APPICON_SRC="assets/icon.png"
APPICON_ICNS="assets/icon.icns"
APPICON_PATH="build/appicon.png"

echo "=== Ropcode Wails Build (${ARCH}) ==="

# Wails v2 reads build/appicon.png and turns it into Contents/Resources/iconfile.icns.
# Keep the Wails icon source derived from the shared project icon used by Electron.
if [ ! -f "$APPICON_SRC" ]; then
  echo "ERROR: ${APPICON_SRC} not found"
  exit 1
fi
if [ ! -f "$APPICON_ICNS" ]; then
  echo "ERROR: ${APPICON_ICNS} not found"
  exit 1
fi
mkdir -p "$(dirname "$APPICON_PATH")"
if command -v magick &> /dev/null; then
  magick "$APPICON_SRC" -background none -gravity center -resize 1024x1024 -extent 1024x1024 "$APPICON_PATH"
else
  cp "$APPICON_SRC" "$APPICON_PATH"
fi

# 1. Build ropcode-server
echo "Building ropcode-server for darwin/${ARCH}..."
GOOS=darwin GOARCH="${ARCH}" go build -tags server -trimpath -ldflags "-s -w" -o "bin/ropcode-server" .

# 2. Build frontend
echo "Building frontend..."
cd frontend && npm run build && cd ..

# 3. Build wails app
echo "Building wails app for darwin/${ARCH}..."
wails build -tags wails -platform "darwin/${ARCH}"

# 4. Bundle ropcode-server and frontend into .app
echo "Bundling ropcode-server into ${APP_PATH}..."
MACOS_DIR="${APP_PATH}/Contents/MacOS"
cp "bin/ropcode-server" "${MACOS_DIR}/ropcode-server"
chmod +x "${MACOS_DIR}/ropcode-server"

echo "Bundling frontend into ${APP_PATH}..."
cp -r "frontend/dist" "${MACOS_DIR}/frontend"

echo "Bundling app icon into ${APP_PATH}..."
mkdir -p "${APP_PATH}/Contents/Resources"
cp "$APPICON_ICNS" "${APP_PATH}/Contents/Resources/iconfile.icns"

# 5. Check output
if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: ${APP_PATH} not found"
  exit 1
fi

if [ ! -s "${APP_PATH}/Contents/Resources/iconfile.icns" ]; then
  echo "ERROR: ${APP_PATH} is missing Contents/Resources/iconfile.icns"
  exit 1
fi

# 6. Package as DMG
echo "Creating DMG: ${DMG_NAME}..."
rm -f "$DMG_PATH"

if command -v create-dmg &> /dev/null; then
  create-dmg \
    --volname "$APP_NAME" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "$APP_NAME.app" 130 220 \
    --app-drop-link 410 220 \
    "$DMG_PATH" \
    "$APP_PATH"
else
  # Fallback: use hdiutil directly
  hdiutil create -volname "$APP_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"
fi

echo "=== Done: ${DMG_PATH} ==="
ls -lh "$DMG_PATH"
