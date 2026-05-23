# 会话 UI / 消息流深度调查报告

日期：2026-05-22

## 结论摘要

会话 UI / 消息流已经做过一轮局部拆分，但当前仍不是一个清晰的功能模块。`AiCodeSession.tsx` 仍然是会话页面、消息恢复、prompt 发送、进程状态、WebSocket 补漏、状态栏、preview、复制导出和停止/清空语义的总控文件。`useMessages.ts` 和 `useSessionEvents.ts` 虽然已经抽出，但它们承载了大量性能和时序约束，不能按普通 hook 继续机械拆分。

当前最重要的事实是：后端所有 provider 仍通过历史命名的 `claude-output` / `claude-error` / `claude-complete` 通道发送“类 Claude JSONL”消息，Go 侧批处理后由 `App.tsx` 按 `cwd` 转发成 `claude-output:<projectPath>` 浏览器事件，最后由 `useSessionEvents` 写入 `useMessages`。这条链路是会话 UI 重构的主轴。

建议先做“边界固化 + 测试补强”，再做文件拆分。第一轮不要改变事件名、消息形状、rAF 批处理、tail-only 订阅、历史恢复或 interactive session ID 语义。

## 当前入口和文件规模

| 文件 | 行数 | 当前职责 |
| --- | ---: | --- |
| `frontend/src/components/ai-code-session/AiCodeSession.tsx` | 1867 | 会话页面总控、prompt 发送、历史恢复、WebSocket 恢复、停止/清空、status bar、preview、复制 |
| `frontend/src/components/ai-code-session/hooks/useSessionEvents.ts` | 568 | 监听 `claude-output:<cwd>` / error / complete，解析消息，更新 session、metrics、todo、runtime、queue |
| `frontend/src/components/ai-code-session/hooks/useMessages.ts` | 543 | 消息存储、rAF 批处理、delta 合并、派生上下文、token、subagent progress、tail 订阅 |
| `frontend/src/components/StreamMessage.tsx` | 1470 | 单条消息渲染、Markdown、工具展示路由、tool result 绑定、memo 比较 |
| `frontend/src/components/ai-code-session/MessageStreamView.tsx` | 303 | Virtuoso 列表、subagent panel 插入、streaming tail row 隔离刷新 |
| `frontend/src/components/ToolWidgets.tsx` | 3373 | 工具调用 UI 展示，仍是消息渲染最大下游依赖 |

`frontend/src/components/ai-code-session/README.md` 和 `REFACTORING_GUIDE.md` 已经过时：文档提到 `AiCodeSessionCore.tsx`、hooks 行数和“主组件约 800 行”等状态，当前源码并不匹配。后续计划应以源码调查为准，不应继续按旧指南执行。

## 实际消息链路

### 1. Provider 进程到统一 JSONL

后端 `internal/claude/session.go` 直接读取 Claude JSONL，补充：

- `session_id`
- `cwd`
- `timestamp`
- `provider`
- `processing`
- `debug_meta.runtime_state`
- interactive 模式下的 `claude_session_id`

Codex、Gemini、DeepSeek 各自在 `transformToUnified` 中把 provider 原生事件转换成类 Claude 消息：

- `type: system/subtype:init`
- `type: assistant` + `message.content`
- `type: user` + `tool_result`
- `type: result`
- `type: error`
- `provider: codex|gemini|deepseek`
- `cwd: projectPath`

注意：这些 provider 仍调用 `emitter.Emit("claude-output", unified)`。这不是 bug，而是现有兼容层。

### 2. Go 事件批处理

`internal/eventhub/coalescer.go` 把高频 `claude-output` 按 `session_id` 合并成 `claude-output-batch`，窗口为 16ms，最多 256 行。任何非 output 事件会先 flush，保证 `claude-complete` / `claude-error` 不会跑到前面的 stream 消息之前。

这意味着前端重构必须保持以下顺序约束：

- batch 内 line 顺序不变。
- complete/error 到达前必须已消费前序 output。
- 不能把 batch 当成单条消息处理。

### 3. WS event 到 window event

`frontend/src/App.tsx` 监听：

- `claude-output`
- `claude-output-batch`
- `claude-error`
- `claude-complete`

然后用消息里的 `cwd`，或 `session_id -> cwd` 映射，把输出转发成：

- `claude-output:<cwd>`
- `claude-error:<cwd>`
- `claude-complete:<cwd>`

会话页面并不直接订阅 WS event，而是订阅这些 window event。

### 4. 会话 hook 消费事件

`useSessionEvents` 监听 `claude-output:${projectPath}` 并执行：

- JSON.parse payload。
- 更新 runtime tracker。
- 对纯 text delta 快速交给 `addMessage` 后返回。
- 从 `system/init` 提取 runtime session id 和 provider session id。
- 更新 `SessionPersistenceService`。
- 统计工具调用、文件操作、代码块、错误。
- 处理 `result`，调用 `onComplete`，设置 `interactiveSessionId`，结束 loading，触发 queue。
- 最后把消息写入 `useMessages`。

