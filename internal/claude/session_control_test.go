package claude

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBuildClaudeArgsUsesPrintModeForInteractiveStreamJSON(t *testing.T) {
	args := buildClaudeArgs(SessionConfig{
		InteractiveMode: true,
		Model:           "sonnet",
	})

	if !argBefore(args, "--print", "--input-format") {
		t.Fatalf("expected --print before --input-format in %#v", args)
	}
	if !argValue(args, "--input-format", "stream-json") {
		t.Fatalf("expected --input-format stream-json in %#v", args)
	}
	if !argValue(args, "--output-format", "stream-json") {
		t.Fatalf("expected --output-format stream-json in %#v", args)
	}
	if !containsArg(args, "--dangerously-skip-permissions") {
		t.Fatalf("expected permissions bypass arg in %#v", args)
	}
}

func TestBuildClaudeArgsResumesInteractiveConversationInPrintMode(t *testing.T) {
	args := buildClaudeArgs(SessionConfig{
		InteractiveMode:       true,
		ResumeClaudeSessionID: "claude-session-123",
	})

	if !argBefore(args, "--print", "--resume") {
		t.Fatalf("expected --print before --resume in %#v", args)
	}
	if !argValue(args, "--resume", "claude-session-123") {
		t.Fatalf("expected --resume claude-session-123 in %#v", args)
	}
}

func TestHandleControlResponseOnlyInitializesForInitRequest(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.initDone = make(chan struct{})
	observer := &recordingActivityObserver{}
	session.activityObserver = observer

	handled := session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": "ropcode-stop-1",
	})

	if !handled {
		t.Fatal("expected control response to be handled")
	}
	if session.initialized {
		t.Fatal("non-init control response must not initialize the session")
	}
	if observer.controlResponses != 1 {
		t.Fatalf("expected observer to receive response, got %d", observer.controlResponses)
	}
}

func TestHandleControlResponseInitializesForInitRequest(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.initDone = make(chan struct{})

	handled := session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": "init_1",
	})

	if !handled {
		t.Fatal("expected init control response to be handled")
	}
	if !session.initialized {
		t.Fatal("init control response should initialize the session")
	}
	select {
	case <-session.initDone:
	default:
		t.Fatal("initDone was not closed")
	}
}

func TestHandleControlResponseInitializesForBlankInitialResponse(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.initDone = make(chan struct{})

	handled := session.handleControlResponse(map[string]interface{}{
		"type": "control_response",
	})

	if !handled {
		t.Fatal("expected blank initial control response to be handled")
	}
	if !session.initialized {
		t.Fatal("blank initial control response should initialize the session")
	}
	select {
	case <-session.initDone:
	default:
		t.Fatal("initDone was not closed")
	}
}

func TestHandleControlResponseDoesNotReinitializeBlankResponse(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.initialized = true
	session.initDone = make(chan struct{})
	observer := &recordingActivityObserver{}
	session.activityObserver = observer

	handled := session.handleControlResponse(map[string]interface{}{
		"type": "control_response",
	})

	if !handled {
		t.Fatal("expected blank follow-up control response to be handled")
	}
	select {
	case <-session.initDone:
		t.Fatal("blank follow-up response must not close initDone again")
	default:
	}
	if observer.controlResponses != 1 {
		t.Fatalf("expected observer to receive follow-up response, got %d", observer.controlResponses)
	}
}

type recordingActivityObserver struct {
	events           int
	completed        int
	controlResponses int
}

func (o *recordingActivityObserver) ObserveClaudeEvent(sessionID string, event map[string]interface{}) {
	o.events++
}

func (o *recordingActivityObserver) CompleteSession(sessionID string) {
	o.completed++
}

func (o *recordingActivityObserver) HandleControlResponse(sessionID string, response map[string]interface{}) {
	o.controlResponses++
}

// stdinSpy is an io.WriteCloser that records every JSONL line written so tests
// can inspect the control_request envelopes the session sent to Claude CLI.
type stdinSpy struct {
	mu     sync.Mutex
	buffer bytes.Buffer
	closed bool
}

