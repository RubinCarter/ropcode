package eventhub

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventHub 统一事件分发中心
type EventHub struct {
	ctx context.Context
}

// New 创建新的 EventHub
func New(ctx context.Context) *EventHub {
	return &EventHub{ctx: ctx}
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
	runtime.EventsEmit(h.ctx, "git:changed", event)
}

// 进程相关事件
type ProcessChangedEvent struct {
	PID      int    `json:"pid"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"` // "running", "stopped"
	ExitCode *int   `json:"exitCode,omitempty"`
}

func (h *EventHub) EmitProcessChanged(event ProcessChangedEvent) {
	runtime.EventsEmit(h.ctx, "process:changed", event)
}

// 会话相关事件
type SessionChangedEvent struct {
	ID       string `json:"id"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"`    // "active", "idle", "completed"
	Provider string `json:"provider"` // "claude", "gemini", "codex"
}

func (h *EventHub) EmitSessionChanged(event SessionChangedEvent) {
	runtime.EventsEmit(h.ctx, "session:changed", event)
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
	runtime.EventsEmit(h.ctx, "worktree:changed", event)
}
