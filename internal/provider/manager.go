package provider

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Manager is the unified session manager for all providers.
type Manager struct {
	ctx      context.Context
	drivers  map[string]ProviderDriver
	sessions map[string]*Session
	binaries map[string]string
	monitor  *Monitor
	emitter  EventEmitter
	mu       sync.RWMutex
}

// NewManager creates a unified provider manager.
func NewManager(ctx context.Context, emitter EventEmitter, monitorCfg *MonitorConfig) *Manager {
	m := &Manager{
		ctx:      ctx,
		drivers:  make(map[string]ProviderDriver),
		sessions: make(map[string]*Session),
		binaries: make(map[string]string),
		emitter:  emitter,
	}
	if monitorCfg != nil {
		m.monitor = NewMonitor(ctx, *monitorCfg, m.onHealthChanged)
	} else {
		m.monitor = NewMonitor(ctx, DefaultMonitorConfig(), m.onHealthChanged)
	}
	return m
}

// RegisterDriver registers a provider driver.
func (m *Manager) RegisterDriver(d ProviderDriver) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.drivers[d.ID()]; exists {
		return fmt.Errorf("driver %q already registered", d.ID())
	}
	m.drivers[d.ID()] = d
	return nil
}

// StartSession starts a new provider session.
func (m *Manager) StartSession(providerID string, config SessionConfig) (string, error) {
	m.mu.RLock()
	driver, ok := m.drivers[providerID]
	binaryPath := m.binaries[providerID]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("unknown provider: %s", providerID)
	}

	sessionID := config.SessionID
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	session := newSession(m.ctx, sessionID, driver, config, m.emitter, m.monitor, m.onSessionComplete)
	session.binaryPath = binaryPath

	m.mu.Lock()
	m.sessions[sessionID] = session
	m.mu.Unlock()

	if err := session.Start(); err != nil {
		m.mu.Lock()
		delete(m.sessions, sessionID)
		m.mu.Unlock()
		return "", err
	}

	if m.emitter != nil {
		m.emitter.Emit("process:changed", ProcessChangedEvent{
			PID:        session.pid,
			Cwd:        config.ProjectPath,
			State:      "running",
			ProviderID: providerID,
			SessionID:  sessionID,
		})
	}

	return sessionID, nil
}

// TerminateSession terminates the specified session.
func (m *Manager) TerminateSession(sessionID string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.terminate()
}

// TerminateByProject terminates sessions for a given provider and project path.
func (m *Manager) TerminateByProject(providerID, projectPath string) error {
	m.mu.RLock()
	var targets []*Session
	for _, s := range m.sessions {
		if s.driver.ID() == providerID && s.config.ProjectPath == projectPath {
			targets = append(targets, s)
		}
	}
	m.mu.RUnlock()

	for _, s := range targets {
		s.terminate()
	}
	return nil
}

// SendMessage sends a message to a session; the driver decides the strategy.
// If the session has ended or is cancelling, it automatically restarts with resume.
func (m *Manager) SendMessage(sessionID, message string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	state := session.GetState()
	switch state {
	case StateCompleted, StateFailed, StateCancelled:
		config := session.GetConfig()
		config.Prompt = message
		config.ResumeSessionID = session.GetProviderSessionID()
		config.Resume = true
		return session.RestartWithConfig(config)
	case StateCancelling:
		// Wait for process to finish, then restart
		session.EnqueueMessage(message)
		return nil
	default:
		return session.driver.SendMessage(session, message)
	}
}

// InterruptSession interrupts the current execution of a session.
func (m *Manager) InterruptSession(sessionID string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.Interrupt(session)
}

// SetModel switches the session model.
func (m *Manager) SetModel(sessionID, model string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.SetModel(session, model)
}

// SetPermissionMode switches the session permission mode.
func (m *Manager) SetPermissionMode(sessionID, mode string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.SetPermissionMode(session, mode)
}

// UpdateEnvironmentVariables updates the session environment variables.
func (m *Manager) UpdateEnvironmentVariables(sessionID string, vars map[string]string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.UpdateEnvironmentVariables(session, vars)
}

