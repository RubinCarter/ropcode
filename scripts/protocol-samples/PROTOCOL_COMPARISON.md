# Protocol Comparison: Claude vs Codex

## Overview

This document compares the **live streaming** and **stored JSONL** formats for both Claude and Codex.
The goal is to map Codex events → Claude protocol format in `output_parser.go`.

---

## Claude Live Protocol (stream-json via stdout)

Claude outputs one JSON object per line. Each has a top-level `type` field.

### Event Types

| type | subtype | Description |
|------|---------|-------------|
| `system` | `init` | Session initialization (tools, model, cwd, etc.) |
| `system` | `hook_started` | Hook execution started |
| `system` | `hook_response` | Hook execution result |
| `assistant` | - | Assistant message with `message.content[]` blocks |
| `user` | - | User message / tool results with `message.content[]` blocks |
| `result` | `success` | Turn completed |

### Content Block Types (inside `message.content[]`)

| Block type | Role | Fields |
|-----------|------|--------|
| `text` | assistant | `text` |
| `thinking` | assistant | `thinking` |
| `tool_use` | assistant | `id`, `name`, `input` |
| `tool_result` | user | `tool_use_id`, `content`, `is_error` |

### Sample: assistant/tool_use
```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "id": "tooluse_8X2zr8YgzCZNp6P9iYYqc3",
        "input": {"command": "echo hello_protocol_test", "description": "Print test string"},
        "name": "Bash",
        "type": "tool_use"
      }
    ],
    "id": "msg_9cc400f4-37c4-4d1d-bbac-",
    "model": "claude-opus-4-7",
    "role": "assistant",
    "type": "message"
  },
  "session_id": "74ec1076-9980-44d2-9a97-0a2e06741971"
}
```

### Sample: user/tool_result
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "tooluse_8X2zr8YgzCZNp6P9iYYqc3",
        "type": "tool_result",
        "content": "hello_protocol_test",
        "is_error": false
      }
    ]
  },
  "session_id": "74ec1076-9980-44d2-9a97-0a2e06741971"
}
```

### Sample: assistant/text
```json
{
  "type": "assistant",
  "message": {
    "content": [
      {"text": "输出为 `hello_protocol_test`。", "type": "text"}
    ],
    "id": "msg_406aa7f9-b32e-45b5-83bf-",
    "model": "claude-opus-4-7",
    "role": "assistant",
    "type": "message"
  },
  "session_id": "74ec1076-9980-44d2-9a97-0a2e06741971"
}
```

### Sample: result
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 10607,
  "num_turns": 2,
  "result": "输出为 `hello_protocol_test`。",
  "session_id": "74ec1076-9980-44d2-9a97-0a2e06741971"
}
```

---

## Codex Live Protocol (JSON-RPC over stdio, app-server mode)

Codex uses JSON-RPC 2.0. Responses have `id` field, notifications have `method` field.

### Response Types (have `id`, no `method`)

| id pattern | Description |
|-----------|-------------|
| `init_1` | Initialize response (userAgent, codexHome, etc.) |
| `thread_1` | Thread created (contains thread.id for subsequent calls) |
| `turn_1` | Turn acknowledged |

### Notification Types (have `method`, no `id`)

| method | Description |
|--------|-------------|
| `thread/started` | Thread started (full thread object) |
| `thread/status/changed` | Thread status → active/idle |
| `thread/tokenUsage/updated` | Token usage stats |
| `turn/started` | Turn started |
| `turn/completed` | Turn completed (end of response) |
| `item/started` | Item started (see item types below) |
| `item/completed` | Item completed (see item types below) |
| `item/agentMessage/delta` | Streaming text delta |
| `mcpServer/startupStatus/updated` | MCP server status |
| `remoteControl/status/changed` | Remote control status |
| `account/rateLimits/updated` | Rate limit info |

### Item Types (inside `params.item`)

| item.type | Description | Key fields |
|-----------|-------------|------------|
| `userMessage` | User input | `content[].text` |
| `reasoning` | Model reasoning | `summary[]`, `content[]` |
| `agentMessage` | Assistant text | `text`, `phase` |
| `commandExecution` | Shell command | `id`, `command`, `commandActions[]`, `aggregatedOutput`, `exitCode` |
| `functionCall` | Function call | `id`, `name`, `arguments` |
| `functionCallOutput` | Function result | `call_id`, `output` |
| `collab_tool_call` | Subagent spawn | (from stored format, not seen in live yet) |

