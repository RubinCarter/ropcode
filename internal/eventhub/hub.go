package eventhub

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"ropcode/internal/stream"
)

// Broadcaster 事件广播接口
type Broadcaster interface {
	BroadcastEvent(eventType string, payload interface{})
}

// EventHub 统一事件分发中心
type EventHub struct {
	ctx         context.Context
	broadcaster Broadcaster
	syncHub     *stream.SyncHub
}

// New 创建新的 EventHub
func New(ctx context.Context) *EventHub {
	return &EventHub{ctx: ctx}
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
}

// Emit 通用事件发送方法（用于 eventEmitter）
func (h *EventHub) Emit(eventName string, payload interface{}) {
	h.emit(eventName, payload)
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
