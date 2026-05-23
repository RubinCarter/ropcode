# Session Stream Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy mixed provider output message path with a single frontend-facing `SessionFrame` protocol over split WebSocket channels.

**Architecture:** `origin/v0.3.0` already has a unified provider runtime that emits `provider.OutputEvent` from `internal/provider/{claude,codex,deepseek}/output_parser.go`. This refactor starts after that boundary: `provider.OutputEvent` is adapted into `internal/stream.SessionFrame`, routed through per-stream queues, sent over dedicated WebSocket channels, then consumed by frontend clients/stores/hooks. Old event compatibility is intentionally removed in one breaking cut.

**Tech Stack:** Go, gorilla/websocket, React, TypeScript, Vite, existing RPC reflection client.

---

## Merge Checkpoint: 2026-05-23

Current branch being merged: `codex/session-stream-frontend-20260523`.

Merge target: local `main` at `3ccda21a5c4e431ecdc9940d44c5c6dc702f4b79` (`refactor(provider): switch app/bindings to unified providerManager, remove old managers`). Local `main` intentionally differs from `origin/main`, which still points at the older `v0.2.4` release line.

Completed for merge:

- Backend split stream stack is implemented:
  - `/ws/rpc`
  - `/ws/sync`
  - `/ws/stream/session/{streamId}`
  - `/ws/stream/bulk/{source}/{id}`
- `provider.OutputEvent` is bridged into `stream.SessionFrame` through `internal/stream`.
- Claude, Codex, and DeepSeek live/history adapters return normalized `SessionFrame` data.
- Frontend protocol mirror, WebSocket clients, stores, and hooks exist and compile.
- Frontend RPC traffic has moved to `/ws/rpc`.
- Main session rendering consumes the session stream/store path rather than the old global event path.
- PTY and agent output are routed through bulk stream state.
- Legacy high-frequency frontend/backend event names are removed from active paths:
  - `claude-output`
  - `claude-output-batch`
  - `pty-output`
  - `agent-output:`
  - `session:stream:*`
- `internal/eventhub/coalescer.go` has been removed.
- `ToolWidgets.tsx` is now a one-line barrel and widgets live under `frontend/src/components/tool-widgets/`.
- `StreamMessage.tsx` has been reduced from 1162 to 865 lines by extracting rendering helpers and common cards.
- `AiCodeSession.tsx` has been reduced from 1907 to 1852 lines by extracting message pane rendering.
- Electron CLI installer path handling was fixed so platform-specific tests pass on Windows while simulating Unix targets.

Verification before merge:

```powershell
go test ./...
cd frontend && npm run build:typecheck
cd electron && npm test
npm --prefix ui-automation run test
```

All four commands passed on 2026-05-23.

Known follow-up debt after merge:

- `AiCodeSession.tsx` is still not the intended roughly 500-line shell. The remaining high-coupling work is session restore, recovery, send, cancel, and runtime side effects.
- `StreamMessage.tsx` is still larger than the ideal final shape.
- `TodoReadWidget.tsx` is still 619 lines, slightly above the target.
- `ToolWidgets.new.tsx` still exists as a compatibility barrel; active imports use `ToolWidgets.tsx` or `tool-widgets/`.

These are structural cleanup items, not current merge blockers after the successful verification above.

---

## Implementation Checkpoint: 2026-05-23

Current branch: `codex/session-stream-continue-20260523`.

Completed in code:

- Backend `internal/stream` protocol and hubs exist:
  - `frame.go`, `content.go`, `usage.go`, `ids.go`, `diagnostics.go`
  - `hub.go`, `queue.go`, `bulk.go`, `sync.go`
  - provider adapters for Claude, Codex, and DeepSeek
- Frontend protocol mirror exists:
  - `frontend/src/lib/session-frame/types.ts`
  - `frontend/src/lib/session-frame/normalize.ts`
  - `frontend/src/lib/session-frame/ids.ts`
  - `frontend/src/lib/session-frame/content.ts`
  - `frontend/src/lib/session-frame/meta.ts`
- Unified provider runtime now emits `provider-output` instead of `claude-output` from `internal/provider/session.go`.
- `provider.OutputEvent` now carries stream routing identity: `project_path`, `cwd`, and `provider_session_id`.
- `app.go` has `sessionStreamHub`, `syncHub`, and `bulkHub` plus a `providerStreamEmitter` that routes unified provider output into `stream.ProviderBridge`.
- History now has frame-returning APIs alongside legacy APIs:
  - `internal/stream/history.go`
  - `internal/claude.LoadSessionHistoryFrames`
  - `internal/codex.LoadSessionHistoryFrames`
  - `internal/deepseek.LoadSessionHistoryFrames`
  - `internal/session.HistoryManager.LoadSessionHistoryFrames`
  - `App.LoadProviderSessionHistoryFrames`
