package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ropcode/internal/eventhub"
	"ropcode/internal/watcher"
)

// EventEmitter 接口，用于发送事件
type EventEmitter interface {
	EmitGitChanged(event eventhub.GitChangedEvent)
}

// GitWatcher 管理多个工作区的 Git 监听
type GitWatcher struct {
	watchers map[string]*watcher.Watcher
	emitter  EventEmitter
	mu       sync.RWMutex
}

// NewGitWatcher 创建新的 GitWatcher
func NewGitWatcher(emitter EventEmitter) *GitWatcher {
	return &GitWatcher{
		watchers: make(map[string]*watcher.Watcher),
		emitter:  emitter,
	}
}

// Watch 开始监听指定工作区的 Git 变化
func (g *GitWatcher) Watch(workspacePath string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if _, exists := g.watchers[workspacePath]; exists {
		return nil // 已经在监听
	}

	gitDir := filepath.Join(workspacePath, ".git")

	// 创建 watcher，使用 300ms 防抖
	w, err := watcher.New(gitDir, 300*time.Millisecond, func(e watcher.Event) {
		g.onGitChange(workspacePath)
	})
	if err != nil {
		return fmt.Errorf("failed to watch git dir: %w", err)
	}

	// 添加关键的 git 子目录到监听列表
	// fsnotify 不支持递归监听，需要手动添加子目录
	gitSubDirs := []string{
		"refs",        // 分支和标签引用
		"refs/heads",  // 本地分支（提交后变化）
		"refs/remotes", // 远程分支引用
		"refs/tags",   // 标签
		"objects",     // git 对象（可选，变化频繁）
		"logs",        // reflog
		"logs/refs",
		"logs/refs/heads",
	}

	for _, subDir := range gitSubDirs {
		subPath := filepath.Join(gitDir, subDir)
		// 只添加存在的目录
		if info, err := os.Stat(subPath); err == nil && info.IsDir() {
			_ = w.AddPath(subPath) // 忽略错误，某些目录可能不存在
		}
	}

	if err := w.Start(); err != nil {
		w.Close()
		return fmt.Errorf("failed to start watcher: %w", err)
	}

	g.watchers[workspacePath] = w

	// 立即发送一次当前状态
	go g.onGitChange(workspacePath)

	return nil
}

// Unwatch 停止监听指定工作区
func (g *GitWatcher) Unwatch(workspacePath string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if w, exists := g.watchers[workspacePath]; exists {
		w.Close()
		delete(g.watchers, workspacePath)
	}
}

// Close 关闭所有监听器
func (g *GitWatcher) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()

	for _, w := range g.watchers {
		w.Close()
	}
	g.watchers = make(map[string]*watcher.Watcher)
}

// onGitChange 处理 Git 变化
func (g *GitWatcher) onGitChange(workspacePath string) {
	event := g.getGitStatus(workspacePath)
	if g.emitter != nil {
		g.emitter.EmitGitChanged(event)
	}
}

// getGitStatus 获取 Git 状态
func (g *GitWatcher) getGitStatus(workspacePath string) eventhub.GitChangedEvent {
	event := eventhub.GitChangedEvent{
		Path:   workspacePath,
		Status: make(map[string]string),
	}

	// 获取当前分支
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = workspacePath
	if output, err := cmd.Output(); err == nil {
		event.Branch = strings.TrimSpace(string(output))
	}

	// 获取 ahead/behind
	cmd = exec.Command("git", "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
	cmd.Dir = workspacePath
	if output, err := cmd.Output(); err == nil {
		parts := strings.Fields(string(output))
		if len(parts) == 2 {
			event.Ahead, _ = strconv.Atoi(parts[0])
			event.Behind, _ = strconv.Atoi(parts[1])
		}
	}

	// 获取文件状态 (使用 git status --porcelain)
	cmd = exec.Command("git", "status", "--porcelain")
	cmd.Dir = workspacePath
	if output, err := cmd.Output(); err == nil {
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if len(line) < 4 {
				continue
			}
			status := strings.TrimSpace(line[:2])
			path := strings.TrimSpace(line[3:])
			if path != "" {
				event.Status[path] = status
			}
		}
	}

	return event
}
