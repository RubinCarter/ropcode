# Codex → Claude 协议适配规划

## 一、Claude 协议目标格式（OutputEvent 必须遵循的规范）

Claude 的 OutputEvent 只有以下几种有效组合：

| OutputEvent.Type | OutputEvent.Subtype | 用途 | message.content[] 内容 |
|-----------------|--------------------|----|----------------------|
| `system` | `init` | 会话初始化 | 无 content，直接放 metadata |
| `system` | `thread_created` | 会话 ID 创建 | session_id |
| `system` | `token_usage` | Token 用量 | usage 数据 |
| `assistant` | - | 文本/思考/工具调用 | `[{type:"text"}]` 或 `[{type:"thinking"}]` 或 `[{type:"tool_use"}]` |
| `assistant` (IsDelta) | - | 流式文本增量 | `[{type:"text", text: delta}]` |
| `assistant` | `result` | 回合结束 | `{type:"result", subtype:"success"}` |
| `user` | - | 工具结果 | `[{type:"tool_result", tool_use_id, content, is_error}]` |
| `error` | - | 错误 | `{type:"error", message: "..."}` |
| `nil` | - | 静默丢弃 | 不产生任何帧 |

**核心规则**：
1. 永远不产生空 content 的 assistant/user 帧
2. tool_use 和 tool_result 必须通过相同 ID 配对
3. 只有上述类型会被 ProviderBridge 转为 SessionFrame 发送给前端

---

## 二、Codex 事件分类（按作用分组）

### A. 会话生命周期事件（Session Lifecycle）

这些事件管理会话的创建、状态变化，不直接产生用户可见内容。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `response/init_1` | 初始化响应，确认连接 |
| Interactive | `response/thread_1` | 线程创建，返回 thread.id（关键：用作 session_id） |
| Interactive | `response/turn_1` | 确认 turn 开始 |
| Interactive | `thread/started` | 线程启动通知 |
| Interactive | `thread/status/changed` | 线程状态变化（idle/active） |
| Interactive | `turn/started` | 回合开始 |
| Interactive | `turn/completed` | 回合结束 ★ |
| Batch | `thread.started` | 线程启动（含 thread_id） |
| Batch | `turn.started` | 回合开始 |
| Batch | `turn.completed` | 回合结束（含 usage） ★ |
| Stored | `session_meta` | 会话元数据 |
| Stored | `turn_context` | 回合上下文（cwd, permissions） |
| Stored | `event_msg/task_started` | 任务开始 |
| Stored | `event_msg/task_complete` | 任务完成 ★ |

### B. 内容输出事件（Content Output）

这些事件产生用户可见的文本内容。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `item/started(agentMessage)` | 文本消息开始 |
| Interactive | `item/agentMessage/delta` | 流式文本增量 ★ |
| Interactive | `item/completed(agentMessage)` | 文本消息完成 ★ |
| Batch | `item.completed/agent_message` | 文本消息完成 ★ |
| Batch | `message.delta` | 流式文本增量 ★ |
| Stored | `event_msg/agent_message` | 完整文本消息 ★ |

### C. 推理事件（Reasoning/Thinking）

模型的内部推理过程。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `item/started(reasoning)` | 推理开始 |
| Interactive | `item/completed(reasoning)` | 推理完成（summary/content） ★ |
| Stored | `response_item/reasoning` | 推理摘要 ★ |
| Stored | `event_msg/agent_reasoning` | 推理文本 ★ |

### D. 工具调用事件（Tool Use）

Shell 命令执行、函数调用等。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `item/started(commandExecution)` | Shell 命令开始 → tool_use ★ |
| Interactive | `item/completed(commandExecution)` | Shell 命令完成 → tool_result ★ |
| Interactive | `item/started(functionCall)` | 函数调用开始 → tool_use ★ |
| Interactive | `item/completed(functionCallOutput)` | 函数结果 → tool_result ★ |
| Batch | `item.started(command_execution)` | Shell 命令开始 → tool_use ★ |
| Batch | `item.completed/command_execution` | Shell 命令完成 → tool_result ★ |
| Stored | `response_item/function_call(exec_command)` | Shell 命令 → tool_use ★ |
| Stored | `response_item/function_call_output` | 命令结果 → tool_result ★ |
| Stored | `response_item/function_call(update_plan)` | 计划更新 → tool_use ★ |
| Stored | `response_item/web_search_call` | 网络搜索 → tool_use ★ |

