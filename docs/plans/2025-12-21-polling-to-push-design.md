# 轮询改 WebSocket 推送设计方案

## 背景

当前前端使用大量 `setInterval` 轮询来获取状态更新，这导致：
1. macOS 锁屏/睡眠后唤醒时，积压的定时器回调可能加剧 WebSocket IPC 连接问题
2. 不必要的 CPU 和网络开销
3. 状态更新延迟（取决于轮询间隔）

## 目标

将所有轮询改为基于 Wails 内置事件系统的推送机制，后端主动通知前端状态变化。

## 当前轮询清单

| 文件 | 用途 | 间隔 |
|------|------|------|
| `Sidebar.tsx:268` | Git 分支变化检测 | 2秒 |
| `GitStatusPane.tsx:110` | Git 状态刷新 | 500ms |
| `CustomTitlebar.tsx:186` | Worktree 检查 | 5秒 |
| `CustomTitlebar.tsx:209` | 未推送提交检查 | 5秒 |
| `ProjectList.tsx:185` | 自动同步状态 | 5秒 |
| `ProjectList.tsx:270` | 运行状态检查 | 200ms |
| `outputCache.tsx:160` | 运行中会话轮询 | 3秒 |
| `useProcessState.ts:83` | 进程状态检查 | - |
| `analytics/index.ts:245` | 分析数据刷新 | - |
| `resourceMonitor.ts:44` | 资源监控 | - |
| `Agents.tsx:43` | Agent 状态 | - |
| `AgentsModal.tsx:57` | Agent 状态 | - |
| `RunningClaudeSessions.tsx:31` | 运行中会话 | 5秒 |

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Git 组件    │  │ 进程组件    │  │ 会话组件            │  │
│  │ (订阅事件)  │  │ (订阅事件)  │  │ (订阅事件)          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │ EventsOn                          │
├──────────────────────────┼──────────────────────────────────┤
│                   Wails IPC (已有)                           │
├──────────────────────────┼──────────────────────────────────┤
│                          │ EventsEmit                        │
│                          ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              EventHub (新增)                           │  │
│  │  - 统一事件分发中心                                    │  │
│  │  - 管理监听器生命周期                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│         ▲                ▲                     ▲             │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────────┴──────────┐  │
│  │ GitWatcher  │  │ ProcessMgr │  │ SessionMgr          │  │
│  │ (文件监听)  │  │ (生命周期)  │  │ (状态变化)          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                        Backend                               │
└─────────────────────────────────────────────────────────────┘
```

### 设计决策

1. **使用 Wails 内置事件系统** - 直接用 `runtime.EventsEmit(ctx, "event-name", data)` 从 Go 推送
2. **按资源类型组织事件（粗粒度）** - 前端根据 path/id 过滤自己关心的
3. **按需监听** - 只监听当前打开/活跃的工作区

### 事件定义

| 事件名 | 触发时机 | 数据结构 |
|--------|---------|---------|
| `git:changed` | .git 目录文件变化 | `{ path, status, branch, ahead, behind }` |
| `process:changed` | 进程启动/停止/状态变化 | `{ pid, cwd, state, exitCode? }` |
| `session:changed` | AI 会话状态变化 | `{ id, cwd, state, provider }` |
| `worktree:changed` | worktree 创建/删除 | `{ path, worktrees[] }` |

### 触发机制

| 数据类型 | 推送触发方式 |
|---------|-------------|
| Git 状态/分支 | 文件系统监听 `.git` 目录 |
| 进程状态 | 进程生命周期回调 |
| AI 会话状态 | 现有 EventEmitter |
| Worktree 状态 | 文件系统监听 |
| 项目运行状态 | 进程生命周期回调 |

## 实现计划

### 后端改动

#### 1. 新增 EventHub (`internal/eventhub/hub.go`)

统一事件分发中心，负责：
- 接收各模块的状态变化通知
- 通过 Wails runtime 推送事件到前端
- 管理监听器生命周期

```go
type EventHub struct {
    ctx context.Context
}

func (h *EventHub) EmitGitChanged(path string, status GitStatus) {
    runtime.EventsEmit(h.ctx, "git:changed", map[string]interface{}{
        "path":   path,
        "status": status.Files,
        "branch": status.Branch,
        "ahead":  status.Ahead,
        "behind": status.Behind,
    })
}

func (h *EventHub) EmitProcessChanged(pid int, cwd string, state string, exitCode *int) {
    runtime.EventsEmit(h.ctx, "process:changed", map[string]interface{}{
        "pid":      pid,
        "cwd":      cwd,
        "state":    state,
        "exitCode": exitCode,
    })
}

func (h *EventHub) EmitSessionChanged(id, cwd, state, provider string) {
    runtime.EventsEmit(h.ctx, "session:changed", map[string]interface{}{
        "id":       id,
        "cwd":      cwd,
        "state":    state,
        "provider": provider,
    })
}

func (h *EventHub) EmitWorktreeChanged(path string, worktrees []Worktree) {
    runtime.EventsEmit(h.ctx, "worktree:changed", map[string]interface{}{
        "path":      path,
        "worktrees": worktrees,
    })
}
```

#### 2. 新增 GitWatcher (`internal/git/watcher.go`)

基于现有 `internal/watcher/watcher.go` 实现 Git 目录监听：

```go
type GitWatcher struct {
    watchers map[string]*watcher.Watcher  // path -> watcher
    hub      *eventhub.EventHub
    mu       sync.RWMutex
}

