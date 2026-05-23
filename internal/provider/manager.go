package provider

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// Manager 是所有 provider 的统一会话管理器。
type Manager struct {
	ctx      context.Context
	drivers  map[string]ProviderDriver
	sessions map[string]*Session
	binaries map[string]string
	monitor  *Monitor
	emitter  EventEmitter
	mu       sync.RWMutex
}

// NewManager 创建统一 provider manager。
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

// RegisterDriver 注册一个 provider driver。
func (m *Manager) RegisterDriver(d ProviderDriver) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.drivers[d.ID()]; exists {
		return fmt.Errorf("driver %q already registered", d.ID())
	}
	m.drivers[d.ID()] = d
	return nil
}

// StartSession 启动一个新的 provider 会话。
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

// TerminateSession 终止指定会话。
func (m *Manager) TerminateSession(sessionID string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.terminate()
}

// TerminateByProject 终止指定 provider 在指定项目下的会话。
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

// SendMessage 向会话发送消息，由 driver 决定策略。
// 如果会话已结束或正在取消，自动带 resume 重启。
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

// InterruptSession 中断会话当前执行。
func (m *Manager) InterruptSession(sessionID string) error {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	return session.driver.Interrupt(session)
}

// IsRunning 检查会话是否在运行。
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

// IsRunningForProject 检查指定 provider 在指定项目下是否有运行中的会话。
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

// GetSessionOutput 获取会话的输出内容。
func (m *Manager) GetSessionOutput(sessionID string) (string, error) {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return session.Output(), nil
}

// GetSession 获取会话状态。
func (m *Manager) GetSession(sessionID string) *SessionStatus {
	m.mu.RLock()
	session, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	return session.Status()
}

// ListRunningSessions 列出指定 provider 的运行中会话。
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

// ListAllSessions 列出所有运行中的会话。
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

// DiscoverBinary 发现指定 provider 的二进制路径。
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

// SetBinaryPath 手动设置 provider 的二进制路径（用于测试或用户配置）。
func (m *Manager) SetBinaryPath(providerID, path string) {
	m.mu.Lock()
	m.binaries[providerID] = path
	m.mu.Unlock()
}

// Shutdown 终止所有会话并停止监控。
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
