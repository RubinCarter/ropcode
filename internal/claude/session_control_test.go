package claude

import "testing"

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
