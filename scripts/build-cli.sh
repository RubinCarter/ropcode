#!/bin/bash
# scripts/build-cli.sh
# Build ropcode CLI binary into the platform/arch-specific bin directory

set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="darwin"
elif [[ "$OSTYPE" == "linux"* ]]; then
  PLATFORM="linux"
else
  PLATFORM="win32"
fi

# Use sysctl to detect real hardware arch (handles Rosetta 2 on Apple Silicon)
if [[ "$PLATFORM" == "darwin" ]]; then
  HW_ARCH=$(sysctl -n hw.optional.arm64 2>/dev/null)
  if [[ "$HW_ARCH" == "1" ]]; then
    ARCH="arm64"
  else
    ARCH="x64"
  fi
else
  RAW_ARCH=$(uname -m)
  if [[ "$RAW_ARCH" == "arm64" ]] || [[ "$RAW_ARCH" == "aarch64" ]]; then
    ARCH="arm64"
  else
    ARCH="x64"
  fi
fi

OUT="bin/$PLATFORM/$ARCH/ropcode"
if [[ "$PLATFORM" == "win32" ]]; then
  OUT="$OUT.exe"
fi

mkdir -p "$(dirname "$OUT")"
go build -o "$OUT" ./cmd/ropcode
echo "CLI built: $OUT"