- Split WebSocket backend endpoints exist and reuse the current auth behavior:
  - `/ws/rpc`
  - `/ws/sync`
  - `/ws/stream/session/{streamId}`
  - `/ws/stream/bulk/{source}/{id}`
- The legacy Claude manager still uses the old coalesced `claude-output` path. Do not delete that path until the frontend has moved to the new stream clients.

Completed verification:

```powershell
go test . ./internal/provider ./internal/stream
go test . ./internal/stream ./internal/claude ./internal/codex ./internal/deepseek ./internal/session ./internal/websocket
cd frontend && npm run build:typecheck
```

Important gaps still open:

- Frontend RPC still uses the legacy `/ws` endpoint through `frontend/src/lib/ws-rpc-client.ts`; it has not moved to `/ws/rpc`.
- Frontend session rendering still consumes legacy `rpc-events`, window dispatch, `useSessionEvents`, and `useMessages`.
- Frontend history rendering still calls legacy Claude-shaped history APIs; it has not switched to `LoadProviderSessionHistoryFrames`.
- New `/ws/sync`, `/ws/stream/session/{streamId}`, and `/ws/stream/bulk/{source}/{id}` endpoints exist on the backend, but no frontend clients/stores/hooks consume them yet.
- PTY, agent output, and log viewers still use legacy event/fetch paths; bulk output migration is not wired.
- Legacy `/ws` and `claude-output` / `claude-output-batch` compatibility paths still exist and must remain until Tasks 9-13 are working.
- Gemini is still out of scope for `SessionFrame` history/live migration.
- Full final verification is not done: `go test ./...`, `cd electron && npm test`, and `npm --prefix ui-automation run test` have not been run for the complete cut.

Next task to execute: **Task 9: Frontend WS Clients And Stores**. After Task 9, continue with Tasks 10-13 before deleting legacy event paths in Task 14.

---

## Hard Boundaries

This plan owns:

- `internal/stream/`: final `SessionFrame` protocol, stream hub, per-stream queues, provider output adapters.
- `internal/websocket/`: split WS endpoints and stream/bulk/sync delivery.
- `frontend/`: WS clients, stores, hooks, session UI/message flow, tool widget split.

This plan does not own:

- `internal/provider/` runtime architecture.
- CLI process startup/termination.
- binary discovery.
- env/path construction.
- provider manager/session unification.
- Gemini migration.

Allowed provider-package changes:

- `internal/provider/types.go`: only if `provider.OutputEvent` needs small identity fields for stream routing.
- `internal/provider/session.go`: only to rename/route the emitted provider output event away from the legacy `claude-output` name, without changing process lifecycle.
- `internal/provider/{claude,codex,deepseek}/output_parser.go`: only if parser facts are missing from `provider.OutputEvent`.
- Legacy `internal/claude`, `internal/codex`, and `internal/deepseek` packages are not the live provider runtime on `origin/v0.3.0`; touch them only for history compatibility or tests that still depend on them.

Not allowed:

- Exposing provider raw structures directly to UI.
- Keeping `claude-output` / `claude-output-batch` compatibility.
- Adding complex QoS/resync/since protocols.
- Putting agent output, PTY, or logs into the main session stream.

---

## Target Data Flow

```text
provider raw output
  -> provider.OutputEvent
  -> stream adapter
  -> stream.SessionFrame
  -> stream hub per-stream queue
  -> websocket channel
  -> frontend ws client
  -> frontend store
  -> hook
  -> UI
```

Channels:

```text
/ws/rpc
/ws/sync
/ws/stream/session/{streamId}
/ws/stream/bulk/{source}/{id}
```

Channel roles:

- `/ws/rpc`: low-frequency RPC request/response only.
- `/ws/sync`: low-frequency UI invalidation and small summaries.
- `/ws/stream/session/{streamId}`: high-frequency main AI session stream only.
- `/ws/stream/bulk/{source}/{id}`: PTY, agent output, and actively opened logs.

Connection failure behavior:

- No incremental resync.
- No reconnect replay.
- Frontend shows disconnected state.
- On connection problem, use app reload with circuit breaker.

---

## File Map

### Backend New Files

