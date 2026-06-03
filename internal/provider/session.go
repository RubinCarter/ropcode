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
	activity        SessionActivity
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
	before, after := s.setState(StateStarting)
	s.emitActivityChanged(before, after)

	binaryPath := s.binaryPath
	if binaryPath == "" {
		var err error
		binaryPath, err = DiscoverBinary(s.driver.BinaryName(), s.driver.BinaryCandidates())
		if err != nil {
			before, after := s.setState(StateFailed)
			s.emitActivityChanged(before, after)
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
		before, after := s.setState(StateFailed)
		s.emitActivityChanged(before, after)
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		before, after := s.setState(StateFailed)
		s.emitActivityChanged(before, after)
		return fmt.Errorf("stderr pipe: %w", err)
	}

	var stdin io.WriteCloser
	if s.config.Interactive {
		stdin, err = cmd.StdinPipe()
		if err != nil {
			before, after := s.setState(StateFailed)
			s.emitActivityChanged(before, after)
			return fmt.Errorf("stdin pipe: %w", err)
		}
	}

	if err := sessionproc.Start(cmd); err != nil {
		before, after := s.setState(StateFailed)
		s.emitActivityChanged(before, after)
		return fmt.Errorf("start process: %w", err)
	}

	s.mu.Lock()
	before = s.activitySnapshotLocked()
	s.cmd = cmd
	s.stdin = stdin
	s.pid = cmd.Process.Pid
	s.state = StateRunning
	s.done = make(chan struct{})
	after = s.activitySnapshotLocked()
	s.mu.Unlock()
	s.emitActivityChanged(before, after)

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
				if s.routeControlResponse(event) {
					continue
				}
				s.updateActivityFromEvent(event)
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
func (s *Session) routeControlResponse(event *OutputEvent) bool {
	if event.Type == "system" && event.Subtype == "init" {
		s.MarkInitialized()
		return false
	}

	if event.Message == nil {
		return false
	}
	// request_id may be at top level or nested inside "response" object
	requestID, _ := event.Message["request_id"].(string)
	if requestID == "" {
		if resp, ok := event.Message["response"].(map[string]interface{}); ok {
			requestID, _ = resp["request_id"].(string)
		}
	}
	if requestID == "" {
		requestID = responseID(event.Message["id"])
	}
	if requestID == "" {
		return event.Subtype == "control_response"
	}
	if requestID == "init_1" {
		s.MarkInitialized()
	}
	delivered := s.DeliverControlResponse(requestID, event.Message)
	return delivered || event.Subtype == "control_response"
}

func responseID(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case int:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case float64:
		if v == float64(int64(v)) {
			return fmt.Sprintf("%d", int64(v))
		}
		return fmt.Sprintf("%v", v)
	default:
		return ""
	}
}

func (s *Session) updateActivityFromEvent(event *OutputEvent) {
	if event == nil || event.Message == nil {
		return
	}
	sidechain := isSidechainMessage(event.Message)

	s.mu.Lock()
	before := s.activitySnapshotLocked()
	activity := before
	status := activity.Status
	threadStatus := activity.ThreadStatus
	turnID := activity.TurnID
	active := activity.Active
	canInterrupt := activity.CanInterrupt

	switch event.Subtype {
	case "session_state_changed":
		if stateValue, ok := event.Message["state"].(string); ok {
			threadStatus = stateValue
			switch stateValue {
			case "running", "requires_action":
				status = SessionActivityActive
				active = true
				canInterrupt = true
			case "idle":
				status = SessionActivityIdle
				active = false
				canInterrupt = false
			}
		}
	case "turn_started":
		status = SessionActivityActive
		active = true
		canInterrupt = true
		if id, ok := nestedString(event.Message, "turn", "id"); ok {
			turnID = id
		}
	case "status_changed":
		if statusType, ok := nestedString(event.Message, "status", "type"); ok {
			threadStatus = statusType
			if sidechain && statusType != "active" {
				break
			}
			switch statusType {
			case "active":
				status = SessionActivityActive
				active = true
				canInterrupt = true
			case "idle", "notLoaded":
				status = SessionActivityIdle
				active = false
				canInterrupt = false
			case "systemError":
				status = SessionActivityError
				active = false
				canInterrupt = false
			}
		}
	}

	if !sidechain && event.Type == "assistant" && hasToolUse(event.Message) {
		status = SessionActivityActive
		active = true
		canInterrupt = true
	}

	if !sidechain && event.Type == "assistant" && hasEndTurn(event.Message) {
		status = SessionActivityIdle
		active = false
		canInterrupt = false
	}

	if !sidechain && (event.Type == "result" || event.Subtype == "result" || event.Subtype == "turn_completed") {
		status = SessionActivityIdle
		active = false
		canInterrupt = false
	}

	s.activity = activity
	s.activity.Status = status
	s.activity.ThreadStatus = threadStatus
	s.activity.TurnID = turnID
	s.activity.Running = s.state == StateRunning || s.state == StateStarting
	s.activity.Active = active
	s.activity.CanInterrupt = canInterrupt
	s.activity.UpdatedAt = time.Now()
	after := s.activitySnapshotLocked()
	s.mu.Unlock()

	s.emitActivityChanged(before, after)
}

