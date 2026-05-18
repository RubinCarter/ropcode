#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=0
SKIP_FRONTEND=0
RUN_AFTER_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --skip-install)   SKIP_INSTALL=1 ;;
    --skip-frontend)  SKIP_FRONTEND=1 ;;
    --run)            RUN_AFTER_BUILD=1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { echo ""; echo "=== $1 ==="; }

format_bytes() {
  local bytes=$1
  if   (( bytes >= 1073741824 )); then printf "%.2f GB" "$(echo "scale=2; $bytes/1073741824" | bc)"
  elif (( bytes >= 1048576 ));    then printf "%.2f MB" "$(echo "scale=2; $bytes/1048576" | bc)"
  elif (( bytes >= 1024 ));       then printf "%.2f KB" "$(echo "scale=2; $bytes/1024" | bc)"
  else echo "${bytes} B"
  fi
}

dir_size() {
  if [[ ! -d "$1" ]]; then echo 0; return; fi
  du -sb "$1" 2>/dev/null | awk '{print $1}'
}

resolve_wails() {
  if command -v wails &>/dev/null; then command -v wails; return; fi
  local go_bin
  go_bin="$(go env GOBIN 2>/dev/null)"
  if [[ -z "$go_bin" ]]; then
    go_bin="$(go env GOPATH)/bin"
  fi
  if [[ -x "$go_bin/wails" ]]; then echo "$go_bin/wails"; return; fi
  echo ""
}

step "Ropcode Wails Build (macOS)"
echo "Output folder: build-wails"
echo "Renderer: system WKWebView"
echo "Bun/Electron runtime: not bundled"

if (( ! SKIP_INSTALL )); then
  step "Ensuring Wails CLI"
  WAILS="$(resolve_wails)"
  if [[ -z "$WAILS" ]]; then
    GOPROXY="https://goproxy.cn,direct" GOSUMDB=off \
      go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
    WAILS="$(resolve_wails)"
  fi
else
  WAILS="$(resolve_wails)"
fi

if [[ -z "$WAILS" ]]; then
  echo "wails not found. Run: go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0" >&2
  exit 1
fi

if (( ! SKIP_FRONTEND )); then
  step "Building frontend"
  (cd frontend && npm run build)
fi

step "Cleaning Wails output folder"
rm -rf build-wails

step "Building Wails shell"
"$WAILS" build -clean -tags "wails" -ldflags "-s -w" -trimpath -skipbindings

step "Size summary"
for path in build-wails "build-wails/bin/RopcodeWails.app" frontend/dist; do
  if [[ -e "$path" ]]; then
    size="$(dir_size "$path")"
    printf "%-45s %12s\n" "$path" "$(format_bytes "$size")"
  fi
done

echo ""
echo "Largest Wails files:"
find build-wails -type f 2>/dev/null \
  | xargs ls -s 2>/dev/null \
  | sort -rn \
  | head -20 \
  | awk '{printf "%-90s %12s\n", $2, $1" B"}'

if (( RUN_AFTER_BUILD )); then
  step "Running Wails shell"
  APP="$(find build-wails/bin -name "*.app" | head -1)"
  if [[ -n "$APP" ]]; then
    open "$APP"
  else
    echo "No .app bundle found in build-wails/bin" >&2
    exit 1
  fi
fi
