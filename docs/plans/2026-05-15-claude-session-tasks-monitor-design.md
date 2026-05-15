# Claude Session Tasks Monitor 设计方案

## 背景

Ropcode 通过常驻 Go 后端 `ropcode-server` 启动和管理 Claude Code CLI。当前 Claude interactive session 已经使用：

- `--input-format stream-json`
- `--output-format stream-json`
- `--verbose`
- `--dangerously-skip-permissions`

Go 后端持续读取 Claude stdout JSONL，并通过 WebSocket 事件转发给前端。Claude Code 会在主输出流里发出后台 activity 的生命周期事件，例如 `task_started`、`task_progress`、`task_notification`。后台子代理和后台 shell 任务的完整日志不应从主输出流中获取，而应通过 task output file 或 subagent transcript tail。

目标是在当前激活 Claude 会话的右侧 `Tasks` 面板中显示该会话派生出的后台子代理和后台任务。数据一致性由 Go 后端保证，前端只做低频轮询和安全展示。

## 非目标

- 不支持 batch Claude session。
- 不追踪或展示真实后台任务 PID，第一版统一允许 `pid = null`。
- 不实现 PID kill 或进程树 fallback。
- 不将 activity 状态写入数据库。
- 不处理超长 cwd 的 Claude hash 截断规则。
- 不把前端消息流聚合作为事实源。

## 范围

第一版只支持 interactive Claude session。

支持的 activity 类型：

| Claude `task_type` | UI 区域 | 说明 |
| --- | --- | --- |
| `local_agent` | Subagents | 后台子代理，`task_id == agentId` |
| `local_bash` | Background Tasks | 后台 shell/tool 任务 |
| 其他类型 | Other/Generic | 展示但不做强逻辑绑定 |

每个 Claude session 最多保留最近 50 条 activity。超过后丢弃最旧记录。

## 数据源

### 生命周期事件

生命周期以 Claude stdout JSONL 的 system task events 为准：

```text
task_started      -> 创建 running activity
task_progress     -> 更新描述、summary、usage
task_notification -> 标记 completed / failed / stopped
```

`output_file` 不是生命周期事实源，只能作为日志读取路径。文件存在不代表任务运行中，文件不增长也不代表任务结束。

### 日志路径

优先级：

1. 从 tool result 文本中提取运行期 output path。
2. 从 `task_notification.output_file` 覆盖确认。
3. 对常规 cwd 使用本地规则 best-effort 推导。

后台 shell/tool 常见文本：

```text
Command running in background with ID: b123. Output is being written to: <path>
```

提取正则：

```regex
Output is being written to:\s*(.+?)(?:\.?$|\n)
```

子代理默认 transcript：

```text
~/.claude/projects/<sanitized-cwd>/<session-id>/subagents/agent-<task_id>.jsonl
```

但 workflow subagent 可能进入子目录，所以直接找 transcript 时必须容忍失败。优先使用 Claude 提供的真实 `output_file`。

## 后端架构

新增包建议为 `internal/claudeactivity`，保持文件职责小而清晰，禁止单文件膨胀。

建议拆分：

| 文件 | 职责 |
| --- | --- |
| `service.go` | 对外门面，接收 Observe、查询 snapshot、停止 activity |
| `store.go` | session-scoped 内存状态，最近 50 条裁剪 |
| `types.go` | Activity、Status、Snapshot、LogTail 类型 |
| `observer.go` | 解析 Claude stdout JSONL 中的 task events 和 output path |
| `log_tail.go` | 安全读取最后 N 行/N KB |
| `tempdir.go` | Unix/macOS Claude temp 路径推导 |
| `tempdir_win.go` | Windows Claude temp 路径推导 |
| `control.go` | stop_task request/response 跟踪 |

`internal/claude/session.go` 不承载 activity 状态逻辑。它只在 stdout JSONL parse 后调用一个窄接口：

```go
type ActivityObserver interface {
    ObserveClaudeEvent(event ClaudeEvent)
    CompleteSession(sessionID string)
    HandleControlResponse(response ControlResponse)
}
```

实际接口命名可随实现调整，但方向是让 Claude session 不知道 UI/RPC 结构。

## Session 生命周期

Claude interactive session 启动后，activity service 为该 session 建立内存 bucket。session 运行期间：

