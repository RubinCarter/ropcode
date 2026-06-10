package eventhub

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ropcode/internal/stream"
)

// Broadcaster 事件广播接口
type Broadcaster interface {
	BroadcastEvent(eventType string, payload interface{})
}

const domainSubscriberBufferSize = 256

// EventHub 统一事件分发中心
type EventHub struct {
	ctx               context.Context
	broadcaster       Broadcaster
	syncHub           *stream.SyncHub
	domainMu          sync.Mutex
	domainSubscribers map[*DomainSubscription]struct{}
	gitDirtyKnown     map[string]bool
	gitDirtyState     map[string]bool
}

// DomainEvent is the stable server-side event envelope for automation.
type DomainEvent struct {
	ID         string            `json:"id"`
	Type       string            `json:"type"`
	Version    int               `json:"version"`
	OccurredAt time.Time         `json:"occurred_at"`
	Source     string            `json:"source"`
	Scope      DomainEventScope  `json:"scope,omitempty"`
	Cause      *DomainEventCause `json:"cause,omitempty"`
	Payload    map[string]any    `json:"payload,omitempty"`
}

type DomainEventScope struct {
	ProjectPath       string `json:"project_path,omitempty"`
	WorkspacePath     string `json:"workspace_path,omitempty"`
	Provider          string `json:"provider,omitempty"`
	SessionID         string `json:"session_id,omitempty"`
	ProviderSessionID string `json:"provider_session_id,omitempty"`
	AgentID           int64  `json:"agent_id,omitempty"`
	AgentRunID        int64  `json:"agent_run_id,omitempty"`
	PID               int    `json:"pid,omitempty"`
	Branch            string `json:"branch,omitempty"`
}

type DomainEventCause struct {
	EventType string `json:"event_type,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type DomainSubscription struct {
	C      <-chan DomainEvent
	hub    *EventHub
	ch     chan DomainEvent
	once   sync.Once
	closed bool
	mu     sync.Mutex
}

// New 创建新的 EventHub
func New(ctx context.Context) *EventHub {
	return &EventHub{
		ctx:               ctx,
		domainSubscribers: make(map[*DomainSubscription]struct{}),
		gitDirtyKnown:     make(map[string]bool),
		gitDirtyState:     make(map[string]bool),
	}
}

// SetBroadcaster 设置 WebSocket 广播器
func (h *EventHub) SetBroadcaster(b Broadcaster) {
	h.broadcaster = b
}

// SetSyncHub connects low-frequency UI refresh events to the sync stream.
func (h *EventHub) SetSyncHub(syncHub *stream.SyncHub) {
	h.syncHub = syncHub
}

// emit 统一的事件发送方法
func (h *EventHub) emit(eventName string, payload interface{}) {
	// WebSocket ���播模式
	if h.broadcaster != nil {
		h.broadcaster.BroadcastEvent(eventName, payload)
	}
	h.broadcastSyncEvent(eventName, payload)
	h.emitDerivedDomainEvents(eventName, payload)
}

// Emit 通用事件发送方法（用于 eventEmitter）
func (h *EventHub) Emit(eventName string, payload interface{}) {
	h.emit(eventName, payload)
}

func (h *EventHub) emitDerivedDomainEvents(eventName string, payload interface{}) {
	switch eventName {
	case "process:changed":
		h.emitProcessDomainEvent(payload)
	case "session:changed":
		h.emitSessionDomainEvent(payload)
	case "project:changed":
		h.emitProjectDomainEvent(payload)
	case "git:changed":
		h.emitGitDomainEvent(payload)
	case "agent:run_changed", "domain:event":
		return
	}
}

func (h *EventHub) EmitDomain(event DomainEvent) {
	if h == nil {
		return
	}
	event = h.normalizeDomainEvent(event)

	h.domainMu.Lock()
	subscribers := make([]*DomainSubscription, 0, len(h.domainSubscribers))
	for sub := range h.domainSubscribers {
		subscribers = append(subscribers, sub)
	}
	h.domainMu.Unlock()

	if h.broadcaster != nil {
		h.broadcaster.BroadcastEvent("domain:event", event)
	}
	for _, sub := range subscribers {
		sub.deliver(event)
	}
}

func (h *EventHub) SubscribeDomain() *DomainSubscription {
	sub := &DomainSubscription{
		hub: h,
		ch:  make(chan DomainEvent, domainSubscriberBufferSize),
	}
	sub.C = sub.ch

	h.domainMu.Lock()
	h.domainSubscribers[sub] = struct{}{}
	h.domainMu.Unlock()

	return sub
}

func (h *EventHub) normalizeDomainEvent(event DomainEvent) DomainEvent {
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.Version == 0 {
		event.Version = 1
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	if event.Source == "" {
		event.Source = "eventhub"
	}
	return event
}

func (h *EventHub) unsubscribeDomain(sub *DomainSubscription) {
	h.domainMu.Lock()
	defer h.domainMu.Unlock()
	delete(h.domainSubscribers, sub)
}

func (s *DomainSubscription) Close() {
	s.once.Do(func() {
		s.hub.unsubscribeDomain(s)
		s.mu.Lock()
		s.closed = true
		close(s.ch)
		s.mu.Unlock()
	})
}

func (s *DomainSubscription) deliver(event DomainEvent) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	select {
	case s.ch <- event:
		return true
	default:
		go s.Close()
		return false
	}
}

// Git 相关事件
type GitChangedEvent struct {
	Path   string            `json:"path"`
	Branch string            `json:"branch"`
	Ahead  int               `json:"ahead"`
	Behind int               `json:"behind"`
	Status map[string]string `json:"status"` // path -> status
}

func (h *EventHub) EmitGitChanged(event GitChangedEvent) {
	h.emit("git:changed", event)
}

// 进程相关事件
type ProcessChangedEvent struct {
	PID      int    `json:"pid"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"` // "running", "stopped"
	ExitCode *int   `json:"exitCode,omitempty"`
}

