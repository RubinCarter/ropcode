# Session Tree Management Design

## Goal

Add session management under both main project spaces and child workspace spaces in the left project tree.

The tree should make historical agent sessions easy to reopen without turning the sidebar into an unbounded history list. The first version shows the most recent active sessions by default and loads the full history only when the user asks for it.

## Current Context

Ropcode already models projects with child workspaces through `ProjectIndex.Workspaces`, and the frontend `ProjectList` already renders a project/workspace tree. Provider session history is currently available through provider-specific scanners:

- Claude sessions are scanned from the Claude project JSONL directory.
- Codex sessions are scanned from the Codex sessions directory.
- Gemini session listing is not implemented yet and may return an empty list in the first version.

The existing `ListProviderSessions(projectPath, provider)` RPC returns one provider at a time. The new feature needs a space-level, provider-mixed list.

## Non-Goals

- Do not implement archive management in the first version.
- Do not move, rename, or delete provider-owned history files.
- Do not load every session for every project and workspace on initial render.
- Do not change provider resume semantics.
- Do not redesign the whole project manager or rsh workflow.

## User Experience

Each main project and each child workspace can directly show its sessions:

```text
Main project
  Session A
  Session B
  ...
  More
Child workspace
  Session A
  Session B
  ...
  More
```

There is no intermediate `Sessions` group in the first version. Sessions are direct children of the space node.

### Default List

For each expanded space, show at most the 10 most recently active sessions.

Sessions from Claude, Codex, and Gemini are mixed into one list and sorted by `last_activity` descending. Each row shows:

- Provider identity, such as Claude or Codex.
- A compact title, preferably the first user message or provider-provided summary.
- Running or idle/completed state when available.
- Relative last activity time.

If a provider cannot list sessions yet, it contributes no rows.

### More

If a space has more than 10 sessions, show a `More` row after the default list.

Clicking `More` loads all sessions for that space only. It is acceptable for the resulting list to contain hundreds of rows. The expanded-all state is frontend UI state and does not need to be persisted.

### Clicking

Clicking a project or workspace node keeps the current behavior: switch into that space.

Clicking a session row opens that specific historical session in that same space. If a matching tab already exists, focus it instead of creating a duplicate when the existing tab identity is unambiguous.

## Data Model

Add a normalized session summary type for the mixed list:

```go
type SpaceSessionsResult struct {
    Sessions []ProviderSessionSummary `json:"sessions"`
    HasMore  bool                     `json:"has_more"`
}

type ProviderSessionSummary struct {
    ID            string `json:"id"`
    Provider      string `json:"provider"`
    ProjectPath   string `json:"project_path"`
    ProjectID     string `json:"project_id,omitempty"`
    CreatedAt     int64  `json:"created_at"`
    LastActivity  int64  `json:"last_activity"`
    Title         string `json:"title,omitempty"`
    FirstMessage  string `json:"first_message,omitempty"`
    IsRunning     bool   `json:"is_running"`
}
```

`LastActivity` is the primary sort key. Provider-specific timestamps should be normalized to Unix seconds. If a provider only exposes a file modification timestamp, use that as `LastActivity`.

`Title` is optional and can initially be the same as `FirstMessage`. Missing titles should fall back to a provider/session label in the UI.

## RPC Design

Add a new reflection RPC:

```go
ListSpaceSessions(projectPath string, limit int) (SpaceSessionsResult, error)
```

Rules:

- `limit > 0`: return at most that many newest sessions and set `HasMore=true` when additional sessions exist.
- `limit <= 0`: return all sessions for the space and set `HasMore=false`.
- The RPC queries supported providers, normalizes results, mixes them, sorts by `LastActivity desc`, then applies `limit`.
- Provider scan errors should be logged and treated as empty provider results unless all providers fail in a way that prevents useful output.

The frontend should use `limit=10` for default display and `limit=0` after `More`.

## Backend Behavior

The backend should reuse existing provider scanners first:

- Claude: `claude.ListProjectSessions`.
- Codex: `codex.ListProjectSessions`.
- Gemini: keep empty until a session listing implementation exists.

Running state can be joined from existing live session managers where practical. If running state is not cheaply available for a provider in the first pass, set `IsRunning=false` for that provider rather than adding expensive polling.

Sorting and limiting belong on the backend so the frontend receives a stable result shape.

For `limit > 0`, the backend can determine `HasMore` by collecting one extra row after sorting, then trimming back to `limit` before returning. This avoids a separate count query and still lets the frontend know whether to show `More`.

## Frontend Behavior

`ProjectList` should lazily load sessions per expanded space:

- When a project or workspace expands, request `ListSpaceSessions(path, 10)` if not already cached.
- Show loading state only under that space.
- Cache by space path and limit mode.
- On `More`, request `ListSpaceSessions(path, 0)` and replace that space's list.
- Invalidate or refresh the affected space when process/session events indicate new activity.

Session rows should be visually subordinate to project/workspace rows and must stay compact enough for sidebar use.

## Performance

Initial rendering must not scan all sessions for all projects. Session loading is triggered by user expansion or by an already-open space that needs display.

Loading all sessions is scoped to one space. Hundreds of rows are acceptable for this version. If this later becomes slow, virtualization can be added to the session subtree without changing the RPC contract.

## Error Handling

If session loading fails for one space, show a small inline error row under that space and keep the rest of the project tree usable.

If one provider fails but another succeeds, show successful provider sessions and log the failed provider. The UI does not need a provider-specific error row in the first version.

## Testing

Backend tests should cover:

- Mixed provider session sorting by `LastActivity`.
- `limit=10` behavior.
- `limit=0` returns all sessions.
- Provider failures do not discard other provider results.

Frontend tests should cover:

- Project/workspace session rows render under the correct tree node.
- `More` only expands the selected space.
- Clicking a session row opens or focuses the corresponding session tab.

Manual verification should cover:

- Main project sessions and child workspace sessions are separated by `projectPath`.
- Claude and Codex sessions are mixed by activity time.
- A space with more than 10 sessions shows `More` and then displays all after click.

## Deferred Work

Soft archive can be added later by storing hidden session keys in Ropcode-owned state:

```text
provider + projectPath + sessionId -> archivedAt
```

That future archive feature should filter rows from `ListSpaceSessions` by default and expose a separate archived view. It should still avoid modifying provider-owned history files.
