// internal/pty/session.go
package pty

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	gopty "github.com/aymanbagabas/go-pty"
)

// Shell type constants
const (
	ShellTypeBash = "bash"
	ShellTypeZsh  = "zsh"
	ShellTypeFish = "fish"
	ShellTypeSh   = "sh"
)

// Cached default shell to avoid repeated file system checks
var (
	cachedDefaultShell     string
	cachedDefaultShellOnce sync.Once
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

// getShellType determines the shell type from the shell path
func getShellType(shellPath string) string {
	base := strings.ToLower(filepath.Base(shellPath))
	switch {
	case strings.Contains(base, "zsh"):
		return ShellTypeZsh
	case strings.Contains(base, "bash"):
		return ShellTypeBash
	case strings.Contains(base, "fish"):
		return ShellTypeFish
	default:
		return ShellTypeSh
	}
}

// buildShellArgs builds optimized shell arguments based on shell type
// Uses --rcfile for bash and ZDOTDIR for zsh to avoid full login shell initialization
func (s *Session) buildShellArgs() []string {
	shellType := getShellType(s.Shell)

	switch shellType {
	case ShellTypeBash:
		// Use --rcfile to load only .bashrc, avoiding full login shell initialization
		// This is faster than -l which loads /etc/profile, ~/.bash_profile, etc.
		bashrc := filepath.Join(os.Getenv("HOME"), ".bashrc")
		if _, err := os.Stat(bashrc); err == nil {
			return []string{"--rcfile", bashrc}
		}
		// Fallback to interactive mode if no .bashrc
		return []string{"-i"}

	case ShellTypeZsh:
		// For zsh, we use interactive mode without login shell
		// The ZDOTDIR environment variable will be set to control which configs are loaded
		return []string{"-i"}

	case ShellTypeFish:
		// Fish uses -i for interactive, -l for login
		// Interactive mode is sufficient and faster
		return []string{"-i"}

	default:
		// For sh and unknown shells, use interactive mode
		return []string{"-i"}
	}
}

// buildShellEnv builds the environment variables for the shell
func (s *Session) buildShellEnv() []string {
	env := os.Environ()
	env = append(env, "TERM=xterm-256color")

	shellType := getShellType(s.Shell)

	// For zsh, we can optionally set ZDOTDIR to a minimal config directory
	// For now, we just ensure the shell starts in interactive mode
	if shellType == ShellTypeZsh {
		// Optionally: Set ZDOTDIR to a minimal config directory for even faster startup
		// env = append(env, "ZDOTDIR=/path/to/minimal/zsh/config")
	}

	return env
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

	// Build optimized shell arguments based on shell type
	// This avoids full login shell initialization which can be slow
	args := s.buildShellArgs()
	cmd := p.Command(s.Shell, args...)
	cmd.Dir = s.Cwd
	cmd.Env = s.buildShellEnv()

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

// detectDefaultShell finds the default shell (internal, not cached)
func detectDefaultShell() string {
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

// getDefaultShell returns the cached default shell path
// This avoids repeated file system checks on each terminal creation
func getDefaultShell() string {
	cachedDefaultShellOnce.Do(func() {
		cachedDefaultShell = detectDefaultShell()
	})
	return cachedDefaultShell
}
