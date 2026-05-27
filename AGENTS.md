# AGENTS.md

This file gives Codex and other coding agents the repository-specific context needed to work safely in this project.

## Project Overview

Ropcode is an Electron desktop app that wraps Claude Code, Gemini CLI, and Codex so users can run AI coding agents in parallel. The repository builds three runtime surfaces from one Go module:

- `ropcode-server`: WebSocket RPC backend, built with `-tags server` from `server_main.go`.
- `ropcode`: CLI binary under `cmd/ropcode`, connecting to a running server over RPC.
- Electron shell: `electron/` starts `ropcode-server` and serves the React frontend.

The standalone server mode is valid. In development it reverse-proxies Vite; in production it serves `frontend/dist`.

Windows firewall note: Ropcode intentionally binds the WebSocket server on `0.0.0.0` so LAN/mobile/dev clients can reach it when needed. Go test binaries are rebuilt under temporary paths, so Windows may repeatedly prompt for `ropcode.test.exe` unless a port-based allow rule exists. The server tries `5173`, then stable fallback ports `5180-5199`, before random fallback. Use admin PowerShell `.\scripts\allow-ropcode-firewall.ps1` once to allow those stable ports instead of narrowing the server to `127.0.0.1`.

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
| Wails v3 single-exe build | `.\wails3\scripts\build-wails3.ps1` |
| Allow Ropcode dev/test firewall prompt once | Admin PowerShell: `.\scripts\allow-ropcode-firewall.ps1` |
| Go server and CLI build | `npm run build:go` |
| Go CLI dev build | `npm run build:cli:dev` |
| Go tests | `go test ./...` |
| Single Go test | `go test -run TestName ./path/to/pkg` |
| Electron tests | `cd electron && npm test` |
| Frontend typecheck | `cd frontend && npm run build:typecheck` |
| Browser UI automation (Edge, no desktop control) | `npm --prefix ui-automation run test` |
| Clean | `make clean` |

The `Makefile` is a thin shim — its `dev` and `build` targets only run `cd electron && npm run dev|build`. They do not rebuild the Go binaries or start Vite. Use the `npm run dev` / `npm run build` scripts when you need the full stack.

Build note: a plain `go build .` does not produce a runnable server because `server_main.go` is behind the `server` build tag. Use `go build -tags server -o bin/ropcode-server .` or the npm scripts.

Wails build note: do not ship or test `build-wails\bin\RopcodeWails.exe` produced by bare `go build -tags wails`. It can compile but will fail at startup with Wails' "correct build tags" dialog because the Wails CLI adds required production tags, metadata, and packaging steps. Use `.\scripts\build-wails.ps1` for a runnable single-exe Wails build.

