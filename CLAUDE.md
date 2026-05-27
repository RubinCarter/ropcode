# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ropcode is an Electron desktop app that wraps Claude Code / Gemini CLI / Codex to run AI coding agents in parallel. It ships **three binaries** built from one Go module:

1. `ropcode-server` — the WebSocket RPC backend (built with `-tags server`, entry: `server_main.go`).
2. `ropcode` (CLI) — a separate binary in `./cmd/ropcode` that connects to a running server over RPC.
3. Electron shell (`electron/`) — spawns `ropcode-server` as a child process and serves the React frontend.

A standalone `ropcode-server` run (without Electron) is a valid target; the server reverse-proxies Vite in dev and serves `frontend/dist` in production.

Windows firewall note: Ropcode intentionally binds the WebSocket server on `0.0.0.0` so LAN/mobile/dev clients can reach it when needed. Go test binaries are rebuilt under temporary paths, so Windows may repeatedly prompt for `ropcode.test.exe` unless a port-based allow rule exists. The server tries `5173`, then stable fallback ports `5180-5199`, before random fallback. Use admin PowerShell `.\scripts\allow-ropcode-firewall.ps1` once to allow those stable ports instead of narrowing the server to `127.0.0.1`.

## Commands

All npm scripts run from the repo root unless stated. The shell is bash (Git Bash on Windows).

| Purpose | Command |
|---|---|
| Full dev stack (Go + frontend + Electron) | `npm run dev` |
| Electron-only dev (assumes Go + frontend already built) | `make dev` |
| Full production build | `npm run build` |
| Electron-only build | `make build` |
| Packaged Electron release | `npm run build:release` (runs `scripts/build-electron.sh`) |
| Wails v2 single-exe build | `.\scripts\build-wails.ps1` |
| Wails v3 single-exe build | `.\wails3\scripts\build-wails3.ps1` |
| Allow Ropcode dev/test firewall prompt once | Admin PowerShell: `.\scripts\allow-ropcode-firewall.ps1` |
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