func isSidechainMessage(message map[string]interface{}) bool {
	if message == nil {
		return false
	}
	if v, ok := message["isSidechain"].(bool); ok && v {
		return true
	}
	if message["parent_tool_use_id"] != nil || message["parentToolUseID"] != nil || message["parentToolUseId"] != nil {
		return true
	}
	return false
}

func nestedString(m map[string]interface{}, key, child string) (string, bool) {
	nested, ok := m[key].(map[string]interface{})
	if !ok {
		return "", false
	}
	value, ok := nested[child].(string)
	return value, ok && value != ""
}

func hasEndTurn(message map[string]interface{}) bool {
	if message == nil {
		return false
	}
	if stopReason, _ := message["stop_reason"].(string); stopReason == "end_turn" {
		return true
	}
	nested, _ := message["message"].(map[string]interface{})
	if stopReason, _ := nested["stop_reason"].(string); stopReason == "end_turn" {
		return true
	}
	return false
}

func hasToolUse(message map[string]interface{}) bool {
	return messageHasContentType(message, "tool_use", "server_tool_use")
}

func messageHasContentType(message map[string]interface{}, types ...string) bool {
	if message == nil {
		return false
	}
	nested, _ := message["message"].(map[string]interface{})
	if contentHasType(nested["content"], types...) {
		return true
	}
	return contentHasType(message["content"], types...)
}

func contentHasType(content interface{}, types ...string) bool {
	for _, block := range contentBlocks(content) {
		blockType, _ := block["type"].(string)
		for _, expected := range types {
			if blockType == expected {
				return true
			}
		}
	}
	return false
}

func contentBlocks(content interface{}) []map[string]interface{} {
	switch v := content.(type) {
	case []interface{}:
		blocks := make([]map[string]interface{}, 0, len(v))
		for _, item := range v {
			if block, ok := item.(map[string]interface{}); ok {
				blocks = append(blocks, block)
			}
		}
		return blocks
	case []map[string]interface{}:
		return v
	default:
		return nil
	}
}