// 前端调用：开始监听某个工作区
func (g *GitWatcher) WatchWorkspace(path string) error {
    g.mu.Lock()
    defer g.mu.Unlock()

    if _, exists := g.watchers[path]; exists {
        return nil
    }

    gitDir := filepath.Join(path, ".git")
    w, err := watcher.New(gitDir, g.onGitChange(path))
    if err != nil {
        return err
    }

    g.watchers[path] = w
    return nil
}

// 前端调用：停止监听某个工作区
func (g *GitWatcher) UnwatchWorkspace(path string) {
    g.mu.Lock()
    defer g.mu.Unlock()

    if w, exists := g.watchers[path]; exists {
        w.Close()
        delete(g.watchers, path)
    }
}

func (g *GitWatcher) onGitChange(path string) func(watcher.Event) {
    return func(e watcher.Event) {
        // 获取最新 Git 状态并推送
        status := g.getGitStatus(path)
        g.hub.EmitGitChanged(path, status)
    }
}
```

#### 3. 修改 ProcessManager (`internal/process/manager.go`)

在进程状态变化时触发事件：

```go
func (m *Manager) SpawnProcess(...) {
    // 现有逻辑...

    // 新增：通知进程启动
    m.hub.EmitProcessChanged(pid, cwd, "running", nil)

    // 监控进程退出
    go func() {
        exitCode := cmd.Wait()
        m.hub.EmitProcessChanged(pid, cwd, "stopped", &exitCode)
    }()
}
```

#### 4. 修改 SessionManager（Claude/Codex/Gemini）

在会话状态变化时触发事件（现有 EventEmitter 模式已支持，需接入 EventHub）。

#### 5. 修改 App (`app.go`)

初始化 EventHub 并注入到各模块：

```go
func (a *App) startup(ctx context.Context) {
    a.ctx = ctx

    // 初始化 EventHub
    a.eventHub = eventhub.New(ctx)

    // 注入到各管理器
    a.processManager.SetEventHub(a.eventHub)
    a.gitWatcher = git.NewWatcher(a.eventHub)
    // ...
}
```

### 前端改动

#### 1. 新增事件订阅 Hook (`hooks/useEventSubscription.ts`)

```typescript
import { useEffect } from 'react';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

interface GitChangedEvent {
  path: string;
  status: Record<string, string>;
  branch: string;
  ahead: number;
  behind: number;
}

export function useGitChanged(
  path: string | undefined,
  callback: (event: GitChangedEvent) => void
) {
  useEffect(() => {
    if (!path) return;

    const handler = (event: GitChangedEvent) => {
      if (event.path === path) {
        callback(event);
      }
    };

    EventsOn('git:changed', handler);
    return () => EventsOff('git:changed');
  }, [path, callback]);
}

// 类似地实现 useProcessChanged, useSessionChanged, useWorktreeChanged
```

#### 2. 修改 GitStatusPane

移除轮询，改用事件订阅：

```typescript
// Before
useEffect(() => {
  const interval = setInterval(fetchGitStatus, 500);
  return () => clearInterval(interval);
}, []);

// After
useGitChanged(workspacePath, (event) => {
  setStatus(event.status);
  setBranch(event.branch);
});

// 初始加载仍需要一次主动获取
useEffect(() => {
  fetchGitStatus();
}, []);
```

#### 3. 工作区生命周期管理

在工作区打开/关闭时注册/注销监听：

```typescript
// WorkspaceTabManager 或相关组件
useEffect(() => {
  if (workspacePath) {
    api.WatchWorkspace(workspacePath);
    return () => api.UnwatchWorkspace(workspacePath);
  }
}, [workspacePath]);
```

## 迁移策略

建议分阶段迁移，每个阶段可独立测试：

### 阶段 1：基础设施
- [ ] 实现 EventHub
- [ ] 实现 GitWatcher
- [ ] 添加前端事件订阅 hooks

### 阶段 2：Git 相关（影响最大的高频轮询）
- [ ] 迁移 GitStatusPane (500ms 轮询)
- [ ] 迁移 Sidebar 分支检测 (2s 轮询)
- [ ] 迁移 CustomTitlebar worktree/未推送检查

### 阶段 3：进程状态
- [ ] 修改 ProcessManager 触发事件
- [ ] 迁移 ProjectList 运行状态检查 (200ms 轮询)
- [ ] 迁移 useProcessState

### 阶段 4：AI 会话状态
- [ ] 接入现有 SessionManager EventEmitter
- [ ] 迁移 RunningClaudeSessions
- [ ] 迁移 outputCache
- [ ] 迁移 Agents/AgentsModal

### 阶段 5：清理
- [ ] 移除所有废弃的轮询代码
- [ ] 更新相关测试

## 风险与注意事项

1. **防抖处理**：文件系统监听可能产生大量事件，需要在 GitWatcher 中做 debounce（现有 watcher 已支持）

2. **初始状态**：事件推送只通知变化，组件挂载时仍需主动获取一次初始状态

3. **连接恢复**：如果 Wails IPC 断开重连，可能需要重新获取状态（这是原有问题，不在本次解决范围）

4. **内存泄漏**：确保在组件卸载时正确移除事件监听器