func (h *EventHub) EmitProcessChanged(event ProcessChangedEvent) {
	h.emit("process:changed", event)
}

// 会话相关事件
type SessionChangedEvent struct {
	ID       string `json:"id"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"`    // "active", "idle", "completed"
	Provider string `json:"provider"` // "claude", "gemini", "codex"
}

func (h *EventHub) EmitSessionChanged(event SessionChangedEvent) {
	h.emit("session:changed", event)
}

// Worktree 相关事件
type WorktreeInfo struct {
	Path   string `json:"path"`
	Branch string `json:"branch"`
	IsMain bool   `json:"isMain"`
}

type WorktreeChangedEvent struct {
	Path      string         `json:"path"`
	Worktrees []WorktreeInfo `json:"worktrees"`
}

func (h *EventHub) EmitWorktreeChanged(event WorktreeChangedEvent) {
	h.emit("worktree:changed", event)
}

// ProjectChangedEvent is emitted when the persisted project index changes.
// Frontends should refresh ListProjects after receiving it.
type ProjectChangedEvent struct {
	ProjectName   string    `json:"project_name"`
	ProjectPath   string    `json:"project_path"`
	WorkspaceName string    `json:"workspace_name,omitempty"`
	WorkspacePath string    `json:"workspace_path,omitempty"`
	Reason        string    `json:"reason"`
	Timestamp     time.Time `json:"timestamp"`
}

func (h *EventHub) EmitProjectChanged(event ProjectChangedEvent) {
	h.emit("project:changed", event)
}

