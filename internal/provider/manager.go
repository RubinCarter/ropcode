package provider

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const FreshSessionSentinel = "__ROP_FRESH_SESSION__"

// Manager is the unified session manager for all providers.
type Manager struct {
	ctx             context.Context
	drivers         map[string]ProviderDriver
	sessions        map[string]*Session
	binaries        map[string]string
	capabilityCache map[string]CapabilityLayers
	monitor         *Monitor
	emitter         EventEmitter
	mu              sync.RWMutex
}

// NewManager creates a unified provider manager.
func NewManager(ctx context.Context, emitter EventEmitter, monitorCfg *MonitorConfig) *Manager {
	m := &Manager{
		ctx:             ctx,
		drivers:         make(map[string]ProviderDriver),
		sessions:        make(map[string]*Session),
		binaries:        make(map[string]string),
		capabilityCache: make(map[string]CapabilityLayers),
		emitter:         emitter,
	}
	if monitorCfg != nil {
		m.monitor = NewMonitor(ctx, *monitorCfg, m.onHealthChanged)
	} else {
		m.monitor = NewMonitor(ctx, DefaultMonitorConfig(), m.onHealthChanged)
	}
	return m
}

func (m *Manager) GetProviderCapabilities(providerID, projectPath string) (CapabilityLayers, error) {
	key := capabilityCacheKey(providerID, projectPath)
	m.mu.RLock()
	if cached, ok := m.capabilityCache[key]; ok {
		m.mu.RUnlock()
		return cloneCapabilityLayers(cached), nil
	}
	m.mu.RUnlock()
	return m.discoverProviderCapabilities(providerID, projectPath, false)
}

func (m *Manager) RefreshProviderCapabilities(providerID, projectPath string) (CapabilityLayers, error) {
	return m.discoverProviderCapabilities(providerID, projectPath, true)
}

func (m *Manager) CachedProviderCapabilities(providerID, projectPath string) (CapabilityLayers, bool) {
	key := capabilityCacheKey(providerID, projectPath)
	m.mu.RLock()
	cached, ok := m.capabilityCache[key]
	m.mu.RUnlock()
	if !ok {
		return CapabilityLayers{}, false
	}
	return cloneCapabilityLayers(cached), true
}

func (m *Manager) SaveProviderCapability(providerID string, capability Capability, projectPath string) error {
	driver, err := m.driver(providerID)
	if err != nil {
		return err
	}
	editor, ok := driver.(ProviderCapabilityEditor)
	if !ok {
		return fmt.Errorf("provider %s does not support editable capabilities", providerID)
	}
	capability.Provider = providerID
	if err := editor.SaveProviderCapability(m.ctx, capability, projectPath); err != nil {
		return err
	}
	m.invalidateCapabilityCache(providerID, projectPath)
	return nil
}

func (m *Manager) DeleteProviderCapability(providerID string, capability Capability, projectPath string) error {
	driver, err := m.driver(providerID)
	if err != nil {
		return err
	}
	editor, ok := driver.(ProviderCapabilityEditor)
	if !ok {
		return fmt.Errorf("provider %s does not support editable capabilities", providerID)
	}
	capability.Provider = providerID
	if err := editor.DeleteProviderCapability(m.ctx, capability, projectPath); err != nil {
		return err
	}
	m.invalidateCapabilityCache(providerID, projectPath)
	return nil
}

func (m *Manager) invalidateCapabilityCache(providerID, projectPath string) {
	m.mu.Lock()
	delete(m.capabilityCache, capabilityCacheKey(providerID, projectPath))
	delete(m.capabilityCache, capabilityCacheKey(providerID, ""))
	m.mu.Unlock()
}

func (m *Manager) discoverProviderCapabilities(providerID, projectPath string, force bool) (CapabilityLayers, error) {
	driver, err := m.driver(providerID)
	if err != nil {
		return CapabilityLayers{}, err
	}

	layers := EmptyCapabilityLayers(providerID)
	if discoverer, ok := driver.(ProviderCapabilityDiscoverer); ok {
		discovered, err := discoverer.DiscoverProviderCapabilities(m.ctx, projectPath, force)
		if err != nil {
			return CapabilityLayers{}, err
		}
		layers = discovered
		if layers.FetchedAt.IsZero() {
			layers.FetchedAt = time.Now().UTC()
		}
	}

	key := capabilityCacheKey(providerID, projectPath)
	m.mu.Lock()
	m.capabilityCache[key] = cloneCapabilityLayers(layers)
	m.mu.Unlock()
	return cloneCapabilityLayers(layers), nil
}

