package provider

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"ropcode/internal/sessionproc"
)

// Session is the generic provider session implementation that also implements SessionHandle.
type Session struct {
	ID      string
	driver  ProviderDriver
	config  SessionConfig
	emitter EventEmitter

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	state  SessionState
	health ProcessHealth
	pid    int

	binaryPath        string
	providerSessionID string
	outputBuf         []byte
	startedAt         time.Time

	msgQueue        []string
	done            chan struct{}
	initDone        chan struct{}
	initialized     bool
	pendingRequests map[string]chan ControlResponse
	mu              sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc

	monitor    *Monitor
	onComplete func(s *Session)
}

var _ SessionHandle = (*Session)(nil)

func newSession(ctx context.Context, id string, driver ProviderDriver, config SessionConfig, emitter EventEmitter, monitor *Monitor, onComplete func(*Session)) *Session {
	sctx, cancel := context.WithCancel(ctx)
	return &Session{
		ID:              id,
		driver:          driver,
		config:          config,
		emitter:         emitter,
		state:           StateCreated,
		health:          HealthOK,
		startedAt:       time.Now(),
		initDone:        make(chan struct{}),
		pendingRequests: make(map[string]chan ControlResponse),
		ctx:             sctx,
		cancel:          cancel,
		monitor:         monitor,
		onComplete:      onComplete,
	}
}

func (s *Session) Start() error {
	s.mu.Lock()
	s.state = StateStarting
	s.mu.Unlock()

	binaryPath := s.binaryPath
	if binaryPath == "" {
		var err error
		binaryPath, err = DiscoverBinary(s.driver.BinaryName(), s.driver.BinaryCandidates())
		if err != nil {
			s.mu.Lock()
			s.state = StateFailed
			s.mu.Unlock()
			return fmt.Errorf("discover binary: %w", err)
		}
	}

	args := s.driver.BuildArgs(s.config)
	env := BuildProcessEnv(s.driver.EnvVars(s.config))

	cmd := exec.CommandContext(s.ctx, binaryPath, args...)
	cmd.Dir = s.config.ProjectPath
	cmd.Env = env
	sessionproc.Configure(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.mu.Lock()
		s.state = StateFailed
		s.mu.Unlock()
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.mu.Lock()
		s.state = StateFailed
		s.mu.Unlock()
		return fmt.Errorf("stderr pipe: %w", err)
	}

	var stdin io.WriteCloser
	if s.config.Interactive {
		stdin, err = cmd.StdinPipe()
		if err != nil {
			s.mu.Lock()
			s.state = StateFailed
			s.mu.Unlock()
			return fmt.Errorf("stdin pipe: %w", err)
		}
	}

	if err := sessionproc.Start(cmd); err != nil {
		s.mu.Lock()
		s.state = StateFailed
		s.mu.Unlock()
		return fmt.Errorf("start process: %w", err)
	}

	s.mu.Lock()
	s.cmd = cmd
	s.stdin = stdin
	s.pid = cmd.Process.Pid
	s.state = StateRunning
	s.done = make(chan struct{})
	s.mu.Unlock()

	if s.monitor != nil {
		s.monitor.Register(s.ID)
	}

	go s.readStream(stdout, "stdout")
	go s.readStream(stderr, "stderr")
	go s.waitForExit()

	if err := s.driver.OnProcessStart(s.ctx, s, s.pid); err != nil {
		s.terminate()
		return fmt.Errorf("on process start: %w", err)
	}

	return nil
}

