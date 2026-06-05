package stream

import (
	"errors"
	"sync"
)

const subscriberBufferSize = 256

var ErrMissingStreamID = errors.New("stream frame missing streamId")

type Hub struct {
	mu       sync.Mutex
	streams  map[string]*streamState
	aliases  map[string]string // realStreamID → virtualStreamID (forward frames to alias)
	aliasSeq map[string]int64
}

type streamState struct {
	queue       streamQueue
	subscribers map[*Subscription]struct{}
}

type Subscription struct {
	C        <-chan SessionFrame
	hub      *Hub
	streamID string
	ch       chan SessionFrame
	mu       sync.Mutex
	closed   bool
	once     sync.Once
}

func NewHub() *Hub {
	return &Hub{
		streams:  make(map[string]*streamState),
		aliases:  make(map[string]string),
		aliasSeq: make(map[string]int64),
	}
}

func (h *Hub) Append(frame SessionFrame) error {
	if frame.StreamID == "" {
		return ErrMissingStreamID
	}

	h.mu.Lock()
	state := h.stateFor(frame.StreamID)
	state.queue.append(frame)
	subscribers := make([]*Subscription, 0, len(state.subscribers))
	for sub := range state.subscribers {
		subscribers = append(subscribers, sub)
	}
	// Check if this stream has an alias (forward to virtual stream)
	aliasID := h.aliases[frame.StreamID]
	var aliasFrame SessionFrame
	var aliasSubscribers []*Subscription
	if aliasID != "" {
		aliasState := h.stateFor(aliasID)
		aliasFrame = h.nextAliasFrame(aliasID, frame)
		aliasState.queue.append(aliasFrame)
		aliasSubscribers = make([]*Subscription, 0, len(aliasState.subscribers))
		for sub := range aliasState.subscribers {
			aliasSubscribers = append(aliasSubscribers, sub)
		}
	}
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.deliver(frame)
	}
	if aliasID != "" {
		for _, sub := range aliasSubscribers {
			sub.deliver(aliasFrame)
		}
	}
	return nil
}

func (h *Hub) AppendVirtual(streamID string, frame SessionFrame) error {
	if streamID == "" {
		return ErrMissingStreamID
	}

	h.mu.Lock()
	state := h.stateFor(streamID)
	virtualFrame := h.nextAliasFrame(streamID, frame)
	state.queue.append(virtualFrame)
	subscribers := make([]*Subscription, 0, len(state.subscribers))
	for sub := range state.subscribers {
		subscribers = append(subscribers, sub)
	}
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.deliver(virtualFrame)
	}
	return nil
}

// RegisterAlias forwards all frames from realStreamID to aliasID.
// Frontend subscribes to aliasID (e.g. projectChatId) and receives frames
// from the real provider session stream.
func (h *Hub) RegisterAlias(realStreamID, aliasID string) {
	h.mu.Lock()
	if realStreamID == "" || aliasID == "" || h.aliases[realStreamID] == aliasID {
		h.mu.Unlock()
		return
	}
	h.aliases[realStreamID] = aliasID

	var replay []SessionFrame
	var aliasSubscribers []*Subscription
	realState := h.streams[realStreamID]
	if realState != nil && realState.queue.len() > 0 {
		aliasState := h.stateFor(aliasID)
		for _, frame := range realState.queue.snapshot() {
			aliasFrame := h.nextAliasFrame(aliasID, frame)
			aliasState.queue.append(aliasFrame)
			replay = append(replay, aliasFrame)
		}
		aliasSubscribers = make([]*Subscription, 0, len(aliasState.subscribers))
		for sub := range aliasState.subscribers {
			aliasSubscribers = append(aliasSubscribers, sub)
		}
	}
	h.mu.Unlock()

	for _, frame := range replay {
		for _, sub := range aliasSubscribers {
			sub.deliver(frame)
		}
	}
}

// UnregisterAlias removes the alias for a real stream.
func (h *Hub) UnregisterAlias(realStreamID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.aliases, realStreamID)
}

func (h *Hub) Subscribe(streamID string) *Subscription {
	sub := &Subscription{
		hub:      h,
		streamID: streamID,
		ch:       make(chan SessionFrame, subscriberBufferSize),
	}
	sub.C = sub.ch

	h.mu.Lock()
	state := h.stateFor(streamID)
	// Full history is loaded through the RPC history APIs. The stream
	// subscription only needs a bounded live replay so opening an old, busy
	// stream cannot block before the WebSocket writer starts reading.
	replay := state.queue.snapshotTail(subscriberBufferSize)
	state.subscribers[sub] = struct{}{}
	h.mu.Unlock()

	for _, frame := range replay {
		sub.deliver(frame)
	}

	return sub
}

func (h *Hub) Diagnostics(streamID string) Diagnostics {
	h.mu.Lock()
	defer h.mu.Unlock()

	state := h.streams[streamID]
	if state == nil {
		return Diagnostics{}
	}
	return Diagnostics{
		QueueLength: state.queue.len(),
		Subscribers: len(state.subscribers),
	}
}

func (h *Hub) unsubscribe(sub *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	state := h.streams[sub.streamID]
	if state == nil {
		return
	}
	delete(state.subscribers, sub)
}

func (h *Hub) stateFor(streamID string) *streamState {
	state := h.streams[streamID]
	if state == nil {
		state = &streamState{subscribers: make(map[*Subscription]struct{})}
		h.streams[streamID] = state
	}
	return state
}

func (h *Hub) nextAliasFrame(aliasID string, frame SessionFrame) SessionFrame {
	h.aliasSeq[aliasID]++
	aliasFrame := frame
	aliasFrame.StreamID = aliasID
	aliasFrame.Seq = h.aliasSeq[aliasID]
	aliasFrame.FrameID = aliasFrameID(aliasID, frame)
	return aliasFrame
}

func (s *Subscription) Close() {
	s.once.Do(func() {
		s.hub.unsubscribe(s)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.closed = true
		close(s.ch)
	})
}

func (s *Subscription) deliver(frame SessionFrame) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	select {
	case s.ch <- frame:
		return true
	default:
		// A slow or orphaned WebSocket must not block provider output. The
		// frame is already retained in the hub queue; closing the subscription
		// lets the client reconnect and replay the bounded tail.
		go s.Close()
		return false
	}
}
