// internal/process/process.go
package process

import (
	"context"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// Process represents a managed process
type Process struct {
	Key      string
	Provider string
	Cmd      *exec.Cmd
	PID      int

	mu      sync.Mutex
	done    chan struct{}
	running bool
}

// NewProcess creates a new managed process
func NewProcess(key string, cmd *exec.Cmd) *Process {
	return &Process{
		Key:     key,
		Cmd:     cmd,
		done:    make(chan struct{}),
		running: false,
	}
}

// Start starts the process
func (p *Process) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Set process group for proper signal handling
	p.Cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	if err := p.Cmd.Start(); err != nil {
		return err
	}

	p.PID = p.Cmd.Process.Pid
	p.running = true

	// Wait goroutine
	go func() {
		p.Cmd.Wait()
		p.mu.Lock()
		p.running = false
		p.mu.Unlock()
		close(p.done)
	}()

	return nil
}

// IsRunning returns whether the process is running
func (p *Process) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

// Signal sends a signal to the process
func (p *Process) Signal(sig os.Signal) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running || p.Cmd.Process == nil {
		return nil
	}

	return p.Cmd.Process.Signal(sig)
}

// GracefulShutdown attempts to gracefully shutdown the process
func (p *Process) GracefulShutdown(ctx context.Context) error {
	// 1. Try SIGINT first
	p.Signal(syscall.SIGINT)

	select {
	case <-p.done:
		return nil
	case <-time.After(5 * time.Second):
	case <-ctx.Done():
		return ctx.Err()
	}

	// 2. Try SIGTERM
	p.Signal(syscall.SIGTERM)

	select {
	case <-p.done:
		return nil
	case <-time.After(3 * time.Second):
	case <-ctx.Done():
		return ctx.Err()
	}

	// 3. Force SIGKILL
	if p.Cmd.Process != nil {
		return p.Cmd.Process.Kill()
	}
	return nil
}

// Wait waits for the process to exit
func (p *Process) Wait() {
	<-p.done
}

// Done returns a channel that closes when the process exits
func (p *Process) Done() <-chan struct{} {
	return p.done
}