func (s *Session) readStream(reader io.ReadCloser, streamType string) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		s.mu.Lock()
		s.outputBuf = append(s.outputBuf, line...)
		s.outputBuf = append(s.outputBuf, '\n')
		s.mu.Unlock()

		if s.monitor != nil {
			s.monitor.RecordOutput(s.ID)
		}

		if streamType == "stdout" {
			event := s.driver.ParseOutput(line)
			if event != nil {
				if completer, ok := s.driver.(OutputEventCompleter); ok {
					if completed, merged := completer.CompleteOutputEvent(event, s.config); merged && completed != nil {
						event = completed
					}
				}
				event.SessionID = s.ID
				event.Provider = s.driver.ID()
				s.extractProviderSessionID(event)
				s.routeControlResponse(event)
				event.ProjectPath = s.config.ProjectPath
				event.Cwd = s.config.ProjectPath
				event.ProviderSessionID = s.GetProviderSessionID()
				if s.emitter != nil {
					s.emitter.Emit("provider-output", event)
				}
			}
		} else {
			event := s.driver.ParseStderr(line)
			if event != nil && s.emitter != nil {
				s.emitter.Emit("claude-error", map[string]interface{}{
					"session_id": s.ID,
					"provider":   s.driver.ID(),
					"level":      event.Level,
					"message":    event.Message,
				})
			}
		}
	}
}

// routeControlResponse checks if the event is a control_response or an initialization signal.
func (s *Session) routeControlResponse(event *OutputEvent) {
	// Codex: thread_created means init is complete
	if event.Subtype == "thread_created" {
		s.MarkInitialized()
		return
	}

	if event.Subtype != "control_response" || event.Message == nil {
		return
	}
	// request_id may be at top level or nested inside "response" object
	requestID, _ := event.Message["request_id"].(string)
	if requestID == "" {
		if resp, ok := event.Message["response"].(map[string]interface{}); ok {
			requestID, _ = resp["request_id"].(string)
		}
	}
	if requestID == "" {
		return
	}
	if requestID == "init_1" {
		s.MarkInitialized()
	}
	s.DeliverControlResponse(requestID, event.Message)
}

func (s *Session) extractProviderSessionID(event *OutputEvent) {
	if event.Message == nil {
		return
	}
	switch s.driver.ID() {
	case "claude":
		if event.Subtype == "init" {
			if sid, ok := event.Message["session_id"].(string); ok {
				s.mu.Lock()
				s.providerSessionID = sid
				s.mu.Unlock()
			}
		}
	case "codex":
		if event.Subtype == "init" {
			if tid, ok := event.Message["thread_id"].(string); ok {
				s.mu.Lock()
				s.providerSessionID = tid
				s.mu.Unlock()
			}
		}
		if event.Subtype == "thread_created" {
			if tid, ok := event.Message["thread_id"].(string); ok {
				s.mu.Lock()
				s.providerSessionID = tid
				s.mu.Unlock()
			}
		}
	case "gemini":
		if event.Subtype == "init" {
			if sid, ok := event.Message["session_id"].(string); ok {
				s.mu.Lock()
				s.providerSessionID = sid
				s.mu.Unlock()
			}
		}
	case "deepseek":
		if event.Subtype == "session_capture" {
			if content, ok := event.Message["content"].(string); ok {
				s.mu.Lock()
				s.providerSessionID = content
				s.mu.Unlock()
			}
		}
		if event.Subtype == "metadata" {
			if meta, ok := event.Message["meta"].(map[string]interface{}); ok {
				if sid, ok := meta["session_id"].(string); ok {
					s.mu.Lock()
					s.providerSessionID = sid
					s.mu.Unlock()
				}
			}
		}
	}
}

func (s *Session) waitForExit() {
	err := s.cmd.Wait()
	sessionproc.Cleanup(s.cmd)
	close(s.done)

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	s.mu.Lock()
	prevState := s.state
	if prevState == StateCancelling {
		s.state = StateCancelled
	} else if exitCode == 0 {
		s.state = StateCompleted
	} else {
		s.state = StateFailed
	}
	s.mu.Unlock()

	if s.monitor != nil {
		s.monitor.Unregister(s.ID)
	}

	if s.emitter != nil {
		s.emitter.Emit("claude-complete", map[string]interface{}{
			"session_id": s.ID,
			"provider":   s.driver.ID(),
			"exit_code":  exitCode,
		})
	}

	s.driver.OnProcessExit(s, exitCode, err)

	if s.onComplete != nil {
		s.onComplete(s)
	}
}