func newStdinSpy() *stdinSpy { return &stdinSpy{} }

func (w *stdinSpy) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return 0, io.ErrClosedPipe
	}
	return w.buffer.Write(p)
}

func (w *stdinSpy) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
	return nil
}

// lines returns all JSON lines that have been written so far.
func (w *stdinSpy) lines() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	raw := w.buffer.String()
	if raw == "" {
		return nil
	}
	out := strings.Split(strings.TrimRight(raw, "\n"), "\n")
	return out
}

// waitForLines blocks until at least n lines are written or the timeout fires.
func (w *stdinSpy) waitForLines(t *testing.T, n int, timeout time.Duration) []string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		lines := w.lines()
		if len(lines) >= n {
			return lines
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected %d stdin lines within %s, got %d: %v", n, timeout, len(lines), lines)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// newReadyInteractiveSession builds an interactive session that is already
// past initialization and wired to a stdinSpy, suitable for testing
// control_request flows without spawning a real Claude CLI process.
func newReadyInteractiveSession() (*Session, *stdinSpy) {
	session := NewSession(SessionConfig{InteractiveMode: true, Model: "sonnet"})
	session.interactive = true
	session.initialized = true
	session.initDone = make(chan struct{})
	close(session.initDone)
	session.initDoneClosed = true
	session.Status = "running"
	spy := newStdinSpy()
	session.stdin = spy
	return session, spy
}

func decodeStdinLine(t *testing.T, line string) map[string]interface{} {
	t.Helper()
	var msg map[string]interface{}
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		t.Fatalf("expected stdin line to be JSON: %q (err=%v)", line, err)
	}
	return msg
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

func argValue(args []string, key, want string) bool {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == key && args[i+1] == want {
			return true
		}
	}
	return false
}

func argBefore(args []string, before, after string) bool {
	beforeIndex := -1
	afterIndex := -1
	for i, arg := range args {
		if arg == before && beforeIndex == -1 {
			beforeIndex = i
		}
		if arg == after && afterIndex == -1 {
			afterIndex = i
		}
	}
	return beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex
}

func TestSetModelSendsControlRequestAndUpdatesConfig(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.SetModel("opus[1m]")
	}()

	lines := spy.waitForLines(t, 1, time.Second)
	envelope := decodeStdinLine(t, lines[0])

	if envelope["type"] != "control_request" {
		t.Fatalf("expected control_request envelope, got %#v", envelope)
	}
	requestID, _ := envelope["request_id"].(string)
	if !strings.HasPrefix(requestID, "ropcode-set-model-") {
		t.Fatalf("expected ropcode-set-model-* request id, got %q", requestID)
	}
	request, _ := envelope["request"].(map[string]interface{})
	if request["subtype"] != "set_model" {
		t.Fatalf("expected subtype=set_model, got %#v", request)
	}
	if request["model"] != "opus[1m]" {
		t.Fatalf("expected model=opus[1m], got %#v", request)
	}

	session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": requestID,
		"response": map[string]interface{}{
			"subtype":    "success",
			"request_id": requestID,
		},
	})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SetModel returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SetModel did not return after success response")
	}

	session.mu.RLock()
	got := session.Config.Model
	session.mu.RUnlock()
	if got != "opus[1m]" {
		t.Fatalf("expected Config.Model=opus[1m] after SetModel, got %q", got)
	}
}

func TestSetModelDefaultOmitsModelField(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.SetModel("default")
	}()

	lines := spy.waitForLines(t, 1, time.Second)
	envelope := decodeStdinLine(t, lines[0])
	request, _ := envelope["request"].(map[string]interface{})
	if _, present := request["model"]; present {
		t.Fatalf("expected default model to omit model field, got %#v", request)
	}

	requestID, _ := envelope["request_id"].(string)
	session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": requestID,
		"response":   map[string]interface{}{"subtype": "success", "request_id": requestID},
	})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SetModel(default) returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SetModel(default) did not return")
	}
}

