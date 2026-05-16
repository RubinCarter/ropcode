# Claude Code CLI 对外接口完整调研（对照 Ropcode 现状）

> 调研对象：`claude-code-source-code/src`（仓内 vendor 副本）
> 对照对象：Ropcode 主仓库 `internal/claude/`、`internal/claudeactivity/`、`frontend/src/`
> 调研日期：2026-05-16
> 调研分支：`subagent-progress-ui`（已 fast-forward 到 `main` @ `b85ae6b`）

---

## 0. 入口分类

Claude Code 进程对外提供三类入口：

| 入口 | 控制方向 | Ropcode 使用情况 |
|---|---|---|
| 启动参数 + 环境变量 | host → CLI（启动时一次性） | 部分使用 |
| stdin/stdout JSONL 控制协议 | host ↔ CLI（运行时双向） | 只用了 `initialize` + `stop_task` |
| 文件系统 | host ↔ CLI（异步） | 仅读取 transcript JSONL |

---

## 1. SDK Control Protocol（核心，21 个 subtype）

源码：`claude-code-source-code/src/entrypoints/sdk/controlSchemas.ts`

请求基础信封：

```json
{ "type": "control_request",
  "request_id": "<uuid>",
  "request": { "subtype": "<subtype>", ... } }
```

响应信封（controlSchemas.ts:586-610）：

```json
{ "type": "control_response",
  "response": { "subtype": "success" | "error",
                "request_id": "...",
                "response": { ... },
                "error": "..." } }
```

### 1.1 已被 Ropcode 使用

| Subtype | 文件:行 | Ropcode 调用方 | 备注 |
|---|---|---|---|
| `initialize` | controlSchemas.ts:60 | `internal/claude/session.go:362` `sendInitialize()` | 启动后立刻发送，等响应解锁 `WaitForInit()` |
| `stop_task` | controlSchemas.ts:458 | `internal/claudeactivity/control.go:23` `SendStopTask` | 通过活动面板停止子任务 |

### 1.2 完全没用上的（19 个）

| Subtype | 文件:行 | 能力 | Ropcode 缺失影响 |
|---|---|---|---|
| `interrupt` | :100 | 中断当前 turn，不杀进程 | 现在 stop 走 SIGINT/进程信号，session 状态会乱 |
| `can_use_tool` | :109 | 工具执行前权限询问（host 决定 allow/deny） | 没有自定义权限网关；只能靠 `--dangerously-skip-permissions` 或 CLI 默认行为 |
| `set_permission_mode` | :127 | 切 `default/acceptEdits/bypassPermissions/plan/dontAsk` | 现在切 plan 模式必须重启进程 |
| `set_model` | :140 | 运行时切模型 | 切模型必须重启 |
| `set_max_thinking_tokens` | :149 | 调 thinking budget | 现在通过 CLI flag 启动时设定，运行时不能改 |
| `mcp_status` | :160 | 查所有 MCP server 状态 | 没有 MCP 状态可视化 |
| `get_context_usage` | :178 | 取当前 context 占用细分（系统/工具/历史/记忆/MCP） | 没有 context 占用 UI；只能算自己累加的 token |
| `rewind_files` | :311 | 把工作区回滚到某条 user message 之前的状态 | 没有 checkpoint/rewind 能力 |
| `cancel_async_message` | :333 | 取消队列里的异步消息 | 没有消息队列管理 |
| `seed_read_state` | :354 | 给 CLI 注入文件 mtime 缓存（避免重复 stat） | 性能优化，没用上 |
| `hook_callback` | :366 | 把 host 端 hook 的结果回写给 CLI | hook 体系完全没接 |
| `mcp_message` | :377 | 透传 JSON-RPC 给某个 MCP server | 没用 |
| `mcp_set_servers` | :387 | 运行时增减 MCP server | 现在 MCP 配置只能靠 settings.json 或 `--mcp-config` 启动时设定 |
| `reload_plugins` | :408 | 热重载插件/skills/commands | 改了 skill 必须重启 |
| `mcp_reconnect` | :438 | 重连失败的 MCP server | 没有 |
| `mcp_toggle` | :447 | 启用/禁用单个 MCP server | 没有 |
| `apply_flag_settings` | :467 | 运行时合并 settings（含 model 字段） | 比 `set_model` 更通用，没用 |
| `get_settings` | :478 | 查当前生效 settings 来源链 | 调试时很有用，没用 |
| `elicitation` | :525 | 处理 MCP server 发起的"向用户索取输入"请求 | 没接 |

### 1.3 路由现状

