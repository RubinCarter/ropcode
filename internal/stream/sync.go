package stream

import "sync"

type SyncEvent struct {
	Type          string         `json:"type"`
	ProjectID     string         `json:"projectId,omitempty"`
	ProjectPath   string         `json:"projectPath,omitempty"`
	WorkspacePath string         `json:"workspacePath,omitempty"`
	SessionID     string         `json:"sessionId,omitempty"`
	Provider      string         `json:"provider,omitempty"`
	Summary       map[string]any `json:"summary,omitempty"`
}

type SyncHub struct {
	mu          sync.Mutex
	subscribers map[*SyncSubscription]struct{}
}

type SyncSubscription struct {
	C    <-chan SyncEvent
	hub  *SyncHub
	ch   chan SyncEvent
	once sync.Once
}

func NewSyncHub() *SyncHub {
	return &SyncHub{subscribers: make(map[*SyncSubscription]struct{})}
}

func (h *SyncHub) Broadcast(event SyncEvent) {
	h.mu.Lock()
	subscribers := make([]*SyncSubscription, 0, len(h.subscribers))
	for sub := range h.subscribers {
		subscribers = append(subscribers, sub)
	}
	h.mu.Unlock()

	for _, sub := range subscribers {
		sub.ch <- event
	}
}

func (h *SyncHub) Subscribe() *SyncSubscription {
	sub := &SyncSubscription{
		hub: h,
		ch:  make(chan SyncEvent, subscriberBufferSize),
	}
	sub.C = sub.ch

	h.mu.Lock()
	h.subscribers[sub] = struct{}{}
	h.mu.Unlock()

	return sub
}

func (h *SyncHub) Diagnostics() Diagnostics {
	h.mu.Lock()
	defer h.mu.Unlock()

	return Diagnostics{Subscribers: len(h.subscribers)}
}

func (h *SyncHub) unsubscribe(sub *SyncSubscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.subscribers, sub)
}

func (s *SyncSubscription) Close() {
	s.once.Do(func() {
		s.hub.unsubscribe(s)
		close(s.ch)
	})
}
