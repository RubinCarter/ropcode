// internal/process/manager.go
package process

import (
	"context"
	"fmt"
	"os/exec"
	"sync"
)

// Manager manages multiple processes
type Manager struct {
	ctx       context.Context
	processes map[string]*Process
	mu        sync.RWMutex
}

// NewManager creates a new process manager
func NewManager(ctx context.Context) *Manager {
	return &Manager{
		ctx:       ctx,
		processes: make(map[string]*Process),
	}
}

// Spawn starts a new process
func (m *Manager) Spawn(key, command string, args []string, cwd string, env []string) (*Process, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Kill existing process with same key
	if existing, exists := m.processes[key]; exists {
		existing.GracefulShutdown(m.ctx)
		delete(m.processes, key)
	}

	cmd := exec.CommandContext(m.ctx, command, args...)
	cmd.Dir = cwd
	if env != nil {
		cmd.Env = env
	}

	proc := NewProcess(key, cmd)
	if err := proc.Start(); err != nil {
		return nil, err
	}

	m.processes[key] = proc

	// Cleanup goroutine
	go func() {
		proc.Wait()
		m.mu.Lock()
		delete(m.processes, key)
		m.mu.Unlock()
	}()

	return proc, nil
}

// Kill terminates a process by key
func (m *Manager) Kill(key string) error {
	m.mu.RLock()
	proc, exists := m.processes[key]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("process not found: %s", key)
	}

	return proc.GracefulShutdown(m.ctx)
}

// IsAlive checks if a process is running
func (m *Manager) IsAlive(key string) bool {
	m.mu.RLock()
	proc, exists := m.processes[key]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	return proc.IsRunning()
}

// KillAll terminates all processes
func (m *Manager) KillAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	var wg sync.WaitGroup
	for _, proc := range m.processes {
		wg.Add(1)
		go func(p *Process) {
			defer wg.Done()
			p.GracefulShutdown(m.ctx)
		}(proc)
	}
	wg.Wait()

	m.processes = make(map[string]*Process)
}

// List returns all active process keys
func (m *Manager) List() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	keys := make([]string, 0, len(m.processes))
	for key := range m.processes {
		keys = append(keys, key)
	}
	return keys
}

// Get returns a process by key
func (m *Manager) Get(key string) (*Process, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	proc, exists := m.processes[key]
	return proc, exists
}

// Count returns the number of running processes
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.processes)
}
