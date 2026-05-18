# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ropcode is an Electron desktop app that wraps Claude Code / Gemini CLI / Codex to run AI coding agents in parallel. It ships **three binaries** built from one Go module:

1. `ropcode-server` — the WebSocket RPC backend (built with `-tags server`, entry: `server_main.go`).
2. `ropcode` (CLI) — a separate binary in `./cmd/ropcode` that connects to a running server over RPC.
3. Electron shell (`electron/`) — spawns `ropcode-server` as a child process and serves the React frontend.

A standalone `ropcode-server` run (without Electron) is a valid target; the server reverse-proxies Vite in dev and serves `frontend/dist` in production.

## Commands

All npm scripts run from the repo root unless stated. The shell is bash (Git Bash on Windows).

| Purpose | Command |
|---|---|
| Full dev stack (Go + frontend + Electron) | `npm run dev` |
| Electron-only dev (assumes Go + frontend already built) | `make dev` |
| Full production build | `npm run build` |
| Electron-only build | `make build` |
| Packaged Electron release | `npm run build:release` (runs `scripts/build-electron.sh`) |
| Go server + platform/arch CLI | `npm run build:go` (builds `bin/ropcode-server` + CLI via `scripts/build-cli.sh`) |
| Go CLI only (flat path) | `npm run build:cli:dev` → `bin/ropcode` |
| Go tests | `go test ./...` (or target a package, e.g. `go test ./internal/claude`) |
| Single Go test | `go test -run TestName ./path/to/pkg` |
| Electron tests | `cd electron && npm test` (TSC compiles to `.tmp-test/`, runs with `node --test`) |
| Frontend typecheck | `cd frontend && npm run build:typecheck` |
| Clean | `make clean` |

The `Makefile` is a thin shim — its `dev` and `build` targets only run `cd electron && npm run dev|build`. They do **not** rebuild the Go binaries or start Vite. Use the `npm run dev` / `npm run build` scripts when you need the full stack.

Build note: `scripts/build-cli.sh` drops the CLI into `bin/<platform>/<arch>/ropcode[.exe]`; `npm run build:cli:dev` drops it at `bin/ropcode` (flat). Electron's `getCliBinaryPath()` expects the platform/arch layout in dev.

For Windows release work, `npm run build:release` may fail under `cmd.exe` because it shells into `./scripts/build-electron.sh` — run it from Git Bash or invoke `bash ./scripts/build-electron.sh` directly.

## Architecture

### Electron ↔ Go handshake

`electron/src/go-server.ts` spawns `ropcode-server` with env:

- `ROPCODE_AUTH_KEY` — random UUID per session, required on every RPC call.
- `ROPCODE_MODE=websocket`
- `ROPCODE_VITE_URL` (dev) or `ROPCODE_FRONTEND_DIR` (prod) — tells Go how to serve the UI.

Go picks a free port and prints `WS_PORT:<port>` to stdout. Electron parses this line, then loads the window pointing at the Go server, which reverse-proxies Vite. This means **the browser always talks to Go, never directly to Vite** — all API traffic (RPC + events + asset serving) goes through one origin.

### RPC is reflection-based

`internal/websocket/router.go` uses `reflect` on the `*App` value to expose **every exported method** as an RPC endpoint named after the method. To add a new frontend-callable API:

1. Add a public method on `*App` in `bindings.go` (or a file in the same package).
2. Add a typed wrapper in `frontend/src/lib/rpc-client.ts` that calls `wsClient.call("MethodName", [...])`.

There is no manual route table. Method names are case-sensitive; argument and return types are JSON-marshaled via `convertParam` / `processResults`.

### App bootstrap

`app.go` defines `App` with one manager per concern (`claudeManager`, `geminiManager`, `codexManager`, `ptyManager`, `processManager`, `dbManager`, `mcpManager`, `sshManager`, `pluginManager`, `sessionManager`, `gitWatcher`, `modelRegistry`, `eventHub`). `startup()` wires them together; `shutdown()` tears them down in reverse. `BootstrapRuntime` (via `internal/runtime/bootstrap.go`) is the shared entry used by both `server_main.go` and tests (`app_clear_test.go`, `internal/runtime/registry_test.go`).

Do not instantiate managers directly in new code — go through `NewApp()` + `Startup()` so the `EventHub` wiring is correct.

### EventHub (server → client push)

