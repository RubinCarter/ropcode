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
	return &Hub{streams: make(map[string]*streamState)}
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
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.ch <- frame
	}
	return nil
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
