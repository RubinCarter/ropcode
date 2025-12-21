#!/bin/bash
set -e

# Build DMG for Ropcode (Wails app)
# Requires: create-dmg (brew install create-dmg)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build/bin"
APP_NAME="ropcode"
APP_PATH="$BUILD_DIR/${APP_NAME}.app"
DMG_NAME="Ropcode.dmg"
DMG_PATH="$BUILD_DIR/$DMG_NAME"
VOLUME_NAME="Ropcode"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Ropcode DMG...${NC}"

# Check if create-dmg is installed
if ! command -v create-dmg &> /dev/null; then
    echo -e "${RED}Error: create-dmg is not installed.${NC}"
    echo "Install it with: brew install create-dmg"
    exit 1
fi

# Build the app first if --no-build is not specified
if [[ "$1" != "--no-build" ]]; then
    echo -e "${YELLOW}Building Wails app...${NC}"
    cd "$PROJECT_ROOT"
    wails build -clean
fi

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: $APP_PATH not found.${NC}"
    echo "Run 'wails build' first or remove --no-build flag."
    exit 1
fi

# Remove old DMG if exists
if [ -f "$DMG_PATH" ]; then
    echo -e "${YELLOW}Removing old DMG...${NC}"
    rm -f "$DMG_PATH"
fi

# Create DMG
echo -e "${YELLOW}Creating DMG...${NC}"
create-dmg \
    --volname "$VOLUME_NAME" \
    --volicon "$PROJECT_ROOT/build/appicon.png" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "${APP_NAME}.app" 150 190 \
    --app-drop-link 450 185 \
    --hide-extension "${APP_NAME}.app" \
    "$DMG_PATH" \
    "$APP_PATH"

echo -e "${GREEN}DMG created successfully: $DMG_PATH${NC}"
echo -e "${GREEN}Size: $(du -h "$DMG_PATH" | cut -f1)${NC}"
