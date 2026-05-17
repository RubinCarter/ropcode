# AGENTS.md

This file gives Codex and other coding agents the repository-specific context needed to work safely in this project.

## Project Overview

Ropcode is an Electron desktop app that wraps Claude Code, Gemini CLI, and Codex so users can run AI coding agents in parallel. The repository builds three runtime surfaces from one Go module:

- `ropcode-server`: WebSocket RPC backend, built with `-tags server` from `server_main.go`.
- `ropcode`: CLI binary under `cmd/ropcode`, connecting to a running server over RPC.
- Electron shell: `electron/` starts `ropcode-server` and serves the React frontend.

The standalone server mode is valid. In development it reverse-proxies Vite; in production it serves `frontend/dist`.

## Common Commands

Run these from the repository root unless noted.

| Purpose | Command |
| --- | --- |
| Full dev stack (Go + frontend + Electron) | `npm run dev` |
| Electron-only dev (Go + frontend already built) | `make dev` |
| Full production build | `npm run build` |
| Electron-only build | `make build` |
| Packaged Electron release | `npm run build:release` |
| Wails single-exe build | `.\scripts\build-wails.ps1` |
| Go server and CLI build | `npm run build:go` |
| Go CLI dev build | `npm run build:cli:dev` |
| Go tests | `go test ./...` |
| Single Go test | `go test -run TestName ./path/to/pkg` |
| Electron tests | `cd electron && npm test` |
| Frontend typecheck | `cd frontend && npm run build:typecheck` |
| Clean | `make clean` |

The `Makefile` is a thin shim — its `dev` and `build` targets only run `cd electron && npm run dev|build`. They do not rebuild the Go binaries or start Vite. Use the `npm run dev` / `npm run build` scripts when you need the full stack.

Build note: a plain `go build .` does not produce a runnable server because `server_main.go` is behind the `server` build tag. Use `go build -tags server -o bin/ropcode-server .` or the npm scripts.

Wails build note: do not ship or test `build-wails\bin\RopcodeWails.exe` produced by bare `go build -tags wails`. It can compile but will fail at startup with Wails' "correct build tags" dialog because the Wails CLI adds required production tags, metadata, and packaging steps. Use `.\scripts\build-wails.ps1` for a runnable single-exe Wails build.

## Architecture Notes

### Electron to Go Startup

`electron/src/go-server.ts` starts `ropcode-server` with:

- `ROPCODE_AUTH_KEY`
- `ROPCODE_MODE=websocket`
- `ROPCODE_VITE_URL` in dev or `ROPCODE_FRONTEND_DIR` in production

The Go server prints `WS_PORT:<port>` to stdout. Electron parses that line and loads the UI through the Go server. The browser should talk to Go, not directly to Vite.