```text
internal/stream/
├─ frame.go
├─ content.go
├─ usage.go
├─ ids.go
├─ hub.go
├─ queue.go
├─ adapter.go
├─ adapter_registry.go
├─ adapter_provider.go
├─ adapter_claude_event.go
├─ adapter_codex_event.go
├─ adapter_deepseek_event.go
├─ bulk.go
├─ sync.go
├─ diagnostics.go
└─ *_test.go

internal/websocket/
├─ connection.go
├─ auth.go
├─ rpc_server.go
├─ sync_server.go
├─ session_stream_server.go
├─ bulk_stream_server.go
├─ stream_registry.go
└─ *_test.go
```

### Backend Modified Files

```text
internal/websocket/server.go
internal/websocket/client.go
internal/websocket/types.go
internal/eventhub/hub.go
internal/eventhub/coalescer.go
internal/provider/session.go
internal/provider/types.go
internal/provider/events.go
internal/provider/claude/output_parser.go
internal/provider/codex/output_parser.go
internal/provider/deepseek/output_parser.go
internal/claude/history.go
internal/codex/history.go
internal/deepseek/history.go
internal/pty/manager.go
internal/session/history.go
app.go
bindings.go
```

### Backend Deleted Or Retired Paths

```text
internal/eventhub/coalescer.go
legacy claude-output emit path
legacy claude-output-batch emit path
StreamSessionOutput RPC push path
```

### Frontend New Files

```text
frontend/src/lib/session-frame/
├─ types.ts
├─ normalize.ts
├─ ids.ts
├─ content.ts
└─ meta.ts

frontend/src/lib/ws/
├─ rpcClient.ts
├─ syncClient.ts
├─ sessionStreamClient.ts
├─ bulkStreamClient.ts
└─ reloadCircuitBreaker.ts

frontend/src/stores/
├─ sessionFrameStore.ts
├─ sessionRuntimeStore.ts
├─ syncStore.ts
└─ bulkStore.ts

frontend/src/hooks/
├─ useSessionStream.ts
├─ useSessionMessages.ts
├─ useSessionRuntime.ts
├─ useSyncEvents.ts
└─ useBulkStream.ts

frontend/src/components/ai-code-session/
├─ transport/
│  ├─ SessionStreamProvider.tsx
│  └─ SessionStreamBoundary.tsx
├─ runtime/
│  ├─ RuntimeStatusBar.tsx
│  └─ RuntimeStatusIcon.tsx
├─ messages/
│  ├─ MessageList.tsx
│  ├─ MessageRow.tsx
│  ├─ AssistantMessage.tsx
│  ├─ UserMessage.tsx
│  ├─ SystemMessage.tsx
│  ├─ ResultMessage.tsx
│  └─ MessageContext.ts
└─ composer/
   ├─ SessionComposer.tsx
   └─ SessionActions.tsx

frontend/src/components/tool-widgets/
├─ index.ts
├─ registry.ts
├─ types.ts
├─ shared.tsx
├─ BashWidget.tsx
├─ ReadWidget.tsx
├─ WriteWidget.tsx
├─ EditWidget.tsx
├─ MultiEditWidget.tsx
├─ GrepWidget.tsx
├─ GlobWidget.tsx
├─ LSWidget.tsx
├─ TodoWidget.tsx
├─ WebWidget.tsx
├─ TaskWidget.tsx
└─ AgentOutputWidget.tsx
```

### Frontend Modified Files

```text
frontend/src/App.tsx
frontend/src/lib/ws-rpc-client.ts
frontend/src/lib/rpc-client.ts
frontend/src/lib/api.ts
frontend/src/lib/subagentProgress.ts
frontend/src/lib/subagentLog.ts
frontend/src/stores/sessionStore.ts
frontend/src/components/ai-code-session/AiCodeSession.tsx
frontend/src/components/ai-code-session/MessageStreamView.tsx
frontend/src/components/ai-code-session/types.ts
frontend/src/components/AgentExecution.tsx
frontend/src/components/AgentRunOutputViewer.tsx
frontend/src/components/SessionOutputViewer.tsx
frontend/src/components/right-sidebar/index.tsx
frontend/src/components/right-sidebar/ClaudeActivityPane.tsx
frontend/src/components/right-sidebar/TerminalPane.tsx
frontend/src/hooks/usePty.ts
frontend/src/hooks/usePtySession.ts
```

### Frontend Deleted Or Retired Paths