func (s *Session) extractProviderSessionID(event *OutputEvent) {
	identifier, ok := s.driver.(ProviderSessionIdentifier)
	if !ok {
		return
	}
	if sid := identifier.ProviderSessionID(event); sid != "" {
		s.SetProviderSessionID(sid)
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
	before := s.activitySnapshotLocked()
	prevState := s.state
	if prevState == StateCancelling {
		s.state = StateCancelled
	} else if exitCode == 0 {
		s.state = StateCompleted
	} else {
		s.state = StateFailed
	}
	s.activity = s.activitySnapshotLocked()
	if exitCode == 0 || prevState == StateCancelling {
		s.activity.Status = SessionActivityIdle
		s.activity.Error = ""
	} else {
		s.activity.Status = SessionActivityError
		if err != nil {
			s.activity.Error = err.Error()
		}
	}
	s.activity.Active = false
	s.activity.CanInterrupt = false
	s.activity.Running = false
	s.activity.UpdatedAt = time.Now()
	after := s.activitySnapshotLocked()
	s.mu.Unlock()
	s.emitActivityChanged(before, after)

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
	before := s.activitySnapshotLocked()
	s.state = StateCancelling
	s.activity = s.activitySnapshotLocked()
	s.activity.Status = SessionActivityIdle
	s.activity.Active = false
	s.activity.CanInterrupt = false
	s.activity.UpdatedAt = time.Now()
	after := s.activitySnapshotLocked()
	done := s.done
	s.mu.Unlock()
	s.emitActivityChanged(before, after)

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

func (s *Session) GetSessionID() string {
	return s.ID
}

func (s *Session) GetProviderSessionID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.providerSessionID
}

func (s *Session) SetProviderSessionID(id string) {
	s.mu.Lock()
	before := s.activitySnapshotLocked()
	s.providerSessionID = id
	after := s.activitySnapshotLocked()
	s.mu.Unlock()
	s.emitActivityChanged(before, after)
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

func (s *Session) Activity() *SessionActivity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	activity := s.activitySnapshotLocked()
	return &activity
}

func (s *Session) MarkActivityActive() {
	s.mu.Lock()
	before := s.activitySnapshotLocked()
	running := s.state == StateRunning || s.state == StateStarting
	s.activity.SessionID = s.ID
	s.activity.ProviderID = s.driver.ID()
	s.activity.ProviderSessionID = s.providerSessionID
	s.activity.ProjectPath = s.config.ProjectPath
	s.activity.Status = SessionActivityActive
	s.activity.Running = running
	s.activity.Active = running
	s.activity.CanInterrupt = running
	s.activity.UpdatedAt = time.Now()
	after := s.activitySnapshotLocked()
	s.mu.Unlock()
	s.emitActivityChanged(before, after)
}

func (s *Session) defaultActivity() SessionActivity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.defaultActivityLocked()
}

func (s *Session) defaultActivityLocked() SessionActivity {
	running := s.state == StateRunning || s.state == StateStarting
	status := SessionActivityIdle
	if !running {
		status = SessionActivityIdle
	} else if !s.config.Interactive {
		status = SessionActivityActive
	}
	return SessionActivity{
		SessionID:         s.ID,
		ProviderID:        s.driver.ID(),
		ProviderSessionID: s.providerSessionID,
		ProjectPath:       s.config.ProjectPath,
		Status:            status,
		Running:           running,
		Active:            running && !s.config.Interactive,
		CanInterrupt:      running && !s.config.Interactive,
		UpdatedAt:         time.Now(),
	}
}

func (s *Session) setState(state SessionState) (SessionActivity, SessionActivity) {
	s.mu.Lock()
	before := s.activitySnapshotLocked()
	s.state = state
	after := s.activitySnapshotLocked()
	s.mu.Unlock()
	return before, after
}

func (s *Session) activitySnapshotLocked() SessionActivity {
	activity := s.activity
	if activity.Status == "" {
		activity = s.defaultActivityLocked()
	}
	activity.SessionID = s.ID
	activity.ProviderID = s.driver.ID()
	activity.ProviderSessionID = s.providerSessionID
	activity.ProjectPath = s.config.ProjectPath
	activity.Running = s.state == StateRunning || s.state == StateStarting
	if !activity.Running {
		activity.Active = false
		activity.CanInterrupt = false
		if activity.Status == SessionActivityActive {
			activity.Status = SessionActivityIdle
		}
	}
	if activity.UpdatedAt.IsZero() {
		activity.UpdatedAt = time.Now()
	}
	return activity
}

func sessionActivityChanged(before, after SessionActivity) bool {
	return before.SessionID != after.SessionID ||
		before.ProviderID != after.ProviderID ||
		before.ProviderSessionID != after.ProviderSessionID ||
		before.ProjectPath != after.ProjectPath ||
		before.Status != after.Status ||
		before.Running != after.Running ||
		before.Active != after.Active ||
		before.CanInterrupt != after.CanInterrupt ||
		before.ThreadStatus != after.ThreadStatus ||
		before.TurnID != after.TurnID ||
		before.Error != after.Error
}

func (s *Session) emitActivityChanged(before, after SessionActivity) {
	if s.emitter == nil || !sessionActivityChanged(before, after) {
		return
	}
	s.emitter.Emit(ProviderActivityChangedEvent, after)
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

func (s *Session) CancelControlRequest(requestID string) {
	s.mu.Lock()
	delete(s.pendingRequests, requestID)
	s.mu.Unlock()
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
