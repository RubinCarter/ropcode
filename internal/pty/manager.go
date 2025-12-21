// internal/pty/manager.go
package pty

import (
	"context"
	"fmt"
	"sync"
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
func (m *Manager) CreateSession(id, cwd string, rows, cols int, shell string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[id]; exists {
		return nil, fmt.Errorf("session already exists: %s", id)
	}

	session, err := NewSession(id, cwd, rows, cols, shell)
	if err != nil {
		return nil, err
	}

	if err := session.Start(); err != nil {
		return nil, err
	}

	m.sessions[id] = session

	// Start output reading goroutine
	go m.readOutput(session)

	return session, nil
}

// readOutput reads from PTY and emits events
func (m *Manager) readOutput(session *Session) {
	buf := make([]byte, 8192)

	for {
		select {
		case <-session.Done():
			return
		case <-m.ctx.Done():
			return
		default:
			n, err := session.Read(buf)
			if err != nil {
				return
			}
			if n > 0 && m.emitter != nil {
				m.emitter.Emit("pty-output", PtyOutput{
					SessionID:  session.ID,
					OutputType: "stdout",
					Content:    string(buf[:n]),
				})
			}
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