```text
frontend/src/components/ai-code-session/hooks/useSessionEvents.ts
frontend/src/components/ai-code-session/hooks/useMessages.ts
frontend/src/components/StreamMessage.tsx
frontend/src/components/ToolWidgets.tsx
frontend/src/components/ToolWidgets.new.tsx
frontend/src/lib/rpc-events.ts
frontend/src/lib/outputCache.tsx
legacy window claude-output routing in frontend/src/App.tsx
```

---

## Protocol Shape

`SessionFrame` is the only frontend session protocol. It should represent the application-side union of Claude/Codex/DeepSeek output after `provider.OutputEvent`.

Required top-level groups:

- identity: `streamId`, `frameId`, `provider`, `runtimeSessionId`, `providerSessionId`
- location: `cwd`, `projectPath`
- ordering: monotonic per-stream `seq`, `timestamp`
- kind: `kind`, `role`, `subtype`
- content: normalized text/thinking/tool_use/tool_result blocks
- tool/subagent: `parentToolUseId`, `taskId`, `toolUseId`, `agentId`, `sidechain`
- result/error: `success`, `error`, `isError`, `durationMs`, `result`
- usage: token and tool usage union
- runtime: processing/retry/rate-limit/tool progress snapshot
- meta: unexpected provider-specific fields

Naming rules:

- Use one frontend field name. Do not expose both snake_case and camelCase for the same concept.
- Provider raw field names from `provider.OutputEvent.Message` go into `meta.raw` only when needed.
- UI core behavior must not depend on `meta`.
- `streamId` is app-owned and route-owned. Provider session id is data, not routing.
- `SessionFrame` should be stable for live and history.

---

## Parallel Workstreams

The implementation is one breaking cut, but the work can run in parallel after Task 1.

```text
Task 1: Protocol contract and fixtures
  unlocks everything

Parallel group A: Backend stream core
  Task 2, Task 3

Parallel group B: Provider adapters
  Task 4, Task 5, Task 6, Task 7, Task 7A

Parallel group C: Frontend protocol/store
  Task 9, Task 10

Parallel group D: UI component split
  Task 11, Task 12

Join:
  Task 8 websocket integration
  Task 13 bulk migration
  Task 14 delete legacy paths
  Task 15 verification
```

---

## Tasks

### Task 1: Freeze SessionFrame Contract And Fixtures

**Files:**

- Create: `internal/stream/frame.go`
- Create: `internal/stream/content.go`
- Create: `internal/stream/usage.go`
- Create: `internal/stream/frame_test.go`
- Create: `frontend/src/lib/session-frame/types.ts`
- Create: `frontend/src/lib/session-frame/normalize.ts`
- Create: `frontend/src/lib/session-frame/normalize.test.ts`
- Use fixture: `frontend/src/lib/__fixtures__/claude-real-subagent-stream.jsonl`
- Add fixtures as needed under: `internal/stream/testdata/`

- [x] Define Go `SessionFrame` with stable frontend field names.
- [x] Define Go content block types for text, thinking, tool use, tool result, system/result/error.
- [x] Define Go usage/runtime/subagent helper structs.
- [x] Define TypeScript mirror types.
- [x] Add fixture tests for Claude subagent real stream.
- [x] Add fixture tests for Codex reasoning/tool call/tool result.
- [x] Add fixture tests for DeepSeek delta/tool/result/session metadata.
- [x] Ensure unknown provider fields land in `meta.raw`.
- [x] Ensure UI-required fields never require reading `meta`.
- [x] Run `go test ./internal/stream`.
- [x] Run `cd frontend && npm run build:typecheck`.

Expected result:

- Backend and frontend agree on the protocol.
- Live/history adapters have a target to implement.

### Task 2: Implement Stream Hub And Per-Stream Queues

**Parallel:** Can run after Task 1.

**Files:**

- Create: `internal/stream/hub.go`
- Create: `internal/stream/queue.go`
- Create: `internal/stream/ids.go`
- Create: `internal/stream/diagnostics.go`
- Create: `internal/stream/hub_test.go`

- [x] Implement stream registration by app-owned `streamId`.
- [x] Implement append/subscribe fanout for `SessionFrame`.
- [x] Use one Go channel per active stream subscriber.
- [x] Do not drop frames on normal path.
- [x] Do not log per frame.
- [x] Add diagnostics getters for queue length/subscriber count only.
- [x] Add tests for ordering.
- [x] Add tests for multiple subscribers on one stream.
- [x] Add tests for independent streams not blocking each other.
- [x] Add tests for subscriber close cleanup.
- [x] Run `go test ./internal/stream`.

Expected result:

- Hot session path is isolated per stream.
- Monitoring is pull-based, not hot-path logging.

