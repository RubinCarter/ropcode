# Ropcode Wails v3 Shell

This directory is an isolated Wails v3 packaging path. Keep Wails v3-specific Go code, module files, scripts, and generated build output here instead of adding `wails3_*.go` files to the repository root.

The v3 shell does not import the root `package main`. It builds and embeds `ropcode-server` plus `frontend/dist`, starts the server as a child process, and proxies WebSocket/API requests through the Wails v3 asset server.

## Build

From the repository root:

```powershell
.\wails3\scripts\build-wails3.ps1
```

Output:

```text
wails3\build\bin\RopcodeWails3.exe
```

Requirements:

- Go 1.25 or newer.
- Wails v3 CLI. The build script installs `github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.95` if missing.

Use `-SkipFrontend` only when `frontend/dist` has already been rebuilt from current frontend source.