### E. 子代理事件（Subagent/Collaboration）

子代理的创建和管理。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `item/started(collab_tool_call)` | 子代理调用开始 → tool_use ★ |
| Interactive | `item/completed(collab_tool_call)` | 子代理结果 → tool_result ★ |
| Stored | `response_item/function_call(spawn_agent, ns:multi_agent_v1)` | 创建子代理 → tool_use ★ |
| Stored | `response_item/function_call(wait_agent, ns:multi_agent_v1)` | 等待子代理 → tool_use ★ |
| Stored | `response_item/function_call_output` (对应 spawn/wait) | 子代理结果 → tool_result ★ |
| Stored | `session_meta/subagent` | 子代理会话元数据 |

### F. 用户输入事件（User Input）

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `item/started(userMessage)` | 用户消息开始 |
| Interactive | `item/completed(userMessage)` | 用户消息完成 |
| Stored | `event_msg/user_message` | 用户消息 |

### G. 元数据/系统事件（Metadata）

不产生用户可见内容，但可能需要内部处理。

| 格式 | 事件 | 作用 |
|------|------|------|
| Interactive | `thread/tokenUsage/updated` | Token 用量 |
| Interactive | `mcpServer/startupStatus/updated` | MCP 服务器状态 |
| Interactive | `remoteControl/status/changed` | 远程控制状态 |
| Interactive | `account/rateLimits/updated` | 速率限制 |
| Stored | `event_msg/token_count` | Token 用量 |
| Stored | `event_msg/web_search_end` | 搜索结束 |
| Stored | `response_item/tool_search_call` | 工具搜索 |
| Stored | `response_item/tool_search_output` | 工具搜索结果 |
| Stored | `response_item/message(developer)` | 系统/开发者消息 |

---

## 三、具体适配映射

### 3.1 Interactive (JSON-RPC) → OutputEvent

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Codex JSON-RPC Event              │ OutputEvent                             │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response(id=init_1)               │ system/control_response                 │
│ response(id=thread_1)             │ system/thread_created {session_id}      │
│ response(id=turn_*)               │ nil                                     │
│ response(error)                   │ error                                   │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ thread/started                    │ nil                                     │
│ thread/status/changed             │ nil                                     │
│ turn/started                      │ nil                                     │
│ turn/completed                    │ assistant(subtype:result)               │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(userMessage)         │ nil                                     │
│ item/completed(userMessage)       │ nil (用户消息由我们自己发送，不需回显)    │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(reasoning)           │ nil                                     │
│ item/completed(reasoning)         │ assistant [{type:"thinking", thinking}] │
│                                   │ (仅当 summary/content 非空时)            │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(agentMessage)        │ nil                                     │
│ item/agentMessage/delta           │ assistant(IsDelta) [{type:"text",text}] │
│ item/completed(agentMessage)      │ assistant [{type:"text", text}]         │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(commandExecution)    │ assistant [{type:"tool_use",            │
│                                   │   id, name:"Bash",                      │
│                                   │   input:{command: 提取的命令}}]          │
│ item/completed(commandExecution)  │ user [{type:"tool_result",              │
│                                   │   tool_use_id: id,                      │
│                                   │   content: aggregatedOutput,            │
│                                   │   is_error: exitCode!=0}]               │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(functionCall)        │ assistant [{type:"tool_use",            │
│                                   │   id, name, input: parse(arguments)}]   │
│ item/completed(functionCallOutput)│ user [{type:"tool_result",              │
│                                   │   tool_use_id: call_id,                 │
│                                   │   content: output}]                     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item/started(collab_tool_call)    │ assistant [{type:"tool_use",            │
│                                   │   id, name:"Agent",                     │
│                                   │   input:{...spawn params}}]             │
│ item/completed(collab_tool_call)  │ user [{type:"tool_result",              │
│                                   │   tool_use_id: id,                      │
│                                   │   content: result}]                     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ thread/tokenUsage/updated         │ system/token_usage {usage映射}          │
│ mcpServer/startupStatus/updated   │ nil                                     │
│ remoteControl/status/changed      │ nil                                     │
│ account/rateLimits/updated        │ nil                                     │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

