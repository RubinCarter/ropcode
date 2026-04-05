# Claude Capability Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Ropcode's filesystem-based slash command and skill discovery with Claude Code–driven capability discovery that loads command summaries and skills from Claude runtime initialization, computes system/user/project layers, caches them, and feeds a unified picker UI.

**Architecture:** Add a backend Claude capability discovery service that launches Claude Code in three isolated contexts (system, user, project), captures initialize/control-response commands plus system/init skills, normalizes them into a single capability model, computes layered diffs, and caches snapshots. Replace the current frontend `SlashCommandPicker` and `SkillPicker` data sources with a unified Claude capability API while preserving the existing text insertion behavior in `FloatingPromptInput`.

**Tech Stack:** Go backend, existing Claude process/session integration, WebSocket RPC, React + TypeScript frontend, existing picker/input components, `go test`, `npm run build:go`, `cd frontend && npm run build:typecheck`

---

### Task 1: Define the new backend capability model

**Files:**
- Create: `internal/claude/capabilities.go`
- Modify: `frontend/src/lib/rpc-client.ts`
- Test: `internal/claude/capabilities_test.go`

**Step 1: Write the failing backend model test**

Create `internal/claude/capabilities_test.go` with tests that assert:
- `ClaudeCapability` can represent both `command` and `skill`
- `CapabilitySnapshot` stores `commands` and `skills`
- `CapabilityLayers` exposes `system`, `user_only`, `project_only`, `all_visible`
- unified capabilities always produce `slash_name` like `/review`

Example skeleton:

```go
func TestNormalizeCapabilityNames(t *testing.T) {
	caps := normalizeCapabilities([]CommandSummary{{Name: "review"}}, []string{"loop"}, "system")

	if len(caps) != 2 {
		t.Fatalf("expected 2 capabilities, got %d", len(caps))
	}
	if caps[0].SlashName == "" || caps[1].SlashName == "" {
		t.Fatal("expected slash names")
	}
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestNormalizeCapabilityNames
```

Expected: FAIL because `capabilities.go` and related types do not exist.

**Step 3: Write minimal implementation**

In `internal/claude/capabilities.go`, add:
- `type CapabilityKind string` with `command` and `skill`
- `type CapabilityScope string` with `system`, `user`, `project`
- `type CommandSummary struct { Name, Description, ArgumentHint string }`
- `type CapabilitySnapshot struct { Stage string; Commands []CommandSummary; Skills []string; ... }`
- `type ClaudeCapability struct { Key, Name, SlashName, Kind, Description, ArgumentHint, Scope string }`
- `type CapabilityLayers struct { System, UserOnly, ProjectOnly, AllVisible []ClaudeCapability }`
- helpers:
  - `normalizeCapabilities(...)`
  - `capabilityKey(kind, name string) string`
  - `dedupeCapabilities(...)`

