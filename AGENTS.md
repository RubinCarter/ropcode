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
| Dev app | `make dev` or `npm run dev` |
| Full production build | `make build` or `npm run build` |
| Packaged Electron release | `npm run build:release` |
| Go server and CLI build | `npm run build:go` |
| Go CLI dev build | `npm run build:cli:dev` |
| Go tests | `go test ./...` |
| Single Go test | `go test -run TestName ./path/to/pkg` |
| Electron tests | `cd electron && npm test` |
| Frontend typecheck | `cd frontend && npm run build:typecheck` |
| Clean | `make clean` |

Build note: a plain `go build .` does not produce a runnable server because `server_main.go` is behind the `server` build tag. Use `go build -tags server -o bin/ropcode-server .` or the npm scripts.

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

### Reflection RPC

`internal/websocket/router.go` reflects exported methods on `*App` and exposes them as RPC endpoints. To add a frontend-callable API:

1. Add a public method on `*App`, usually in `bindings.go` or another file in package `main`.
2. Add a typed wrapper in `frontend/src/lib/rpc-client.ts`.

Method names are case-sensitive. Changing exported `App` method names, signatures, or JSON shapes can break the frontend and CLI.

### App Bootstrap

`app.go` owns the main `App` type and wires managers during `Startup()`. Use `NewApp()` and `Startup()` rather than directly constructing managers in new code, so EventHub and lifecycle wiring remain correct.

### EventHub

`internal/eventhub/hub.go` is the single server-to-client push path. Managers should emit through adapter structs that call EventHub methods. Do not call `broadcaster.BroadcastEvent` directly from managers.

### Provider Managers

`internal/claude`, `internal/gemini`, and `internal/codex` each contain provider session managers that spawn external CLIs and stream process output as events. Keep provider-specific changes inside the matching package unless a shared contract genuinely needs to change.

### CLI

The CLI lives in `cmd/ropcode` and shares `internal/*` code with the server. RPC and model changes must compile for both server and CLI targets.

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
