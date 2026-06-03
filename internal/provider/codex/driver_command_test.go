package codex

import (
	"encoding/json"
	"testing"
	"time"

	"ropcode/internal/provider"
)

func TestDriverHandleProviderCommandCompactUsesThreadCompactStart(t *testing.T) {
	session := &commandSession{
		config:            provider.SessionConfig{Interactive: true, ProjectPath: t.TempDir()},
		providerSessionID: "thread-1",
		state:             provider.StateRunning,
	}

	driver := &Driver{}
	if !driver.IsProviderCommand("/compact") {
		t.Fatal("expected /compact to be a provider command")
	}
	if err := driver.HandleProviderCommand(session, "/compact"); err != nil {
		t.Fatalf("handle compact command: %v", err)
	}
	if len(session.writes) != 1 {
		t.Fatalf("expected one JSON-RPC write, got %d", len(session.writes))
	}

	var request map[string]any
	if err := json.Unmarshal(session.writes[0], &request); err != nil {
		t.Fatalf("decode JSON-RPC request: %v", err)
	}
	if request["method"] != "thread/compact/start" {
		t.Fatalf("expected thread/compact/start, got %#v", request["method"])
	}
	params, _ := request["params"].(map[string]any)
	if params["threadId"] != "thread-1" {
		t.Fatalf("expected thread id thread-1, got %#v", params["threadId"])
	}
	if _, ok := params["input"]; ok {
		t.Fatalf("compact command must not be sent as model input: %#v", params)
	}
}

func TestDriverProviderCommandDetectionStripsInjectedWrappers(t *testing.T) {
	message := "<previous_conversation>\n[User]: hello\n</previous_conversation>\n\n<system_instruction>internal</system_instruction>\n\n/compact"
	command, ok := codexProviderCommand(message)
	if !ok || command != "compact" {
		t.Fatalf("expected wrapped compact command, got command=%q ok=%v", command, ok)
	}
}

func TestDriverProviderCommandDetectionStripsWorktreeFirstMessageWrapper(t *testing.T) {
	message := `<system_instruction>
Work in this workspace.
</system_instruction>

/compact

<system-instruction>
Rename the branch before editing files.
</system-instruction>`

	command, ok := codexProviderCommand(message)
	if !ok || command != "compact" {
		t.Fatalf("expected first-message wrapped compact command, got command=%q ok=%v", command, ok)
	}
}

func TestDriverProviderCommandRejectsUnsupportedTUICommand(t *testing.T) {
	session := &commandSession{
		config:            provider.SessionConfig{Interactive: true, ProjectPath: t.TempDir()},
		providerSessionID: "thread-1",
		state:             provider.StateRunning,
	}

	driver := &Driver{}
	if !driver.IsProviderCommand("/model") {
		t.Fatal("expected /model to be recognized as a provider command")
	}
	err := driver.HandleProviderCommand(session, "/model")
	if err == nil {
		t.Fatal("expected unsupported TUI command error")
	}
	if len(session.writes) != 0 {
		t.Fatalf("unsupported command should not write to Codex stdin, got %d writes", len(session.writes))
	}
}

func TestDriverInterruptRequiresActiveTurnID(t *testing.T) {
	session := &commandSession{
		config:            provider.SessionConfig{Interactive: true, ProjectPath: t.TempDir()},
		providerSessionID: "thread-1",
		state:             provider.StateRunning,
	}

	driver := &Driver{}
	err := driver.Interrupt(session)
	if err == nil {
		t.Fatal("expected missing active turn error")
	}
	if len(session.writes) != 0 {
		t.Fatalf("interrupt without turn id should not write to Codex stdin, got %d writes", len(session.writes))
	}
}

func TestDriverInterruptSendsThreadAndTurnID(t *testing.T) {
	session := &commandSession{
		config:            provider.SessionConfig{Interactive: true, ProjectPath: t.TempDir()},
		providerSessionID: "thread-1",
		state:             provider.StateRunning,
	}

	driver := &Driver{}
	driver.rememberTurnStarted(map[string]interface{}{
		"threadId": "thread-1",
		"turn":     map[string]interface{}{"id": "turn-1"},
	})
	if err := driver.Interrupt(session); err != nil {
		t.Fatalf("interrupt active turn: %v", err)
	}
	if len(session.writes) != 1 {
		t.Fatalf("expected one JSON-RPC write, got %d", len(session.writes))
	}

	var request map[string]any
	if err := json.Unmarshal(session.writes[0], &request); err != nil {
		t.Fatalf("decode JSON-RPC request: %v", err)
	}
	if request["method"] != "turn/interrupt" {
		t.Fatalf("expected turn/interrupt, got %#v", request["method"])
	}
	params, _ := request["params"].(map[string]any)
	if params["threadId"] != "thread-1" || params["turnId"] != "turn-1" {
		t.Fatalf("expected thread and turn id params, got %#v", params)
	}
}

type commandSession struct {
	writes            [][]byte
	config            provider.SessionConfig
	state             provider.SessionState
	providerSessionID string
}

func (s *commandSession) WriteStdin(data []byte) error {
	s.writes = append(s.writes, append([]byte(nil), data...))
	return nil
}

func (s *commandSession) Kill() error { return nil }

func (s *commandSession) EnqueueMessage(msg string) {}

func (s *commandSession) DequeueMessage() (string, bool) { return "", false }

func (s *commandSession) RestartWithConfig(config provider.SessionConfig) error {
	s.config = config
	return nil
}

func (s *commandSession) GetState() provider.SessionState { return s.state }

func (s *commandSession) GetSessionID() string { return "runtime-1" }

func (s *commandSession) GetProviderSessionID() string { return s.providerSessionID }

func (s *commandSession) GetConfig() provider.SessionConfig { return s.config }

func (s *commandSession) SetProviderSessionID(id string) { s.providerSessionID = id }

func (s *commandSession) UpdateConfig(fn func(*provider.SessionConfig)) { fn(&s.config) }

func (s *commandSession) SendControlRequest(requestID string, payload []byte) (<-chan provider.ControlResponse, error) {
	ch := make(chan provider.ControlResponse)
	return ch, nil
}

func (s *commandSession) CancelControlRequest(requestID string) {}

func (s *commandSession) MarkInitialized() {}

func (s *commandSession) WaitForInit(timeout time.Duration) error { return nil }