func TestSetModelPropagatesErrorResponse(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.SetModel("not-a-real-model")
	}()

	lines := spy.waitForLines(t, 1, time.Second)
	envelope := decodeStdinLine(t, lines[0])
	requestID, _ := envelope["request_id"].(string)

	session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": requestID,
		"response": map[string]interface{}{
			"subtype":    "error",
			"request_id": requestID,
			"error":      "unknown model",
		},
	})

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "unknown model") {
			t.Fatalf("expected error response to surface, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SetModel did not return after error response")
	}

	session.mu.RLock()
	got := session.Config.Model
	session.mu.RUnlock()
	if got != "sonnet" {
		t.Fatalf("expected Config.Model unchanged after error, got %q", got)
	}
}

func TestSetPermissionModeRejectsInvalidMode(t *testing.T) {
	session, _ := newReadyInteractiveSession()

	if err := session.SetPermissionMode("yolo"); err == nil {
		t.Fatal("expected invalid mode to return error")
	}
}

func TestSetPermissionModeSendsValidEnvelope(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.SetPermissionMode("plan")
	}()

	lines := spy.waitForLines(t, 1, time.Second)
	envelope := decodeStdinLine(t, lines[0])
	if envelope["type"] != "control_request" {
		t.Fatalf("expected control_request, got %#v", envelope)
	}
	request, _ := envelope["request"].(map[string]interface{})
	if request["subtype"] != "set_permission_mode" {
		t.Fatalf("expected subtype=set_permission_mode, got %#v", request)
	}
	if request["mode"] != "plan" {
		t.Fatalf("expected mode=plan, got %#v", request)
	}

	requestID, _ := envelope["request_id"].(string)
	session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": requestID,
		"response":   map[string]interface{}{"subtype": "success", "request_id": requestID},
	})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SetPermissionMode returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SetPermissionMode did not return")
	}
}

func TestInterruptSendsEnvelopeAndCompletesOnSuccess(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.Interrupt()
	}()

	lines := spy.waitForLines(t, 1, time.Second)
	envelope := decodeStdinLine(t, lines[0])
	request, _ := envelope["request"].(map[string]interface{})
	if request["subtype"] != "interrupt" {
		t.Fatalf("expected subtype=interrupt, got %#v", request)
	}

	requestID, _ := envelope["request_id"].(string)
	session.handleControlResponse(map[string]interface{}{
		"type":       "control_response",
		"request_id": requestID,
		"response":   map[string]interface{}{"subtype": "success", "request_id": requestID},
	})

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Interrupt returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Interrupt did not return")
	}
}

func TestControlRequestRejectsBeforeInitialization(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.Status = "running"
	session.stdin = newStdinSpy()

	if err := session.SetModel("sonnet"); err == nil || !strings.Contains(err.Error(), "not yet initialized") {
		t.Fatalf("expected uninitialized error, got %v", err)
	}
}

func TestControlRequestRejectsBatchMode(t *testing.T) {
	session := NewSession(SessionConfig{})
	session.Status = "running"

	if err := session.Interrupt(); err == nil || !strings.Contains(err.Error(), "interactive mode") {
		t.Fatalf("expected interactive-mode error, got %v", err)
	}
}

func TestPendingControlRequestsCleanedUpOnSessionDone(t *testing.T) {
	session, _ := newReadyInteractiveSession()

	done := make(chan error, 1)
	go func() {
		done <- session.Interrupt()
	}()

	// Wait until the request is registered.
	deadline := time.Now().Add(time.Second)
	for {
		session.mu.RLock()
		pending := len(session.pendingControlRequests)
		session.mu.RUnlock()
		if pending > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pending control request never registered")
		}
		time.Sleep(2 * time.Millisecond)
	}

	close(session.done)

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "session ended") {
			t.Fatalf("expected session-ended error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Interrupt did not return after session done was closed")
	}
}

