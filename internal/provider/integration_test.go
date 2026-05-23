package provider_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sync"
	"testing"
	"time"

	"ropcode/internal/provider"
	providerClaude "ropcode/internal/provider/claude"
	providerCodex "ropcode/internal/provider/codex"
)

type testEmitter struct {
	mu     sync.Mutex
	events []testEvent
}

type testEvent struct {
	name string
	data interface{}
}

func (e *testEmitter) Emit(name string, data interface{}) {
	e.mu.Lock()
	e.events = append(e.events, testEvent{name, data})
	e.mu.Unlock()
}

func (e *testEmitter) findEvents(name string) []testEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var result []testEvent
	for _, ev := range e.events {
		if ev.name == name {
			result = append(result, ev)
		}
	}
	return result
}

func TestClaudeInteractiveSession_RealBinary(t *testing.T) {
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("claude binary not found, skipping real integration test")
	}

	ctx := context.Background()
	emitter := &testEmitter{}
	mgr := provider.NewManager(ctx, emitter, nil)
	defer mgr.Shutdown()

	mgr.RegisterDriver(&providerClaude.Driver{})

	config := provider.SessionConfig{
		ProjectPath: t.TempDir(),
		Interactive: true,
	}

	t.Log("Starting interactive Claude session...")
	sessionID, err := mgr.StartSession("claude", config)
	if err != nil {
		t.Fatalf("StartSession failed: %v", err)
	}
	t.Logf("Session started: %s", sessionID)

	t.Log("Waiting for init...")
	if err := mgr.WaitForInit(sessionID, 30*time.Second); err != nil {
		output, _ := mgr.GetSessionOutput(sessionID)
		t.Logf("Session output so far:\n%s", output)
		t.Fatalf("WaitForInit failed: %v", err)
	}
	t.Log("Init complete!")

	// Check emitted events
	claudeOutputEvents := emitter.findEvents("claude-output")
	t.Logf("Total claude-output events after init: %d", len(claudeOutputEvents))

	hasSystemInit := false
	for i, ev := range claudeOutputEvents {
		if m, ok := ev.data.(map[string]interface{}); ok {
			evType, _ := m["type"].(string)
			evSubtype, _ := m["subtype"].(string)
			if i < 5 {
				summary, _ := json.Marshal(map[string]string{"type": evType, "subtype": evSubtype})
				t.Logf("  Event[%d]: %s", i, summary)
			}
			if evType == "system" && evSubtype == "init" {
				hasSystemInit = true
			}
		} else {
			t.Logf("  Event[%d]: unexpected type %T", i, ev.data)
		}
	}

	if !hasSystemInit {
		t.Error("missing 'system init' event in claude-output emissions")
	}

	// Send a message and verify response events are emitted
	t.Log("Sending message...")
	preMessageCount := len(emitter.findEvents("claude-output"))
	if err := mgr.SendMessage(sessionID, "Say exactly: hello"); err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	// Wait for response
	time.Sleep(10 * time.Second)

	postMessageEvents := emitter.findEvents("claude-output")
	newEvents := postMessageEvents[preMessageCount:]
	t.Logf("New claude-output events after message: %d", len(newEvents))

	hasAssistant := false
	for i, ev := range newEvents {
		if m, ok := ev.data.(map[string]interface{}); ok {
			evType, _ := m["type"].(string)
			evSubtype, _ := m["subtype"].(string)
			if i < 10 {
				summary, _ := json.Marshal(map[string]string{"type": evType, "subtype": evSubtype})
				t.Logf("  NewEvent[%d]: %s", i, summary)
			}
			if evType == "assistant" {
				hasAssistant = true
			}
		}
	}

	if len(newEvents) == 0 {
		t.Error("NO events emitted after sending message - frontend won't see any response")
	}
	if !hasAssistant {
		t.Error("no 'assistant' type event found in response")
	}

	// Check for process:changed events
	processEvents := emitter.findEvents("process:changed")
	t.Logf("Total process:changed events: %d", len(processEvents))
	for _, ev := range processEvents {
		data, _ := json.Marshal(ev.data)
		t.Logf("  process:changed: %s", string(data))
	}

	// Terminate and check for claude-complete
	if err := mgr.TerminateSession(sessionID); err != nil {
		t.Logf("TerminateSession: %v", err)
	}
	time.Sleep(1 * time.Second)

	completeEvents := emitter.findEvents("claude-complete")
	t.Logf("Total claude-complete events: %d", len(completeEvents))
	if len(completeEvents) == 0 {
		t.Error("missing 'claude-complete' event")
	} else {
		data, _ := json.Marshal(completeEvents[0].data)
		t.Logf("  claude-complete: %s", string(data))
	}

	fmt.Println("Test complete")
}