### Task 3: Implement Bulk And Sync Stream Models

**Parallel:** Can run after Task 1.

**Files:**

- Create: `internal/stream/bulk.go`
- Create: `internal/stream/sync.go`
- Create: `internal/stream/bulk_test.go`
- Create: `internal/stream/sync_test.go`

- [x] Define `BulkFrame` for PTY, agent output, and opened logs.
- [x] Define `SyncEvent` for invalidation and small summary.
- [x] Implement bulk hub keyed by `source/id`.
- [x] Implement sync hub for low-frequency broadcast.
- [x] Keep logs on-demand/file-backed; do not make background log stream mandatory.
- [x] Run `go test ./internal/stream`.

Expected result:

- Main session stream stays clean.
- Bulk output can be opened independently.

### Task 4: Provider Output Bridge

**Parallel:** Can run after Task 1.

**Files:**

- Create: `internal/stream/adapter_provider.go`
- Create: `internal/stream/adapter_provider_test.go`
- Modify: `internal/provider/types.go`
- Modify: `internal/provider/session.go`
- Modify: `internal/provider/events.go`
- Modify: `app.go`

- [x] Accept `provider.OutputEvent` as the backend adapter input.
- [x] Preserve runtime session id from `provider.Session.ID`.
- [x] Preserve provider id from `provider.OutputEvent.Provider`.
- [x] Preserve provider session id when `provider.Session.GetProviderSessionID()` is available.
- [x] Attach app-owned `streamId` deterministically for each running session.
- [x] Emit stream frames into `internal/stream.Hub`, not legacy EventHub event names, for the unified provider runtime.
- [x] Keep provider runtime lifecycle untouched.
- [x] Add tests for bridge routing and stream id identity.
- [x] Add root-level test that `providerStreamEmitter` accepts `*provider.OutputEvent`.

Expected result:

- The new stream layer starts at the existing `provider.OutputEvent` boundary on `origin/v0.3.0`.

### Task 5: Claude OutputEvent Adapter

**Parallel:** Can run after Task 1 and Task 4 interface is known.

**Files:**

- Create: `internal/stream/adapter_claude_event.go`
- Create: `internal/stream/adapter_claude_event_test.go`
- Modify if needed: `internal/provider/claude/output_parser.go`
- Modify: `internal/claude/history.go`

- [x] Convert Claude `provider.OutputEvent` into `SessionFrame`.
- [x] Preserve text, thinking, tool_use, tool_result, system init, task lifecycle, result, error.
- [x] Preserve subagent fields: parent tool use, sidechain, task id, agent id, toolUseResult.
- [x] Preserve runtime state currently in `debug_meta.runtime_state`, but normalize field names.
- [x] Keep provider raw extras in `meta.raw`.
- [x] Convert Claude history through the same adapter shape. See Task 7A.
- [x] Run focused Claude event adapter tests.

Expected result:

- Claude live and history produce the same `SessionFrame` family.

### Task 6: Codex OutputEvent Adapter

**Parallel:** Can run after Task 1 and Task 4 interface is known.

**Files:**

- Create: `internal/stream/adapter_codex_event.go`
- Create: `internal/stream/adapter_codex_event_test.go`
- Modify if needed: `internal/provider/codex/output_parser.go`
- Modify: `internal/codex/history.go`

- [x] Convert `thread.started` into session init frame.
- [x] Convert `response_item.message` into user/assistant content.
- [x] Convert `response_item.reasoning` into thinking block.
- [x] Convert function/custom tool calls into tool_use blocks.
- [x] Convert function/custom tool outputs into tool_result blocks.
- [x] Convert turn/session completion into result frames.
- [x] Keep ignored Codex metadata out of UI core, but allow relevant unexpected fields in `meta.raw`.
- [x] Make live and history use the same adapter logic. See Task 7A.
- [x] Run focused Codex adapter tests.

Expected result:

- Codex reasoning mismatch between live/history is fixed.

### Task 7: DeepSeek OutputEvent Adapter

**Parallel:** Can run after Task 1 and Task 4 interface is known.

**Files:**

- Create: `internal/stream/adapter_deepseek_event.go`
- Create: `internal/stream/adapter_deepseek_event_test.go`
- Modify if needed: `internal/provider/deepseek/output_parser.go`
- Modify: `internal/deepseek/history.go`

