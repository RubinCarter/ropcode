// internal/codex/manager.go
package codex

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

type SessionManager struct {
	ctx        context.Context
	emitter    EventEmitter
	sessions   map[string]*Session
	binaryPath string
	mu         sync.RWMutex
}

// NewSessionManager creates a new Codex session manager
func NewSessionManager(ctx context.Context, emitter EventEmitter) *SessionManager {
	manager := &SessionManager{
		ctx:      ctx,
		emitter:  emitter,
		sessions: make(map[string]*Session),
	}

	// Try to discover the binary path on initialization
	if path, err := manager.discoverBinary(); err == nil {
		manager.binaryPath = path
	}

	return manager
}

// SetBinaryPath sets the path to the Codex binary
func (m *SessionManager) SetBinaryPath(path string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.binaryPath = path
}

// GetBinaryPath returns the current binary path
func (m *SessionManager) GetBinaryPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.binaryPath
}

// discoverBinary attempts to find the Codex binary in common locations
func (m *SessionManager) discoverBinary() (string, error) {
	// First, try to find it in PATH
	if path, err := exec.LookPath("codex"); err == nil {
		return path, nil
	}

	// Common installation locations
	commonPaths := []string{
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
		"/usr/bin/codex",
		filepath.Join(os.Getenv("HOME"), ".local/bin/codex"),
		filepath.Join(os.Getenv("HOME"), ".cargo/bin/codex"),
	}

	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("codex binary not found in PATH or common locations")
}

// StartSession starts a new Codex session
func (m *SessionManager) StartSession(config SessionConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if binary path is set
	if m.binaryPath == "" {
		path, err := m.discoverBinary()
		if err != nil {
			return "", fmt.Errorf("codex binary not configured: %w", err)
		}
		m.binaryPath = path
	}

	// Check if there's already a running session for this project
	if config.ProjectPath != "" {
		for _, session := range m.sessions {
			if session.Config.ProjectPath == config.ProjectPath && session.IsRunning() {
				return "", fmt.Errorf("a session is already running for project: %s", config.ProjectPath)
			}
		}
	}

	// Create new session
	session := NewSession(config)

	// Start the session
	if err := session.Start(m.ctx, m.binaryPath, m.emitter); err != nil {
		return "", fmt.Errorf("failed to start session: %w", err)
	}

	// Store the session
	m.sessions[session.ID] = session

	return session.ID, nil
}

// TerminateSession terminates a specific session by ID
func (m *SessionManager) TerminateSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.IsRunning() {
		return fmt.Errorf("session is not running: %s", sessionID)
	}

	return session.Terminate()
}

// TerminateByProject terminates all sessions for a specific project path
func (m *SessionManager) TerminateByProject(projectPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var lastErr error
	terminated := 0

	for _, session := range m.sessions {
		if session.Config.ProjectPath == projectPath && session.IsRunning() {
			if err := session.Terminate(); err != nil {
				lastErr = err
			} else {
				terminated++
			}
		}
	}

	if terminated == 0 {
		return fmt.Errorf("no running sessions found for project: %s", projectPath)
	}

	return lastErr
}

// IsRunning checks if a specific session is running
func (m *SessionManager) IsRunning(sessionID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return false
	}

	return session.IsRunning()
}

// IsRunningForProject checks if any session is running for a specific project
func (m *SessionManager) IsRunningForProject(projectPath string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, session := range m.sessions {
		if session.Config.ProjectPath == projectPath && session.IsRunning() {
			return true
		}
	}

	return false
}

// GetSessionOutput returns the output of a specific session
func (m *SessionManager) GetSessionOutput(sessionID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}

	return session.GetOutput(), nil
}

// ListRunningSessions returns a list of all running sessions
func (m *SessionManager) ListRunningSessions() []*SessionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*SessionStatus
	for _, session := range m.sessions {
		if session.IsRunning() {
			result = append(result, &SessionStatus{
				SessionID:   session.ID,
				ProjectPath: session.Config.ProjectPath,
				Model:       session.Config.Model,
				Status:      session.Status,
				StartedAt:   session.StartedAt,
				PID:         session.GetPID(),
			})
		}
	}

	return result
}

// CleanupCompleted removes completed sessions from memory
func (m *SessionManager) CleanupCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, session := range m.sessions {
		if !session.IsRunning() {
			delete(m.sessions, id)
		}
	}
}