Wails v3 build note: v3 is intentionally isolated under `wails3\`. Do not add `wails3_*.go` files to the repository root. Use `.\wails3\scripts\build-wails3.ps1` to build `wails3\build\bin\RopcodeWails3.exe`; the script builds `ropcode-server`, copies `frontend/dist` into the v3 module, and embeds both into the Wails v3 shell. Wails v3 currently requires Go 1.25+.

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

### Wails v3 Single-Exe Shell

The Wails v3 shell is isolated in `wails3\` as a separate Go module. Keep all v3-specific source, scripts, copied frontend files, embedded server binaries, and build output inside that directory. It builds a small Wails v3 host that embeds `ropcode-server.exe` and `frontend/dist`, extracts them at runtime, starts the server as a child process, then loads the frontend through the Wails asset server while proxying `/ws`, `/ws/rpc`, `/ws/sync`, `/api/upload-attachment`, and `/local-file/` to the child server.

For Wails v3 repros or distribution tests:

- Build with `.\wails3\scripts\build-wails3.ps1`; add `-SkipFrontend` only when `frontend/dist` has already been rebuilt from current source.
- Do not put Wails v3 entrypoints in the root module. The root module remains the v2 Wails/Electron/server module.
- After frontend or backend changes, verify the running process path is `wails3\build\bin\RopcodeWails3.exe` and check the embedded `wails3\bin\ropcode-server.exe` hash or timestamp before judging the fix.
- Wails v3 uses the system WebView2 runtime and does not bundle Electron, Chromium, Bun, or Node. Electron `<webview>` functionality is not full parity in this shell.

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

`internal/claude`, `internal/gemini`, `internal/codex`, and `internal/provider/pi` each contain provider session managers or drivers that spawn external CLIs and stream process output as events. They expose near-identical shapes (`NewSessionManager`, `SetProcessEmitter`, `CleanupCompleted`, ...). Keep provider-specific changes inside the matching package unless a shared contract genuinely needs to change. The app expects `claude`, `gemini`, `codex`, and `pi` to be installed and on PATH when those providers are used.

Pi provider note: Ropcode treats Pi as an external CLI dependency. Install `@earendil-works/pi-coding-agent` so `pi` is on PATH, with Node >= 22.19.0. Ropcode starts it via `pi --mode rpc`, keeps stdin open, sends JSONL prompt/abort commands, and renders stdout through the unified provider session-frame stream. Pi config defaults to `~/.pi/agent`; override with `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` when needed.

### CLI

The CLI lives in `cmd/ropcode` and shares `internal/*` code with the server, dialing the same WebSocket RPC endpoint via `internal/rpc.Dial`. Entry points: `root.go` (command dispatch), `workspace.go`, `session.go`, `project.go`, `instance.go`, `tui.go`. Global flags (`--instance`, `--project`, `--workspace`, `--cwd`) are stripped before subcommand parsing — see `stripGlobalFlags`. Multiple Ropcode instances are tracked in the SQLite DB via `internal/runtime/registry.go`; `--instance` selects which one to talk to. RPC and model changes must compile for both server and CLI targets.

CLI PWD behavior: from a real unregistered directory, bare `ropcode status`, `send`, `logs`, `stop`, or `focus` auto-registers that directory as a project through the server RPC path, treats it as the logical `main` space, prints registration and history import counts, and emits normal project change events. Saved focus is only a fallback and must not override a real registered or auto-registerable `$PWD`.

### Desktop UI Automation

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

When an `agent-cu` run hits a tool-specific pitfall, record it before finishing: include the symptom, likely cause, reliable recovery, and exact command/selector that worked. Update both this file and `CLAUDE.md` when the lesson is durable enough to help future UI automation.

Windows Electron lessons from the 2026-05-21 UI sync validation:

- In dev runs launched through the root Electron binary, `agent-cu apps --compact` may report the app as `electron` while `agent-cu snapshot -a electron ...` fails with `application not found`. If `agent-cu windows -a electron --compact` shows a window titled `ropcode`, use the title for targeted reads (`agent-cu snapshot -a ropcode -i -c -d 8`) or omit `-a` while the Ropcode window is frontmost.
- The Windows `agent-cu wait-for` command does not accept `-a`; `agent-cu wait-for 'name~="..."' -a ropcode` fails with `unexpected argument '-a'`. Use `agent-cu find ... -a ropcode --compact`, `agent-cu text -a ropcode`, or a frontmost-window `agent-cu wait-for` instead.
- Electron DevTools can appear as a second text area in snapshots and pollute `agent-cu text` output. Prefer compact snapshots and selector-based checks, or close DevTools before broad text checks.
- In project-list sync checks, an unexpanded project row may expose the updated workspace count before individual workspace names are visible. Verifying the row name changed from `ropcode 2 main` to `ropcode 3 main` without pressing refresh is valid evidence that `project:changed` reloaded the list.
- When a user is actively using the desktop, do not run `agent-cu click`, `agent-cu type`, key presses, window restore, or window focus commands. Use `ui-automation/` or `playwright-cli --browser=msedge` browser checks instead; reserve `agent-cu` interaction for an agreed foreground test window or a dedicated VM/session.

## Constraints

- Workspace root on this machine: `E:\bit_master\ropcode`.
- This repo is Windows-oriented but contains bash scripts used by npm and make targets.
- When code must differ between Windows and Unix-like platforms, keep the Unix-like implementation in the original file name and move only Windows-specific code into a separate `win` file. In Go, use build tags with names such as `feature.go` for Unix-like/default behavior and `feature_win.go` for Windows behavior; avoid the longer `windows` suffix. Use the equivalent `win` platform module/file split in TypeScript/Electron code.
- Use `rg` or `rg --files` for searches.
- Prefer focused unit tests over full app bootstrap when changing code that does not need process-lifetime goroutines.
- Never track local Graphify scratch files or stale Superpowers plan drafts: `.graphifyignore`, `graphify-out/`, and `docs/superpowers/plans/2026-05-22-pi-fifth-provider.md` must remain ignored/untracked.
- `bindings.go` is large and reflection-exposed; inspect `frontend/src/lib/rpc-client.ts` and `frontend/src/lib/ws-rpc-client.ts` before changing public `App` methods.
- Agent templates live in `internal/agents/examples/`.
- Design notes live in `docs/plans/`; read the relevant plan before implementing a feature covered there.

## Verification Guidance

Pick the smallest verification that covers the change:

- Go backend or CLI changes: `go test ./...`, or a focused package/test while iterating.
- Frontend TypeScript changes: `cd frontend && npm run build:typecheck`.
- Electron main-process changes: `cd electron && npm test`.
- Cross-surface changes: combine the relevant commands above.
- User-visible frontend, RPC UI, navigation, or CLI/UI sync changes: also run `npm --prefix ui-automation run test` so a real browser drives the Go-served UI. Do not rely only on unit tests, Go tests, or TypeScript checks for final sign-off.
- Electron-native desktop changes: add an `agent-cu` desktop UI scenario when foreground control is acceptable, or report clearly that only browser-layer automation was run.
- Packaged Electron repros: confirm the running process uses `release\win-unpacked\resources\bin\ropcode-server.exe` and that this file matches the newly built server hash. If needed, copy `bin\ropcode-server.exe`, `bin\ropcode.exe`, and `frontend\dist` into `release\win-unpacked\resources\bin\` and `release\win-unpacked\resources\frontend\`, then restart the app.

When a command cannot be run, report that clearly with the reason.

## Related files

`CLAUDE.md` (used by Claude Code) covers much of the same ground. Keep the two in sync when updating cross-cutting facts (build commands, packaged-app paths, platform-split convention).

Ropcode-specific agent skills must also stay in sync with this file when changing CLI usage, UI automation requirements, human-test build steps, or packaged-app verification rules:

- Codex project skill: `.codex/skills/ropcode-cli/SKILL.md`
- Claude Code local skill on this workstation: `C:\Users\式羽\.claude\skills\ropcode-cli\SKILL.md`
