#!/bin/bash
# scripts/dev-wails.sh
# Launch wails dev with frontend watch mode (no proxy, uses built assets)

set -e

# Ensure frontend/dist exists for initial load
if [ ! -f "frontend/dist/index.html" ]; then
  echo "[dev-wails] Building frontend for first run..."
  (cd frontend && npm run build)
fi

# wails dev handles:
# - Go compilation + hot reload on .go changes
# - frontend:dev:watcher runs "vite build --watch" for auto-rebuild
# - Serves built assets from frontend/dist with middleware injection
# - Auto-reloads webview when frontend/dist changes
exec wails dev -tags wails -skipbindings
