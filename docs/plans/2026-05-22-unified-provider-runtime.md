# Unified Provider Runtime 重构方案

## Context

当前 AI Provider 实现分散在 `internal/claude/`、`internal/codex/`、`internal/gemini/`、`internal/deepseek/` 四个独立包中，存在大量重复代码（SessionManager、EventEmitter、ProcessChangedEvent、binary discovery、env 增强各重复 3-4 次），且没有统一的 Go API 保证行为一致性。需要重构为统一的 provider 运行时，放在 `internal/provider/` 下。

### 现状问题

| 问题 | 严重程度 | 影响范围 |
|------|----------|----------|
| EventEmitter/ProcessChangedEmitter 接口在 4 个 provider 中各定义一次 | 高 | 类型不统一，无法多态 |
| ProcessChangedEvent 结构体重复 4 次 | 高 | app.go 需要 4 个适配器做相同的事 |
| Binary discovery 逻辑重复（相同模式，不同二进制名） | 中 | 新增 provider 需要复制粘贴 |
| enhanceEnvForProduction() 重复 3 次（Codex/DeepSeek/Gemini） | 中 | 环境变量继承不一致 |
| SessionManager 方法 90% 相同（StartSession/Terminate/IsRunning/...） | 高 | 行为不一致风险 |
| 无进程健康监控（心跳、卡死检测、异常输出） | 高 | 生产环境不可靠 |
| provider/interface.go 存在但未真正使用 | 中 | 抽象半成品 |
| 调用方需要区分 interactive/batch provider | 中 | bindings.go 分支过多 |

### 代码量分布

```
internal/claude/   — 7,152 行 (20 文件) — 最复杂，有 interactive mode
internal/codex/    — 2,736 行 (8 文件)  — 标准 batch mode
internal/deepseek/ — 1,591 行 (5 文件)  — 标准 batch mode
internal/gemini/   — 1,365 行 (3 文件)  — 标准 batch mode
internal/provider/ — 345 行 (3 文件)    — 未使用的接口定义
internal/sessionproc/ — 已有良好的平台抽象
```

---

## 设计目标

1. **统一接口** — 一套 Go interface 覆盖所有 provider 的全部能力（含交互）
2. **消除重复** — 公共逻辑下沉到 runtime 层，provider 只实现差异部分
3. **进程监控** — 心跳、卡死检测、异常退出恢复、输出流健康检查
4. **平台一致** — binary discovery + env 继承 + 进程管理统一处理 mac/linux/win
5. **可扩展** — 新增 provider 只需实现一个接口 + 注册
6. **多实例管理** — 支持 multi-project / multi-workspace / multi-agent 场景
7. **向后兼容** — 渐进式迁移，不破坏现有 RPC API

---

## 目标包结构