这里同时处理 UI 状态、业务状态、分析埋点、todo 状态、session persistence 和 runtime 状态，是后续拆分的重点。

### 5. 消息存储和渲染

`useMessages` 当前不是普通 React state：

- `messagesRef.current` 是可变数组。
- 普通消息进入 `messageQueueRef`，用 `requestAnimationFrame` 批量 flush。
- assistant delta 合并进 `deltaBufferRef`，尽量追加到最后一条 assistant text block。
- 纯文本 delta 不触发整个 `AiCodeSession` 重新渲染，只通知 tail listener。
- `MessageStreamView` 的 `StreamingTailRow` 用 `useSyncExternalStore` 只刷新最后一行。
- `derivedRef` 增量维护 token、tool result、tool name、read path、agent output map 和 `StreamMessageContext`。

这组性能约束必须被显式测试保护，不能在重构中退回“每条 delta setState 拷贝数组”的实现。

## 关键耦合和风险

### 风险 1：provider 命名和 Claude 命名混用

现状有三层“Claude”含义：

- `claude-output` 是历史事件通道名，实际承载所有 provider。
- `ClaudeStreamMessage` 是统一消息类型名，实际也承载 Codex/Gemini/DeepSeek。
- `claudeSessionId` 在前端有时表示 runtime session id，有时表示真实 Claude provider session id。

`useSessionEvents` 已经用 `runtime_session_id` 和 `claude_session_id` 区分一部分场景。重构时建议先引入命名更准确的内部类型和 facade，但不要第一轮改公开事件名。

### 风险 2：历史恢复在页面组件里

`AiCodeSession.tsx` 内部有三套历史加载/恢复路径：

- localStorage session restore。
- explicit historical session load。
- WS reconnect / visibilitychange recovery。

它们都会调用 `providers.loadHistory` 并把历史消息重新推断 type 后 `setMessages`。这里和 project switch、skip restore、activeRecoveryKeys、clear cooldown、subagent transcript refresh 都交织在一起。建议单独抽成 `useSessionHistoryRecovery`，但必须先补行为测试。

### 风险 3：`providers.loadHistory` wrapper 参数命名混乱

`LoadProviderSessionHistory` 前端 wrapper 签名是 `(projectId, sessionId, providerName)`，内部调用 Go RPC 时变成 `(sessionId, projectId, providerName)`。`providers.loadHistory(sessionId, projectId, providerName)` 又调用 `LoadProviderSessionHistory(projectId, sessionId, providerName)`。

当前链路能工作，但可读性很差，极易在重构中传反。建议建立一个小的 typed facade：

```ts
loadProviderHistory({ provider, sessionId, projectId })
```

第一轮只替换调用点，不改变 RPC。

### 风险 4：`StreamMessage` 仍是渲染和 tool routing 的瓶颈

`StreamMessage.tsx` 同时负责：

- Markdown 渲染。
- system/user/assistant/result/error/raw/info 分支。
- tool_use 渲染路由。
- tool_result 特殊折叠。
- agent mention 展示。
- card expansion key。
- memo comparator。

它依赖 `ToolWidgets.tsx`，后者更大。会话消息流重构如果先动 `StreamMessage`，风险会放大。建议先稳定输入数据和 list 边界，再拆消息渲染。

### 风险 5：测试很多是源码形状断言

当前已有不少测试，但很多通过正则检查源码结构，例如确认某段源码存在或不存在。这能保护关键路径不被误删，但不能证明运行时事件顺序、rAF flush、delta 合并、history recovery、provider session id 语义真的正确。

重构前建议补少量“行为级”测试，不必一次性补全。

## 已有保护

当前已经有价值的测试/约束：

- `useMessages.test.ts` 保护 token 分项、增量 derived state、delta estimate 替换。
- `useSessionEvents.test.js` 保护 provider session id 和 runtime session id 的区分。
- `messageFilter.test.ts` 保护 displayable message 过滤。
- `runtimeState.test.ts` / `runtimePresentation.test.ts` / `sessionStatusBarPresentation.test.ts` 保护 runtime status。
- `SubagentProgressPanel.state.test.ts` 和 `useSubagentTranscriptSync.test.ts` 保护 subagent transcript 相关连接。
- `StreamMessage.performance.test.ts` 保护 shared context 和 memoization 的一些源码约束。

这些测试在第一轮拆分中要保持通过。

## 必补测试建议

第一批建议补 4 类小测试，作为重构安全网：

1. `useMessages` 行为测试
   - 连续 assistant text delta 合并为一条 assistant message。
   - delta flush 不增加 structural version，但 tail revision 增加。
   - 普通 tool_use + tool_result 能更新 `streamMessageContext.toolResults` 和 `toolUseNamesById`。

2. App event router 测试
   - `claude-output-batch` 多行按顺序转发到 `claude-output:<cwd>`。
   - 没有 cwd 的后续消息能通过 `session_id -> cwd` 映射转发。
   - malformed line 不影响 batch 后续行。