Ropcode 已实现的 control_response 路由：`internal/claude/session.go:565-635` `handleControlResponse()`，会按 `request_id` 路由到 `init_1` 或 `claudeactivity` 服务。

> **结论：结构完整，加新 subtype 几乎零成本**——主要是没人写。

---

## 2. Initialize 响应里返回的元数据

请求字段（controlSchemas.ts:60-95）host 可以传：`hooks`, `sdkMcpServers`, `jsonSchema`, `systemPrompt`, `appendSystemPrompt`, `agents`, `promptSuggestions`, `agentProgressSummaries`

响应字段：`commands[]`, `agents[]`, `output_style`, `available_output_styles`, `models[]`, `account`, `pid`, `fast_mode_state`

### Ropcode 现状

- ✅ `internal/claude/discovery_protocol.go` 解析 `commands[]` 和 `system/init` 的 `skills[]`
- ❌ `models[]` / `account` / `pid` / `fast_mode_state` / `available_output_styles` 全部丢弃

**`models[]` 尤其可惜**：CLI 启动时已经知道当前账户能用哪些模型，Ropcode 现在只能硬编码 `CLAUDE_MODELS` 数组（`frontend/src/components/FloatingPromptInput.tsx:357-394`），导致升级模型时前端要改代码。

---

## 3. stdin 可接受的消息类型

`controlSchemas.ts:655-663` 定义的 `StdinMessageSchema` union：

| type | Ropcode 状态 | 说明 |
|---|---|---|
| `user`（普通用户消息） | ✅ `session.go:434` `SendMessage()` | |
| `control_request` | ✅ initialize / stop_task | |
| `control_response` | ❌ 没实现 | host 回应 CLI 主动发的 `can_use_tool` / `elicitation` 没法回 |
| `keep_alive` | ❌ | 长连接保活 |
| `update_environment_variables` | ❌ | 运行时改环境变量 |

---

## 4. stdout 可发出的消息类型

`controlSchemas.ts:642-653`：

| type | Ropcode 状态 |
|---|---|
| `assistant` / `user` / `system` 消息（SDKMessage） | ✅ 完整解析 |
| Streamlined text chunks | ✅ |
| Tool use summary | ✅ |
| Post-turn summary | ✅ |
| `control_response`（响应 host 的请求） | ✅ 部分（init/stop_task） |
| `control_request`（CLI 主动向 host 发请求） | ❌ 没接（影响 `can_use_tool` 和 `elicitation`） |
| `control_cancel_request` | ❌ |
| `keep_alive` | ❌ |

---

## 5. CLI 启动参数（80+，列高频）

源码：`claude-code-source-code/src/main.tsx:971-1006`

### 5.1 已被 Ropcode 使用

`internal/claude/session.go` 的 `buildClaudeArgs()` 用了：

- `--print` / `--output-format stream-json` / `--input-format stream-json`
- `--model`
- `--resume <session-id>` / `--continue`
- `--include-partial-messages`
- `--dangerously-skip-permissions`
- `--session-id`
- 自定义 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 环境变量

### 5.2 没用上的高价值参数

| 参数 | 能力 | Ropcode 可受益场景 |
|---|---|---|
| `--permission-mode <mode>` | 启动时定权限模式 | 直接进 plan 模式，不需要进入后再切 |
| `--allowed-tools` / `--disallowed-tools` | 工具白名单/黑名单 | 项目级工具策略 |
| `--mcp-config <files...>` | 加载 MCP server | 当前依赖用户全局 settings |
| `--strict-mcp-config` | 只用指定的 MCP（隔离用户全局配置） | 项目隔离 |
| `--max-turns` | 限制非交互最大 turn 数 | 防止失控 |
| `--max-budget-usd` | 限定 API 花费 | 成本控制 |
| `--task-budget` | API 端 token 预算 | 同上 |
| `--system-prompt-file` / `--append-system-prompt-file` | 系统提示来自文件 | 项目级 prompt 注入 |
| `--add-dir <dirs...>` | 额外允许目录 | 工作区跨目录支持 |
| `--rewind-files <message-id>` | 启动时回滚文件 | checkpoint 恢复 |
| `--resume-session-at <message-id>` | 从某条消息开始 resume | 历史回放 |
| `--fork-session` | resume 时新建 session id | 分叉对话 |
| `--fallback-model` | overload 时降级 | 可靠性 |
| `--betas <names...>` | 启用 beta header | 新特性试用 |
| `--workload <tag>` | 计费打 tag | 多项目计费区分 |
| `--include-hook-events` | stdout 输出 hook 生命周期 | 调试 |
| `--replay-user-messages` | 用户消息回显（确认 ack） | 调试 |
| `--prefill <text>` | 启动时预填输入框 | UX |
| `--bare` | 跳过 hooks/LSP/plugins/attribution | 调试 |
| `--init` / `--init-only` / `--maintenance` | 运行 Setup hooks | 项目初始化 |