- 每条 stdout JSONL 事件进入 observer。
- observer 只更新 Go 端 store。
- 前端不订阅这些原始事件作为事实源。

Claude session 结束时：

- monitor 做善后。
- 尚未收到 terminal notification 的 activity 标记为 `stale`。
- session bucket 保留到 ropcode 进程退出，仍只保留最近 50 条。

## 重启恢复

重启 ropcode 后内存 store 会丢失，但可以从 Claude 主会话 JSONL 恢复最近 50 条 activity。

恢复逻辑：

1. 用户打开 Claude 会话时，Go 根据 `projectPath + sessionId` 找主 JSONL。
2. 扫描主 JSONL 中的 task events。
3. 重建最近 50 条 activity。
4. 有 terminal notification 的记录保持 `completed/failed/stopped`。
5. 没有 terminal notification 的记录标记为 `stale`。
6. 恢复出的 stale activity 默认 `can_stop=false`。

恢复是投影重建，不需要数据库。

## Stop 行为

第一版只支持 Claude Code control request：

```json
{
  "type": "control_request",
  "request_id": "ropcode-stop-1",
  "request": {
    "subtype": "stop_task",
    "task_id": "b123"
  }
}
```

要求：

- session 必须是 interactive。
- stdin 必须仍可写。
- activity 必须是 running。

Stop 后：

- Go store 先标记 `stopping`。
- 等待 `control_response` 或 `task_notification stopped`。
- 成功后更新状态。
- 失败时记录错误并显示。
- 超时后标记 `stop_unknown` 或回到 running，具体命名实现时定。

当前 ropcode 需要新增通用 `SendControlRequest` 能力，不能复用 `SendClaudeMessage`。

同时需要修正现有 `control_response` 处理：不能把所有 `control_response` 都当初始化响应吞掉。必须按 `request_id` 分流：

- initialize response -> interactive init 逻辑
- stop_task response -> activity service
- 未知 response -> debug log

## RPC 设计

新增 reflection RPC：

```go
GetClaudeSessionActivities(sessionID string) (ClaudeActivitySnapshot, error)
GetClaudeActivityLogTail(sessionID, activityID string, maxLines int) (ClaudeActivityLogTail, error)
StopClaudeActivity(sessionID, activityID string) error
```

前端每 2-3 秒轮询 `GetClaudeSessionActivities`。日志只在用户展开 activity 时请求 `GetClaudeActivityLogTail`。

## 前端设计

右侧 sidebar 新增 `Tasks` tab，与 Console/Files 同级。

显示规则：

- 只在当前激活 tab 是 Claude chat 时显示内容。
- 永远跟随当前激活 Claude 会话。
- 非 Claude tab 显示空态或禁用。
- badge 显示当前激活会话 running/stopping/failed 数量。

布局：

- 上半区：Subagents
- 下半区：Background Tasks

每条 activity 显示：

- description
- status
- task type
- started/ended time
- summary 或 last activity
- `pid: null`
- stop 按钮，仅 `can_stop=true` 时可用

日志：

- 默认折叠。
- 展开后只显示后端返回的最后几十行。
- 固定最大高度，内部滚动。
- 不渲染完整日志，避免 10 万行导致 UI 崩溃。

## 平台差异

平台差异必须在 Go 文件层面拆分：

- `*_win.go` 处理 Windows temp 路径、路径分隔、文件读取差异。
- 默认文件处理 Unix/macOS。

早期实现要增加足够 debug log，尤其记录：

- platform
- runtime session id
- Claude-side session id
- task_id
- task_type
- output_file
- inferred output path
- path exists
- tail read bytes/lines
- ENOENT/read error
- control request id
- control response subtype/error

Windows 上需要验证 task output 是否会被清理，但第一版把所有文件读取都视作 best-effort。

## 待实测项

- `<claude-temp>` 在当前环境中的真实路径。
- `CLAUDE_CODE_TMPDIR` 是否由 Claude 进程 env 覆盖。
- PowerShell/Bash tool result 文本是否稳定包含 output path。
- `local_agent` 的 task output symlink 在 Windows 上是否可直接 tail。
- `task_notification.status` 是否仅出现 `completed/failed/stopped`。
- control response request_id 是否稳定回传。

这些不阻塞第一版设计，但必须在实现期打点验证。

