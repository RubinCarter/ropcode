// internal/claude/manager.go
package claude

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

func discoverClaudeBinaryPath() (string, error) {
	// First, try to find it in PATH
	if path, err := exec.LookPath("claude"); err == nil {
		return path, nil
	}

	// Common installation locations
	commonPaths := []string{
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
		filepath.Join(os.Getenv("HOME"), ".npm-global/bin/claude"),
		filepath.Join(os.Getenv("HOME"), ".local/bin/claude"),
	}

	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			if err := exec.Command(path, "--version").Run(); err == nil {
				return path, nil
			}
		}
	}

	return "", fmt.Errorf("claude binary not found in PATH or common locations")
}

type SessionManager struct {
	ctx            context.Context
	emitter        EventEmitter
	processEmitter ProcessChangedEmitter
	sessions       map[string]*Session
	binaryPath     string
	mu             sync.RWMutex
}

// NewSessionManager creates a new session manager
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

// SetBinaryPath sets the path to the Claude binary
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

// SetProcessEmitter sets the process changed emitter
func (m *SessionManager) SetProcessEmitter(emitter ProcessChangedEmitter) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processEmitter = emitter
}

// discoverBinary attempts to find the Claude binary in common locations
func (m *SessionManager) discoverBinary() (string, error) {
	return discoverClaudeBinaryPath()
}

// StartSession starts a new Claude session
func (m *SessionManager) StartSession(config SessionConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if binary path is set
	if m.binaryPath == "" {
		path, err := m.discoverBinary()
		if err != nil {
			return "", fmt.Errorf("claude binary not configured: %w", err)
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

	// For interactive mode, auto-populate ResumeClaudeSessionID from the last completed session
	// so conversation history is restored when the user restarts after stopping.
	if config.InteractiveMode && !config.DisableAutoResume && config.ResumeClaudeSessionID == "" && config.ProjectPath != "" {
		for _, session := range m.sessions {
			if session.Config.ProjectPath == config.ProjectPath && !session.IsRunning() && session.IsInteractive() {
				if claudeID := session.GetClaudeSessionID(); claudeID != "" {
					config.ResumeClaudeSessionID = claudeID
					log.Printf("[Manager] Auto-resuming previous Claude conversation: %s", claudeID)
					break
				}
			}
		}
	}

	// Create new session
	session := NewSession(config)

	// Start the session
	if err := session.Start(m.ctx, m.binaryPath, m.emitter, m.processEmitter); err != nil {
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

	runningSessions := make([]*SessionStatus, 0)

	for _, session := range m.sessions {
		if session.IsRunning() {
			runningSessions = append(runningSessions, session.GetStatus())
		}
	}

	return runningSessions
}

// GetSession returns the status of a specific session
func (m *SessionManager) GetSession(sessionID string) *SessionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return nil
	}

	return session.GetStatus()
}

// SendMessage sends a message to a running interactive session
func (m *SessionManager) SendMessage(sessionID, prompt string) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		log.Printf("[SendMessage] Session not found: %s", sessionID)
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.IsRunning() {
		log.Printf("[SendMessage] Session is not running: %s, status=%s", sessionID, session.Status)
		return fmt.Errorf("session is not running: %s", sessionID)
	}

	log.Printf("[SendMessage] Sending message to session %s: %s", sessionID, prompt[:min(50, len(prompt))])
	return session.SendMessage(prompt, m.emitter)
}

// WaitForInit waits for an interactive session to complete initialization
func (m *SessionManager) WaitForInit(sessionID string, timeout time.Duration) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return session.WaitForInit(timeout)
}

// GetInteractiveSessionForProject returns the running interactive session for a project, if any
func (m *SessionManager) GetInteractiveSessionForProject(projectPath string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, session := range m.sessions {
		if session.Config.ProjectPath == projectPath && session.IsRunning() && session.IsInteractive() {
			return session
		}
	}

	return nil
}

// CleanupCompleted removes completed sessions from the manager
func (m *SessionManager) CleanupCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, session := range m.sessions {
		if !session.IsRunning() {
			delete(m.sessions, id)
		}
	}
}
