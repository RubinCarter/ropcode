package stream

import (
	"fmt"
	"strings"
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

func TestHubReplaysOnlyLatestUpsertFrameToLateSubscribers(t *testing.T) {
	hub := NewHub()

	first := testFrame("stream-a", 1)
	first.FrameID = "stable-message"
	first.MessageID = "message-1"
	first.Operation = FrameOperationUpsert
	first.Role = RoleAssistant
	first.Content = []ContentBlock{{Type: ContentText, Text: "partial"}}
	second := first
	second.Seq = 2
	second.Content = []ContentBlock{{Type: ContentText, Text: "complete final reply"}}

	if err := hub.Append(first); err != nil {
		t.Fatal(err)
	}
	if err := hub.Append(second); err != nil {
		t.Fatal(err)
	}

	sub := hub.Subscribe("stream-a")
	defer sub.Close()

	frame := receiveFrame(t, sub)
	if got := frameContentText(frame.Content); got != "complete final reply" {
		t.Fatalf("expected latest upsert content, got %q", got)
	}
	select {
	case extra := <-sub.C:
		t.Fatalf("expected only latest upsert frame, got extra frame %#v", extra)
	default:
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

func TestHubRegisterAliasKeepsQueuedVirtualFrames(t *testing.T) {
	hub := NewHub()

	hub.RegisterAlias("provider-a:runtime-1", "project-chat-1")
	if err := hub.Append(testFrame("provider-a:runtime-1", 1)); err != nil {
		t.Fatal(err)
	}

	hub.RegisterAlias("provider-b:runtime-2", "project-chat-1")
	if err := hub.Append(testFrame("provider-b:runtime-2", 1)); err != nil {
		t.Fatal(err)
	}

	sub := hub.Subscribe("project-chat-1")
	defer sub.Close()

	if got := receiveFrame(t, sub); got.RuntimeSessionID != "runtime-1" {
		t.Fatalf("expected first provider frame replay, got runtime %q", got.RuntimeSessionID)
	}
	if got := receiveFrame(t, sub); got.RuntimeSessionID != "runtime-2" {
		t.Fatalf("expected second provider frame replay, got runtime %q", got.RuntimeSessionID)
	}
}

func TestHubAliasKeepsMultipleRealStreamsAndAssignsVirtualSeq(t *testing.T) {
	hub := NewHub()

	hub.RegisterAlias("provider-a:runtime-1", "project-chat-1")
	hub.RegisterAlias("provider-b:runtime-2", "project-chat-1")

	sub := hub.Subscribe("project-chat-1")
	defer sub.Close()

	if err := hub.Append(testFrame("provider-a:runtime-1", 1)); err != nil {
		t.Fatal(err)
	}
	if err := hub.Append(testFrame("provider-b:runtime-2", 1)); err != nil {
		t.Fatal(err)
	}
	if err := hub.Append(testFrame("provider-a:runtime-1", 2)); err != nil {
		t.Fatal(err)
	}

	first := receiveFrame(t, sub)
	second := receiveFrame(t, sub)
	third := receiveFrame(t, sub)

	if first.Seq != 1 || second.Seq != 2 || third.Seq != 3 {
		t.Fatalf("expected virtual seq 1,2,3, got %d,%d,%d", first.Seq, second.Seq, third.Seq)
	}
	if first.StreamID != "project-chat-1" || second.StreamID != "project-chat-1" || third.StreamID != "project-chat-1" {
		t.Fatalf("expected all frames on project chat stream, got %q %q %q", first.StreamID, second.StreamID, third.StreamID)
	}
	if first.FrameID == "provider-a:runtime-1-frame-1" || second.FrameID == "provider-b:runtime-2-frame-1" {
		t.Fatalf("expected alias frame ids to be rewritten, got %q %q", first.FrameID, second.FrameID)
	}
	if first.FrameID == second.FrameID || first.FrameID == third.FrameID || second.FrameID == third.FrameID {
		t.Fatalf("expected alias frame ids to remain unique, got %q %q %q", first.FrameID, second.FrameID, third.FrameID)
	}
}

func TestAliasFramesUseSameIdentityAsRebasedHistory(t *testing.T) {
	hub := NewHub()
	realFrame := testFrame("provider-a:runtime-1", 1)

	historyFrames := RebaseFramesToStream("project-chat-1", []SessionFrame{realFrame})
	if len(historyFrames) != 1 {
		t.Fatalf("expected one history frame, got %d", len(historyFrames))
	}
	if historyFrames[0].Seq != -1 {
		t.Fatalf("expected rebased history seq -1, got %d", historyFrames[0].Seq)
	}

	hub.RegisterAlias("provider-a:runtime-1", "project-chat-1")
	sub := hub.Subscribe("project-chat-1")
	defer sub.Close()
	if err := hub.Append(realFrame); err != nil {
		t.Fatal(err)
	}
	liveFrame := receiveFrame(t, sub)

	if liveFrame.FrameID != historyFrames[0].FrameID {
		t.Fatalf("expected history and live alias frames to share identity, got %q and %q", historyFrames[0].FrameID, liveFrame.FrameID)
	}
	if liveFrame.Seq != 1 {
		t.Fatalf("expected live alias seq 1, got %d", liveFrame.Seq)
	}
}

func TestAliasFrameIdentityIgnoresSourceSeqAndFrameID(t *testing.T) {
	hub := NewHub()
	historyFrame := testFrame("provider-a:runtime-1", 1)
	liveFrame := historyFrame
	liveFrame.Seq = 999
	liveFrame.FrameID = "provider-a:runtime-1-random-live-frame"

	historyFrames := RebaseFramesToStream("project-chat-1", []SessionFrame{historyFrame})
	if len(historyFrames) != 1 {
		t.Fatalf("expected one history frame, got %d", len(historyFrames))
	}

	hub.RegisterAlias("provider-a:runtime-1", "project-chat-1")
	sub := hub.Subscribe("project-chat-1")
	defer sub.Close()
	if err := hub.Append(liveFrame); err != nil {
		t.Fatal(err)
	}
	aliasedLiveFrame := receiveFrame(t, sub)

	if aliasedLiveFrame.FrameID != historyFrames[0].FrameID {
		t.Fatalf("expected alias identity to ignore source seq/frame id, got %q and %q", aliasedLiveFrame.FrameID, historyFrames[0].FrameID)
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
		FrameID:          fmt.Sprintf("%s-frame-%d", streamID, seq),
		Provider:         "claude",
		RuntimeSessionID: streamID[strings.LastIndex(streamID, ":")+1:],
		Seq:              seq,
		Timestamp:        fmt.Sprintf("2026-06-02T00:00:%02dZ", seq),
		Kind:             FrameKindMessage,
		Content:          []ContentBlock{{Type: ContentText, Text: "x"}},
		Meta:             Meta{Raw: map[string]any{"event_id": fmt.Sprintf("%s-event-%d", streamID, seq)}},
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
