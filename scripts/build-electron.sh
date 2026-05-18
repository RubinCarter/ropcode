#!/bin/bash
# scripts/build-electron.sh
# 完整的 Electron 构建流程

set -e

echo "=== Ropcode Electron Build ==="

# 检测当前操作系统
if [[ "$OSTYPE" == "darwin"* ]]; then
  CURRENT_OS="darwin"
  BUILDER_TARGET="--mac"
elif [[ "$OSTYPE" == "linux"* ]]; then
  CURRENT_OS="linux"
  BUILDER_TARGET="--linux"
elif [[ "$OSTYPE" == "msys"* ]] || [[ "$OSTYPE" == "cygwin"* ]] || [[ "$OSTYPE" == "win32"* ]]; then
  CURRENT_OS="win32"
  BUILDER_TARGET="--win"
else
  echo "Unsupported OS: $OSTYPE"
  exit 1
fi

echo "Detected OS: $CURRENT_OS ($OSTYPE)"

# 1. 构建 Go 服务器
 echo "Building Go server..."
mkdir -p bin/darwin/arm64 bin/darwin/x64 bin/linux/x64 bin/win32/x64

if [[ "$CURRENT_OS" == "darwin" ]]; then
  GOOS=darwin GOARCH=arm64 go build -tags server -o bin/darwin/arm64/ropcode-server .
  GOOS=darwin GOARCH=amd64 go build -tags server -o bin/darwin/x64/ropcode-server .
  GOOS=darwin GOARCH=arm64 go build -o bin/darwin/arm64/ropcode ./cmd/ropcode
  GOOS=darwin GOARCH=amd64 go build -o bin/darwin/x64/ropcode ./cmd/ropcode
elif [[ "$CURRENT_OS" == "linux" ]]; then
  GOOS=linux GOARCH=amd64 go build -tags server -o bin/linux/x64/ropcode-server .
  GOOS=linux GOARCH=amd64 go build -o bin/linux/x64/ropcode ./cmd/ropcode
elif [[ "$CURRENT_OS" == "win32" ]]; then
  GOOS=windows GOARCH=amd64 go build -tags server -o bin/win32/x64/ropcode-server.exe .
  GOOS=windows GOARCH=amd64 go build -o bin/win32/x64/ropcode.exe ./cmd/ropcode
fi

echo "Go server built."

# 2. 构建前端
echo "Building frontend..."
cd frontend
npm ci
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" npm run build
cd ..
echo "Frontend built."

# 3. 构建 Electron
echo "Building Electron..."
cd electron
npm install
npm run build
cd ..
echo "Electron built."

# 4. 复制前端到 Electron
echo "Copying frontend to Electron..."
mkdir -p electron/dist/frontend
cp -r frontend/dist/* electron/dist/frontend/
echo "Frontend copied."

# 5. 根据当前 OS 生成临时 electron-builder 配置
echo "Preparing electron-builder config for $CURRENT_OS..."
if [[ "$CURRENT_OS" == "darwin" ]]; then
  SERVER_BIN="bin/darwin/\${arch}/ropcode-server"
  CLI_BIN="bin/darwin/\${arch}/ropcode"
  SERVER_RESOURCE="bin/ropcode-server"
  CLI_RESOURCE="bin/ropcode"
elif [[ "$CURRENT_OS" == "linux" ]]; then
  SERVER_BIN="bin/linux/x64/ropcode-server"
  CLI_BIN="bin/linux/x64/ropcode"
  SERVER_RESOURCE="bin/ropcode-server"
  CLI_RESOURCE="bin/ropcode"
elif [[ "$CURRENT_OS" == "win32" ]]; then
  SERVER_BIN="bin/win32/x64/ropcode-server.exe"
  CLI_BIN="bin/win32/x64/ropcode.exe"
  SERVER_RESOURCE="bin/ropcode-server.exe"
  CLI_RESOURCE="bin/ropcode.exe"
fi

sed \
  -e "s|from: bin/darwin/\${arch}/ropcode-server|from: $SERVER_BIN|" \
  -e "s|to: bin/ropcode-server|to: $SERVER_RESOURCE|" \
  -e "s|from: bin/darwin/\${arch}/ropcode$|from: $CLI_BIN|" \
  -e "s|to: bin/ropcode$|to: $CLI_RESOURCE|" \
  electron-builder.yml > electron-builder-tmp.yml

# 6. 打包
echo "Packaging with electron-builder ($BUILDER_TARGET)..."
npx electron-builder $BUILDER_TARGET --config electron-builder-tmp.yml

# 7. 清理临时配置
rm -f electron-builder-tmp.yml

echo "=== Build Complete ==="