### 3.2 Batch (exec --json) → OutputEvent

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Codex Batch Event                 │ OutputEvent                             │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ thread.started                    │ system/init {session_id: thread_id}     │
│ turn.started                      │ nil                                     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item.started(command_execution)   │ assistant [{type:"tool_use",            │
│                                   │   id, name:"Bash",                      │
│                                   │   input:{command: 提取的命令}}]          │
│ item.completed(command_execution) │ user [{type:"tool_result",              │
│                                   │   tool_use_id: id,                      │
│                                   │   content: aggregated_output,           │
│                                   │   is_error: exit_code!=0}]              │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ item.completed(agent_message)     │ assistant [{type:"text", text}]         │
│ message.delta                     │ assistant(IsDelta) [{type:"text",text}] │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ turn.completed                    │ assistant(subtype:result)               │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

### 3.3 Stored JSONL (history) → OutputEvent

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Codex Stored Event                │ OutputEvent                             │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ session_meta                      │ system/init {session metadata}          │
│ session_meta(subagent)            │ system/init {subagent metadata}         │
│ turn_context                      │ nil                                     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ event_msg/task_started            │ nil                                     │
│ event_msg/task_complete           │ assistant(subtype:result)               │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ event_msg/agent_message           │ assistant [{type:"text", text}]         │
│ event_msg/agent_reasoning         │ assistant [{type:"thinking", thinking}] │
│ event_msg/user_message            │ user [{type:"text", text}]              │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response_item/function_call       │ assistant [{type:"tool_use",            │
│   (name=exec_command)             │   id:call_id, name:"Bash",             │
│                                   │   input:{command: parse(args).cmd}}]    │
│ response_item/function_call       │ assistant [{type:"tool_use",            │
│   (name=update_plan)              │   id:call_id, name:"TodoWrite",        │
│                                   │   input: parse(arguments)}]             │
│ response_item/function_call       │ assistant [{type:"tool_use",            │
│   (ns=multi_agent_v1,             │   id:call_id, name:"Agent",            │
│    name=spawn_agent)              │   input: parse(arguments)}]             │
│ response_item/function_call       │ assistant [{type:"tool_use",            │
│   (ns=multi_agent_v1,             │   id:call_id, name:"Agent.wait",       │
│    name=wait_agent)               │   input: parse(arguments)}]             │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response_item/function_call_output│ user [{type:"tool_result",              │
│                                   │   tool_use_id: call_id,                 │
│                                   │   content: output}]                     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response_item/reasoning           │ assistant [{type:"thinking",            │
│                                   │   thinking: summary[0].text}]           │
│                                   │ (仅当 summary 非空时；                   │
│                                   │  encrypted_content 忽略)                 │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response_item/web_search_call     │ assistant [{type:"tool_use",            │
│                                   │   name:"WebSearch",                     │
│                                   │   input:{queries: action.queries}}]     │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ response_item/message(developer)  │ nil (系统指令，不显示)                    │
│ response_item/tool_search_call    │ nil (内部工具发现，不显示)                │
│ response_item/tool_search_output  │ nil (内部工具发现结果，不显示)            │
│ event_msg/token_count             │ system/token_usage {usage映射}          │
│ event_msg/web_search_end          │ nil                                     │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

---

## 四、关键适配细节

### 4.1 命令提取逻辑

Codex 的 shell 命令被包裹在 `/bin/zsh -lc '...'` 中，需要提取实际命令：