func capabilityCacheKey(providerID, projectPath string) string {
	return strings.TrimSpace(providerID) + "::" + strings.TrimSpace(projectPath)
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

// EnsureUserSession starts, resumes, or reuses the provider's user-facing session.
// Provider-specific mode selection, config normalization, initialization, and
// first-message delivery are owned here so callers do not branch per provider.
func (m *Manager) EnsureUserSession(providerID string, config SessionConfig) (string, error) {
	driver, err := m.driver(providerID)
	if err != nil {
		return "", err
	}
	m.prepareSessionConfig(driver, &config)

	initialPrompt := config.Prompt
	longLived := useLongLivedSession(driver, config)
	config.Interactive = longLived
	if longLived {
		config.Prompt = ""
	}

	forceFresh := config.ResumeSessionID == FreshSessionSentinel
	if forceFresh {
		config.ResumeSessionID = ""
		config.Resume = false
	}

	if longLived {
		existing := ""
		if config.ResumeSessionID != "" {
			existing = m.ResolveRunningSessionID(providerID, config.ProjectPath, config.ResumeSessionID)
		} else {
			existing = m.GetRunningSessionForProject(providerID, config.ProjectPath)
		}
		if existing != "" {
			if !forceFresh {
				m.applyRuntimeConfig(existing, config)
				if initialPrompt != "" {
					if err := m.SendMessage(existing, initialPrompt); err != nil {
						return "", err
					}
				}
				return existing, nil
			}
			_ = m.TerminateSession(existing)
		}
	}

	sessionID, err := m.StartSession(providerID, config)
	if err != nil {
		return "", err
	}
	if !longLived {
		return sessionID, nil
	}

	sessionID, err = m.waitForProviderSessionInit(providerID, sessionID, config)
	if err != nil {
		return "", err
	}
	if initialPrompt != "" {
		if err := m.SendMessage(sessionID, initialPrompt); err != nil {
			return "", err
		}
	}
	return sessionID, nil
}

func (m *Manager) applyRuntimeConfig(sessionID string, config SessionConfig) {
	if config.Model != "" {
		_ = m.SetModel(sessionID, config.Model)
	}
	vars := make(map[string]string)
	if config.AuthToken != "" {
		vars["AUTH_TOKEN"] = config.AuthToken
	}
	if config.BaseURL != "" {
		vars["BASE_URL"] = config.BaseURL
	}
	if len(vars) > 0 {
		_ = m.UpdateEnvironmentVariables(sessionID, vars)
	}
}

// SendUserMessage resolves either a runtime ID or provider-native
// session ID, then sends the message through the active provider session.
func (m *Manager) SendUserMessage(providerID, projectPath, sessionID, message string) (string, error) {
	if resolved := m.ResolveRunningSessionID(providerID, projectPath, sessionID); resolved != "" {
		sessionID = resolved
		if err := m.SendMessage(sessionID, message); err != nil {
			return "", err
		}
		return sessionID, nil
	}
	if sessionID == "" {
		return "", fmt.Errorf("session not found")
	}

	config, ok := m.resumeConfigForSessionMessage(providerID, projectPath, sessionID, message)
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return m.EnsureUserSession(providerID, config)
}

func (m *Manager) resumeConfigForSessionMessage(providerID, projectPath, sessionID, message string) (SessionConfig, bool) {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	if ok {
		m.mu.RUnlock()
		config := session.GetConfig()
		config.Prompt = message
		config.Resume = true
		if providerSessionID := session.GetProviderSessionID(); providerSessionID != "" {
			config.ResumeSessionID = providerSessionID
		}
		if config.Extra != nil {
			config.Extra = cloneStringMap(config.Extra)
		}
		return config, true
	}
	m.mu.RUnlock()

	if providerID == "" || projectPath == "" {
		return SessionConfig{}, false
	}
	return SessionConfig{
		ProjectPath:     projectPath,
		Prompt:          message,
		Resume:          true,
		ResumeSessionID: sessionID,
	}, true
}

func cloneStringMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// IsProviderSessionRunningForProject checks either a provider ID, runtime ID,
// or provider-native ID without callers knowing which identifier they hold.
func (m *Manager) IsProviderSessionRunningForProject(projectPath, providerOrSessionID string) bool {
	if providerOrSessionID == "" {
		m.mu.RLock()
		defer m.mu.RUnlock()
		for _, s := range m.sessions {
			if s.config.ProjectPath != projectPath {
				continue
			}
			state := s.GetState()
			if state == StateRunning || state == StateStarting {
				return true
			}
		}
		return false
	}
	if m.ResolveRunningSessionID("", projectPath, providerOrSessionID) != "" {
		return true
	}
	return m.IsRunningForProject(providerOrSessionID, projectPath)
}

// QueryProviderSessionActivityForProject resolves either a provider ID,
// runtime ID, or provider-native session ID and returns the provider-owned
// activity snapshot. Native query APIs are hidden behind the driver interface.
func (m *Manager) QueryProviderSessionActivityForProject(projectPath, providerOrSessionID string, timeout time.Duration) (*SessionActivity, error) {
	session := m.resolveSession(projectPath, providerOrSessionID)
	if session == nil {
		return &SessionActivity{Status: SessionActivityIdle}, nil
	}

	activity := session.Activity()
	queried, err := session.driver.QuerySessionActivity(session, timeout)
	if err != nil {
		return activity, err
	}
	if queried != nil {
		activity = mergeSessionActivity(activity, queried)
	}
	return activity, nil
}

func (m *Manager) resolveSession(projectPath, providerOrSessionID string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if providerOrSessionID != "" {
		if s, ok := m.sessions[providerOrSessionID]; ok {
			if projectPath == "" || s.config.ProjectPath == projectPath {
				return s
			}
		}
		for _, s := range m.sessions {
			if projectPath != "" && s.config.ProjectPath != projectPath {
				continue
			}
			if s.driver.ID() == providerOrSessionID || s.GetProviderSessionID() == providerOrSessionID {
				state := s.GetState()
				if state == StateRunning || state == StateStarting {
					return s
				}
			}
		}
		return nil
	}
	for _, s := range m.sessions {
		if s.config.ProjectPath != projectPath {
			continue
		}
		state := s.GetState()
		if state == StateRunning || state == StateStarting {
			return s
		}
	}
	return nil
}

func mergeSessionActivity(base *SessionActivity, queried *SessionActivity) *SessionActivity {
	if base == nil {
		return queried
	}
	if queried == nil {
		return base
	}
	if base.Active && !queried.Active && queried.Status == SessionActivityIdle {
		merged := *base
		merged.Running = queried.Running
		if queried.ProviderSessionID != "" {
			merged.ProviderSessionID = queried.ProviderSessionID
		}
		if queried.ThreadStatus != "" {
			merged.ThreadStatus = queried.ThreadStatus
		}
		if !queried.UpdatedAt.IsZero() {
			merged.UpdatedAt = queried.UpdatedAt
		}
		return &merged
	}
	merged := *base
	if queried.Status != "" {
		merged.Status = queried.Status
	}
	merged.Running = queried.Running
	merged.Active = queried.Active
	merged.CanInterrupt = queried.CanInterrupt
	if queried.ThreadStatus != "" {
		merged.ThreadStatus = queried.ThreadStatus
	}
	if queried.TurnID != "" {
		merged.TurnID = queried.TurnID
	}
	if queried.Error != "" {
		merged.Error = queried.Error
	}
	if !queried.UpdatedAt.IsZero() {
		merged.UpdatedAt = queried.UpdatedAt
	}
	return &merged
}

// TerminateByProjectAll terminates all running sessions for a project.
func (m *Manager) TerminateByProjectAll(projectPath string) error {
	m.mu.RLock()
	targets := make([]*Session, 0)
	for _, s := range m.sessions {
		if s.config.ProjectPath == projectPath {
			state := s.GetState()
			if state == StateRunning || state == StateStarting || state == StateCancelling {
				targets = append(targets, s)
			}
		}
	}
	m.mu.RUnlock()
	for _, s := range targets {
		_ = s.terminate()
	}
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
	config.SessionID = sessionID

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

func (m *Manager) driver(providerID string) (ProviderDriver, error) {
	m.mu.RLock()
	driver, ok := m.drivers[providerID]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown provider: %s", providerID)
	}
	return driver, nil
}

func (m *Manager) prepareSessionConfig(driver ProviderDriver, config *SessionConfig) {
	if config.Extra == nil {
		config.Extra = make(map[string]string)
	}
	if preparer, ok := driver.(SessionConfigPreparer); ok {
		preparer.PrepareSessionConfig(config)
	}
}

func useLongLivedSession(driver ProviderDriver, config SessionConfig) bool {
	if mode, ok := driver.(ProviderSessionMode); ok {
		return mode.UseLongLivedSession(config)
	}
	return config.Interactive
}

func (m *Manager) waitForProviderSessionInit(providerID, sessionID string, config SessionConfig) (string, error) {
	err := m.WaitForInit(sessionID, 30*time.Second)
	if err == nil {
		return sessionID, nil
	}
	_ = m.TerminateSession(sessionID)
	if config.ResumeSessionID != "" && isRecoverableInitFailure(err) {
		config.ResumeSessionID = ""
		config.Resume = false
		retryID, retryErr := m.StartSession(providerID, config)
		if retryErr != nil {
			return "", fmt.Errorf("provider session initialization failed: %w", retryErr)
		}
		if retryErr := m.WaitForInit(retryID, 30*time.Second); retryErr != nil {
			_ = m.TerminateSession(retryID)
			return "", fmt.Errorf("provider session initialization failed: %w", retryErr)
		}
		return retryID, nil
	}
	return "", fmt.Errorf("provider session initialization failed: %w", err)
}

func isRecoverableInitFailure(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.HasPrefix(msg, "session init timeout") ||
		strings.HasPrefix(msg, "session exited before initialization")
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
		if err := session.driver.SendMessage(session, message); err != nil {
			return err
		}
		session.MarkActivityActive()
		return nil
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

// ResolveRunningSessionID returns the runtime session ID for an already-running
// session. The input may be either the runtime ID or the provider-native ID
// captured from the provider's init event.
func (m *Manager) ResolveRunningSessionID(providerID, projectPath, sessionID string) string {
	if sessionID == "" {
		return ""
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.sessions[sessionID]; ok {
		state := s.GetState()
		if state == StateRunning || state == StateStarting {
			return s.ID
		}
	}
	for _, s := range m.sessions {
		if providerID != "" && s.driver.ID() != providerID {
			continue
		}
		if projectPath != "" && s.config.ProjectPath != projectPath {
			continue
		}
		state := s.GetState()
		if state != StateRunning && state != StateStarting {
			continue
		}
		if s.GetProviderSessionID() == sessionID {
			return s.ID
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

// --- History API (dispatches to HistoryProvider implementations) ---

func (m *Manager) historyProvider(providerID string) (HistoryProvider, error) {
	m.mu.RLock()
	driver, ok := m.drivers[providerID]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown provider: %s", providerID)
	}
	hp, ok := driver.(HistoryProvider)
	if !ok {
		return nil, fmt.Errorf("provider %s does not support history", providerID)
	}
	return hp, nil
}

func (m *Manager) LoadSessionHistory(providerID, projectID, sessionID string) ([]Message, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.LoadSessionHistory(projectID, sessionID)
}

func (m *Manager) LoadHistoryEvents(providerID, projectID, sessionID string) ([]OutputEvent, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.LoadHistoryEvents(projectID, sessionID)
}

func (m *Manager) ListProviderSessions(providerID, projectPath string) ([]HistorySessionInfo, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.ListProjectSessions(projectPath)
}

func (m *Manager) ListProviderSessionsLimit(providerID, projectPath string, limit int) (HistorySessionsResult, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return HistorySessionsResult{}, err
	}
	return hp.ListProjectSessionsLimit(projectPath, limit)
}

func (m *Manager) GetMessageIndex(providerID, projectID, sessionID string) ([]int, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.GetMessageIndex(projectID, sessionID)
}

func (m *Manager) GetMessagesRange(providerID, projectID, sessionID string, start, end int) ([]Message, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.GetMessagesRange(projectID, sessionID, start, end)
}

func (m *Manager) LoadSubagentTranscripts(providerID, projectID, sessionID string) (map[string][]Message, error) {
	hp, err := m.historyProvider(providerID)
	if err != nil {
		return nil, err
	}
	return hp.LoadSubagentTranscripts(projectID, sessionID)
}