```
internal/provider/
├── runtime.go              # Runtime 主结构 + driver 注册表
├── manager.go              # 统一 SessionManager（替代 4 个独立 manager）
├── session.go              # 通用 Session 实现（进程 + 状态 + 输出缓冲 + 消息队列）
├── session_handle.go       # SessionHandle 接口实现
├── process.go              # 进程生命周期（spawn/terminate/wait，调用 sessionproc）
├── monitor.go              # 健康监控（heartbeat/stuck/hang/crash 检测）
├── discovery.go            # 统一 binary discovery（unix）
├── discovery_win.go        # Windows 候选路径扩展
├── env.go                  # 环境变量构建（通用层）
├── env_unix.go             # Unix PATH 增强（shell PATH 提取）
├── env_win.go              # Windows PATH 处理
├── output.go               # stdout/stderr 流读取 + 事件富化
├── events.go               # 统一 EventEmitter / ProcessChangedEmitter / 事件类型
├── types.go                # SessionConfig, OutputEvent, SessionStatus 等公共类型
│
├── driver.go               # ProviderDriver 接口定义 + SessionHandle 接口
│
├── claude/                  # Claude driver 实现
│   ├── driver.go           # 实现 ProviderDriver（含 SendMessage/Interrupt 真交互策略）
│   ├── args.go             # Claude CLI 参数构建
│   ├── output_parser.go    # Claude JSONL 解析 → OutputEvent
│   ├── control.go          # control_request/control_response 协议格式化
│   ├── capabilities.go     # 能力发现（保留）
│   ├── capability_discovery.go
│   ├── history.go          # 读取 ~/.claude/ 会话历史
│   ├── hooks.go            # Claude hooks 支持
│   └── settings.go         # Claude settings 读取
│
├── codex/                   # Codex driver 实现
│   ├── driver.go           # 实现 ProviderDriver（消息队列 + resume 策略）
│   ├── args.go             # Codex CLI 参数构建
│   ├── output_parser.go    # Codex JSONL 解析
│   ├── tool_adapt.go       # Codex tool → 统一格式
│   ├── config.go           # config.toml / auth.json 解析
│   └── history.go          # 读取 ~/.codex/ 会话历史
│
├── gemini/                  # Gemini driver 实现
│   ├── driver.go           # 实现 ProviderDriver（消息队列 + resume 策略）
│   ├── args.go             # Gemini CLI 参数构建
│   ├── output_parser.go    # Gemini JSONL 解析
│   ├── tool_adapt.go       # Gemini tool → 统一格式
│   └── history.go          # 读取 ~/.gemini/ 会话历史
│
├── deepseek/                # DeepSeek driver 实现
│   ├── driver.go           # 实现 ProviderDriver（消息队列 + resume 策略）
│   ├── args.go             # DeepSeek CLI 参数构建
│   ├── output_parser.go    # DeepSeek JSONL 解析
│   ├── tool_adapt.go       # DeepSeek tool → 统一格式
│   └── history.go          # 读取 ~/.deepseek/ 会话历史
│
└── provider_test.go        # 集成测试
```

保留 `internal/sessionproc/`（平台进程管理）和 `internal/eventhub/`（WebSocket 广播）不动。

---

## 核心接口设计

### 设计原则

**单一接口，所有 provider 实现全部方法。** 不区分 "interactive provider" 和 "batch provider"——每个 provider 都能响应 `SendMessage` 和 `Interrupt`，只是底层策略不同：

- **Claude**：真交互模式，stdin 直接写入，Interrupt 发 control_request
- **Gemini/Codex/DeepSeek**：模拟交互——消息进入待发送队列，等当前任务完成后带 resume 发起下一轮；Interrupt 直接杀进程

调用方完全不需要区分 provider 的交互实现方式。

### ProviderDriver（统一接口）

```go
// internal/provider/driver.go
package provider

type ProviderDriver interface {
    // === 标识 ===
    ID() string                          // "claude", "codex", "gemini", "deepseek"
    BinaryName() string                  // 可执行文件名
    BinaryCandidates() []string          // 平台特有的额外候选路径

    // === 会话构建 ===
    BuildArgs(config SessionConfig) []string
    EnvVars(config SessionConfig) map[string]string

    // === 输出解析 ===
    ParseOutput(line []byte) *OutputEvent
    ParseStderr(line []byte) *StderrEvent

    // === 交互 ===
    // SendMessage 向会话发送消息。
    // Claude: 通过 SessionHandle.WriteStdin 直接写入 stdin
    // 其他: 通过 SessionHandle.EnqueueMessage 入队，等当前进程完成后带 resume 重启
    SendMessage(session SessionHandle, msg string) error

    // Interrupt 中断当前执行。
    // Claude: 发送 control_request 中断当前 turn（进程不死）
    // 其他: 通过 SessionHandle.Kill 杀死进程
    Interrupt(session SessionHandle) error

    // === 生命周期回调 ===
    OnProcessStart(ctx context.Context, pid int) error
    OnProcessExit(session SessionHandle, exitCode int, err error)
}
```

### SessionHandle（Runtime 提供给 Driver 的操作句柄）