### Sample: item/started (commandExecution)
```json
{
  "method": "item/started",
  "params": {
    "item": {
      "type": "commandExecution",
      "id": "call_MlkLV4yXoEuh8hpUQHO8ESKZ",
      "command": "/bin/zsh -lc 'echo hello_world'",
      "cwd": "/Users/rubin/.../protocol-samples",
      "processId": "82686",
      "source": "unifiedExecStartup",
      "status": "inProgress",
      "commandActions": [{"type": "unknown", "command": "echo hello_world"}],
      "aggregatedOutput": null,
      "exitCode": null
    },
    "threadId": "019e5e94-61d2-77e2-9325-d0e1c9c43e67",
    "turnId": "019e5e94-69a2-7c93-a4df-b23e0a425ff3"
  }
}
```

### Sample: item/completed (commandExecution)
```json
{
  "method": "item/completed",
  "params": {
    "item": {
      "type": "commandExecution",
      "id": "call_MlkLV4yXoEuh8hpUQHO8ESKZ",
      "command": "/bin/zsh -lc 'echo hello_world'",
      "status": "completed",
      "commandActions": [{"type": "unknown", "command": "echo hello_world"}],
      "aggregatedOutput": "hello_world\n",
      "exitCode": 0
    },
    "threadId": "...",
    "turnId": "..."
  }
}
```

### Sample: item/agentMessage/delta
```json
{
  "method": "item/agentMessage/delta",
  "params": {
    "threadId": "019e5e94-61d2-77e2-9325-d0e1c9c43e67",
    "turnId": "019e5e94-69a2-7c93-a4df-b23e0a425ff3",
    "itemId": "msg_015d31619437bed1016a141dddaca881948f454f70dd28d3a5",
    "delta": "我"
  }
}
```

### Sample: item/completed (agentMessage)
```json
{
  "method": "item/completed",
  "params": {
    "item": {
      "type": "agentMessage",
      "id": "msg_015d31619437bed1016a141dddaca881948f454f70dd28d3a5",
      "text": "我会直接运行这两个命令，并把实际输出汇总给你。",
      "phase": "commentary",
      "memoryCitation": null
    },
    "threadId": "...",
    "turnId": "..."
  }
}
```

### Sample: item/started (reasoning)
```json
{
  "method": "item/started",
  "params": {
    "item": {
      "type": "reasoning",
      "id": "rs_015d31619437bed1016a141dd943bc8194ac00946dc7528df5",
      "summary": [],
      "content": []
    },
    "threadId": "...",
    "turnId": "..."
  }
}
```

### Sample: thread/tokenUsage/updated
```json
{
  "method": "thread/tokenUsage/updated",
  "params": {
    "threadId": "...",
    "turnId": "...",
    "tokenUsage": {
      "total": {"totalTokens": 22436, "inputTokens": 22026, "cachedInputTokens": 2432, "outputTokens": 410, "reasoningOutputTokens": 242},
      "last": {"totalTokens": 22436, "inputTokens": 22026, "cachedInputTokens": 2432, "outputTokens": 410, "reasoningOutputTokens": 242},
      "modelContextWindow": 258400
    }
  }
}
```

---

## Codex Batch Protocol (exec --json, stdout)

Simpler flat JSONL format. Each line has a top-level `type`.

### Event Types

| type | Description |
|------|-------------|
| `thread.started` | Session started (`thread_id`) |
| `turn.started` | Turn started |
| `item.started` | Item started (same item types as interactive) |
| `item.completed` | Item completed |
| `turn.completed` | Turn completed (includes `usage`) |
| `message.delta` | Text streaming delta |

### Sample: item.started (commandExecution, batch)
```json
{
  "type": "item.started",
  "item": {
    "id": "item_0",
    "type": "command_execution",
    "command": "/bin/zsh -lc 'echo hello_protocol_test'",
    "aggregated_output": "",
    "exit_code": null,
    "status": "in_progress"
  }
}
```

