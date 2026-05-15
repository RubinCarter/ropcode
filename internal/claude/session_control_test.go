package claude

import "testing"

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
