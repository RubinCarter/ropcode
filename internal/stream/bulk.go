package stream

import (
	"errors"
	"fmt"
	"sync"
)

var ErrMissingBulkKey = errors.New("bulk frame missing source or id")

type BulkFrame struct {
	Source    string         `json:"source"`
	ID        string         `json:"id"`
	FrameID   string         `json:"frameId,omitempty"`
	Seq       int64          `json:"seq"`
	Timestamp string         `json:"timestamp,omitempty"`
	Data      string         `json:"data,omitempty"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type BulkHub struct {
	mu      sync.Mutex
	streams map[string]*bulkState
}

type bulkState struct {
	queue       []BulkFrame
	subscribers map[*BulkSubscription]struct{}
}

type BulkSubscription struct {
	C    <-chan BulkFrame
	hub  *BulkHub
	key  string
	ch   chan BulkFrame
	once sync.Once
}

func NewBulkHub() *BulkHub {
	return &BulkHub{streams: make(map[string]*bulkState)}
}

func (h *BulkHub) Append(frame BulkFrame) error {
	if frame.Source == "" || frame.ID == "" {
		return ErrMissingBulkKey
	}

	key := bulkKey(frame.Source, frame.ID)
	h.mu.Lock()
	state := h.stateFor(key)
	state.queue = append(state.queue, frame)
	subscribers := make([]*BulkSubscription, 0, len(state.subscribers))
	for sub := range state.subscribers {
		subscribers = append(subscribers, sub)
	}
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.ch <- frame
	}
	return nil
}

func (h *BulkHub) Subscribe(source string, id string) *BulkSubscription {
	key := bulkKey(source, id)
	sub := &BulkSubscription{
		hub: h,
		key: key,
		ch:  make(chan BulkFrame, subscriberBufferSize),
	}
	sub.C = sub.ch

	h.mu.Lock()
	state := h.stateFor(key)
	replay := make([]BulkFrame, len(state.queue))
	copy(replay, state.queue)
	state.subscribers[sub] = struct{}{}
	h.mu.Unlock()

	for _, frame := range replay {
		sub.ch <- frame
	}

	return sub
}

func (h *BulkHub) Diagnostics(source string, id string) Diagnostics {
	h.mu.Lock()
	defer h.mu.Unlock()

	state := h.streams[bulkKey(source, id)]
	if state == nil {
		return Diagnostics{}
	}
	return Diagnostics{QueueLength: len(state.queue), Subscribers: len(state.subscribers)}
}

func (h *BulkHub) unsubscribe(sub *BulkSubscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	state := h.streams[sub.key]
	if state == nil {
		return
	}
	delete(state.subscribers, sub)
}

func (h *BulkHub) stateFor(key string) *bulkState {
	state := h.streams[key]
	if state == nil {
		state = &bulkState{subscribers: make(map[*BulkSubscription]struct{})}
		h.streams[key] = state
	}
	return state
}

func (s *BulkSubscription) Close() {
	s.once.Do(func() {
		s.hub.unsubscribe(s)
		close(s.ch)
	})
}

func bulkKey(source string, id string) string {
	return fmt.Sprintf("%s/%s", source, id)
}