- [x] Convert `content` delta into appendable text frame.
- [x] Convert `tool_use` into normalized tool_use block.
- [x] Convert `tool_result` into normalized tool_result block.
- [x] Convert `session_capture` and `metadata` into init/metadata frames.
- [x] Convert `done` into result frame.
- [x] Preserve runtime/provider session id distinction.
- [x] Improve history adapter to recover tools/results when present in raw session data. See Task 7A.
- [x] If raw history lacks tool structure, preserve text and put raw source into `meta.raw`. See Task 7A.
- [x] Run focused DeepSeek adapter tests.

Expected result:

- DeepSeek live and history no longer have avoidable shape drift.

### Task 7A: History SessionFrame Adapters

**Join Point:** Must run before frontend store/UI migration depends on history frames. Can run before or in parallel with Task 8 because it does not depend on WebSocket endpoints.

**Files:**

- Create: `internal/stream/history.go`
- Create: `internal/stream/history_test.go`
- Modify: `internal/claude/history.go`
- Modify: `internal/codex/history.go`
- Modify: `internal/deepseek/history.go`
- Modify if needed: `internal/session/history.go`
- Modify if needed: `bindings.go`

- [x] Write failing tests that convert Claude history entries into `SessionFrame` using `AdaptClaudeOutput`.
- [x] Write failing tests that convert Codex JSONL history entries into `SessionFrame` using `AdaptCodexOutput`.
- [x] Write failing tests that convert DeepSeek JSON history entries into `SessionFrame` using `AdaptDeepSeekOutput`.
- [x] Preserve existing legacy history APIs until frontend callers are migrated.
- [x] Add new frame-returning history APIs rather than changing JSON shape under existing callers in one step.
- [x] Use provider session id as data only; do not use it as stream routing key.
- [x] Preserve raw provider history fragments in `meta.raw` when the source lacks enough structure.
- [x] Run `go test ./internal/stream ./internal/claude ./internal/codex ./internal/deepseek`.

Expected result:

- Live and history paths share adapter logic without forcing old frontend callers to change before Task 9-11.

### Task 8: Split WebSocket Channels

**Join Point:** Can start after Tasks 2 and 3 have enough interfaces. It can proceed before Task 7A is fully integrated, but frontend session-history rendering must not switch to `SessionFrame` until Task 7A is complete.

**Files:**

- Create if still useful during frontend integration: `internal/websocket/connection.go`
- Create: `internal/websocket/auth.go`
- Create: `internal/websocket/rpc_server.go`
- Create: `internal/websocket/sync_server.go`
- Create: `internal/websocket/session_stream_server.go`
- Create: `internal/websocket/bulk_stream_server.go`
- Create: `internal/websocket/stream_registry.go`
- Modify: `internal/websocket/server.go`
- Modify: `internal/websocket/client.go`
- Modify: `internal/websocket/types.go`
- Modify: `app.go`

- [x] Add `stream.Hub`, `stream.SyncHub`, and `stream.BulkHub` accessors on `App` or runtime composition without exposing manager internals.
- [x] Keep `/ws/rpc` request/response isolated from events.
- [x] Add `/ws/sync` subscription to sync hub.
- [x] Add `/ws/stream/session/{streamId}` subscription to session stream hub.
- [x] Add `/ws/stream/bulk/{source}/{id}` subscription to bulk hub.
- [x] Reuse current auth behavior for all WS paths.
- [ ] Remove global broadcast for session frames.
- [x] Add tests that high-frequency stream output does not block RPC response.
- [x] Add tests that independent session streams do not block each other.
- [x] Add tests for auth rejection on all WS paths.
- [x] Run `go test ./internal/websocket ./internal/stream`.

Expected result:

- Physical WS channels match the refactor boundary.
- Current status: backend channels are implemented and tested. The remaining unchecked item, removing global session broadcast, is intentionally deferred until Tasks 9-13 move frontend consumers off legacy `/ws` events.

### Task 9: Frontend WS Clients And Stores

**Parallel:** Can run after Task 1; final integration depends on Task 8. History-backed display depends on Task 7A.

**Files:**

