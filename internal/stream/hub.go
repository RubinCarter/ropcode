package stream

import (
	"errors"
	"sync"
)

const subscriberBufferSize = 256

var ErrMissingStreamID = errors.New("stream frame missing streamId")

type Hub struct {
	mu      sync.Mutex
	streams map[string]*streamState
	aliases map[string]string // realStreamID → virtualStreamID (forward frames to alias)
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
	once     sync.Once
}

func NewHub() *Hub {
	return &Hub{
		streams: make(map[string]*streamState),
		aliases: make(map[string]string),
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
	var aliasSubscribers []*Subscription
	if aliasID != "" {
		aliasState := h.stateFor(aliasID)
		aliasFrame := frame
		aliasFrame.StreamID = aliasID
		aliasState.queue.append(aliasFrame)
		aliasSubscribers = make([]*Subscription, 0, len(aliasState.subscribers))
		for sub := range aliasState.subscribers {
			aliasSubscribers = append(aliasSubscribers, sub)
		}
	}
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.ch <- frame
	}
	if aliasID != "" {
		aliasFrame := frame
		aliasFrame.StreamID = aliasID
		for _, sub := range aliasSubscribers {
			sub.ch <- aliasFrame
		}
	}
	return nil
}

// RegisterAlias forwards all frames from realStreamID to aliasID.
// Frontend subscribes to aliasID (e.g. projectChatId) and receives frames
// from the real provider session stream.
// Clears the alias stream's queue on each call to prevent stale frame replay.
func (h *Hub) RegisterAlias(realStreamID, aliasID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Remove any previous alias pointing to this aliasID
	for k, v := range h.aliases {
		if v == aliasID {
			delete(h.aliases, k)
		}
	}
	h.aliases[realStreamID] = aliasID
	// Clear the alias stream's queue so old segment frames don't replay
	if state := h.streams[aliasID]; state != nil {
		state.queue.reset()
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
	replay := state.queue.snapshot()
	state.subscribers[sub] = struct{}{}
	h.mu.Unlock()

	for _, frame := range replay {
		sub.ch <- frame
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

func (s *Subscription) Close() {
	s.once.Do(func() {
		s.hub.unsubscribe(s)
		close(s.ch)
	})
}