func TestCodexBatchSession_RealBinary(t *testing.T) {
	if _, err := exec.LookPath("codex"); err != nil {
		t.Skip("codex binary not found, skipping real integration test")
	}

	ctx := context.Background()
	emitter := &testEmitter{}
	mgr := provider.NewManager(ctx, emitter, nil)
	defer mgr.Shutdown()

	mgr.RegisterDriver(&providerCodex.Driver{})

	config := provider.SessionConfig{
		ProjectPath: ".",
		Prompt:      "Say exactly: hello",
		Model:       "o4-mini",
	}

	t.Log("Starting Codex batch session...")
	sessionID, err := mgr.StartSession("codex", config)
	if err != nil {
		t.Fatalf("StartSession failed: %v", err)
	}
	t.Logf("Session started: %s", sessionID)

	// Wait for process to complete (batch mode exits on its own)
	waitDone := make(chan struct{})
	go func() {
		for mgr.IsRunning(sessionID) {
			time.Sleep(500 * time.Millisecond)
		}
		close(waitDone)
	}()
	select {
	case <-waitDone:
	case <-time.After(30 * time.Second):
		output, _ := mgr.GetSessionOutput(sessionID)
		t.Logf("Session output on timeout:\n%s", output)
		status := mgr.GetSession(sessionID)
		if status != nil {
			t.Logf("Session status: %s, PID: %d", status.Status, status.PID)
		}
		mgr.TerminateSession(sessionID)
		t.Fatal("Codex session did not complete within 30s")
	}

	// Check events
	claudeOutputEvents := emitter.findEvents("claude-output")
	t.Logf("Total claude-output events: %d", len(claudeOutputEvents))

	for i, ev := range claudeOutputEvents {
		if i >= 10 {
			t.Logf("  ... and %d more", len(claudeOutputEvents)-10)
			break
		}
		if s, ok := ev.data.(string); ok {
			if len(s) > 200 {
				s = s[:200] + "..."
			}
			t.Logf("  Event[%d]: %s", i, s)
		} else {
			t.Logf("  Event[%d]: unexpected type %T", i, ev.data)
		}
	}

	if len(claudeOutputEvents) == 0 {
		output, _ := mgr.GetSessionOutput(sessionID)
		t.Logf("Raw output:\n%s", output)
		t.Error("NO claude-output events emitted for Codex session")
	}

	completeEvents := emitter.findEvents("claude-complete")
	t.Logf("Total claude-complete events: %d", len(completeEvents))
	if len(completeEvents) == 0 {
		t.Error("missing claude-complete event")
	}
}

func TestClaudeInteractiveSession_EarlyExitDetection(t *testing.T) {
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("claude binary not found, skipping real integration test")
	}

	ctx := context.Background()
	mgr := provider.NewManager(ctx, &testEmitter{}, nil)
	defer mgr.Shutdown()

	mgr.RegisterDriver(&providerClaude.Driver{})

	config := provider.SessionConfig{
		ProjectPath:     t.TempDir(),
		Interactive:     true,
		ResumeSessionID: "nonexistent-session-id-12345",
	}

	sessionID, err := mgr.StartSession("claude", config)
	if err != nil {
		t.Fatalf("StartSession failed: %v", err)
	}

	start := time.Now()
	err = mgr.WaitForInit(sessionID, 30*time.Second)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected WaitForInit to fail with nonexistent resume ID")
	}
	t.Logf("WaitForInit failed after %v: %v", elapsed, err)

	if elapsed > 15*time.Second {
		output, _ := mgr.GetSessionOutput(sessionID)
		t.Logf("Session output:\n%s", output)
		t.Errorf("WaitForInit took too long (%v), expected early exit detection", elapsed)
	}
}