```go
// internal/provider/session_handle.go

// SessionHandle 是 runtime 暴露给 driver 的操作原语。
// Driver 根据自己的策略组合使用这些原语——runtime 提供机制，driver 决定策略。
type SessionHandle interface {
    // 进程 I/O
    WriteStdin(data []byte) error           // 向当前进程 stdin 写入数据
    Kill() error                            // 强制终止当前进程

    // 消息队列（用于 batch provider 的模拟交互）
    EnqueueMessage(msg string)              // 消息入队等待
    DequeueMessage() (string, bool)         // 消息出队

    // 进程重启（用于 batch provider 带 resume 继续对话）
    RestartWithConfig(config SessionConfig) error

    // 状态查询
    GetState() SessionState                 // 当前会话状态
    GetProviderSessionID() string           // provider 侧的 session ID（用于 resume）
    GetConfig() SessionConfig               // 当前会话配置
}
```

### 各 Provider 的 SendMessage/Interrupt 实现策略

| Provider | SendMessage | Interrupt |
|----------|-------------|-----------|
| Claude | `session.WriteStdin(formatStreamJSON(msg))` | `session.WriteStdin(formatControlRequest("interrupt"))` |
| Codex | `session.EnqueueMessage(msg)`，OnProcessExit 中检查队列并 `RestartWithConfig` | `session.Kill()` |
| Gemini | 同 Codex | `session.Kill()` |
| DeepSeek | 同 Codex | `session.Kill()` |

### OnProcessExit 的关键作用

对于 batch provider，`OnProcessExit` 是消息队列驱动的核心：

```go
// codex/driver.go 示例
func (d *Driver) OnProcessExit(session SessionHandle, exitCode int, err error) {
    // 进程正常退出后，检查是否有待发送消息
    if msg, ok := session.DequeueMessage(); ok {
        config := session.GetConfig()
        config.Prompt = msg
        config.ResumeSessionID = session.GetProviderSessionID()
        config.Resume = true
        session.RestartWithConfig(config)
    }
}
```

这样 batch provider 自然地实现了"多轮对话"——每轮是一个独立进程，通过 resume 串联上下文。

### CapabilityDiscoverer（可选扩展接口）

```go
// 目前仅 Claude 实现，用于发现 system/user/project 级别的能力配置
type CapabilityDiscoverer interface {
    DiscoverCapabilities(ctx context.Context) (*Capabilities, error)
}
```

这是唯一保留的扩展接口——因为能力发现是 Claude 独有的启动前预热逻辑，与会话运行时无关，不适合放在 ProviderDriver 中。

---

## 统一类型

```go
// internal/provider/types.go

type SessionConfig struct {
    ProjectPath     string            `json:"project_path"`
    Prompt          string            `json:"prompt"`
    Model           string            `json:"model"`
    SessionID       string            `json:"session_id,omitempty"`
    Resume          bool              `json:"resume,omitempty"`
    Interactive     bool              `json:"interactive,omitempty"`
    ProviderApiID   string            `json:"provider_api_id,omitempty"`
    AuthToken       string            `json:"auth_token,omitempty"`
    BaseURL         string            `json:"base_url,omitempty"`
    ResumeSessionID string            `json:"resume_session_id,omitempty"`
    Extra           map[string]string `json:"extra,omitempty"`
}

type SessionStatus struct {
    SessionID         string    `json:"session_id"`
    ProviderID        string    `json:"provider_id"`
    ProviderSessionID string    `json:"provider_session_id,omitempty"`
    ProjectPath       string    `json:"project_path"`
    Model             string    `json:"model"`
    Status            string    `json:"status"`  // created/starting/running/cancelling/completed/failed/cancelled
    Health            string    `json:"health"`  // ok/slow/stuck/hanging/crashed
    StartedAt         time.Time `json:"started_at"`
    PID               int       `json:"pid"`
}

type OutputEvent struct {
    Type      string                 `json:"type"`      // system/assistant/user/tool_use/tool_result/error/raw
    Subtype   string                 `json:"subtype,omitempty"`
    SessionID string                 `json:"session_id"`
    Provider  string                 `json:"provider"`
    Message   map[string]interface{} `json:"message,omitempty"`
    IsDelta   bool                   `json:"is_delta,omitempty"`
    Raw       string                 `json:"raw,omitempty"`
}

type ProcessChangedEvent struct {
    PID        int    `json:"pid"`
    Cwd        string `json:"cwd"`
    State      string `json:"state"`
    ExitCode   *int   `json:"exitCode,omitempty"`
    ProviderID string `json:"provider_id"`
    SessionID  string `json:"session_id"`
}
```