**Interactive**:
```
item.commandActions[0].command  →  优先使用（干净的命令）
item.command                    →  回退（含 shell wrapper）
```

**Batch**:
```
item.command 去掉 "/bin/zsh -lc '" 前缀和 "'" 后缀
```

**Stored**:
```
JSON.parse(payload.arguments).cmd 或 .command
```

### 4.2 Tool Name 映射

| Codex 原始名称 | → Claude 工具名 |
|---------------|----------------|
| `exec_command` / `commandExecution` / `command_execution` | `Bash` |
| `update_plan` | `TodoWrite` |
| `spawn_agent` (ns: multi_agent_v1) | `Agent` |
| `wait_agent` (ns: multi_agent_v1) | `Agent.wait` |
| `close_agent` (ns: multi_agent_v1) | `Agent.close` |
| `send_input` (ns: multi_agent_v1) | `Agent.send` |
| `resume_agent` (ns: multi_agent_v1) | `Agent.resume` |
| `web_search_call` | `WebSearch` |
| 其他 function_call | 保持原名 |

### 4.3 Token Usage 映射

| Codex 字段 | → Claude 字段 |
|-----------|--------------|
| `inputTokens` / `input_tokens` | `input_tokens` |
| `outputTokens` / `output_tokens` | `output_tokens` |
| `cachedInputTokens` / `cached_input_tokens` | `cache_read_input_tokens` |
| `reasoningOutputTokens` / `reasoning_output_tokens` | (额外字段，保留) |
| `totalTokens` / `total_tokens` | `total_tokens` |

### 4.4 Error 检测

| 场景 | 判断条件 |
|------|---------|
| Interactive commandExecution | `exitCode != 0` |
| Batch command_execution | `exit_code != 0` |
| Stored function_call_output | output 包含 "error" / "Error" / exitCode 信息 |
| JSON-RPC error response | `response.error` 存在 |

### 4.5 nil 事件（静默丢弃，不产生帧）

以下事件不应产生任何 OutputEvent（返回 nil）：

- `thread/started`, `thread/status/changed` — 生命周期噪音
- `turn/started` — 回合开始无需通知前端
- `item/started(userMessage)`, `item/completed(userMessage)` — 用户消息由我们发送
- `item/started(reasoning)` — 推理开始无内容
- `item/started(agentMessage)` — 文本开始无内容
- `mcpServer/startupStatus/updated` — MCP 内部状态
- `remoteControl/status/changed` — 远程控制
- `account/rateLimits/updated` — 速率限制
- `turn_context` — 内部上下文
- `event_msg/task_started` — 任务开始
- `response_item/message(developer)` — 系统指令
- `response_item/tool_search_*` — 内部工具发现
- `event_msg/web_search_end` — 搜索结束标记

---

## 五、实现文件规划

| 文件 | 职责 |
|------|------|
| `internal/provider/codex/output_parser.go` | Interactive + Batch 实时流解析 |
| `internal/provider/codex/history_normalize.go` | Stored JSONL 历史归一化 |

两个文件共享的辅助函数：
- `extractShellCommand(item)` — 从 commandActions 或 command 字段提取干净命令
- `mapToolName(name, namespace)` — Codex 工具名 → Claude 工具名
- `parseArguments(argsJSON)` — 解析 JSON 字符串参数
- `mapTokenUsage(raw)` — Token 用量字段映射
- `codexReasoningText(item)` — 从 reasoning item 提取文本

---

## 六、验证清单

- [ ] text 消息正确显示（delta 流式 + completed 完整）
- [ ] tool_use (Bash) 正确显示命令
- [ ] tool_result 正确显示输出和错误状态
- [ ] tool_use 和 tool_result 通过相同 ID 配对
- [ ] thinking/reasoning 正确显示
- [ ] subagent (Agent) 工具调用正确显示
- [ ] result 事件正确触发前端 "回合结束"
- [ ] 无空 content 帧产生
- [ ] 无多余的 system 帧干扰前端
- [ ] token usage 正确传递
- [ ] 历史回放与实时流产生相同的前端效果