- Create: `frontend/src/lib/ws/rpcClient.ts`
- Create: `frontend/src/lib/ws/syncClient.ts`
- Create: `frontend/src/lib/ws/sessionStreamClient.ts`
- Create: `frontend/src/lib/ws/bulkStreamClient.ts`
- Create: `frontend/src/lib/ws/reloadCircuitBreaker.ts`
- Create: `frontend/src/stores/sessionFrameStore.ts`
- Create: `frontend/src/stores/sessionRuntimeStore.ts`
- Create: `frontend/src/stores/syncStore.ts`
- Create: `frontend/src/stores/bulkStore.ts`
- Modify: `frontend/src/stores/sessionStore.ts`
- Modify: `frontend/src/lib/ws-rpc-client.ts`
- Modify: `frontend/src/lib/rpc-client.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] Move RPC traffic to `/ws/rpc`.
- [ ] Implement session stream client by `streamId`.
- [ ] Use `normalizeSessionFrame` at every session stream ingress.
- [ ] Implement sync client for invalidations.
- [ ] Implement bulk client for PTY/agent/log streams.
- [ ] Implement reload circuit breaker for connection failures.
- [ ] Implement frame/bulk/sync stores outside React render state.
- [ ] Keep existing `frontend/src/stores/sessionStore.ts` for project/session metadata or split it only if needed.
- [ ] Use subscription APIs suitable for `useSyncExternalStore`.
- [ ] Do not use window events for session messages.
- [ ] Add frontend unit tests for store append/order/delta behavior.
- [ ] Run `cd frontend && npm run build:typecheck`.

Expected result:

- Frontend transport and state no longer depend on legacy global event routing.

### Task 10: Frontend Hooks

**Parallel:** Can run after Task 9 store interfaces exist.

**Files:**

- Create: `frontend/src/hooks/useSessionStream.ts`
- Create: `frontend/src/hooks/useSessionMessages.ts`
- Create: `frontend/src/hooks/useSessionRuntime.ts`
- Create: `frontend/src/hooks/useSyncEvents.ts`
- Create: `frontend/src/hooks/useBulkStream.ts`
- Modify: `frontend/src/hooks/usePty.ts`
- Modify: `frontend/src/hooks/usePtySession.ts`
- Modify: `frontend/src/lib/subagentProgress.ts`
- Modify: `frontend/src/lib/subagentLog.ts`

- [ ] `useSessionStream` only connects/subscribes; it must not own heavy message state.
- [ ] `useSessionMessages` derives display messages from `sessionStore`.
- [ ] `useSessionRuntime` derives status from normalized runtime fields.
- [ ] `useSyncEvents` maps invalidation to data reloads.
- [ ] `useBulkStream` powers PTY/agent/log viewers.
- [ ] Migrate PTY hooks off `pty-output`.
- [ ] Update subagent progress to read normalized fields.
- [ ] Add hook/store tests for delta appending and subagent grouping.
- [ ] Run `cd frontend && npm run build:typecheck`.

Expected result:

- Hooks are thin adapters over stores and transport.

### Task 11: Session UI Split

**Parallel:** Can run after Tasks 9 and 10 stabilize.

**Files:**

- Modify: `frontend/src/components/ai-code-session/AiCodeSession.tsx`
- Modify: `frontend/src/components/ai-code-session/MessageStreamView.tsx`
- Modify: `frontend/src/components/ai-code-session/types.ts`
- Create files under:
  - `frontend/src/components/ai-code-session/transport/`
  - `frontend/src/components/ai-code-session/runtime/`
  - `frontend/src/components/ai-code-session/messages/`
  - `frontend/src/components/ai-code-session/composer/`
- Delete: `frontend/src/components/ai-code-session/hooks/useSessionEvents.ts`
- Delete: `frontend/src/components/ai-code-session/hooks/useMessages.ts`

- [ ] Turn `AiCodeSession.tsx` into a shell under roughly 500 lines.
- [ ] Move stream connection into transport components.
- [ ] Move runtime status into runtime components.
- [ ] Move message list/row/rendering into messages components.
- [ ] Move prompt/session actions into composer components where practical.
- [ ] Preserve current user workflows: open session, send prompt, stream output, stop, resume, provider switch.
- [ ] Remove legacy window listener code.
- [ ] Run frontend typecheck.

Expected result:

- Session UI no longer mixes transport, message state, rendering, runtime state, and composer logic in one file.

### Task 12: Tool Widget Split

**Parallel:** Can run after Task 1 and Task 11 message contracts are known.

**Files:**

- Create files under: `frontend/src/components/tool-widgets/`
- Modify message rendering imports.
- Delete: `frontend/src/components/ToolWidgets.tsx`
- Delete: `frontend/src/components/ToolWidgets.new.tsx`
- Modify tests:
  - `frontend/src/components/ToolWidgets.websearch.test.ts`
  - `frontend/src/components/StreamMessage.performance.test.ts`
  - `frontend/src/components/SubagentProgressPanel.state.test.ts`

- [ ] Create registry and shared widget props.
- [ ] Move Bash/Read/Write/Edit/MultiEdit/Grep/Glob/LS/Todo/Web/Task/AgentOutput into separate files.
- [ ] Keep each widget focused and under roughly 500 lines.
- [ ] Update message renderer to call registry.
- [ ] Preserve existing custom rendering behavior.
- [ ] Add/update tests for representative widgets.
- [ ] Run frontend typecheck and relevant tests.

Expected result:

- Tool UI becomes maintainable and does not keep `ToolWidgets.tsx` as a giant choke point.

### Task 13: Bulk Output Migration

**Join Point:** Depends on Tasks 3, 8, 9, and 10.

**Files:**

- Modify: `internal/pty/manager.go`
- Modify: `frontend/src/components/right-sidebar/index.tsx`
- Modify: `frontend/src/components/right-sidebar/TerminalPane.tsx`
- Modify: `frontend/src/components/AgentExecution.tsx`
- Modify: `frontend/src/components/AgentRunOutputViewer.tsx`
- Modify: `frontend/src/components/SessionOutputViewer.tsx`
- Modify: `frontend/src/components/right-sidebar/ClaudeActivityPane.tsx`

- [ ] Route PTY output through `/ws/stream/bulk/pty/{id}`.
- [ ] Route agent output through `/ws/stream/bulk/agent/{id}`.
- [ ] Keep logs file-backed and fetch/open only on demand.
- [ ] Do not mix agent output into main session stream.
- [ ] Keep main session stream limited to core conversation/lifecycle frames.
- [ ] Run focused frontend typecheck.

Expected result:

- Bulk data cannot clog the main session channel.

### Task 14: Delete Legacy Event Path

**Join Point:** Must run after all new paths work.

**Files:**

- Delete: `internal/eventhub/coalescer.go`
- Modify/Delete old references in:
  - `app.go`
  - `internal/eventhub/hub.go`
  - `internal/provider/session.go`
  - `internal/websocket/client.go`
  - `frontend/src/App.tsx`
  - `frontend/src/lib/rpc-events.ts`
  - `frontend/src/components/ai-code-session/hooks/useSessionEvents.ts`
  - provider session files

- [ ] Remove `ClaudeOutputCoalescer`.
- [ ] Remove `claude-output` and `claude-output-batch` listeners.
- [ ] Remove old cwd-based window dispatch.
- [ ] Remove `StreamSessionOutput` push path if no longer used.
- [ ] `rg "claude-output|claude-output-batch|pty-output|agent-output:"` and confirm only tests/docs or intentionally ignored legacy provider packages remain.
- [ ] Run Go and frontend typecheck.

Expected result:

- There is one session stream path, not two.

### Task 15: Final Verification

**Files:** No planned source changes unless fixing discovered failures.

- [ ] Run `go test ./...`.
- [ ] Run `cd frontend && npm run build:typecheck`.
- [ ] Run `cd electron && npm test` if websocket startup behavior changed.
- [ ] Run `npm --prefix ui-automation run test` because this affects visible frontend, RPC, and UI sync.
- [ ] Manually inspect `rg` results for removed legacy events.
- [ ] Check large-file status and confirm split goals:
  - `AiCodeSession.tsx` under roughly 500 lines or clearly shell-only.
  - No active `ToolWidgets.tsx` giant file.
  - No active `StreamMessage.tsx` giant file.
  - New files mostly under 500 lines.

Expected result:

- The app compiles, tests pass, UI automation covers Go-served frontend, and legacy message flow is gone.

---

## Risk List

- Claude subagent frames have the richest real shape. Use the existing real fixture as the primary compatibility source.
- Codex live/history reasoning currently diverges. Fixing this is mandatory.
- DeepSeek history is weaker than live. Recover tools/results where raw data allows; otherwise preserve raw in `meta.raw`.
- Removing `claude-output` breaks many current listeners at once. Do it only after the frontend stream/store path is working.
- Avoid hot-path logging. Diagnostics must be sampled/pulled.
- Do not implement incremental resync. If transport fails, disconnect/reload with circuit breaker.

---

## Suggested Commit Slices

Although implementation is one breaking cut, commits should stay reviewable:

1. `feat(stream): define session frame protocol`
2. `feat(stream): add stream and bulk hubs`
3. `feat(stream): add provider output adapters`
4. `feat(websocket): split rpc sync session and bulk channels`
5. `feat(frontend): add ws clients and stream stores`
6. `refactor(session-ui): consume session frame store`
7. `refactor(tool-widgets): split tool renderers`
8. `refactor(bulk): move pty and agent output to bulk streams`
9. `refactor(stream): remove legacy claude output events`

