package stream

import (
	"testing"
	"time"
)

func TestBulkHubRoutesBySourceAndID(t *testing.T) {
	hub := NewBulkHub()
	pty := hub.Subscribe("pty", "term-1")
	defer pty.Close()
	agent := hub.Subscribe("agent", "run-1")
	defer agent.Close()

	if err := hub.Append(BulkFrame{Source: "pty", ID: "term-1", Seq: 1, Data: "pty data"}); err != nil {
		t.Fatal(err)
	}
	if err := hub.Append(BulkFrame{Source: "agent", ID: "run-1", Seq: 1, Data: "agent data"}); err != nil {
		t.Fatal(err)
	}

	if got := receiveBulkFrame(t, pty); got.Data != "pty data" {
		t.Fatalf("expected pty data, got %q", got.Data)
	}
	if got := receiveBulkFrame(t, agent); got.Data != "agent data" {
		t.Fatalf("expected agent data, got %q", got.Data)
	}
}

func TestBulkHubDiagnostics(t *testing.T) {
	hub := NewBulkHub()
	sub := hub.Subscribe("logs", "file-1")

	if got := hub.Diagnostics("logs", "file-1").Subscribers; got != 1 {
		t.Fatalf("expected 1 subscriber, got %d", got)
	}
	if err := hub.Append(BulkFrame{Source: "logs", ID: "file-1", Seq: 1, Data: "line"}); err != nil {
		t.Fatal(err)
	}
	if got := hub.Diagnostics("logs", "file-1").QueueLength; got != 1 {
		t.Fatalf("expected queue length 1, got %d", got)
	}

	sub.Close()
	if got := hub.Diagnostics("logs", "file-1").Subscribers; got != 0 {
		t.Fatalf("expected 0 subscribers, got %d", got)
	}
}

func TestBulkHubReplaysQueuedFramesToLateSubscribers(t *testing.T) {
	hub := NewBulkHub()
	if err := hub.Append(BulkFrame{Source: "agent", ID: "run-1", Seq: 1, Data: "first"}); err != nil {
		t.Fatal(err)
	}
	if err := hub.Append(BulkFrame{Source: "agent", ID: "run-1", Seq: 2, Data: "second"}); err != nil {
		t.Fatal(err)
	}

	sub := hub.Subscribe("agent", "run-1")
	defer sub.Close()

	if got := receiveBulkFrame(t, sub); got.Data != "first" {
		t.Fatalf("expected first replay frame, got %q", got.Data)
	}
	if got := receiveBulkFrame(t, sub); got.Data != "second" {
		t.Fatalf("expected second replay frame, got %q", got.Data)
	}
}

func receiveBulkFrame(t *testing.T, sub *BulkSubscription) BulkFrame {
	t.Helper()
	select {
	case frame, ok := <-sub.C:
		if !ok {
			t.Fatal("bulk subscription channel closed")
		}
		return frame
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for bulk frame")
		return BulkFrame{}
	}
}