---

## 统一 Manager

```go
// internal/provider/manager.go

type Manager struct {
    ctx       context.Context
    drivers   map[string]ProviderDriver   // providerID → driver
    sessions  map[string]*Session         // sessionID → session
    binaries  map[string]string           // providerID → binary path (缓存)
    monitor   *Monitor
    emitter   EventEmitter
    mu        sync.RWMutex
}

// 公共 API — 调用方无需区分 provider 类型
func (m *Manager) RegisterDriver(d ProviderDriver) error
func (m *Manager) StartSession(providerID string, config SessionConfig) (string, error)
func (m *Manager) TerminateSession(sessionID string) error
func (m *Manager) TerminateByProject(providerID, projectPath string) error
func (m *Manager) SendMessage(sessionID, message string) error   // 内部委托 driver.SendMessage(handle, msg)
func (m *Manager) InterruptSession(sessionID string) error       // 内部委托 driver.Interrupt(handle)
func (m *Manager) IsRunning(sessionID string) bool
func (m *Manager) IsRunningForProject(providerID, projectPath string) bool
func (m *Manager) GetSessionOutput(sessionID string) (string, error)
func (m *Manager) GetSession(sessionID string) *SessionStatus
func (m *Manager) ListRunningSessions(providerID string) []*SessionStatus
func (m *Manager) ListAllSessions() []*SessionStatus
func (m *Manager) DiscoverBinary(providerID string) (string, error)
func (m *Manager) Shutdown()
```

Manager.SendMessage 的实现：
```go
func (m *Manager) SendMessage(sessionID, message string) error {
    session := m.getSession(sessionID)
    if session == nil {
        return ErrSessionNotFound
    }
    return session.driver.SendMessage(session, message)  // driver 决定策略
}
```

无 type assertion，无分支——所有 provider 统一路径。

---

## 进程监控子系统

```go
// internal/provider/monitor.go

type MonitorConfig struct {
    CheckInterval  time.Duration // 默认 5s
    SlowThreshold  time.Duration // 默认 30s，输出间隔超过此值标记 slow
    StuckThreshold time.Duration // 默认 120s，无输出标记 stuck
    HangThreshold  time.Duration // 默认 300s，无输出且进程存活标记 hanging
}

type ProcessHealth string
const (
    HealthOK      ProcessHealth = "ok"
    HealthSlow    ProcessHealth = "slow"
    HealthStuck   ProcessHealth = "stuck"
    HealthHanging ProcessHealth = "hanging"
    HealthCrashed ProcessHealth = "crashed"
)
```

监控方式：
- **被动式**：每次 stdout 有输出时调用 `monitor.RecordOutput(sessionID)`
- **定期扫描**：后台 goroutine 每 `CheckInterval` 检查所有 session 的 `lastOutput` 时间
- **进程存活检测**：Unix 用 `kill -0`，Windows 用 `WaitForSingleObject(0)`
- **健康事件**：状态变更时通过 EventHub 推送 `"provider:health"` 事件到前端
- **异常输出检测**：stderr 行数超过阈值触发告警

---

## 平台进程管理

复用现有 `internal/sessionproc/`，不做修改：