### Sample: item.completed (commandExecution, batch)
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_0",
    "type": "command_execution",
    "command": "/bin/zsh -lc 'echo hello_protocol_test'",
    "aggregated_output": "hello_protocol_test\n",
    "exit_code": 0,
    "status": "completed"
  }
}
```

### Sample: item.completed (agent_message, batch)
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_2",
    "type": "agent_message",
    "text": "已运行两个命令：..."
  }
}
```

### Sample: turn.completed (batch)
```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 43195,
    "cached_input_tokens": 25856,
    "output_tokens": 345,
    "reasoning_output_tokens": 166
  }
}
```

---

## Codex Stored JSONL Format (~/.codex/sessions/)

Different from both live protocols. Uses `response_item` wrapper.

### Event Types

| type | payload.type | Description |
|------|-------------|-------------|
| `session_meta` | - | Session metadata |
| `turn_context` | - | Turn context (cwd, permissions, etc.) |
| `event_msg` | `task_started` | Turn started |
| `event_msg` | `task_complete` | Turn completed |
| `event_msg` | `agent_message` | Agent text |
| `event_msg` | `agent_reasoning` | Reasoning text |
| `event_msg` | `user_message` | User input |
| `event_msg` | `token_count` | Token usage |
| `response_item` | `message` | System/developer message |
| `response_item` | `function_call` | Tool call |
| `response_item` | `function_call_output` | Tool result |
| `response_item` | `reasoning` | Reasoning summary |
| `response_item` | `web_search_call` | Web search |
| `response_item` | `tool_search_call` | Tool search |
| `response_item` | `tool_search_output` | Tool search result |

### Sample: response_item/function_call (stored)
```json
{
  "timestamp": "2026-05-25T06:12:09.420Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "exec_command",
    "arguments": "{\"command\":\"git branch -m research-openclaw-info\"}",
    "call_id": "call_v2R4bMOK2nJAmy8Ffbn72NGt"
  }
}
```

### Sample: response_item/function_call (spawn_agent, stored)
```json
{
  "timestamp": "2026-05-24T04:57:11.948Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "spawn_agent",
    "namespace": "multi_agent_v1",
    "arguments": "{\"agent_type\":\"explorer\",\"fork_context\":true,\"message\":\"...\"}",
    "call_id": "call_1EdFGP4p8gDvMWI8nRAhc3Dt"
  }
}
```

### Sample: response_item/function_call_output (stored)
```json
{
  "timestamp": "2026-05-25T06:12:09.450Z",
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_v2R4bMOK2nJAmy8Ffbn72NGt",
    "output": "Plan updated"
  }
}
```

### Sample: event_msg/agent_message (stored)
```json
{
  "timestamp": "...",
  "type": "event_msg",
  "payload": {
    "type": "agent_message",
    "text": "The agent's response text..."
  }
}
```

### Sample: response_item/reasoning (stored)
```json
{
  "timestamp": "2026-05-25T06:12:08.871Z",
  "type": "response_item",
  "payload": {
    "type": "reasoning",
    "summary": [
      {"type": "summary_text", "text": "**Planning web execution**\n\n..."}
    ]
  }
}
```

---

## Protocol Mapping: Codex → Claude OutputEvent

### Live Interactive (JSON-RPC) → OutputEvent

| Codex Event | → OutputEvent.Type | → content block |
|-------------|-------------------|-----------------|
| `response/init_1` | `system` (subtype: control_response) | - |
| `response/thread_1` | `system` (subtype: thread_created) | session_id |
| `thread/started` | nil (suppress) | - |
| `thread/status/changed` | nil (suppress) | - |
| `turn/started` | nil (suppress) | - |
| `turn/completed` | `assistant` (subtype: result) | result/success |
| `item/started(userMessage)` | nil (suppress) | - |
| `item/completed(userMessage)` | nil (suppress) | - |
| `item/started(reasoning)` | nil (suppress) | - |
| `item/completed(reasoning)` | `assistant` | `[{type: "thinking", thinking: text}]` |
| `item/started(commandExecution)` | `assistant` | `[{type: "tool_use", id, name: "Bash", input: {command}}]` |
| `item/completed(commandExecution)` | `user` | `[{type: "tool_result", tool_use_id, content, is_error}]` |
| `item/started(agentMessage)` | nil (suppress) | - |
| `item/agentMessage/delta` | `assistant` (IsDelta: true) | `[{type: "text", text: delta}]` |
| `item/completed(agentMessage)` | `assistant` | `[{type: "text", text}]` |
| `item/started(functionCall)` | `assistant` | `[{type: "tool_use", id, name, input}]` |
| `item/completed(functionCallOutput)` | `user` | `[{type: "tool_result", tool_use_id, content}]` |
| `item/started(collab_tool_call)` | `assistant` | `[{type: "tool_use", id, name: "Agent", input}]` |
| `item/completed(collab_tool_call)` | `user` | `[{type: "tool_result", tool_use_id, content}]` |
| `thread/tokenUsage/updated` | `system` (subtype: token_usage) | usage data |
| `mcpServer/startupStatus/updated` | nil (suppress) | - |
| `remoteControl/status/changed` | nil (suppress) | - |
| `account/rateLimits/updated` | nil (suppress) | - |

