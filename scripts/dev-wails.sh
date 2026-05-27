#!/bin/bash
# scripts/dev-wails.sh
# Launch wails dev with frontend watch mode (subprocess+proxy architecture)

set -e

# Build ropcode-server (the subprocess that handles RPC)
echo "[dev-wails] Building ropcode-server..."
go build -tags server -o bin/ropcode-server .

# Ensure frontend/dist exists for initial load
if [ ! -f "frontend/dist/index.html" ]; then
  echo "[dev-wails] Building frontend for first run..."
  (cd frontend && npm run build)
fi

# wails dev handles:
# - Go compilation + hot reload on .go changes (the wails shell binary)
# - frontend:dev:watcher runs "vite build --watch" for auto-rebuild
# - Serves built assets from frontend/dist with middleware injection
# - Auto-reloads webview when frontend/dist changes
exec wails dev -tags wails -skipbindings