// WaitForInit waits for session initialization to complete.
func (m *Manager) WaitForInit(sessionID string, timeout time.Duration) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.WaitForInit(session, timeout)
}

// WriteStdin writes raw data to the session's stdin (for sending control requests, etc.).
func (m *Manager) WriteStdin(sessionID string, data []byte) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.WriteStdin(data)
}

// GetRunningSessionForProject returns the running session ID for a given provider and project.
func (m *Manager) GetRunningSessionForProject(providerID, projectPath string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		if s.driver.ID() == providerID && s.config.ProjectPath == projectPath {
			state := s.GetState()
			if state == StateRunning || state == StateStarting {
				return s.ID
			}
		}
	}
	return ""
}
func (m *Manager) IsRunning(sessionID string) bool {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	state := session.GetState()
	return state == StateRunning || state == StateStarting
}

// IsRunningForProject checks whether a given provider has a running session in the specified project.
func (m *Manager) IsRunningForProject(providerID, projectPath string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		if s.driver.ID() == providerID && s.config.ProjectPath == projectPath {
			state := s.GetState()
			if state == StateRunning || state == StateStarting {
				return true
			}
		}
	}
	return false
}

// GetSessionOutput returns the output content of a session.
func (m *Manager) GetSessionOutput(sessionID string) (string, error) {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return session.Output(), nil
}

// GetSession returns the session status.
func (m *Manager) GetSession(sessionID string) *SessionStatus {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	return session.Status()
}

// ListRunningSessions lists running sessions for the specified provider.
func (m *Manager) ListRunningSessions(providerID string) []*SessionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var result []*SessionStatus
	for _, s := range m.sessions {
		if s.driver.ID() == providerID {
			state := s.GetState()
			if state == StateRunning || state == StateStarting {
				result = append(result, s.Status())
			}
		}
	}
	return result
}

// ListAllSessions lists all running sessions.
func (m *Manager) ListAllSessions() []*SessionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var result []*SessionStatus
	for _, s := range m.sessions {
		state := s.GetState()
		if state == StateRunning || state == StateStarting {
			result = append(result, s.Status())
		}
	}
	return result
}

// DiscoverBinary discovers the binary path for the specified provider.
func (m *Manager) DiscoverBinary(providerID string) (string, error) {
	m.mu.RLock()
	if cached, ok := m.binaries[providerID]; ok {
		m.mu.RUnlock()
		return cached, nil
	}
	driver, ok := m.drivers[providerID]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("unknown provider: %s", providerID)
	}

	path, err := DiscoverBinary(driver.BinaryName(), driver.BinaryCandidates())
	if err != nil {
		return "", err
	}

	m.mu.Lock()
	m.binaries[providerID] = path
	m.mu.Unlock()
	return path, nil
}

// SetBinaryPath manually sets the binary path for a provider (for testing or user configuration).
func (m *Manager) SetBinaryPath(providerID, path string) {
	m.mu.Lock()
	m.binaries[providerID] = path
	m.mu.Unlock()
}

// Shutdown terminates all sessions and stops the monitor.
func (m *Manager) Shutdown() {
	m.mu.RLock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.RUnlock()

	for _, s := range sessions {
		s.terminate()
	}

	if m.monitor != nil {
		m.monitor.Stop()
	}
}

func (m *Manager) onSessionComplete(s *Session) {
	exitCode := 0
	if s.cmd != nil && s.cmd.ProcessState != nil {
		exitCode = s.cmd.ProcessState.ExitCode()
	}
	if m.emitter != nil {
		m.emitter.Emit("process:changed", ProcessChangedEvent{
			PID:        s.pid,
			Cwd:        s.config.ProjectPath,
			State:      "stopped",
			ExitCode:   &exitCode,
			ProviderID: s.driver.ID(),
			SessionID:  s.ID,
		})
	}
}

func (m *Manager) onHealthChanged(sessionID string, health ProcessHealth) {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	session.mu.Lock()
	session.health = health
	session.mu.Unlock()

	if m.emitter != nil {
		m.emitter.Emit("provider:health", SessionChangedEvent{
			SessionID:  sessionID,
			ProviderID: session.driver.ID(),
			State:      string(session.GetState()),
			Health:     string(health),
		})
	}
}