3. history facade 测试
   - `loadProviderHistory({ sessionId, projectId, provider })` 最终 RPC 参数顺序正确。
   - `providers.loadHistory` 旧兼容层只做委托。

4. prompt send routing 测试
   - active interactive session 走 `SendClaudeMessage` / `resumeProviderSession`。
   - 非 Claude batch resume 走 `resumeProviderSession`。
   - first prompt + Claude fresh session 走 `StartInteractiveClaudeSession`。
   - `/clear` 本地 fallback 不把 prompt 发送到 provider。

## 建议拆分边界

### 第一阶段：固化 facade，不改变行为

目标是让 `AiCodeSession.tsx` 少直接接触底层细节。

建议新增：

- `message-flow/eventRouter.ts`
  - 封装 `claude-output` / batch / error / complete 到 per-cwd window event 的路由。
  - 先从 `App.tsx` 移出，不改事件名。

- `message-flow/providerHistory.ts`
  - 封装 provider history 参数顺序。
  - 替代直接使用 `providers.loadHistory`。

- `message-flow/sessionMessageTypes.ts`
  - 定义中性类型别名，例如 `SessionStreamMessage = ClaudeStreamMessage`。
  - 第一阶段只别名，不迁移所有字段。

### 第二阶段：拆 `AiCodeSession` 的 controller

建议从 `AiCodeSession.tsx` 抽出：

- `useSessionHistoryRecovery`
  - localStorage restore。
  - explicit session history load。
  - reconnect/visibility recovery。
  - activeRecoveryKeys / clear cooldown。

- `usePromptSubmission`
  - classify prompt。
  - queue。
  - first prompt title hook。
  - start/resume/send provider RPC。
  - local `/clear` fallback。

- `useSessionChromeState`
  - preview。
  - copy popover。
  - scroll buttons。
  - slash command dialog。
  - provider API switch notice。

拆分后 `AiCodeSession` 应该只做：

- 组合 hooks。
- 传 props 给 `MessageStreamView`、`SessionStatusBar`、`FloatingPromptInput`。
- 布局。

### 第三阶段：拆 `useSessionEvents`

`useSessionEvents` 应拆为纯 reducer + side effects：

- `parseSessionStreamPayload(payload)`：JSON parse 和类型归一。
- `reduceSessionEventState(message, current)`：session id、runtime id、loading、interactive id 的纯决策。
- `trackSessionMessageEffects(message, deps)`：metrics/todo/analytics。
- `handleCompletionMessage(message)`：result 和 complete event 的统一语义。

第一轮不要改变 event source，仍监听 `claude-output:<projectPath>`。

### 第四阶段：拆消息渲染

等 state 和 event 流稳定后，再拆：

- `StreamMessage` 按 message type 分组件。
- `ToolWidgets.tsx` 按 tool 类型拆 registry。
- `StreamMessageContext` 构造移出展示组件，成为消息派生层的一部分。

## 不建议第一轮做的事

- 不要重命名后端 `claude-output` 事件。
- 不要改 `ClaudeStreamMessage` 的真实 JSON shape。
- 不要把 `messagesRef` 改回 React 数组 state。
- 不要移除 `MessageStreamView` 的 streaming tail subscription。
- 不要把 `claudeSessionId` / `runtime_session_id` 语义“简化”为一个 id。
- 不要同时拆 `ToolWidgets.tsx` 和 `AiCodeSession.tsx`。

## 验证矩阵

每个阶段至少跑：

- `cd frontend && npm run build:typecheck`
- 会话相关前端测试文件
- 若影响 App event router 或真实 UI：`npm --prefix ui-automation run test`

影响后端 provider 输出或 RPC 时还要跑：

- `go test ./...`
- provider 对应 focused tests，例如 `go test ./internal/codex ./internal/gemini ./internal/deepseek ./internal/claude`

最终人工/自动验证场景：

1. 新建 Claude 会话，流式输出显示，停止按钮有效。
2. Claude interactive session 结束后继续发送下一条，不重新打开错误 session。
3. Codex/Gemini/DeepSeek 新会话能显示 assistant text、tool_use、tool_result、result。
4. 刷新/WS 重连后恢复不重复消息、不丢尾部消息。
5. 切换 project/workspace 不串消息。
6. `/clear` 后旧流不会通过 recovery 重新灌回来。
7. subagent panel 和 transcript refresh 仍正常。

## 推荐下一步

先写一个小设计文档，范围只覆盖第一阶段和第二阶段，不要把 `StreamMessage` / `ToolWidgets` 放进同一轮。推荐第一轮目标：

- 提取 event router。
- 提取 provider history facade。
- 提取 history recovery hook。
- 提取 prompt submission hook。
- 保持 UI 输出和事件名完全不变。

完成后再根据文件缩小程度和测试结果，决定是否进入 `useSessionEvents` reducer 化。