When testing the unpacked packaged app from `release\win-unpacked\Ropcode.exe`, Electron does not use root `bin\` or `frontend\dist` directly. It starts:

- `release\win-unpacked\resources\bin\ropcode-server.exe`
- `release\win-unpacked\resources\frontend`

After changing backend or frontend code for a packaged-app repro, rebuild and copy the updated artifacts into those `resources` paths, or run a full release packaging step. Verify with `Get-Process ropcode-server | Select Path`, `Get-FileHash`, or a fresh server log marker before judging the fix.

For Windows release work, `npm run build:release` may fail if it is launched through `cmd.exe`, because it invokes `./scripts/build-electron.sh`. Run it from Git Bash or call `bash ./scripts/build-electron.sh` directly.

For a single-file Windows test build, use the portable target instead of NSIS. The portable output is `release\Ropcode 0.x.x.exe`; it still relies on the unpacked `resources` tree at runtime, so verify both the exe and `release\win-unpacked\resources\bin\ropcode-server.exe` hash after packaging. The current portable config needs Windows-specific `extraResources` paths (`bin/win32/x64/...`) rather than the default macOS placeholders in `electron-builder.yml`.

### Wails Single-Exe Shell

The Wails shell is an additive Windows build path configured by `wails.json` and `scripts/build-wails.ps1`. It embeds `frontend/dist` into `build-wails\bin\RopcodeWails.exe`, starts the existing `BootstrapRuntime` in-process, and exposes the same WebSocket RPC routes through the Wails asset server.

For Wails repros or distribution tests:

- Build with `.\scripts\build-wails.ps1`; add `-SkipFrontend` only when `frontend/dist` has already been rebuilt from the current frontend source.
- Do not replace this with `go build -tags wails`; that omits required Wails production build tags and produces an exe that opens an error dialog.
- After frontend or backend changes, verify the running process path is `build-wails\bin\RopcodeWails.exe` and check its `LastWriteTime` or hash before judging the fix.
- Wails uses the system WebView2 runtime and does not bundle Electron, Chromium, Bun, or Node. The Electron `<webview>` feature is not full parity in this shell.

### Reflection RPC

`internal/websocket/router.go` reflects exported methods on `*App` and exposes them as RPC endpoints. To add a frontend-callable API:

1. Add a public method on `*App`, usually in `bindings.go` or another file in package `main`.
2. Add a typed wrapper in `frontend/src/lib/rpc-client.ts`.

Method names are case-sensitive. Changing exported `App` method names, signatures, or JSON shapes can break the frontend and CLI.

### App Bootstrap

`app.go` owns the main `App` type and wires managers during `Startup()`. Use `NewApp()` and `Startup()` rather than directly constructing managers in new code, so EventHub and lifecycle wiring remain correct. `BootstrapRuntime` (`internal/runtime/bootstrap.go`) is the shared entry used by both `server_main.go` and tests; `Startup` launches background goroutines (capability prewarm, GitWatcher), so prefer focused unit tests when you don't need the full process lifetime.

### EventHub

`internal/eventhub/hub.go` is the single server-to-client push path. Managers should emit through adapter structs (e.g. `claudeProcessEmitter` in `app.go`) that call EventHub methods, which forward to the WebSocket `Broadcaster`. Event names are strings (`"git:changed"`, `"process:changed"`, `"session:changed"`, ...) and the frontend subscribes via `frontend/src/lib/rpc-events.ts`. Do not call `broadcaster.BroadcastEvent` directly from managers.

### Provider Managers

`internal/claude`, `internal/gemini`, and `internal/codex` each contain provider session managers that spawn external CLIs and stream process output as events. They expose near-identical shapes (`NewSessionManager`, `SetProcessEmitter`, `CleanupCompleted`, ...). Keep provider-specific changes inside the matching package unless a shared contract genuinely needs to change. The app expects `claude`, `gemini`, and `codex` to be installed and on PATH.

### CLI

The CLI lives in `cmd/ropcode` and shares `internal/*` code with the server, dialing the same WebSocket RPC endpoint via `internal/rpc.Dial`. Entry points: `root.go` (command dispatch), `workspace.go`, `session.go`, `project.go`, `instance.go`, `tui.go`. Global flags (`--instance`, `--project`, `--workspace`, `--cwd`) are stripped before subcommand parsing — see `stripGlobalFlags`. Multiple Ropcode instances are tracked in the SQLite DB via `internal/runtime/registry.go`; `--instance` selects which one to talk to. RPC and model changes must compile for both server and CLI targets.

## Constraints

- Workspace root on this machine: `E:\bit_master\ropcode`.
- This repo is Windows-oriented but contains bash scripts used by npm and make targets.
- When code must differ between Windows and Unix-like platforms, keep the Unix-like implementation in the original file name and move only Windows-specific code into a separate `win` file. In Go, use build tags with names such as `feature.go` for Unix-like/default behavior and `feature_win.go` for Windows behavior; avoid the longer `windows` suffix. Use the equivalent `win` platform module/file split in TypeScript/Electron code.
- Use `rg` or `rg --files` for searches.
- Prefer focused unit tests over full app bootstrap when changing code that does not need process-lifetime goroutines.
- `bindings.go` is large and reflection-exposed; inspect `frontend/src/lib/rpc-client.ts` and `frontend/src/lib/ws-rpc-client.ts` before changing public `App` methods.
- Agent templates live in `internal/agents/examples/`.
- Design notes live in `docs/plans/`; read the relevant plan before implementing a feature covered there.

## Verification Guidance

Pick the smallest verification that covers the change:

- Go backend or CLI changes: `go test ./...`, or a focused package/test while iterating.
- Frontend TypeScript changes: `cd frontend && npm run build:typecheck`.
- Electron main-process changes: `cd electron && npm test`.
- Cross-surface changes: combine the relevant commands above.
- Packaged Electron repros: confirm the running process uses `release\win-unpacked\resources\bin\ropcode-server.exe` and that this file matches the newly built server hash. If needed, copy `bin\ropcode-server.exe`, `bin\ropcode.exe`, and `frontend\dist` into `release\win-unpacked\resources\bin\` and `release\win-unpacked\resources\frontend\`, then restart the app.

When a command cannot be run, report that clearly with the reason.

## Related files

`CLAUDE.md` (used by Claude Code) covers much of the same ground. Keep the two in sync when updating cross-cutting facts (build commands, packaged-app paths, platform-split convention).
