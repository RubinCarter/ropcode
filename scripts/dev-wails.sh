#!/bin/bash
# scripts/dev-wails.sh
# Launch wails dev with frontend watch mode (subprocess+proxy architecture)

set -e

resolve_wails() {
  if command -v wails &>/dev/null; then command -v wails; return; fi
  local go_bin
  go_bin="$(go env GOPATH 2>/dev/null)/bin"
  if [[ -x "$go_bin/wails" ]]; then echo "$go_bin/wails"; return; fi
  go_bin="$(go env GOBIN 2>/dev/null)"
  if [[ -n "$go_bin" && -x "$go_bin/wails" ]]; then echo "$go_bin/wails"; return; fi
}

ensure_frontend_deps() {
  if [[ ! -x "frontend/node_modules/.bin/vite" ]]; then
    echo "[dev-wails] Installing frontend dependencies..."
    (cd frontend && npm install)
  fi
}

ensure_wails() {
  local wails_bin
  wails_bin="$(resolve_wails)"
  if [[ -z "$wails_bin" ]]; then
    echo "[dev-wails] Installing Wails CLI..."
    go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
    wails_bin="$(resolve_wails)"
  fi
  if [[ -z "$wails_bin" ]]; then
    echo "[dev-wails] wails not found. Run: go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0" >&2
    exit 127
  fi
  echo "$wails_bin"
}

ensure_frontend_deps
WAILS="$(ensure_wails)"

# Build ropcode-server (the subprocess that handles RPC)
echo "[dev-wails] Building ropcode-server..."
go build -tags server -o bin/ropcode-server .

# Ensure frontend/dist exists for initial load
if [ ! -f "frontend/dist/index.html" ]; then
  echo "[dev-wails] Building frontend for first run..."
  (cd frontend && npm run build:dev)
fi

# wails dev handles:
# - Go compilation + hot reload on .go changes (the wails shell binary)
# - frontend:dev:watcher starts the Vite dev server and auto-discovers its URL
# - Wails proxies Vite while preserving the runtime/RPC middleware
exec "$WAILS" dev -tags wails -skipbindings -s