| 平台 | 进程组 | 终止信号 | 子进程清理 |
|------|--------|----------|-----------|
| macOS/Linux | `Setpgid: true` | SIGINT → 5s → SIGKILL (发给 -pgid) | 进程组自动包含子进程 |
| Windows | `CREATE_NEW_PROCESS_GROUP` | `CTRL_BREAK_EVENT` → 5s → `TerminateJobObject` | Job Object kill-on-close |

`internal/provider/process.go` 封装调用 sessionproc 的逻辑，对上层透明。

---

## Binary Discovery 统一

```go
// internal/provider/discovery.go

func DiscoverBinary(binaryName string, extraCandidates []string) (string, error)
```

优先级：
1. `exec.LookPath`（尊重当前 PATH）
2. 通用路径：`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/.npm-global/bin`, `~/.cargo/bin`
3. Driver 提供的 `BinaryCandidates()`（provider 特有路径）
4. Windows：glob 展开版本化路径（如 `WindowsApps/*/codex.exe`）

每个 driver 只需返回自己独有的候选路径，通用路径由框架处理。

---

## 环境变量继承

```go
// internal/provider/env.go

func BuildProcessEnv(driverEnvVars map[string]string) []string
```

分层构建：
1. **基础层**：`os.Environ()` 继承当前进程环境
2. **平台增强层**：`enhancePATH()` 补充 .app 打包环境缺失的路径（统一现有 3 处重复）
3. **Shell PATH 提取**（仅 macOS GUI 环境）：启动 login shell 获取完整 PATH（现有 `claude/shell_path.go` 逻辑上移）
4. **Provider 层**：driver 返回的 `EnvVars()` 覆盖/追加（API key、base URL 等）

---

## app.go 集成变化

### Before
```go
type App struct {
    claudeManager   *claude.SessionManager
    geminiManager   *gemini.SessionManager
    codexManager    *codex.SessionManager
    deepseekManager *deepseek.SessionManager
}
// + 4 个 processEmitter adapter structs
```

### After
```go
type App struct {
    providerManager *provider.Manager  // 一个 manager 管理所有 provider
}
// 零 adapter — provider.Manager 直接对接 EventHub
```

---

## 迁移策略（5 阶段）

### Phase 1: 基础设施（不改变现有行为）
- 创建 `internal/provider/driver.go` — 接口定义 + SessionHandle
- 创建 `internal/provider/types.go` — 统一类型
- 创建 `internal/provider/events.go` — 统一事件类型
- 创建 `internal/provider/discovery.go` — binary discovery
- 创建 `internal/provider/env.go` — 环境变量构建
- **验证**：新包独立编译通过，单元测试覆盖 discovery 和 env

### Phase 2: Driver 实现（与现有代码并行）
- `internal/provider/claude/driver.go` — 实现 ProviderDriver
- `internal/provider/codex/driver.go` — 实现 ProviderDriver
- `internal/provider/gemini/driver.go` — 实现 ProviderDriver
- `internal/provider/deepseek/driver.go` — 实现 ProviderDriver
- 从现有 session.go 提取 output_parser.go、args.go
- **验证**：`var _ ProviderDriver = (*Driver)(nil)` 编译检查通过

### Phase 3: 统一 Manager + Monitor
- `internal/provider/session.go` — 通用 Session（实现 SessionHandle）
- `internal/provider/manager.go` — 统一 Manager
- `internal/provider/monitor.go` — 健康监控
- `internal/provider/process.go` — 进程生命周期
- `internal/provider/output.go` — 流处理
- **验证**：mock driver 集成测试，完整生命周期验证

### Phase 4: 切换调用方
- app.go 用 `providerManager` 替代 4 个独立 manager
- bindings.go RPC 方法委托给 `providerManager`
- 删除 4 个 processEmitter adapter
- RPC 方法签名不变，前端无感知
- **验证**：`go test ./...` 全部通过，手动测试所有 provider 流程

