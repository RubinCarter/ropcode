# Changelog

## [0.2.3] - 2026-05-16

### Added

- **Claude activity panel**: structured subagent transcript view in the right sidebar, backed by transcript log tailing and async activity output tracking
- **Subagent message routing**: sidechain messages now render inline in the main stream when appropriate, and route into the panel via `parent_tool_use_id`
- **Claude session task monitor**: backend service that tracks Claude session control state, exposes runtime model/permission/interrupt switches, and supports provider API hot-swap
- **Windows desktop support**: single-exe Windows shell, Windows release packaging, native path handling, and platform-aware backend
- **Codex provider sync**: pull supported Codex models directly from the provider API; preserve session config across reconnects on Windows
- **CLI command tree**: flatter command structure with pwd-aware project/workspace targeting and `send --create` for ad-hoc sessions
- **Timestamped runtime logs**: per-startup server log files under `~/.ropcode/logs/`
- **Repository agent guidance**: `AGENTS.md` and refreshed README centered on workspace + multi-CLI workflows

### Fixed

- **Subagent visibility**: hide root-stream messages with `parent_tool_use_id`, restore main-session visibility for messages incorrectly captured by the panel, and unify root stream filtering
- **Message filter**: collapse consecutive transient runtime cards (api_retry, status updates) into one, and show api_retry with a "retrying" label instead of "Failed"
- **Thinking timer**: preserve elapsed time across transport reconnects and visibility changes
- **Prompt input**: keep the selected provider stable through queued sends and provider switches
- **Claude activity panel**: refresh logic on session lifecycle changes
- **Claude on Windows**: fix interactive session startup that previously failed on Windows
- **Refactor follow-ups**: restore `App.ExecuteCommand` and `App.ReadGitFileAtHead` Wails RPC methods that were dropped during the internal-package refactor

### Changed

- **Refactor**: move `logging`, `pathutil`, `gitcontent`, and `command` into `internal/` packages; root now only contains `app.go`, `bindings.go`, `server_main.go`, `dependencies.go` and their tests
- **CI**: add Windows EXE build job to the release workflow alongside macOS DMG and Linux AppImage/deb

## [0.2.2] - 2026-05-13

### Added

- **Claude capability discovery**: unified capability picker with staged loading of slash commands, project commands, and built-ins; cache-accelerated warm-up
- **Interactive Claude sessions**: Claude provider switched to interactive session mode with conversation resume, prompt queue processing, and history persistence
- **Session status bar**: persistent status bar merged with prompt queue, directional token metrics, and precise elapsed time display
- **Subagent progress panel**: grouped subagent progress with live transcript loading
- **File attachment upload**: attach files from the input bar with secure filename sanitization and native mobile picker support
- **CLI RPC client**: full CLI with instance selection, project/workspace context resolution, live session commands, and TUI attach mode
- **Instance switcher**: multi-instance dropdown integrated into titlebar and mobile header; merges instance list from URL on load
- **Mobile layout**: responsive bottom tab navigation, MCP/Settings pages adapted for mobile, iOS keyboard layout fixes, WebSocket reconnect improvements
- **Linux build support**: cross-platform Linux build script
- **Electron enhancements**: CLI installer, app menu integration, native context menu (copy/paste/links)
- **Gemini 3 models**: added Gemini 3 model family
- **1M context variants**: Sonnet[1m] and Opus[1m] one-million-token context options
- **Sidebar workspace aggregation**: colored dot indicators for workspace status; parent project row shows runtime state and branch info
- **In-app debug log viewer**: debug log panel for mobile diagnostics

### Fixed

- **UI rendering performance**: significantly reduced re-renders, scroll jank, and placeholder flashes during streaming; message card expansion state preserved
- **Message filtering**: hide queue-operation events and internal runtime noise; preserve cancellation state
- **Session recovery**: fix timestamp-based message recovery false positives; fix duplicate user messages in multi-client scenarios
- **WebSocket**: fix stale instance revival after stop; add ping/pong heartbeat; fix iOS visibility-restore reconnect
- **Claude session**: fix fallback when resume ID is invalid; fix stale API retry status after result; fix interactive session startup blocking
- **Capability picker**: restore built-in slash commands; keep project commands fresh and visible
- **File upload**: fix iOS upload path, event bubbling, filename extension handling, and error handling
- **Image preview**: fix broken image preview on iOS and remote clients
- **Terminal**: fix Powerline font rendering (Unicode11 addon); fix Safari requestIdleCallback fallback; sync xterm background with app theme
- **Chat**: fix session mixing after provider switch; fix provider API config race condition; fix Virtuoso re-measure after fullscreen/resize
- **Gemini**: remove auto model to prevent fallback to Gemini 3 on proxy servers
- **Backend**: fix silent nil return for uninitialized DB; fix RPC JSON-to-Go-struct conversion; fix list APIs returning null instead of empty slice
- **Git**: fix Chinese filename encoding in git status output
- **Build**: add macOS entitlements.plist to fix code signing

### Changed

- Migrated frontend from `@tanstack/react-virtual` to `react-virtuoso`, fixing blank areas during streaming
- Built-in models now returned from code instead of database, simplifying model registration
- Claude inherits full shell PATH and runs with telemetry disabled
- Frontend now served through Go backend on a fixed port, enabling direct browser access

## [0.2.1] - 2026-04-30

Initial beta release.
