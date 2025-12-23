package eventhub

import (
	"context"
)

// Broadcaster 事件广播接口
type Broadcaster interface {
	BroadcastEvent(eventType string, payload interface{})
}

// EventHub 统一事件分发中心
type EventHub struct {
	ctx         context.Context
	broadcaster Broadcaster
}

// New 创建新的 EventHub
func New(ctx context.Context) *EventHub {
	return &EventHub{ctx: ctx}
}

// SetBroadcaster 设置 WebSocket 广播器
func (h *EventHub) SetBroadcaster(b Broadcaster) {
	h.broadcaster = b
}

// emit 统一的事件发送方法
func (h *EventHub) emit(eventName string, payload interface{}) {
	// WebSocket ���播模式
	if h.broadcaster != nil {
		h.broadcaster.BroadcastEvent(eventName, payload)
	}
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

// Claude 输出事件
func (h *EventHub) EmitClaudeOutput(sessionID string, output interface{}) {
	h.emit("claude-output", map[string]interface{}{
		"session_id": sessionID,
		"output":     output,
	})
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

// PTY 输出事件
func (h *EventHub) EmitPtyOutput(sessionID string, data string) {
	h.emit("pty-output", map[string]interface{}{
		"session_id": sessionID,
		"data":       data,
	})
}

// 文件拖放事件
func (h *EventHub) EmitFileDrop(paths []string) {
	h.emit("file-drop", paths)
}