// AgentRunChangedEvent is emitted when a persisted agent run changes status.
type AgentRunChangedEvent struct {
	RunID       int64      `json:"run_id"`
	AgentID     int64      `json:"agent_id"`
	AgentPackID string     `json:"agent_pack_id,omitempty"`
	PackAgentID string     `json:"pack_agent_id,omitempty"`
	AgentName   string     `json:"agent_name,omitempty"`
	AgentIcon   string     `json:"agent_icon,omitempty"`
	Task        string     `json:"task,omitempty"`
	Model       string     `json:"model,omitempty"`
	ProjectPath string     `json:"project_path,omitempty"`
	SessionID   string     `json:"session_id,omitempty"`
	Status      string     `json:"status"`
	PID         int        `json:"pid,omitempty"`
	Error       string     `json:"error,omitempty"`
	Timestamp   time.Time  `json:"timestamp"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

func (h *EventHub) EmitAgentRunChanged(event AgentRunChangedEvent) {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	h.emit("agent:run_changed", event)
	h.EmitDomain(DomainEvent{
		Type:       agentRunDomainType(event.Status),
		Source:     "agent.run",
		OccurredAt: event.Timestamp,
		Scope: DomainEventScope{
			ProjectPath: event.ProjectPath,
			SessionID:   event.SessionID,
			AgentID:     event.AgentID,
			AgentRunID:  event.RunID,
			PID:         event.PID,
		},
		Payload: map[string]any{
			"run_id":        event.RunID,
			"agent_id":      event.AgentID,
			"agent_pack_id": event.AgentPackID,
			"pack_agent_id": event.PackAgentID,
			"agent_name":    event.AgentName,
			"agent_icon":    event.AgentIcon,
			"task":          event.Task,
			"model":         event.Model,
			"project_path":  event.ProjectPath,
			"session_id":    event.SessionID,
			"status":        event.Status,
			"pid":           event.PID,
			"error":         event.Error,
			"timestamp":     event.Timestamp,
			"completed_at":  event.CompletedAt,
		},
	})
}

func (h *EventHub) emitProcessDomainEvent(payload interface{}) {
	values, ok := domainPayloadMap(payload)
	if !ok {
		return
	}
	state := stringField(values, "state")
	cwd := stringField(values, "cwd", "workspace_path")
	h.EmitDomain(DomainEvent{
		Type:   processDomainType(state),
		Source: "process",
		Scope: DomainEventScope{
			ProjectPath:   stringField(values, "project_path"),
			WorkspacePath: cwd,
			Provider:      stringField(values, "provider", "provider_id"),
			SessionID:     stringField(values, "session_id", "id"),
			PID:           intField(values, "pid"),
		},
		Cause: &DomainEventCause{
			EventType: "process:changed",
			Reason:    state,
		},
		Payload: values,
	})
}

func (h *EventHub) emitSessionDomainEvent(payload interface{}) {
	values, ok := domainPayloadMap(payload)
	if !ok {
		return
	}
	state := stringField(values, "state")
	workspacePath := stringField(values, "cwd", "workspace_path")
	h.EmitDomain(DomainEvent{
		Type:   sessionDomainType(state),
		Source: "session",
		Scope: DomainEventScope{
			ProjectPath:   stringField(values, "project_path"),
			WorkspacePath: workspacePath,
			Provider:      stringField(values, "provider", "provider_id"),
			SessionID:     stringField(values, "id", "session_id"),
		},
		Cause: &DomainEventCause{
			EventType: "session:changed",
			Reason:    state,
		},
		Payload: values,
	})
}

func (h *EventHub) emitProjectDomainEvent(payload interface{}) {
	values, ok := domainPayloadMap(payload)
	if !ok {
		return
	}
	reason := stringField(values, "reason")
	h.EmitDomain(DomainEvent{
		Type:   "project.changed",
		Source: "project",
		Scope: DomainEventScope{
			ProjectPath:   stringField(values, "project_path"),
			WorkspacePath: stringField(values, "workspace_path"),
		},
		Cause: &DomainEventCause{
			EventType: "project:changed",
			Reason:    reason,
		},
		Payload: values,
	})
}

func (h *EventHub) emitGitDomainEvent(payload interface{}) {
	values, ok := domainPayloadMap(payload)
	if !ok {
		return
	}
	workspacePath := stringField(values, "path", "workspace_path")
	status := statusField(values, "status")
	dirty := len(status) > 0

	h.domainMu.Lock()
	known := h.gitDirtyKnown[workspacePath]
	wasDirty := h.gitDirtyState[workspacePath]
	h.gitDirtyKnown[workspacePath] = true
	h.gitDirtyState[workspacePath] = dirty
	h.domainMu.Unlock()

	if dirty == wasDirty && known {
		return
	}
	if !dirty && !known {
		return
	}

	eventType := "git.clean"
	if dirty {
		eventType = "git.dirty"
	}
	values["dirty"] = dirty
	h.EmitDomain(DomainEvent{
		Type:   eventType,
		Source: "git",
		Scope: DomainEventScope{
			WorkspacePath: workspacePath,
			Branch:        stringField(values, "branch"),
		},
		Cause: &DomainEventCause{
			EventType: "git:changed",
		},
		Payload: values,
	})
}

func processDomainType(state string) string {
	switch strings.ToLower(state) {
	case "running", "started", "active":
		return "process.started"
	case "stopped", "completed", "exited":
		return "process.stopped"
	default:
		return "process.changed"
	}
}

func sessionDomainType(state string) string {
	switch strings.ToLower(state) {
	case "active", "running", "started":
		return "session.started"
	case "idle":
		return "session.idle"
	case "compacted", "compacting", "context_compacted":
		return "session.compacted"
	case "completed", "complete", "finished":
		return "session.completed"
	default:
		return "session.changed"
	}
}

func agentRunDomainType(status string) string {
	switch strings.ToLower(status) {
	case "pending":
		return "agent.run.pending"
	case "running":
		return "agent.run.started"
	case "completed", "complete", "finished", "success", "succeeded":
		return "agent.run.completed"
	case "failed", "error":
		return "agent.run.failed"
	case "cancelled", "canceled":
		return "agent.run.cancelled"
	default:
		return "agent.run.changed"
	}
}

func domainPayloadMap(payload interface{}) (map[string]any, bool) {
	switch event := payload.(type) {
	case nil:
		return nil, false
	case map[string]any:
		return clonePayloadMap(event), true
	case map[string]string:
		values := make(map[string]any, len(event))
		for key, value := range event {
			values[key] = value
		}
		return values, true
	case json.RawMessage:
		return jsonPayloadMap(event)
	case []byte:
		return jsonPayloadMap(event)
	case string:
		text := strings.TrimSpace(event)
		if !strings.HasPrefix(text, "{") {
			return nil, false
		}
		return jsonPayloadMap([]byte(text))
	default:
		data, err := json.Marshal(event)
		if err != nil {
			return nil, false
		}
		return jsonPayloadMap(data)
	}
}

func clonePayloadMap(values map[string]any) map[string]any {
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func jsonPayloadMap(data []byte) (map[string]any, bool) {
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil || values == nil {
		return nil, false
	}
	return values, true
}

func stringField(values map[string]any, keys ...string) string {
	for _, key := range keys {
		switch value := values[key].(type) {
		case string:
			return value
		case fmt.Stringer:
			return value.String()
		case json.Number:
			return value.String()
		}
	}
	return ""
}

func intField(values map[string]any, key string) int {
	switch value := values[key].(type) {
	case int:
		return value
	case int8:
		return int(value)
	case int16:
		return int(value)
	case int32:
		return int(value)
	case int64:
		return int(value)
	case uint:
		return int(value)
	case uint8:
		return int(value)
	case uint16:
		return int(value)
	case uint32:
		return int(value)
	case uint64:
		return int(value)
	case float64:
		return int(value)
	case float32:
		return int(value)
	case json.Number:
		number, err := value.Int64()
		if err == nil {
			return int(number)
		}
	}
	return 0
}

func int64Field(values map[string]any, key string) int64 {
	switch value := values[key].(type) {
	case int:
		return int64(value)
	case int8:
		return int64(value)
	case int16:
		return int64(value)
	case int32:
		return int64(value)
	case int64:
		return value
	case uint:
		return int64(value)
	case uint8:
		return int64(value)
	case uint16:
		return int64(value)
	case uint32:
		return int64(value)
	case uint64:
		return int64(value)
	case float64:
		return int64(value)
	case float32:
		return int64(value)
	case json.Number:
		number, err := value.Int64()
		if err == nil {
			return number
		}
	}
	return 0
}

func statusField(values map[string]any, key string) map[string]string {
	value, ok := values[key]
	if !ok || value == nil {
		return nil
	}
	switch status := value.(type) {
	case map[string]string:
		return status
	case map[string]any:
		result := make(map[string]string, len(status))
		for path, state := range status {
			if text, ok := state.(string); ok {
				result[path] = text
			}
		}
		return result
	default:
		data, err := json.Marshal(status)
		if err != nil {
			return nil
		}
		var result map[string]string
		if err := json.Unmarshal(data, &result); err != nil {
			return nil
		}
		return result
	}
}

// Claude 错误事件
func (h *EventHub) EmitClaudeError(sessionID string, err string) {
	h.emit("claude-error", map[string]interface{}{
		"session_id": sessionID,
		"error":      err,
	})
}

// Claude 完成事件
func (h *EventHub) EmitClaudeComplete(sessionID string, result interface{}) {
	h.emit("claude-complete", map[string]interface{}{
		"session_id": sessionID,
		"result":     result,
	})
}

// 文件拖放事件
func (h *EventHub) EmitFileDrop(paths []string) {
	h.emit("file-drop", paths)
}

func debugEventPayload(payload interface{}) string {
	switch event := payload.(type) {
	case ProcessChangedEvent:
		return "process cwd=" + event.Cwd + " state=" + event.State
	case SessionChangedEvent:
		return "session id=" + event.ID + " cwd=" + event.Cwd + " state=" + event.State + " provider=" + event.Provider
	case GitChangedEvent:
		return "git path=" + event.Path + " branch=" + event.Branch
	case ProjectChangedEvent:
		return "project path=" + event.ProjectPath + " reason=" + event.Reason
	case map[string]interface{}:
		return "map session_id=" + debugEventString(event, "session_id") + " type=" + debugEventString(event, "type") + " subtype=" + debugEventString(event, "subtype")
	case string:
		if len(event) > 240 {
			event = event[:240] + "...(truncated)"
		}
		return "string len=" + strconv.Itoa(len(event)) + " preview=" + event
	default:
		return fmt.Sprintf("type=%T", payload)
	}
}

func debugEventString(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return value
}

func (h *EventHub) broadcastSyncEvent(eventName string, payload interface{}) {
	if h.syncHub == nil {
		return
	}
	switch eventName {
	case "session:changed":
		if event, ok := syncSessionChangedEvent(payload); ok {
			h.syncHub.Broadcast(event)
		}
	case "project:changed":
		if event, ok := syncProjectChangedEvent(payload); ok {
			h.syncHub.Broadcast(event)
		}
	}
}

func syncSessionChangedEvent(payload interface{}) (stream.SyncEvent, bool) {
	switch event := payload.(type) {
	case SessionChangedEvent:
		return stream.SyncEvent{
			Type:          "session:changed",
			WorkspacePath: event.Cwd,
			SessionID:     event.ID,
			Provider:      event.Provider,
		}, event.Cwd != ""
	case map[string]any:
		cwd := stringFromAny(event["cwd"])
		return stream.SyncEvent{
			Type:          "session:changed",
			WorkspacePath: cwd,
			SessionID:     stringFromAny(event["id"]),
			Provider:      stringFromAny(event["provider"]),
		}, cwd != ""
	default:
		return stream.SyncEvent{}, false
	}
}

func syncProjectChangedEvent(payload interface{}) (stream.SyncEvent, bool) {
	switch event := payload.(type) {
	case ProjectChangedEvent:
		return stream.SyncEvent{
			Type:          "project:changed",
			ProjectPath:   event.ProjectPath,
			WorkspacePath: event.WorkspacePath,
		}, event.ProjectPath != "" || event.WorkspacePath != ""
	default:
		return stream.SyncEvent{}, false
	}
}

func stringFromAny(value any) string {
	switch v := value.(type) {
	case string:
		return v
	default:
		return ""
	}
}
