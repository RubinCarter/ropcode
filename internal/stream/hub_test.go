package stream

import (
	"testing"
	"time"
)

func TestHubDeliversFramesInOrder(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe("stream-a")
	defer sub.Close()

	appendFrames(t, hub, "stream-a", 1, 2, 3)

	for want := int64(1); want <= 3; want++ {
		frame := receiveFrame(t, sub)
		if frame.Seq != want {
			t.Fatalf("expected seq %d, got %d", want, frame.Seq)
		}
	}
}

func TestHubFansOutToMultipleSubscribers(t *testing.T) {
	hub := NewHub()
	subA := hub.Subscribe("stream-a")
	defer subA.Close()
	subB := hub.Subscribe("stream-a")
	defer subB.Close()

	frame := testFrame("stream-a", 1)
	hub.Append(frame)

	if got := receiveFrame(t, subA); got.FrameID != frame.FrameID {
		t.Fatalf("subscriber A got %q", got.FrameID)
	}
	if got := receiveFrame(t, subB); got.FrameID != frame.FrameID {
		t.Fatalf("subscriber B got %q", got.FrameID)
	}
}

func TestHubReplaysQueuedFramesToLateSubscribers(t *testing.T) {
	hub := NewHub()
	appendFrames(t, hub, "stream-a", 1, 2)

	sub := hub.Subscribe("stream-a")
	defer sub.Close()

	if got := receiveFrame(t, sub); got.Seq != 1 {
		t.Fatalf("expected replay seq 1, got %d", got.Seq)
	}
	if got := receiveFrame(t, sub); got.Seq != 2 {
		t.Fatalf("expected replay seq 2, got %d", got.Seq)
	}
}

func TestHubKeepsIndependentStreamsSeparate(t *testing.T) {
	hub := NewHub()
	subA := hub.Subscribe("stream-a")
	defer subA.Close()
	subB := hub.Subscribe("stream-b")
	defer subB.Close()

	hub.Append(testFrame("stream-a", 1))
	hub.Append(testFrame("stream-b", 1))

	if got := receiveFrame(t, subA); got.StreamID != "stream-a" {
		t.Fatalf("subscriber A got stream %q", got.StreamID)
	}
	if got := receiveFrame(t, subB); got.StreamID != "stream-b" {
		t.Fatalf("subscriber B got stream %q", got.StreamID)
	}
}

func TestHubDiagnosticsAndSubscriberCloseCleanup(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe("stream-a")

	if got := hub.Diagnostics("stream-a").Subscribers; got != 1 {
		t.Fatalf("expected 1 subscriber, got %d", got)
	}

	hub.Append(testFrame("stream-a", 1))
	if got := hub.Diagnostics("stream-a").QueueLength; got != 1 {
		t.Fatalf("expected queue length 1, got %d", got)
	}

	sub.Close()
	if got := hub.Diagnostics("stream-a").Subscribers; got != 0 {
		t.Fatalf("expected 0 subscribers after close, got %d", got)
	}
}

func appendFrames(t *testing.T, hub *Hub, streamID string, seqs ...int64) {
	t.Helper()
	for _, seq := range seqs {
		if err := hub.Append(testFrame(streamID, seq)); err != nil {
			t.Fatal(err)
		}
	}
}

func testFrame(streamID string, seq int64) SessionFrame {
	return SessionFrame{
		StreamID:         streamID,
		FrameID:          streamID + "-frame",
		Provider:         "claude",
		RuntimeSessionID: "runtime",
		Seq:              seq,
		Kind:             FrameKindMessage,
		Content:          []ContentBlock{{Type: ContentText, Text: "x"}},
	}
}

func receiveFrame(t *testing.T, sub *Subscription) SessionFrame {
	t.Helper()
	select {
	case frame, ok := <-sub.C:
		if !ok {
			t.Fatal("subscription channel closed")
		}
		return frame
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for frame")
		return SessionFrame{}
	}
}
