#!/bin/bash
# scripts/build-electron.sh
# 完整的 Electron 构建流程

set -e

echo "=== Ropcode Electron Build ==="

# 1. 构建 Go 服务器
echo "Building Go server..."
mkdir -p bin/darwin/arm64 bin/darwin/x64 bin/linux/x64 bin/win32/x64

if [[ "$OSTYPE" == "darwin"* ]]; then
  GOOS=darwin GOARCH=arm64 go build -tags server -o bin/darwin/arm64/ropcode-server .
  GOOS=darwin GOARCH=amd64 go build -tags server -o bin/darwin/x64/ropcode-server .
elif [[ "$OSTYPE" == "linux"* ]]; then
  GOOS=linux GOARCH=amd64 go build -tags server -o bin/linux/x64/ropcode-server .
fi

echo "Go server built."

# 2. 构建前端
echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..
echo "Frontend built."

# 3. 构建 Electron
echo "Building Electron..."
cd electron
npm ci
npm run build
cd ..
echo "Electron built."

# 4. 复制前端到 Electron
echo "Copying frontend to Electron..."
mkdir -p electron/dist/frontend
cp -r frontend/dist/* electron/dist/frontend/
echo "Frontend copied."

# 5. 打包
echo "Packaging with electron-builder..."
npx electron-builder --config electron-builder.yml

echo "=== Build Complete ==="