### 5.3 Subcommands（完全没接）

`mcp serve|add|remove|add-json` / `auth login|status` / `plugin list|install|uninstall|enable|disable|update` / `marketplace add|list|remove|update` / `agents` / `config` / `doctor` / `completion`

这些是 CLI 的另一种调用形态——以"工具"方式调用。Ropcode 完全可以包装 `claude doctor` 做诊断、`claude mcp add` 做 MCP 管理。

---

## 6. 环境变量

源码：全仓库 `process.env.*` 检索。

### 6.1 Ropcode 已设置

- ✅ `ANTHROPIC_BASE_URL` (`session.go:203`)
- ✅ `ANTHROPIC_AUTH_TOKEN` (`session.go:207`)
- ✅ `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (`session.go:212`)

### 6.2 高价值未用

| 变量 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | 直接 API key（fallback） |
| `ANTHROPIC_MODEL` | 默认模型 |
| `CLAUDE_CODE_ENTRYPOINT` | 标识入口（`sdk-cli` / `cli` / `mcp` / `local-agent`）— 让 CLI 知道是被谁调起 |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | 禁 Fast Mode |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 限制输出长度 |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | 不让 CLI 改终端标题 |
| `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES` | 输出工具调用摘要 |
| `CLAUDE_CODE_FRAME_TIMING_LOG` | 帧时序日志路径（性能调优） |
| `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / `CLAUDE_CODE_USE_FOUNDRY` | 切换 API 后端 |
| `NODE_EXTRA_CA_CERTS` | 自签证书 |

---

## 7. Hooks 系统（27 个事件，完全没接）

源码：`claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts:355-383`

Hooks 是 host 在 CLI 关键生命周期点插入逻辑的能力。配置方式有两种：

- **进程内 hooks**：host 通过 `initialize` 控制请求里的 `hooks` 字段注册回调，CLI 在事件发生时通过 stdout 发 `control_request`，host 处理后通过 `hook_callback` 回写
- **外部 hooks**：settings.json 里配 bash/prompt/agent/http 命令

### 完整事件列表