func (s *Session) terminate() error {
	s.mu.Lock()
	if s.state != StateRunning && s.state != StateStarting {
		s.mu.Unlock()
		return nil
	}
	s.state = StateCancelling
	done := s.done
	s.mu.Unlock()

	if s.cmd != nil && s.cmd.Process != nil {
		sessionproc.Terminate(s.cmd, done)
	}
	return nil
}

// === SessionHandle interface implementation ===

func (s *Session) WriteStdin(data []byte) error {
	s.mu.RLock()
	stdin := s.stdin
	s.mu.RUnlock()
	if stdin == nil {
		return fmt.Errorf("stdin not available")
	}
	_, err := stdin.Write(data)
	return err
}

func (s *Session) Kill() error {
	return s.terminate()
}

func (s *Session) EnqueueMessage(msg string) {
	s.mu.Lock()
	s.msgQueue = append(s.msgQueue, msg)
	s.mu.Unlock()
}

func (s *Session) DequeueMessage() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.msgQueue) == 0 {
		return "", false
	}
	msg := s.msgQueue[0]
	s.msgQueue = s.msgQueue[1:]
	return msg, true
}

func (s *Session) RestartWithConfig(config SessionConfig) error {
	s.mu.Lock()
	s.config = config
	s.state = StateCreated
	s.outputBuf = nil
	s.mu.Unlock()
	return s.Start()
}

func (s *Session) GetState() SessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Session) GetProviderSessionID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.providerSessionID
}

func (s *Session) SetProviderSessionID(id string) {
	s.mu.Lock()
	s.providerSessionID = id
	s.mu.Unlock()
}

func (s *Session) GetConfig() SessionConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config
}

func (s *Session) Status() *SessionStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &SessionStatus{
		SessionID:         s.ID,
		ProviderID:        s.driver.ID(),
		ProviderSessionID: s.providerSessionID,
		ProviderApiID:     s.config.ProviderApiID,
		ProjectPath:       s.config.ProjectPath,
		Model:             s.config.Model,
		Status:            string(s.state),
		Health:            string(s.health),
		StartedAt:         s.startedAt,
		PID:               s.pid,
		Extra:             s.config.Extra,
	}
}

func (s *Session) Output() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.outputBuf)
}

// UpdateConfig atomically updates the session config.
func (s *Session) UpdateConfig(fn func(*SessionConfig)) {
	s.mu.Lock()
	fn(&s.config)
	s.mu.Unlock()
}

// SendControlRequest sends a control request and registers a response waiter.
// The caller receives the response via the returned channel and must handle timeout itself.
func (s *Session) SendControlRequest(requestID string, payload []byte) (<-chan ControlResponse, error) {
	ch := make(chan ControlResponse, 1)

	s.mu.Lock()
	s.pendingRequests[requestID] = ch
	s.mu.Unlock()

	if err := s.WriteStdin(payload); err != nil {
		s.mu.Lock()
		delete(s.pendingRequests, requestID)
		s.mu.Unlock()
		return nil, err
	}

	return ch, nil
}

// DeliverControlResponse routes a received control_response to the waiting caller.
// Called by readStream when a control_response is parsed.
func (s *Session) DeliverControlResponse(requestID string, data map[string]interface{}) bool {
	s.mu.Lock()
	ch, ok := s.pendingRequests[requestID]
	if ok {
		delete(s.pendingRequests, requestID)
	}
	s.mu.Unlock()

	if ok {
		ch <- ControlResponse{Data: data}
		close(ch)
		return true
	}
	return false
}

// MarkInitialized marks the session initialized. The visible system init frame
// comes from Claude's own stdout; control_response only unblocks startup.
func (s *Session) MarkInitialized() {
	s.mu.Lock()
	if !s.initialized {
		s.initialized = true
		close(s.initDone)
	}
	s.mu.Unlock()
}

// WaitForInit waits for the session to complete initialization.
func (s *Session) WaitForInit(timeout time.Duration) error {
	select {
	case <-s.initDone:
		return nil
	case <-s.done:
		return fmt.Errorf("session exited before initialization")
	case <-time.After(timeout):
		return fmt.Errorf("session init timeout after %v", timeout)
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