func TestUpdateEnvironmentVariablesWritesPlainStdinMessage(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	err := session.UpdateEnvironmentVariables(map[string]string{
		"ANTHROPIC_BASE_URL":   "https://api.deepseek.com/anthropic",
		"ANTHROPIC_AUTH_TOKEN": "sk-test",
	})
	if err != nil {
		t.Fatalf("UpdateEnvironmentVariables returned error: %v", err)
	}

	lines := spy.lines()
	if len(lines) != 1 {
		t.Fatalf("expected exactly one stdin line, got %d (lines=%v)", len(lines), lines)
	}
	envelope := decodeStdinLine(t, lines[0])
	if envelope["type"] != "update_environment_variables" {
		t.Fatalf("expected type=update_environment_variables, got %#v", envelope)
	}
	// update_environment_variables is a plain stdin message, not a
	// control_request — it MUST NOT carry request_id / request envelope.
	if _, ok := envelope["request_id"]; ok {
		t.Fatalf("update_environment_variables must not have request_id: %#v", envelope)
	}
	if _, ok := envelope["request"]; ok {
		t.Fatalf("update_environment_variables must not have request envelope: %#v", envelope)
	}
	variables, ok := envelope["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected variables map, got %#v", envelope["variables"])
	}
	if variables["ANTHROPIC_BASE_URL"] != "https://api.deepseek.com/anthropic" {
		t.Fatalf("ANTHROPIC_BASE_URL not propagated: %#v", variables)
	}
	if variables["ANTHROPIC_AUTH_TOKEN"] != "sk-test" {
		t.Fatalf("ANTHROPIC_AUTH_TOKEN not propagated: %#v", variables)
	}
}

func TestUpdateEnvironmentVariablesAllowsEmptyValuesToUnsetEnv(t *testing.T) {
	session, spy := newReadyInteractiveSession()

	if err := session.UpdateEnvironmentVariables(map[string]string{
		"ANTHROPIC_BASE_URL": "",
	}); err != nil {
		t.Fatalf("expected empty value to be accepted, got %v", err)
	}

	lines := spy.lines()
	if len(lines) != 1 {
		t.Fatalf("expected one stdin line, got %d", len(lines))
	}
	envelope := decodeStdinLine(t, lines[0])
	variables := envelope["variables"].(map[string]interface{})
	if v, ok := variables["ANTHROPIC_BASE_URL"]; !ok || v != "" {
		t.Fatalf("expected empty string passthrough, got %#v", variables)
	}
}

func TestUpdateEnvironmentVariablesRejectsEmptyMap(t *testing.T) {
	session, _ := newReadyInteractiveSession()

	if err := session.UpdateEnvironmentVariables(nil); err == nil {
		t.Fatal("expected nil map to error")
	}
	if err := session.UpdateEnvironmentVariables(map[string]string{}); err == nil {
		t.Fatal("expected empty map to error")
	}
}

func TestUpdateEnvironmentVariablesRejectsEmptyKey(t *testing.T) {
	session, _ := newReadyInteractiveSession()

	if err := session.UpdateEnvironmentVariables(map[string]string{"": "value"}); err == nil {
		t.Fatal("expected empty key to error")
	}
}

func TestUpdateEnvironmentVariablesRejectsBatchMode(t *testing.T) {
	session := NewSession(SessionConfig{})
	session.Status = "running"

	err := session.UpdateEnvironmentVariables(map[string]string{"FOO": "bar"})
	if err == nil || !strings.Contains(err.Error(), "interactive mode") {
		t.Fatalf("expected interactive-mode error, got %v", err)
	}
}

func TestUpdateEnvironmentVariablesRejectsBeforeInitialized(t *testing.T) {
	session := NewSession(SessionConfig{InteractiveMode: true})
	session.interactive = true
	session.Status = "running"
	session.stdin = newStdinSpy()

	err := session.UpdateEnvironmentVariables(map[string]string{"FOO": "bar"})
	if err == nil || !strings.Contains(err.Error(), "not yet initialized") {
		t.Fatalf("expected uninitialized error, got %v", err)
	}
}