Keep it data-only. No process launching yet.

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestNormalizeCapabilityNames
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capabilities.go internal/claude/capabilities_test.go frontend/src/lib/rpc-client.ts
git commit -m "feat: add claude capability model"
```

---

### Task 2: Define snapshot diffing for system/user/project layers

**Files:**
- Modify: `internal/claude/capabilities.go`
- Modify: `internal/claude/capabilities_test.go`

**Step 1: Write the failing diff test**

Add tests that build three snapshots:
- system commands: `review`, skills: `help`
- user commands: `review`, `foo`; skills: `help`, `loop`
- project commands: `review`, `foo`, `bar`; skills: `help`, `loop`, `proj`

Assert:
- `user_only` contains `/foo` and `/loop`
- `project_only` contains `/bar` and `/proj`
- `all_visible` contains all unique capabilities

Example skeleton:

```go
func TestBuildCapabilityLayers(t *testing.T) {
	layers := BuildCapabilityLayers(systemSnap, userSnap, projectSnap)
	assertHasCapability(t, layers.UserOnly, "command", "foo")
	assertHasCapability(t, layers.UserOnly, "skill", "loop")
	assertHasCapability(t, layers.ProjectOnly, "command", "bar")
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestBuildCapabilityLayers
```

Expected: FAIL because diffing is not implemented.

**Step 3: Write minimal implementation**

In `internal/claude/capabilities.go`, add:
- `BuildCapabilityLayers(system, user, project CapabilitySnapshot) CapabilityLayers`
- set-diff helpers keyed by `kind:name`
- deterministic sorting for stable UI/tests:
  - scope order: system, user, project
  - kind order: command, skill
  - then name ascending

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestBuildCapabilityLayers
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capabilities.go internal/claude/capabilities_test.go
git commit -m "feat: add claude capability layering"
```

---

### Task 3: Implement Claude Code initialize parsing in Go

**Files:**
- Create: `internal/claude/discovery_protocol.go`
- Modify: `internal/claude/capabilities_test.go`
- Reference: `claude-code-source-code/src/cli/print.ts:4453-4460`
- Reference: `claude-code-source-code/src/utils/messages/systemInit.ts:68-78`

**Step 1: Write the failing parser test**

Add tests with raw JSON lines representing:
- a control response whose `response.response.commands` contains `review`
- a system init message whose `skills` contains `loop`

Assert the parser extracts:
- command summaries from initialize/reload response
- skill names from system init

Example fixture shape:

```json
{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":""}]}}}
{"type":"system","subtype":"init","skills":["loop","brainstorm"]}
```

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestParseDiscoveryMessages
```

Expected: FAIL because parser code does not exist.

**Step 3: Write minimal implementation**

In `internal/claude/discovery_protocol.go`, add:
- lightweight structs for:
  - control response envelope
  - initialize payload response
  - system init payload
- parser helpers:
  - `ParseCommandSummariesFromLine(line []byte) ([]CommandSummary, bool, error)`
  - `ParseSkillsFromLine(line []byte) ([]string, bool, error)`
  - `CollectDiscoveryData(lines [][]byte) (commands []CommandSummary, skills []string, err error)`

Rules:
- ignore unrelated lines
- dedupe commands by name
- dedupe skills by name
- only parse the fields Claude currently exposes

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestParseDiscoveryMessages
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/discovery_protocol.go internal/claude/capabilities_test.go
git commit -m "feat: parse claude discovery protocol"
```

---

### Task 4: Build a three-stage discovery runner

**Files:**
- Create: `internal/claude/capability_discovery.go`
- Modify: `internal/claude/capabilities_test.go`
- Reference: `bindings.go:1926`, `bindings.go:3739`

**Step 1: Write the failing runner unit test**

Write tests for a runner abstraction that receives injected command output instead of launching the real binary. Assert that it can:
- run `system`, `user`, `project` stages
- build three snapshots
- return `CapabilityLayers`

Use an injected interface like:

```go
type DiscoveryTransport interface {
	Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error)
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestDiscoverCapabilityLayers
```

Expected: FAIL because discovery runner does not exist.

**Step 3: Write minimal implementation**

In `internal/claude/capability_discovery.go`, add:
- `type DiscoveryStage string` with `system`, `user`, `project`
- `type CapabilityDiscoveryService struct { ... }`
- `func NewCapabilityDiscoveryService(...) *CapabilityDiscoveryService`
- `func (s *CapabilityDiscoveryService) Discover(projectPath string) (CapabilityLayers, error)`

Important:
- keep actual process launching behind an interface
- do not mix caching yet
- use stage sequence: system -> user -> project
- compute final layers only after all three snapshots are available

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestDiscoverCapabilityLayers
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capability_discovery.go internal/claude/capabilities_test.go
git commit -m "feat: add staged claude capability discovery"
```

---

### Task 5: Implement real Claude process discovery transport

**Files:**
- Modify: `internal/claude/capability_discovery.go`
- Modify: `internal/claude/settings.go` (only if an existing Claude binary/config helper belongs there)
- Modify: `internal/claude/manager.go` (only if process helper reuse is needed)
- Test: `internal/claude/capabilities_test.go`
- Reference: `claude-code-source-code/src/cli/print.ts:4453-4460`
- Reference: `claude-code-source-code/src/utils/messages/systemInit.ts:68-78`

**Step 1: Write the failing transport integration test**

Add a test around environment shaping logic, not the real binary. Assert that:
- system stage uses isolated `HOME` and isolated `cwd`
- user stage uses real `HOME` and isolated non-project `cwd`
- project stage uses real `HOME` and project `cwd`

Test helper should inspect generated `exec.Cmd` environment and args.

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestBuildDiscoveryCommand
```

Expected: FAIL because real transport command builder does not exist.

**Step 3: Write minimal implementation**

Implement a transport that:
- locates Claude binary using existing app helpers instead of hardcoding
- launches Claude in a mode that emits initialize/control responses and system/init
- reads stdout/stderr line stream
- feeds lines into the parser from Task 3
- terminates once both command summaries and skills have been observed, or on timeout

Implementation constraints:
- do not start a full interactive user session in the UI layer
- keep a short discovery timeout
- stage-specific environment:
  - system: isolated HOME + empty temp cwd
  - user: real HOME + empty temp cwd
  - project: real HOME + project cwd
- if `skills` are missing but `commands` exist, return an explicit error so the caller knows discovery is incomplete

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestBuildDiscoveryCommand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capability_discovery.go internal/claude/capabilities_test.go internal/claude/settings.go internal/claude/manager.go
git commit -m "feat: launch claude for capability discovery"
```

---

### Task 6: Add backend cache for snapshots and layers

**Files:**
- Modify: `internal/claude/capability_discovery.go`
- Modify: `internal/claude/capabilities_test.go`

**Step 1: Write the failing cache test**

Add tests that assert:
- system snapshot is reused across repeated calls when Claude version is unchanged
- user snapshot is reused across repeated calls when user cache generation is unchanged
- project layers are reused per project path
- forced refresh bypasses cache

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestCapabilityDiscoveryCache
```

Expected: FAIL because caching is not implemented.

**Step 3: Write minimal implementation**

Add in-memory cache types:
- `systemCache`
- `userCache`
- `projectCache map[string]...`

Cache rules:
- key system by Claude version
- key user by Claude version + user cache generation
- key project by Claude version + project path + user cache generation
- stale-but-present data may be returned for read calls while refresh runs separately only if you explicitly support async refresh later; for now, keep it synchronous and deterministic

Expose:
- `Discover(projectPath string)` uses cache
- `Refresh(projectPath string)` bypasses cache and updates it

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestCapabilityDiscoveryCache
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capability_discovery.go internal/claude/capabilities_test.go
git commit -m "feat: cache claude capability snapshots"
```

---

### Task 7: Expose new RPC endpoints from the Go app

**Files:**
- Modify: `bindings.go`
- Modify: `frontend/src/lib/rpc-client.ts`
- Test: `cmd/ropcode/session_test.go` (only if RPC harness already covers this shape)

**Step 1: Write the failing RPC shape test**

Add a test or compile-time check that the app exposes new methods:
- `GetClaudeCapabilityLayers(projectPath string)`
- `RefreshClaudeCapabilityLayers(projectPath string)`

Expected JSON shape should include:
- `system`
- `user_only`
- `project_only`
- `all_visible`
- `fetched_at`

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./cmd/ropcode -run TestClaudeCapabilityLayersRPC
```

If there is no suitable existing RPC test harness, use:

```bash
go test ./... -run TestClaudeCapabilityLayersRPC
```

Expected: FAIL because methods are missing.

**Step 3: Write minimal implementation**

In `bindings.go`:
- add app-level discovery service field wiring if needed
- add:
  - `func (a *App) GetClaudeCapabilityLayers(projectPath string) (..., error)`
  - `func (a *App) RefreshClaudeCapabilityLayers(projectPath string) (..., error)`
- keep old slash/skill endpoints temporarily for migration

In `frontend/src/lib/rpc-client.ts`:
- add TS interfaces for:
  - `ClaudeCapability`
  - `ClaudeCapabilityLayers`
- add RPC functions:
  - `GetClaudeCapabilityLayers(projectPath: string)`
  - `RefreshClaudeCapabilityLayers(projectPath: string)`
- export convenience aliases in `api.ts`

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./... -run TestClaudeCapabilityLayersRPC
```

Expected: PASS.

**Step 5: Commit**

```bash
git add bindings.go frontend/src/lib/rpc-client.ts frontend/src/lib/api.ts cmd/ropcode/session_test.go
git commit -m "feat: expose claude capability layer rpc"
```

---

### Task 8: Build a unified frontend capability picker data path

**Files:**
- Create: `frontend/src/components/ClaudeCapabilityPicker.tsx`
- Modify: `frontend/src/lib/rpc-client.ts`
- Test: `frontend/src/components/SlashCommandPicker.tsx` and `frontend/src/components/SkillPicker.tsx` (read-only references for migration)

**Step 1: Write the failing component contract test or typecheck target**

Because this frontend currently has no test runner configured, use type-driven RED/GREEN:
- create the component file with imports and props referencing non-existent types/functions so `tsc` fails

Component props should include:
- `projectPath?: string`
- `initialQuery?: string`
- `onSelect(capability)`
- `onClose()`
- `anchorRef?`

**Step 2: Run typecheck to verify it fails**

Run:

```bash
cd frontend && npm run build:typecheck
```

Expected: FAIL because `ClaudeCapabilityPicker` and/or new capability types are incomplete.

**Step 3: Write minimal implementation**

Implement `ClaudeCapabilityPicker.tsx` by reusing the best pieces of the existing pickers:
- load data from `api.getClaudeCapabilityLayers(projectPath)`
- default to `all_visible`
- filter by `name`, `slash_name`, `description`
- group by scope in this order:
  - Project
  - User
  - System
- within each group, show type badge: `Command` or `Skill`
- use `slash_name` for display
- if `argumentHint` exists, display it secondarily

Do not add editing/management UI here.

**Step 4: Run typecheck to verify it passes**

Run:

```bash
cd frontend && npm run build:typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/ClaudeCapabilityPicker.tsx frontend/src/lib/rpc-client.ts
git commit -m "feat: add unified claude capability picker"
```

---

### Task 9: Replace picker usage in FloatingPromptInput

**Files:**
- Modify: `frontend/src/components/FloatingPromptInput.tsx`
- Modify: `frontend/src/components/SlashCommandPicker.tsx`
- Modify: `frontend/src/components/SkillPicker.tsx`
- Test: `frontend/package.json` build command

**Step 1: Write the failing integration change**

Update `FloatingPromptInput.tsx` imports and selection handlers to reference a unified capability type before the rest of the file is updated, so typecheck fails.

Requirements:
- `/` trigger should open the unified capability picker
- `:` trigger should no longer open a separate skill picker for Claude capability discovery
- command/skill insertion should normalize to `slash_name`

**Step 2: Run typecheck to verify it fails**

Run:

```bash
cd frontend && npm run build:typecheck
```

Expected: FAIL because handlers still expect `SlashCommand` / `Skill`.

**Step 3: Write minimal implementation**

In `FloatingPromptInput.tsx`:
- replace `SlashCommandPicker` and `SkillPicker` with `ClaudeCapabilityPicker` for Claude provider paths
- keep non-Claude provider behavior unchanged unless clearly obsolete
- add one `handleClaudeCapabilitySelect(capability)` that inserts:
  - `capability.slash_name`
  - trailing space
- remove dependence on `full_command` and `full_name` for Claude capability insertion

Migration constraint:
- do not break existing file picker behavior
- do not change send semantics; still insert text and let provider execute it

**Step 4: Run typecheck to verify it passes**

Run:

```bash
cd frontend && npm run build:typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/FloatingPromptInput.tsx frontend/src/components/ClaudeCapabilityPicker.tsx frontend/src/components/SlashCommandPicker.tsx frontend/src/components/SkillPicker.tsx
git commit -m "feat: wire unified claude capability picker"
```

---

### Task 10: Stop using filesystem-driven slash command picker data

**Files:**
- Modify: `frontend/src/components/SlashCommandPicker.tsx`
- Modify: `frontend/src/components/SkillPicker.tsx`
- Modify: `internal/claude/commands.go`
- Modify: `bindings.go`
- Reference: `frontend/src/components/SlashCommandsManager.tsx`

**Step 1: Write the failing backend/frontend cleanup test**

Add or update tests to assert the picker path no longer relies on:
- `ListSlashCommands` for Claude discovery UI
- `SkillsList` for Claude discovery UI

If no direct test exists, make the cleanup incremental and use `go test` + `frontend build:typecheck` as the verification gate.

**Step 2: Run verification before code cleanup**

Run:

```bash
go test ./internal/claude
npx --yes tsc -p frontend/tsconfig.json --noEmit
```

Expected: baseline passes before cleanup.

**Step 3: Write minimal implementation**

Cleanup rules:
- keep slash command management/editor code only if it still serves a separate user-facing editing feature
- remove picker-path dependencies on `ListSlashCommands` and `SkillsList`
- if `internal/claude/commands.go` is now only used by management UI, leave it in place; if not, delete unused code in later refactor task

Do not over-delete in this task. Focus on removing discovery-path dependencies only.

**Step 4: Run verification after cleanup**

Run:

```bash
go test ./internal/claude
cd frontend && npm run build:typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/commands.go bindings.go frontend/src/components/SlashCommandPicker.tsx frontend/src/components/SkillPicker.tsx frontend/src/components/FloatingPromptInput.tsx
git commit -m "refactor: stop using filesystem discovery for claude picker"
```

---

### Task 11: Add refresh support and cache invalidation hooks

**Files:**
- Modify: `bindings.go`
- Modify: `frontend/src/components/ClaudeCapabilityPicker.tsx`
- Modify: `internal/claude/capability_discovery.go`

**Step 1: Write the failing refresh test**

Add tests that assert:
- calling refresh bypasses caches
- refreshed user/project layers replace stale cache content

Frontend side:
- picker should expose a retry/refresh path when initial load fails

**Step 2: Run test to verify it fails**

Run:

```bash
go test ./internal/claude -run TestRefreshCapabilityLayers
```

Expected: FAIL because refresh path is incomplete.

**Step 3: Write minimal implementation**

Implement:
- backend `RefreshClaudeCapabilityLayers(projectPath)` bypassing cache
- frontend retry button in `ClaudeCapabilityPicker`
- optional background refresh on mount if cached data is marked stale later; skip if no stale state is implemented yet

**Step 4: Run test to verify it passes**

Run:

```bash
go test ./internal/claude -run TestRefreshCapabilityLayers
cd frontend && npm run build:typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add internal/claude/capability_discovery.go bindings.go frontend/src/components/ClaudeCapabilityPicker.tsx
git commit -m "feat: add claude capability refresh"
```

---

### Task 12: Verify the full implementation before declaring completion

**Files:**
- Modify: `docs/plans/2026-04-01-claude-capability-discovery.md` (check off progress notes only if you want; not required)

**Step 1: Run focused backend tests**

Run:

```bash
go test ./internal/claude
```

Expected: PASS.

**Step 2: Run broader Go tests that touch RPC/session integration**

Run:

```bash
go test ./...
```

Expected: PASS, or capture exact failing package if there is unrelated pre-existing breakage.

**Step 3: Run frontend typecheck/build**

Run:

```bash
cd frontend && npm run build:typecheck
```

Expected: PASS.

**Step 4: Run root build**

Run:

```bash
npm run build:go
```

Expected: PASS.

**Step 5: Manual verification checklist**

Verify in the app:
- Claude picker shows `/review`
- Claude picker shows `/loop` when available in skills
- project-only capabilities appear only for the current project
- selecting a capability inserts `/name ` into the prompt
- refresh updates the picker after plugin/skill changes
- no filesystem-only Claude picker behavior remains

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: unify claude capability discovery"
```

---

## Notes for the implementing engineer

- Treat `commands[]` and `skills[]` as separate upstream discovery channels. Do not assume one subsumes the other.
- Do not reconstruct command source by scanning `.claude/commands`, `.claude/skills`, or plugin folders for picker data.
- Use Claude Code's emitted capability summaries as the only source of truth for picker discovery.
- Keep command insertion behavior simple: insert `slash_name` plus trailing space. Do not execute capabilities directly in the picker.
- Preserve YAGNI: this plan does **not** require a full capability manager UI or persistent database storage.
- Preserve DRY: the unified picker should replace duplicated filtering/grouping logic now split across `SlashCommandPicker.tsx` and `SkillPicker.tsx`.

## Test strategy summary

Backend:
- parser unit tests
- layering/diff tests
- cache tests
- environment builder tests

Frontend:
- use `npm run build:typecheck` as the enforced verification gate for this change set
- manual smoke-check for picker behavior in the running app

## Relevant existing code to inspect while implementing

- `claude-code-source-code/src/cli/print.ts:4453-4460`
- `claude-code-source-code/src/cli/print.ts:3113-3120`
- `claude-code-source-code/src/utils/messages/systemInit.ts:68-78`
- `internal/claude/commands.go`
- `bindings.go:2119-2120`
- `bindings.go:4487`
- `frontend/src/components/SlashCommandPicker.tsx`
- `frontend/src/components/SkillPicker.tsx`
- `frontend/src/components/FloatingPromptInput.tsx:1271-1341`
- `frontend/src/lib/rpc-client.ts:77,194,1060,1256`