Wails v3 is intentionally isolated under `wails3\`. Do not add `wails3_*.go` files to the repository root. Use `.\wails3\scripts\build-wails3.ps1` to build `wails3\build\bin\RopcodeWails3.exe`; the script builds `ropcode-server`, copies `frontend/dist` into the v3 module, and embeds both into the Wails v3 shell. Wails v3 currently requires Go 1.25+.

## Architecture

### Electron ↔ Go handshake

`electron/src/go-server.ts` spawns `ropcode-server` with env:

- `ROPCODE_AUTH_KEY` — random UUID per session, required on every RPC call.
- `ROPCODE_MODE=websocket`
- `ROPCODE_VITE_URL` (dev) or `ROPCODE_FRONTEND_DIR` (prod) — tells Go how to serve the UI.

Go picks a free port and prints `WS_PORT:<port>` to stdout. Electron parses this line, then loads the window pointing at the Go server, which reverse-proxies Vite. This means **the browser always talks to Go, never directly to Vite** — all API traffic (RPC + events + asset serving) goes through one origin.

### Wails shells

The legacy Wails v2 shell is configured by `wails.json` and `scripts/build-wails.ps1`. It builds `build-wails\bin\RopcodeWails.exe`, starts the existing `BootstrapRuntime` in-process, and exposes WebSocket RPC routes through the Wails asset server. Do not ship a bare `go build -tags wails` binary; use the script so Wails production tags and metadata are applied.

The Wails v3 shell is a separate module in `wails3\`. Keep all v3-specific source, scripts, copied frontend files, embedded server binaries, and build output inside that directory. It embeds `ropcode-server.exe` and `frontend/dist`, extracts them at runtime, starts the server as a child process, then loads the frontend through the Wails v3 asset server while proxying `/ws`, `/ws/rpc`, `/ws/sync`, `/api/upload-attachment`, and `/local-file/` to the child server.

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

`internal/claude`, `internal/gemini`, `internal/codex`, and `internal/provider/pi` each expose a session manager or provider driver with near-identical shapes (`NewSessionManager`, `SetProcessEmitter`, `CleanupCompleted`, ...). They spawn the external CLI (`claude`, `gemini`, `codex`, `pi`) as subprocesses and stream stdout/stderr as events. Capability discovery (`internal/claude/capability_discovery.go`) runs two prewarm goroutines at startup to cache system/user-level Claude capabilities.

Pi provider note: Ropcode treats Pi as an external CLI dependency. Install `@earendil-works/pi-coding-agent` so `pi` is on PATH, with Node >= 22.19.0. Ropcode starts it via `pi --mode rpc`, keeps stdin open, sends JSONL prompt/abort commands, and renders stdout through the unified provider session-frame stream. Pi config defaults to `~/.pi/agent`; override with `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` when needed.

### CLI (`cmd/ropcode`)

The CLI dials the same WebSocket RPC endpoint as the frontend and reuses `internal/rpc.Dial`. Entry points: `root.go` (command dispatch), `workspace.go`, `session.go`, `project.go`, `instance.go`, `tui.go`. Global flags (`--instance`, `--project`, `--workspace`, `--cwd`) are stripped before subcommand parsing — see `stripGlobalFlags`.

Multiple Ropcode instances are tracked in the SQLite DB via `internal/runtime/registry.go`; the CLI's `--instance` flag picks which one to talk to.

CLI PWD behavior: from a real unregistered directory, bare `ropcode status`, `send`, `logs`, `stop`, or `focus` auto-registers that directory as a project through the server RPC path, treats it as the logical `main` space, prints registration and history import counts, and emits normal project change events. Saved focus is only a fallback and must not override a real registered or auto-registerable `$PWD`.

### Desktop UI automation

Prefer browser-layer automation first when the behavior can be validated through the React/WebSocket UI without Electron-native window semantics. The dedicated harness lives in `ui-automation/` and runs headless Microsoft Edge through Playwright:

```powershell
npm --prefix ui-automation install
npm --prefix ui-automation run test
```

That runner builds the latest local `bin\ropcode-server.exe` and `bin\win32\x64\ropcode.exe`, starts Vite and `ropcode-server`, opens the Go-served app in Edge, verifies injected WebSocket auth config, performs an authenticated `ListProjects` RPC call, and navigates the Projects, Settings, and Agents panes. Use it as the default final UI check for visible frontend, RPC, navigation, and CLI/UI sync changes because it does not steal mouse, keyboard, or foreground focus.

Use the `agent-computer-use` skill and the `agent-cu` CLI for desktop UI validation. Do not replace it with raw coordinate scripts, PowerShell UI hacks, or generic process/window commands when the test needs to click, type, read, or verify the app.

Start every UI automation run with:

1. `agent-cu check-permissions`
2. `agent-cu apps --compact` to discover the exact app name
3. `agent-cu windows -a <APP> --compact`
4. `agent-cu snapshot -a <APP> -i -c -d 8`

If the sidebar or nested controls are missing, retry snapshots with `-d 12`. Follow the loop `snapshot -> act -> verify`: after any click, typing action, navigation, modal open, or UI mutation, take a fresh snapshot because `@e*` refs can go stale. Prefer stable `id="..."` selectors when the Electron DOM exposes them; use refs only for the immediate next action after a snapshot.

For CLI/UI sync tests, mutate state through CLI/RPC or one UI surface, then verify the other surface without pressing the manual refresh button. Use `agent-cu text -a <APP>`, `agent-cu find`, `agent-cu wait-for`, or `agent-cu get-value` as the state check; do not treat a successful click as proof that the UI updated.

For final verification of any change that affects visible frontend state, RPC-backed UI, navigation, modals, or user workflows, run the browser UI automation in `ui-automation/` in addition to unit tests/typechecks. If the change affects Electron startup, native window behavior, file dialogs, accessibility-tree behavior, or desktop-only focus/keyboard paths, also run a real `agent-cu` desktop scenario when the machine is available for foreground UI control. Unit tests and typechecks are necessary but not sufficient for these changes.

When an `agent-cu` run hits a tool-specific pitfall, record it before finishing: include the symptom, likely cause, reliable recovery, and exact command/selector that worked. Update both this file and `AGENTS.md` when the lesson is durable enough to help future UI automation.

Windows Electron lessons from the 2026-05-21 UI sync validation:

- In dev runs launched through the root Electron binary, `agent-cu apps --compact` may report the app as `electron` while `agent-cu snapshot -a electron ...` fails with `application not found`. If `agent-cu windows -a electron --compact` shows a window titled `ropcode`, use the title for targeted reads (`agent-cu snapshot -a ropcode -i -c -d 8`) or omit `-a` while the Ropcode window is frontmost.
- The Windows `agent-cu wait-for` command does not accept `-a`; `agent-cu wait-for 'name~="..."' -a ropcode` fails with `unexpected argument '-a'`. Use `agent-cu find ... -a ropcode --compact`, `agent-cu text -a ropcode`, or a frontmost-window `agent-cu wait-for` instead.
- Electron DevTools can appear as a second text area in snapshots and pollute `agent-cu text` output. Prefer compact snapshots and selector-based checks, or close DevTools before broad text checks.
- In project-list sync checks, an unexpanded project row may expose the updated workspace count before individual workspace names are visible. Verifying the row name changed from `ropcode 2 main` to `ropcode 3 main` without pressing refresh is valid evidence that `project:changed` reloaded the list.
- When a user is actively using the desktop, do not run `agent-cu click`, `agent-cu type`, key presses, window restore, or window focus commands. Use `ui-automation/` or `playwright-cli --browser=msedge` browser checks instead; reserve `agent-cu` interaction for an agreed foreground test window or a dedicated VM/session.

## Constraints & gotchas

- **Windows path layout**: project root is `E:\bit_master\ropcode`. Shell is Git Bash — use forward slashes and quote paths. Follow the Windows compat rules already in user-level `~/.claude/rules/*`.
- **Build tags**: Only `server_main.go` has `//go:build server`. A plain `go build .` will **not** produce a runnable binary (no `main`). Always pass `-tags server` or build `./cmd/ropcode`.
- **`app.go` assumes a process lifetime**: `Startup` launches background goroutines (capability prewarm, GitWatcher); tests that need to avoid these should use focused unit tests rather than `BootstrapRuntime`.
- **Local scratch artifacts**: never track `.graphifyignore`, `graphify-out/`, or `docs/superpowers/plans/2026-05-22-pi-fifth-provider.md`; these are ignored local analysis/obsolete plan artifacts.
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