| 类别 | 事件 |
|---|---|
| 权限/工具 | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied` |
| 会话生命周期 | `SessionStart`, `Setup`, `Stop`, `StopFailure`, `SessionEnd`, `UserPromptSubmit`, `Notification` |
| 子代理 | `SubagentStart`, `SubagentStop` |
| 上下文 | `PreCompact`, `PostCompact`, `InstructionsLoaded` |
| 任务 | `TaskCreated`, `TaskCompleted`, `TeammateIdle` |
| MCP | `Elicitation`, `ElicitationResult` |
| 文件/目录 | `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove` |
| 配置 | `ConfigChange` |

**Ropcode 完全没接 hooks**。这是非常大的能力缺口：

- 想做"自动通过某些工具调用"→ 应该用 `PreToolUse` hook 而不是 `--dangerously-skip-permissions`
- 想知道 CLI 何时开始压缩 context → `PreCompact`/`PostCompact`（替代当前从消息流推断 compacting 状态）
- 想监控 subagent 生命周期 → `SubagentStart`/`SubagentStop`（替代 `SubagentProgressPanel` 当前从消息流反推的方式）

---

## 8. MCP 集成（多通道，没用）

| 配置类型 | 协议 |
|---|---|
| `stdio` | 子进程 stdio |
| `sse` | Server-Sent Events |
| `http` | HTTP |
| `sdk` | 进程内 SDK server |
| `claudeai-proxy` | 通过 claude.ai 代理 |

**Ropcode 现状**：完全没有 MCP 管理 UI，没有调用 `mcp_status` / `mcp_set_servers` / `mcp_reconnect` / `mcp_toggle`。用户的 MCP 配置只能靠手编 settings.json，配置错了 Ropcode 也看不到状态。

---

## 9. Bridge / Remote（不适用）

`src/remote/` 和 `src/bridge/` 是 Claude Code 自身的 SSH/WebSocket 远程会话支持，跟 Ropcode 这种本地 host 无关。但协议是同一个 control_request schema，所以将来如果 Ropcode 要做远程开发机会话管理，可以复用同一套。

---

## 10. 文件系统接口

| 路径 | 用途 | Ropcode 使用 |
|---|---|---|
| `~/.claude/settings.json` | 全局设置 | ❌ 没读 |
| `.claude/settings.json` | 项目设置（提交） | ❌ |
| `.claude/settings.local.json` | 项目本地设置 | ❌ |
| `~/.claude/projects/<slug>/*.jsonl` | 历史 transcript | ✅ 读取（subagent transcript sync） |
| `~/.claude/CLAUDE.md` | 全局 instructions | ❌ |
| `.claude/CLAUDE.md` | 项目 instructions | ❌ |
| `.claude/agents/*.md` | 项目 agent 定义 | ❌ |
| `.claude/skills/*.md` | 项目 skill 定义 | ❌ |
| `~/.claude/scheduled_tasks.json` | 持久化定时任务 | ❌ |
| `~/.claude/keybindings.json` | 键位 | ❌ |
| `.claude/worktrees/` | worktree 目录 | ❌ |

Ropcode 只读 transcript JSONL 用于子代理聚合，settings/instructions/agents/skills/scheduled_tasks 全部不可见。

---

# Ropcode 接入路线图（按 ROI 排序）

| 优先级 | 工作 | 依赖 | 价值 |
|---|---|---|---|
| **P0** | `set_model` control_request | 现有 control_request 通道 | 切模型不重启 |
| **P0** | `set_permission_mode` | 同上 | 切 plan 模式不重启 |
| **P0** | `interrupt` control_request | 同上 | 干净中断，不杀进程 |
| **P1** | 解析 `initialize` 响应里的 `models[]` / `account` / `pid` / `fast_mode_state` | session.go:625 完成 init 路径 | 模型列表不再硬编码 |
| **P1** | `get_context_usage` | control_request | context 占用 UI |
| **P1** | `apply_flag_settings`（带 model + thinking + permission_mode） | 同上 | 一次性切多个设置 |
| **P1** | `--allowed-tools` / `--disallowed-tools` 启动参数 | buildClaudeArgs | 项目级工具策略 |
| **P2** | `can_use_tool` 双向流（出站 + `control_response` 入站） | stdout dispatcher 加分支，stdin 加 control_response 写入 | 自定义权限 UI（替代 dangerous-skip） |
| **P2** | `mcp_status` + `mcp_toggle` + `mcp_reconnect` | control_request | MCP 管理 UI |
| **P2** | Hooks `PreCompact` / `PostCompact` | initialize 里注册 hooks + control_request 双向 + `hook_callback` | 准确的 compact 信号（替代当前 status 推断） |
| **P2** | Hooks `SubagentStart` / `SubagentStop` | 同上 | 替代消息流反推子代理生命周期 |
| **P3** | `rewind_files` | control_request | checkpoint/回滚 |
| **P3** | `--max-budget-usd` / `--task-budget` | buildClaudeArgs | 成本守护 |
| **P3** | Settings 文件读写 | fs | 设置可见性 |
| **P3** | `update_environment_variables` stdin 消息 | stdin 写入 | 运行时改 env（如代理） |

---

# 核心结论

1. Ropcode **已经有 control_request 双向通道的骨架**（`session.go:381` `writeControlRequest()` + `:565-635` 路由），加任何 subtype 都是几行代码的事，**不是技术问题，是没接**。
2. **三条 P0**（`set_model` / `set_permission_mode` / `interrupt`）是现在最痛的——任何切换都要重启进程。
3. **`initialize` 响应里 80% 的字段被丢弃了**——`models`/`account`/`pid`/`fast_mode_state` 全都进回收站。`discovery_protocol.go` 只接了 `commands` 和 skills。
4. **Hooks 是最大未开采矿区**——现在 SubagentProgressPanel、compacting 状态显示，都可以用 hooks 替代脏的"从消息流反推"。
5. **MCP 管理完全空白**——这块是 Claude Code 生态最活跃的扩展点，Ropcode 现在等于把这个能力封死了。

如果要落地，建议先做 P0 三条 + initialize 元数据解析，工作量大约一周，能直接消除"为什么切模型/切权限要重启"这个最大用户痛点。

---

# 参考来源

- 调研主索引：`claude-code-source-code/src/entrypoints/sdk/controlSchemas.ts`
- Hooks schema：`claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts`
- CLI 选项：`claude-code-source-code/src/main.tsx:971-1006`
- 处理器：`claude-code-source-code/src/cli/print.ts`、`claude-code-source-code/src/cli/structuredIO.ts`
- Ropcode 现状基线：
  - `internal/claude/session.go:361-635`
  - `internal/claude/discovery_protocol.go`
  - `internal/claudeactivity/control.go`
  - `frontend/src/components/FloatingPromptInput.tsx:357-394`
