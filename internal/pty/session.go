// internal/pty/session.go
package pty

import (
	"io"
	"os"
	"sync"

	gopty "github.com/aymanbagabas/go-pty"
)

// Session represents a PTY terminal session
type Session struct {
	ID    string
	Cwd   string
	Shell string
	Rows  int
	Cols  int

	pty     gopty.Pty
	cmd     *gopty.Cmd
	mu      sync.Mutex
	closed  bool
	started bool // indicates if Start() has completed successfully

	doneCh chan struct{}
}

// NewSession creates a new PTY session
func NewSession(id, cwd string, rows, cols int, shell string) (*Session, error) {
	if shell == "" {
		shell = getDefaultShell()
	}

	s := &Session{
		ID:     id,
		Cwd:    cwd,
		Shell:  shell,
		Rows:   rows,
		Cols:   cols,
		doneCh: make(chan struct{}),
	}

	return s, nil
}

// Start initializes and starts the PTY session
func (s *Session) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p, err := gopty.New()
	if err != nil {
		return err
	}

	// Resize to requested dimensions
	if err := p.Resize(s.Cols, s.Rows); err != nil {
		p.Close()
		return err
	}

	// Use login shell (-l) to load user's shell configuration (.zshrc, .bashrc, etc.)
	// This ensures PATH and other environment variables are properly set
	cmd := p.Command(s.Shell, "-l")
	cmd.Dir = s.Cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	if err := cmd.Start(); err != nil {
		p.Close()
		return err
	}

	s.pty = p
	s.cmd = cmd
	s.started = true

	return nil
}

// Write sends data to the PTY
func (s *Session) Write(data string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed || s.pty == nil || !s.started {
		return io.ErrClosedPipe
	}

	_, err := s.pty.Write([]byte(data))
	return err
}

// IsStarted returns whether the PTY session has started successfully
func (s *Session) IsStarted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.started
}

// Read reads data from the PTY
func (s *Session) Read(buf []byte) (int, error) {
	if s.pty == nil {
		return 0, io.EOF
	}
	return s.pty.Read(buf)
}

// Resize changes the PTY terminal size
func (s *Session) Resize(rows, cols int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pty == nil {
		return nil
	}

	s.Rows = rows
	s.Cols = cols
	return s.pty.Resize(cols, rows)
}

// Close closes the PTY session
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}
	s.closed = true
	close(s.doneCh)

	if s.pty != nil {
		return s.pty.Close()
	}

	return nil
}

// Done returns a channel that is closed when the session ends
func (s *Session) Done() <-chan struct{} {
	return s.doneCh
}

func getDefaultShell() string {
	// First try SHELL environment variable
	if shell := os.Getenv("SHELL"); shell != "" {
		// Verify it exists before using it
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}

	// Common shell locations to try
	shells := []string{
		"/bin/zsh",
		"/usr/bin/zsh",
		"/opt/homebrew/bin/zsh",
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/sh",
		"/usr/bin/sh",
	}

	for _, shell := range shells {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}

	// Last resort
	return "/bin/sh"
}