### Batch (exec --json) → OutputEvent

| Codex Event | → OutputEvent.Type | → content block |
|-------------|-------------------|-----------------|
| `thread.started` | `system` (subtype: init) | session_id |
| `turn.started` | nil (suppress) | - |
| `item.started(command_execution)` | `assistant` | `[{type: "tool_use", id, name: "Bash", input: {command}}]` |
| `item.completed(command_execution)` | `user` | `[{type: "tool_result", tool_use_id, content, is_error}]` |
| `item.completed(agent_message)` | `assistant` | `[{type: "text", text}]` |
| `turn.completed` | `assistant` (subtype: result) | result/success |
| `message.delta` | `assistant` (IsDelta: true) | `[{type: "text", text: delta}]` |

### Stored JSONL → OutputEvent (history normalization)

| Codex Event | → OutputEvent.Type | → content block |
|-------------|-------------------|-----------------|
| `session_meta` | `system` (subtype: init) | session metadata |
| `turn_context` | nil (suppress) | - |
| `event_msg/task_started` | nil (suppress) | - |
| `event_msg/task_complete` | `assistant` (subtype: result) | result/success |
| `event_msg/agent_message` | `assistant` | `[{type: "text", text}]` |
| `event_msg/agent_reasoning` | `assistant` | `[{type: "thinking", thinking: text}]` |
| `event_msg/user_message` | `user` | `[{type: "text", text}]` |
| `response_item/function_call` | `assistant` | `[{type: "tool_use", id: call_id, name, input}]` |
| `response_item/function_call_output` | `user` | `[{type: "tool_result", tool_use_id: call_id, content}]` |
| `response_item/message(developer)` | nil (suppress) | - |
| `response_item/reasoning` | `assistant` | `[{type: "thinking", thinking: summary_text}]` |
| `response_item/web_search_call` | `assistant` | `[{type: "tool_use", name: "WebSearch", input}]` |
| `response_item/tool_search_call` | nil (suppress) | - |
| `response_item/tool_search_output` | nil (suppress) | - |

---

## Key Differences Between Formats

### Naming Conventions
| Concept | Interactive (JSON-RPC) | Batch (exec --json) | Stored JSONL |
|---------|----------------------|--------------------|--------------| 
| Shell command | `commandExecution` | `command_execution` | `function_call(exec_command)` |
| Agent text | `agentMessage` | `agent_message` | `event_msg/agent_message` |
| Reasoning | `reasoning` | (not seen) | `response_item/reasoning` + `event_msg/agent_reasoning` |
| Subagent | `collab_tool_call` (?) | (not seen) | `function_call(spawn_agent, ns:multi_agent_v1)` |
| Tool call | `functionCall` | (not seen) | `function_call` |
| Tool result | `functionCallOutput` | (not seen) | `function_call_output` |

### Command Extraction
- **Interactive**: `item.commandActions[0].command` (clean) or strip shell wrapper from `item.command`
- **Batch**: Strip `/bin/zsh -lc '...'` wrapper from `item.command`
- **Stored**: Parse `arguments` JSON string, extract `command` field

### Error Detection
- **Interactive**: `item.exitCode !== 0`
- **Batch**: `item.exit_code !== 0`
- **Stored**: No explicit error field; infer from output content