`internal/eventhub/hub.go` is the single path for pushing events to the frontend. Each manager gets a small adapter struct (e.g. `claudeProcessEmitter` in `app.go`) that translates the manager's event type into an `eventhub.*` type and calls `eventHub.Emit*`. EventHub forwards to a `Broadcaster` (the WebSocket server), which fans out to all connected clients. Event names are strings (`"git:changed"`, `"process:changed"`, `"session:changed"`, etc.) — the frontend subscribes via `rpc-events.ts`.

**Don't call `broadcaster.BroadcastEvent` from managers directly** — always go through EventHub so the abstraction holds when we add non-WebSocket transports.

### AI provider session managers

`internal/claude`, `internal/gemini`, `internal/codex` each expose a `SessionManager` with near-identical shapes (`NewSessionManager`, `SetProcessEmitter`, `CleanupCompleted`, ...). They spawn the external CLI (`claude`, `gemini`, `codex`) as subprocesses and stream stdout/stderr as events. Capability discovery (`internal/claude/capability_discovery.go`) runs two prewarm goroutines at startup to cache system/user-level Claude capabilities.

### CLI (`cmd/ropcode`)

The CLI dials the same WebSocket RPC endpoint as the frontend and reuses `internal/rpc.Dial`. Entry points: `root.go` (command dispatch), `workspace.go`, `session.go`, `project.go`, `instance.go`, `tui.go`. Global flags (`--instance`, `--project`, `--workspace`, `--cwd`) are stripped before subcommand parsing — see `stripGlobalFlags`.

Multiple Ropcode instances are tracked in the SQLite DB via `internal/runtime/registry.go`; the CLI's `--instance` flag picks which one to talk to.

## Constraints & gotchas

- **Windows path layout**: project root is `E:\bit_master\ropcode`. Shell is Git Bash — use forward slashes and quote paths. Follow the Windows compat rules already in user-level `~/.claude/rules/*`.
- **Build tags**: Only `server_main.go` has `//go:build server`. A plain `go build .` will **not** produce a runnable binary (no `main`). Always pass `-tags server` or build `./cmd/ropcode`.
- **`app.go` assumes a process lifetime**: `Startup` launches background goroutines (capability prewarm, GitWatcher); tests that need to avoid these should use focused unit tests rather than `BootstrapRuntime`.
- **`bindings.go` is huge (~4k lines) and reflection-exposed**: renaming methods or changing signatures is a breaking frontend change. Grep `frontend/src/lib/rpc-client.ts` and `frontend/src/lib/ws-rpc-client.ts` before touching a public `App` method.
- **CLI lives in a separate module entry** but shares the same `internal/*` code — changes to RPC types must compile both the server and CLI targets.
- **Agents / external tools**: the app is a GUI wrapper and expects `claude`, `gemini`, and `codex` to be installed and on PATH; agent templates live in `internal/agents/examples/`.
- **Platform-split convention**: when behavior diverges between Windows and Unix, keep the Unix/default implementation in the original filename and put the Windows variant in a sibling `*_win` file (Go: build tags with `feature.go` / `feature_win.go`; TS: `feature.ts` / `feature.win.ts`). Avoid the longer `windows` suffix.

## Packaged Electron repros (Windows)

When reproducing a bug against `release\win-unpacked\Ropcode.exe`, Electron does **not** use root `bin\` or `frontend\dist`. It runs:

- `release\win-unpacked\resources\bin\ropcode-server.exe`
- `release\win-unpacked\resources\frontend\`

After a backend or frontend change, either rebuild the full release or copy fresh artifacts (`bin\ropcode-server.exe`, `bin\ropcode.exe`, `frontend\dist\*`) into the matching `resources\` paths and restart the app. Verify the running process actually picked them up — `Get-Process ropcode-server | Select Path`, `Get-FileHash`, or a fresh log marker — before judging a fix. For one-off test builds, the portable target produces `release\Ropcode 0.x.x.exe` but still depends on the unpacked `resources\` tree.

## Design docs

Historical/in-progress design notes live in `docs/plans/` (dated filenames). When implementing a feature that has a design doc, read the doc first — the code often refers back to names defined there.

## Related files

`AGENTS.md` (used by Codex) covers much of the same ground. Keep the two in sync when updating cross-cutting facts (build commands, packaged-app paths, platform-split convention).

