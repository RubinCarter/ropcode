package ssh

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// SshConnection represents a saved SSH connection configuration
type SshConnection struct {
	Name    string `json:"name"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	KeyPath string `json:"key_path,omitempty"`
}

// SyncState represents the state of an active sync operation
type SyncState struct {
	LocalPath    string
	RemotePath   string
	Connection   string
	IsRunning    bool
	IsPaused     bool
	LastSyncTime time.Time
	Error        string
	cancel       chan struct{}
}

// Manager manages SSH connections and sync operations
type Manager struct {
	ropcodeDir  string
	connections []SshConnection
	syncStates  map[string]*SyncState // keyed by localPath
	mu          sync.RWMutex
}

// NewManager creates a new SSH manager
func NewManager() *Manager {
	homeDir, _ := os.UserHomeDir()
	ropcodeDir := filepath.Join(homeDir, ".ropcode")

	m := &Manager{
		ropcodeDir:  ropcodeDir,
		connections: []SshConnection{},
		syncStates:  make(map[string]*SyncState),
	}

	// Load saved connections
	m.loadConnections()

	return m
}

// configPath returns the path to the SSH connections config file
func (m *Manager) configPath() string {
	return filepath.Join(m.ropcodeDir, "ssh_connections.json")
}

// loadConnections loads saved connections from disk
func (m *Manager) loadConnections() {
	data, err := os.ReadFile(m.configPath())
	if err != nil {
		return // File doesn't exist or can't be read
	}

	var connections []SshConnection
	if err := json.Unmarshal(data, &connections); err != nil {
		return
	}

	m.connections = connections
}

// saveConnections saves connections to disk
func (m *Manager) saveConnections() error {
	// Ensure directory exists
	if err := os.MkdirAll(m.ropcodeDir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(m.connections, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.configPath(), data, 0644)
}

// ListGlobalConnections returns all saved SSH connections
func (m *Manager) ListGlobalConnections() ([]SshConnection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connections, nil
}

// AddGlobalConnection adds a new SSH connection
func (m *Manager) AddGlobalConnection(conn SshConnection) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if conn.Name == "" || conn.Host == "" || conn.User == "" {
		return fmt.Errorf("invalid connection: name, host, and user are required")
	}

	// Set default port
	if conn.Port == 0 {
		conn.Port = 22
	}

	// Check for duplicates
	for _, c := range m.connections {
		if c.Name == conn.Name {
			return fmt.Errorf("connection with name '%s' already exists", conn.Name)
		}
	}

	m.connections = append(m.connections, conn)
	return m.saveConnections()
}

// DeleteGlobalConnection removes a saved SSH connection
func (m *Manager) DeleteGlobalConnection(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, c := range m.connections {
		if c.Name == name {
			m.connections = append(m.connections[:i], m.connections[i+1:]...)
			return m.saveConnections()
		}
	}
	return fmt.Errorf("connection '%s' not found", name)
}

// getConnection looks up a connection by name
func (m *Manager) getConnection(name string) (*SshConnection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, c := range m.connections {
		if c.Name == name {
			return &c, nil
		}
	}
	return nil, fmt.Errorf("connection '%s' not found", name)
}

// buildRsyncArgs builds rsync command arguments for a sync operation
func (m *Manager) buildRsyncArgs(conn *SshConnection, localPath, remotePath string, download bool) []string {
	sshCmd := fmt.Sprintf("ssh -p %d", conn.Port)
	if conn.KeyPath != "" {
		sshCmd += fmt.Sprintf(" -i %s", conn.KeyPath)
	}

	args := []string{
		"-avz",
		"--progress",
		"--delete",
		"-e", sshCmd,
	}

	remote := fmt.Sprintf("%s@%s:%s", conn.User, conn.Host, remotePath)

	if download {
		args = append(args, remote, localPath)
	} else {
		args = append(args, localPath, remote)
	}

	return args
}

// SyncFromSSH downloads files from remote to local using rsync
func (m *Manager) SyncFromSSH(localPath, remotePath, connectionName string) error {
	conn, err := m.getConnection(connectionName)
	if err != nil {
		return err
	}

	args := m.buildRsyncArgs(conn, localPath, remotePath, true)
	cmd := exec.Command("rsync", args...)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rsync failed: %v\n%s", err, string(output))
	}

	return nil
}

// SyncToSSH uploads files from local to remote using rsync
func (m *Manager) SyncToSSH(localPath, remotePath, connectionName string) error {
	conn, err := m.getConnection(connectionName)
	if err != nil {
		return err
	}

	args := m.buildRsyncArgs(conn, localPath, remotePath, false)
	cmd := exec.Command("rsync", args...)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rsync failed: %v\n%s", err, string(output))
	}

	return nil
}

// StartAutoSync starts automatic bidirectional sync using fswatch + rsync
func (m *Manager) StartAutoSync(localPath, remotePath, connectionName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if already running
	if state, exists := m.syncStates[localPath]; exists && state.IsRunning {
		return fmt.Errorf("auto-sync already running for %s", localPath)
	}

	// Verify connection exists
	if _, err := m.getConnection(connectionName); err != nil {
		return err
	}

	// Create sync state
	state := &SyncState{
		LocalPath:    localPath,
		RemotePath:   remotePath,
		Connection:   connectionName,
		IsRunning:    true,
		IsPaused:     false,
		LastSyncTime: time.Now(),
		cancel:       make(chan struct{}),
	}

	m.syncStates[localPath] = state

	// Start background sync goroutine
	go m.runAutoSync(state)

	return nil
}

// runAutoSync runs the auto-sync loop
func (m *Manager) runAutoSync(state *SyncState) {
	ticker := time.NewTicker(5 * time.Second) // Poll every 5 seconds
	defer ticker.Stop()

	for {
		select {
		case <-state.cancel:
			return
		case <-ticker.C:
			if state.IsPaused {
				continue
			}

			// Perform bidirectional sync
			err := m.SyncToSSH(state.LocalPath, state.RemotePath, state.Connection)
			if err != nil {
				state.Error = err.Error()
			} else {
				state.Error = ""
				state.LastSyncTime = time.Now()
			}
		}
	}
}

// StopAutoSync stops automatic sync for a path
func (m *Manager) StopAutoSync(localPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, exists := m.syncStates[localPath]
	if !exists {
		return fmt.Errorf("no auto-sync running for %s", localPath)
	}

	close(state.cancel)
	state.IsRunning = false
	delete(m.syncStates, localPath)

	return nil
}

// PauseSshSync pauses ongoing sync operation
func (m *Manager) PauseSshSync(localPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, exists := m.syncStates[localPath]
	if !exists {
		return fmt.Errorf("no auto-sync running for %s", localPath)
	}

	state.IsPaused = true
	return nil
}

// ResumeSshSync resumes paused sync operation
func (m *Manager) ResumeSshSync(localPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, exists := m.syncStates[localPath]
	if !exists {
		return fmt.Errorf("no auto-sync running for %s", localPath)
	}

	state.IsPaused = false
	return nil
}

// CancelSshSync cancels ongoing sync operation (alias for StopAutoSync)
func (m *Manager) CancelSshSync(localPath string) error {
	return m.StopAutoSync(localPath)
}

// AutoSyncStatus represents the status of auto-sync for a path
type AutoSyncStatus struct {
	ProjectPath  string `json:"project_path"`
	IsRunning    bool   `json:"is_running"`
	IsPaused     bool   `json:"is_paused"`
	LastSyncTime int64  `json:"last_sync_time,omitempty"`
	Error        string `json:"error,omitempty"`
}

// GetAutoSyncStatus returns the auto-sync status for a path
func (m *Manager) GetAutoSyncStatus(localPath string) (*AutoSyncStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	state, exists := m.syncStates[localPath]
	if !exists {
		return &AutoSyncStatus{
			ProjectPath: localPath,
			IsRunning:   false,
		}, nil
	}

	return &AutoSyncStatus{
		ProjectPath:  localPath,
		IsRunning:    state.IsRunning,
		IsPaused:     state.IsPaused,
		LastSyncTime: state.LastSyncTime.Unix(),
		Error:        state.Error,
	}, nil
}
