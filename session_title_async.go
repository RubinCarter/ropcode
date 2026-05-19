// session_title_async.go
//
// Async wrappers around the synchronous Generate* methods.
//
// Title/branch generation can take up to 60s when it spawns the Claude CLI.
// Calling those RPCs from the WebSocket request loop pinned a request slot for
// that whole time, which competed with high-frequency event traffic on the
// shared Send channel. The async versions return a request_id immediately and
// emit a result event when the underlying work finishes, so the front-end can
// show a "generating..." state without holding an RPC open.
//
// Event payloads:
//
//	"session-title:generated":
//	  { request_id, kind: "first-prompt" | "session", title, error,
//	    provider?, session_id?, project_id? }
//
//	"branch-name:generated":
//	  { request_id, project_path, branch, error }
package main

import (
	"strings"

	"github.com/google/uuid"
)

// generateRequestID creates a unique correlation token used by async title /
// branch RPCs to pair their request with the eventual result event.
func generateRequestID() string {
	return uuid.New().String()
}

// emitTitleResult pushes a generation result through the event hub so the
// front-end can match it with the originating request_id. Safe to call when
// the event hub is not initialised yet (events are simply dropped).
func (a *App) emitTitleResult(payload map[string]interface{}) {
	if a == nil || a.eventHub == nil {
		return
	}
	a.eventHub.Emit("session-title:generated", payload)
}

func (a *App) emitBranchResult(payload map[string]interface{}) {
	if a == nil || a.eventHub == nil {
		return
	}
	a.eventHub.Emit("branch-name:generated", payload)
}

// GenerateSessionTitleAsync schedules title generation for a brand new session
// and returns a request_id. The result is delivered via the
// "session-title:generated" event with kind="first-prompt".
func (a *App) GenerateSessionTitleAsync(prompt string) (string, error) {
	requestID := generateRequestID()
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		// Empty prompts will never produce a useful title — emit immediately.
		go a.emitTitleResult(map[string]interface{}{
			"request_id": requestID,
			"kind":       "first-prompt",
			"title":      "",
			"error":      "",
		})
		return requestID, nil
	}

	go func() {
		title, err := a.GenerateSessionTitle(prompt)
		payload := map[string]interface{}{
			"request_id": requestID,
			"kind":       "first-prompt",
			"title":      title,
			"error":      "",
		}
		if err != nil {
			payload["error"] = err.Error()
		}
		a.emitTitleResult(payload)
	}()

	return requestID, nil
}

// GenerateSessionTitleForSessionAsync regenerates the title of an existing
// session in the background. Result is delivered via "session-title:generated"
// with kind="session" and the originating provider/session/project IDs so the
// caller can match it.
func (a *App) GenerateSessionTitleForSessionAsync(provider, sessionID, projectID string) (string, error) {
	requestID := generateRequestID()
	provider = strings.TrimSpace(provider)
	sessionID = strings.TrimSpace(sessionID)
	projectID = strings.TrimSpace(projectID)

	go func() {
		title, err := a.GenerateSessionTitleForSession(provider, sessionID, projectID)
		payload := map[string]interface{}{
			"request_id": requestID,
			"kind":       "session",
			"provider":   provider,
			"session_id": sessionID,
			"project_id": projectID,
			"title":      title,
			"error":      "",
		}
		if err != nil {
			payload["error"] = err.Error()
		}
		a.emitTitleResult(payload)
	}()

	return requestID, nil
}

// GenerateBranchNameAsync runs branch-name generation in the background. The
// result is delivered via the "branch-name:generated" event so the UI can show
// a generating state without holding an RPC open for 60s.
func (a *App) GenerateBranchNameAsync(projectPath string) (string, error) {
	requestID := generateRequestID()
	projectPath = strings.TrimSpace(projectPath)

	go func() {
		branch, err := a.GenerateBranchName(projectPath)
		payload := map[string]interface{}{
			"request_id":   requestID,
			"project_path": projectPath,
			"branch":       branch,
			"error":        "",
		}
		if err != nil {
			payload["error"] = err.Error()
		}
		a.emitBranchResult(payload)
	}()

	return requestID, nil
}
