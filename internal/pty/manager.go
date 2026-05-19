// internal/pty/manager.go
package pty

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// EventEmitter interface for emitting events to the frontend
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

// PtyOutput represents output from a PTY session
type PtyOutput struct {
	SessionID  string `json:"session_id"`
	OutputType string `json:"output_type"`
	Content    string `json:"content"`
}

// PtyReady represents PTY session ready event
type PtyReady struct {
	SessionID string `json:"session_id"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

// Manager manages multiple PTY sessions
type Manager struct {
	ctx      context.Context
	emitter  EventEmitter
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new PTY manager
func NewManager(ctx context.Context, emitter EventEmitter) *Manager {
	return &Manager{
		ctx:      ctx,
		emitter:  emitter,
		sessions: make(map[string]*Session),
	}
}

// CreateSession creates a new PTY session
// This method returns immediately with a pending session.
// The actual shell startup happens asynchronously in a goroutine.
// A "pty-ready" event will be emitted when the PTY is ready or failed.
func (m *Manager) CreateSession(id, cwd string, rows, cols int, shell string) (*Session, error) {
	m.mu.Lock()

	if _, exists := m.sessions[id]; exists {
		m.mu.Unlock()
		return nil, fmt.Errorf("session already exists: %s", id)
	}

	session, err := NewSession(id, cwd, rows, cols, shell)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}

	// Store session immediately (before Start) so we can return quickly
	m.sessions[id] = session
	m.mu.Unlock()

	// Start the PTY asynchronously to avoid blocking the main thread
	go func() {
		if err := session.Start(); err != nil {
			// Remove failed session
			m.mu.Lock()
			delete(m.sessions, id)
			m.mu.Unlock()

			// Emit failure event
			if m.emitter != nil {
				m.emitter.Emit("pty-ready", PtyReady{
					SessionID: id,
					Success:   false,
					Error:     err.Error(),
				})
			}
			return
		}

		// Start output reading goroutine
		go m.readOutput(session)

		// Emit success event
		if m.emitter != nil {
			m.emitter.Emit("pty-ready", PtyReady{
				SessionID: id,
				Success:   true,
			})
		}
	}()

	return session, nil
}

// readOutput reads from a PTY and emits "pty-output" events to the front-end.
//
// Output is coalesced over a 16ms window before emission so that bursty
// programs like `npm run dev` produce roughly one event per frame rather than
// hundreds. The previous implementation emitted every read directly, which
// during fast streaming overwhelmed the WebSocket Send queue and starved
// regular RPC responses on the same connection.
//
// Two paths flush the pending buffer:
//
//   - Read goroutine: when the read returns and the accumulator has filled
//     past the high-water mark, OR the flush timer fires for the next 16ms
//     boundary.
//   - Session shutdown: residual bytes are flushed before the goroutine
//     exits so the user sees the final lines.
const (
	ptyFlushInterval = 16 * time.Millisecond
	// Flush eagerly when a single batch exceeds this many bytes so very large
	// outputs (compiler dumps, log floods) don't pile up unbounded in memory.
	ptyFlushHighWater = 64 * 1024
)

func (m *Manager) readOutput(session *Session) {
	buf := make([]byte, 8192)
	pending := make([]byte, 0, ptyFlushHighWater)

	flush := func() {
		if len(pending) == 0 || m.emitter == nil {
			pending = pending[:0]
			return
		}
		m.emitter.Emit("pty-output", PtyOutput{
			SessionID:  session.ID,
			OutputType: "stdout",
			Content:    string(pending),
		})
		pending = pending[:0]
	}

	// Reads run on this goroutine; the timer fires on the runtime timer
	// goroutine but only signals via flushReady so we don't race with the
	// in-flight Read call.
	flushReady := make(chan struct{}, 1)
	readDone := make(chan struct{})
	timer := time.NewTimer(ptyFlushInterval)
	if !timer.Stop() {
		<-timer.C
	}
	timerArmed := false
	armTimer := func() {
		if timerArmed {
			return
		}
		timer.Reset(ptyFlushInterval)
		timerArmed = true
	}
	go func() {
		for {
			select {
			case <-session.Done():
				return
			case <-m.ctx.Done():
				return
			case <-readDone:
				return
			case <-timer.C:
				select {
				case flushReady <- struct{}{}:
				default:
				}
			}
		}
	}()

	defer func() {
		close(readDone)
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		flush()
	}()

	for {
		select {
		case <-session.Done():
			return
		case <-m.ctx.Done():
			return
		case <-flushReady:
			timerArmed = false
			flush()
		default:
			n, err := session.Read(buf)
			if err != nil {
				return
			}
			if n == 0 {
				continue
			}
			pending = append(pending, buf[:n]...)
			if len(pending) >= ptyFlushHighWater {
				flush()
				timerArmed = false
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				continue
			}
			armTimer()
		}
	}
}

// Write sends data to a PTY session
func (m *Manager) Write(sessionID, data string) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return session.Write(data)
}

// Resize changes the terminal size for a session
func (m *Manager) Resize(sessionID string, rows, cols int) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return session.Resize(rows, cols)
}

// CloseSession closes a specific PTY session
func (m *Manager) CloseSession(sessionID string) error {
	m.mu.Lock()
	session, exists := m.sessions[sessionID]
	if exists {
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return session.Close()
}

// CloseAll closes all PTY sessions
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, session := range m.sessions {
		session.Close()
		delete(m.sessions, id)
	}
}

// ListSessions returns all active session IDs
func (m *Manager) ListSessions() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}

// GetSession returns a session by ID
func (m *Manager) GetSession(sessionID string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, exists := m.sessions[sessionID]
	return session, exists
}
