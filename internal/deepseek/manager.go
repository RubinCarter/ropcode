package deepseek

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

type SessionManager struct {
	ctx            context.Context
	emitter        EventEmitter
	processEmitter ProcessChangedEmitter
	sessions       map[string]*Session
	binaryPath     string
	mu             sync.RWMutex
}

func NewSessionManager(ctx context.Context, emitter EventEmitter) *SessionManager {
	manager := &SessionManager{
		ctx:      ctx,
		emitter:  emitter,
		sessions: make(map[string]*Session),
	}
	if path, err := manager.discoverBinary(); err == nil {
		manager.binaryPath = path
	}
	return manager
}

func (m *SessionManager) SetBinaryPath(path string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.binaryPath = path
}

func (m *SessionManager) GetBinaryPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.binaryPath
}

func (m *SessionManager) SetProcessEmitter(emitter ProcessChangedEmitter) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processEmitter = emitter
}

func (m *SessionManager) discoverBinary() (string, error) {
	commonPaths := []string{
		"/opt/homebrew/bin/deepseek",
		"/usr/local/bin/deepseek",
		"/usr/bin/deepseek",
		filepath.Join(os.Getenv("HOME"), ".local/bin/deepseek"),
		filepath.Join(os.Getenv("HOME"), ".cargo/bin/deepseek"),
		filepath.Join(os.Getenv("HOME"), ".npm-global/bin/deepseek"),
	}
	if runtime.GOOS == "windows" {
		commonPaths = append(windowsDeepSeekBinaryCandidates(
			os.Getenv("USERPROFILE"),
			os.Getenv("LOCALAPPDATA"),
			os.Getenv("APPDATA"),
			os.Getenv("ProgramData"),
		), commonPaths...)
	}

	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	if path, err := exec.LookPath("deepseek"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("deepseek binary not found in PATH or common locations")
}

func windowsDeepSeekBinaryCandidates(userProfile, localAppData, appData, programData string) []string {
	var candidates []string
	if programData != "" {
		candidates = append(candidates,
			filepath.Join(programData, "npm", "npm", "deepseek.cmd"),
			filepath.Join(programData, "npm", "npm", "deepseek.ps1"),
			filepath.Join(programData, "npm", "deepseek.cmd"),
			filepath.Join(programData, "npm", "deepseek.ps1"),
		)
	}
	if appData != "" {
		candidates = append(candidates,
			filepath.Join(appData, "npm", "deepseek.cmd"),
			filepath.Join(appData, "npm", "deepseek.ps1"),
		)
	}
	if userProfile != "" {
		candidates = append(candidates,
			filepath.Join(userProfile, "AppData", "Roaming", "npm", "deepseek.cmd"),
			filepath.Join(userProfile, "AppData", "Roaming", "npm", "deepseek.ps1"),
			filepath.Join(userProfile, "scoop", "shims", "deepseek.exe"),
			filepath.Join(userProfile, "scoop", "shims", "deepseek.cmd"),
		)
	}
	if localAppData != "" {
		candidates = append(candidates,
			filepath.Join(localAppData, "Microsoft", "WinGet", "Packages", "*", "deepseek.exe"),
			filepath.Join(localAppData, "Programs", "deepseek-tui", "deepseek.exe"),
		)
	}
	candidates = append(candidates,
		`C:\Program Files\deepseek-tui\deepseek.exe`,
		`C:\Program Files\DeepSeek TUI\deepseek.exe`,
	)
	return expandGlobCandidates(candidates)
}

func expandGlobCandidates(candidates []string) []string {
	var expanded []string
	for _, candidate := range candidates {
		matches, err := filepath.Glob(candidate)
		if err == nil && len(matches) > 0 {
			expanded = append(expanded, matches...)
			continue
		}
		expanded = append(expanded, filepath.Clean(candidate))
	}
	return expanded
}

func (m *SessionManager) StartSession(config SessionConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.binaryPath == "" {
		path, err := m.discoverBinary()
		if err != nil {
			return "", fmt.Errorf("deepseek binary not configured: %w", err)
		}
		m.binaryPath = path
	}

	if config.ProjectPath != "" {
		for _, session := range m.sessions {
			if session.Config.ProjectPath == config.ProjectPath && session.IsRunning() {
				return "", fmt.Errorf("a session is already running for project: %s", config.ProjectPath)
			}
		}
	}

	session := NewSession(config)
	if err := session.Start(m.ctx, m.binaryPath, m.emitter, m.processEmitter); err != nil {
		return "", fmt.Errorf("failed to start session: %w", err)
	}
	m.sessions[session.ID] = session
	return session.ID, nil
}

func (m *SessionManager) TerminateSession(sessionID string) error {
	m.mu.RLock()
	session, exists := m.findSessionLocked(sessionID)
	m.mu.RUnlock()
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	if !session.IsRunning() {
		return fmt.Errorf("session is not running: %s", sessionID)
	}
	return session.Terminate()
}

func (m *SessionManager) IsRunning(sessionID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, exists := m.findSessionLocked(sessionID)
	return exists && session.IsRunning()
}

func (m *SessionManager) GetSessionOutput(sessionID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, exists := m.findSessionLocked(sessionID)
	if !exists {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return session.GetOutput(), nil
}

func (m *SessionManager) findSessionLocked(sessionID string) (*Session, bool) {
	session, exists := m.sessions[sessionID]
	if exists {
		return session, true
	}
	for _, session := range m.sessions {
		if session.ID == sessionID {
			return session, true
		}
	}
	return nil, false
}

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

func (m *SessionManager) TerminateByProject(projectPath string) error {
	m.mu.RLock()
	var sessions []*Session
	for _, session := range m.sessions {
		if session.Config.ProjectPath == projectPath && session.IsRunning() {
			sessions = append(sessions, session)
		}
	}
	m.mu.RUnlock()

	if len(sessions) == 0 {
		return fmt.Errorf("no running sessions found for project: %s", projectPath)
	}

	for _, session := range sessions {
		if err := session.Terminate(); err != nil {
			return err
		}
	}
	return nil
}

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

func (m *SessionManager) CleanupCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, session := range m.sessions {
		if !session.IsRunning() {
			delete(m.sessions, id)
		}
	}
}