### Phase 5: 清理旧代码
- 删除 `internal/claude/manager.go`、`internal/claude/session.go`
- 删除 `internal/codex/manager.go`、`internal/codex/session.go`
- 删除 `internal/gemini/manager.go`、`internal/gemini/session.go`
- 删除 `internal/deepseek/manager.go`、`internal/deepseek/session.go`
- 删除旧 `internal/provider/` 中的 stub 接口
- 删除各包中重复的 EventEmitter/ProcessChangedEmitter/ProcessChangedEvent 定义

---

## 新增 Provider 的开发体验（目标态）

```go
// internal/provider/cursor/driver.go
package cursor

type Driver struct{}

func (d *Driver) ID() string                    { return "cursor" }
func (d *Driver) BinaryName() string            { return "cursor" }
func (d *Driver) BinaryCandidates() []string    { return nil }
func (d *Driver) BuildArgs(config provider.SessionConfig) []string { ... }
func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string { ... }
func (d *Driver) ParseOutput(line []byte) *provider.OutputEvent { ... }
func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent { ... }
func (d *Driver) OnProcessStart(ctx context.Context, pid int) error { return nil }
func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
    // batch provider 标准模式：进程退出后检查消息队列
    if msg, ok := session.DequeueMessage(); ok {
        config := session.GetConfig()
        config.Prompt = msg
        config.ResumeSessionID = session.GetProviderSessionID()
        config.Resume = true
        session.RestartWithConfig(config)
    }
}

func (d *Driver) SendMessage(session provider.SessionHandle, msg string) error {
    // 模拟交互：入队等待当前进程完成
    session.EnqueueMessage(msg)
    return nil
}

func (d *Driver) Interrupt(session provider.SessionHandle) error {
    return session.Kill()
}
```

注册：
```go
a.providerManager.RegisterDriver(&cursor.Driver{})
```

自动获得：binary discovery、环境变量、进程管理、健康监控、事件分发、多实例管理、消息队列驱动的多轮对话。

---

## 关键设计决策

### 1. 为什么不用 InteractiveDriver 扩展接口？

所有 provider 都实现完整的 `SendMessage` 和 `Interrupt`，区别只是策略：
- Claude 通过 stdin 真交互
- 其他通过消息队列 + resume 模拟交互

调用方统一调用 `Manager.SendMessage(sessionID, msg)`，零分支。`SessionHandle` 提供机制（WriteStdin、EnqueueMessage、RestartWithConfig），driver 决定策略。

### 2. 为什么用 SessionHandle 而不是直接暴露 Session？

- 控制 driver 的操作范围——只能做 Handle 允许的事
- 避免 driver 直接操作 Session 内部状态导致竞态
- Handle 是接口，方便测试时 mock

### 3. 进程监控的粒度？

被动式：每次 stdout 有输出时 session 调用 `monitor.RecordOutput()`。Monitor 后台 goroutine 定期扫描 lastOutput 时间，超过阈值触发回调。不做主动心跳（CLI 工具不支持）。

### 4. 多实例管理？

Manager 的 sessions map 以 sessionID 为 key，支持同一 provider 的多个并发实例。通过 `ListRunningSessions(providerID)` 按 provider 过滤，通过 `IsRunningForProject(providerID, projectPath)` 检查项目级冲突。Workspace/Agent 级别的隔离由上层负责。

### 5. 向后兼容策略？

bindings.go 的 RPC 方法签名不变。内部实现从 `a.claudeManager.StartSession(config)` 变为 `a.providerManager.StartSession("claude", config)`。前端完全无感知。

---

## 验证方式

1. **单元测试**：discovery、env、monitor 各自独立测试
2. **集成测试**：mock driver 验证完整 session 生命周期（start → output → terminate → queue → restart）
3. **编译检查**：`go build -tags server .` 确保 server 编译通过
4. **回归测试**：`go test ./...` 全部通过
5. **手动验证**：启动 dev 环境，测试 Claude/Codex/Gemini/DeepSeek 各 provider 的启动、输出、终止流程
6. **事件验证**：确认前端收到的事件名和格式不变（`claude-output`、`claude-complete`、`process:changed`）
