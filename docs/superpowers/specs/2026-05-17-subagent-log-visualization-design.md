# Subagent Log 可视化（右侧栏）

**日期**：2026-05-17
**作者**：与 shikihane 共同设计
**状态**：草案 — 待用户审阅

## 背景

右侧栏 `ClaudeActivityPane` 列出当前 Claude session 的后台异步任务（`local_agent` / `local_bash` / `other`）。每个 Card 展开后显示一个 80 行文本 tail（`<pre>{tail.content}</pre>`）。

对 `local_agent` 而言，`outputFile` 实际是一份 JSONL transcript（每行一条 Claude SDK message），但当前 UI 把它当作纯文本字符串塞进 `<pre>`，用户看到的是 JSON 字符串原文，看不出"在调用什么工具、用了多少 token、跑了多久"。

## 目标

把 `local_agent` Card 展开后的 `<pre>` 替换为：

- **顶部**：摘要 chips —— 各 tool 调用计数、token 总量、已用时长
- **下方**：完整 transcript，每条消息复用主流的 `StreamMessage` 组件渲染

## 非目标

- 不重做 `SubagentProgressPanel`（主流内嵌的同步 sidechain 面板）
- 不改 `ClaudeActivityPane` 的列表骨架、Card 头部、Stop 按钮、`Log` 折叠按钮、2.5s 全量 snapshot 轮询
- 不改 `internal/claudeactivity` 的 observer / activity 发现 / transcript fallback 逻辑
- `local_bash` / `other` 不在本次范围（仍走老 `<pre>` tail）
- 不做跨 ropcode 进程重启的 activity 重建（需 SQLite，影响面太大）
- 不做 transcript 搜索、跳转到特定 tool_use_id、导出
- 不处理单行 > 1MB 等极端场景

## Invariants

| # | 约束 |
|---|---|
| I1 | 前端 UI 缓存的生命周期 = `ClaudeActivityPane` 组件树。Card 折叠/展开**不**清；activity 从 snapshot 消失或 `activeSession` 切换才清 |
| I2 | 后端**无**缓存。每次 RPC 现读文件，无状态 |
| I3 | 首次加载（`since=-1`）只返回末 80 行，附带 `truncated_before = max(0, totalLines - 80)`。`totalLines < 80` 时 `truncated_before=0`，全部行返回。早于这 80 行的内容默认不可见 |
| I4 | 增量按行索引：`since=lastLineIndex` → `[since, totalLines)` 的完整行 |
| I5 | 后端只返回有 `\n` 收尾的完整行；半行（无换行收尾）下轮再说 |
| I6 | 单行 `JSON.parse` 失败 → 前端跳过 + `console.warn`，不 crash 整个 transcript |
| I7 | 文件已不可读（不存在 / `totalLines < since` / 读失败）→ RPC 返回 `file_missing: true`，UI 显示 "Transcript file no longer available — session may have ended"，已缓存 messages 保留可看 |
| I9 | activity stale 不影响 RPC 行为，仍按文件状态返回（`local_agent` 即使 stale 也允许展开读 transcript） |
| I10 | 跨 app 重启不重建 activity / 缓存（明确不在范围） |
| I11 | `local_bash` / `other` 不走新 RPC，沿用 `GetClaudeActivityLogTail`，不变 |
| I12 | 单次 RPC 行数 cap 80 行 / 256KB（先到先停） |
| I13 | "Load earlier transcript" 按钮：仅当 `truncated_before > 0` 时显示，按钮文案带数字（如 "Load 420 earlier messages"）。点击后前端循环调用 `since=0` → `since=next_line_index` 直到 `next_line_index === messages 起点对应的行号`，期间禁用按钮 + 显示进度。`truncated_before` 在首次加载时确定，增量 poll **不**改变它；仅当 Load earlier 完成时归零 |
| I14 | 极长单行 / 解析极慢等极端场景不处理 |

> I8 留空位 —— truncate/rotate 在 append-only transcript 下不会发生，已并入 I7。

## 架构

### 数据流

```
Claude CLI ──写──▶ ~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl
                                                                      │
                                                                      ▼
                                                  internal/claudeactivity
                                                  (无缓存，按需读)
                                                                      │
                                                       RPC ReadClaudeSubagentLog
                                                                      │
                                                                      ▼
                                                  ClaudeActivityPane
                                                  Map<activityID, ParsedTranscript>
                                                                      │
                                                                      ▼
                                                  SubagentLogView
                                                  (chips + StreamMessage 列表)
```

### 后端：`internal/claudeactivity/subagent_log.go`（新）

无状态 RPC handler，每次现读文件。

```go
const (
    initialLineWindow = 80
    chunkLineCap      = 80
    chunkByteCap      = 256 * 1024
)

func (s *Service) ReadSubagentLog(sessionID, activityID string, since int) (SubagentLogChunk, error)
```

**行为**：

- `since == -1` 首次加载：返回末 80 行 + `truncated_before = totalLines - 80`
- `since >= 0` 增量：返回 `[since, totalLines)` 的完整行，受 `chunkLineCap` / `chunkByteCap` 限制
- `since > totalLines`：视为文件被外部改过，返回 `file_missing=true`
- 文件不存在 / Stat 失败：`file_missing=true, lines=[]`
- 仅接受 `local_agent` activity；其他类型报错（防误用）

**辅助**：`resolveSubagentPath` 沿用 `log_tail.go` 的 `resolveClaudeSubagentTranscript` + `findClaudeSubagentTranscript` fallback 链。

**新类型**（`internal/claudeactivity/types.go`）：

```go
type SubagentLogChunk struct {
    SessionID       string   `json:"session_id"`
    ActivityID      string   `json:"activity_id"`
    Lines           []string `json:"lines"`              // 完整 JSONL 行（已剥 \n / \r\n）
    NextLineIndex   int      `json:"next_line_index"`    // 前端下次传这个值
    TotalLines      int      `json:"total_lines"`
    TruncatedBefore int      `json:"truncated_before"`   // 仅 since=-1 首次加载
    FileMissing     bool     `json:"file_missing"`
    Path            string   `json:"path,omitempty"`
    ResolvedBy      string   `json:"resolved_by,omitempty"`
}
```

**新 RPC**（`bindings.go`）：

```go
func (a *App) ReadClaudeSubagentLog(sessionID, activityID string, since int) (claudeactivity.SubagentLogChunk, error)
```

### 前端：`frontend/src/lib/subagentLog.ts`（新）

纯函数，无 React。

```ts
export interface ParsedTranscript {
  messages: ClaudeStreamMessageLike[];
  lastLineIndex: number;       // 下次 since 的值
  truncatedBefore: number;
  fileMissing: boolean;
  loadingEarlier: boolean;
}

export interface TranscriptSummary {
  toolCounts: Map<string, { count: number; running: number }>;
  totalTokens: number;
  elapsedMs?: number;
  status: 'running' | 'completed' | 'failed' | 'unknown';
}

export function parseTranscriptLines(rawLines: string[]): ClaudeStreamMessageLike[];
export function summarizeTranscript(messages: ClaudeStreamMessageLike[]): TranscriptSummary;
export function emptyTranscript(): ParsedTranscript;
```

`parseTranscriptLines`：每行 `JSON.parse`，失败跳过 + `console.warn`。

`summarizeTranscript`：从 `subagentProgress.ts` 中 import 并复用 `assistantToolUses` / `messageTokens` —— 把这两个函数从 `subagentProgress.ts` 改为 `export`，避免重复实现。

### 前端组件：`SubagentLogView.tsx`（新）

Dumb component，只渲染。

```tsx
interface SubagentLogViewProps {
  transcript: ParsedTranscript;
  onLoadEarlier: () => void;
}
```

渲染结构：

```
<div>
  <SummaryChips summary={summary} />
  {fileMissing && <FileMissingNotice />}
  {truncatedBefore > 0 && <LoadEarlierPrompt count loading onClick />}
  {messages.map(m => <StreamMessage ... />)}
</div>
```

`agentOutputMap` 留空（右侧栏没那个上下文）。

### 前端：`ClaudeActivityPane.tsx`（改）

新增 state：

```tsx
const [subagentLogs, setSubagentLogs] = useState<Map<string, ParsedTranscript>>(new Map());
```

`loadLogTail` 拆成两个分派：

- `loadSubagentLog(activity)` → `local_agent`，走新 RPC
- `loadBashLogTail(activity)` → 其他，走老 `GetClaudeActivityLogTail`

| 事件 | 操作 |
|---|---|
| 首次展开 Card（无 entry） | RPC `since=-1` → 创建 entry |
| 已有 entry，再次展开 | 立即用缓存渲染 + 立即调一次 `since=lastLineIndex` 增量刷新 |
| poll tick + Card 展开中 | RPC `since=lastLineIndex` → 追加到 messages 末尾 |
| Load earlier 按钮 | 循环 `since=0..` → prepend 到 messages，完成后 `truncatedBefore=0` |
| RPC `file_missing=true` | `entry.fileMissing=true`，messages 不动 |
| activity 从 snapshot 消失 | 删 Map entry |
| `activeSession` 变 | `setSubagentLogs(new Map())` |
| Card 折叠 | **不动**（保留缓存） |

**Load earlier 并发保护**：循环期间用 ref 标记 `loadingEarlier=true`，poll tick 检测到就跳过这个 activity 本轮。Load earlier 拿到的旧消息整体 prepend，不与增量追加重叠（`lastLineIndex` 是缓存上界，旧消息行号严格小于它）。

## 落地顺序

每一步独立编译 + 验证。

1. **后端 RPC + 测试** —— `subagent_log.go` + `subagent_log_test.go` + `types.go` + `bindings.go`。`go test ./internal/claudeactivity` 通过
2. **前端纯函数 + 测试** —— `subagentLog.ts` + `subagentLog.test.ts`
3. **`SubagentLogView.tsx`** —— 用 fixture 数据渲染，先看视觉
4. **`ClaudeActivityPane.tsx` 接线** —— Map state、增量轮询分派、Load earlier 循环、清缓存边界
5. **手测 + 视觉调整**

## 测试覆盖

**后端 `subagent_log_test.go`**：

- `since=-1` 短文件（< 80 行）→ 返回全部，`truncated_before=0`
- `since=-1` 长文件（500 行）→ 返回末 80，`truncated_before=420`，`next_line_index=500`
- `since=400` 长文件（500 行）→ 受 80 行 cap 截，返回 80 行，`next_line_index=480`
- 半行（最后无 `\n`）→ 不计入 `total_lines`，不返回
- `since > totalLines` → `file_missing=true`
- 文件不存在 → `file_missing=true`
- CRLF（`\r\n`）→ `\r` 被剥
- fallback：`outputFile` 不存在但 `~/.claude/.../subagents/agent-<id>.jsonl` 存在 → 走 fallback，`ResolvedBy=claude_subagent_transcript`
- activity 不是 `local_agent` → 报错

**前端 `subagentLog.test.ts`**：

- `parseTranscriptLines` 在坏 JSON 行存在时跳过其余正常解析
- `summarizeTranscript` 计 tool 计数 / running 数 / token 总和

**前端 `SubagentLogView.test.tsx`**：

- `truncatedBefore=0` 不显示 Load earlier 按钮
- `loadingEarlier=true` 时按钮 disabled
- `fileMissing=true` 显示提示
- 多个工具调用时 chips 显示正确计数

**`ClaudeActivityPane`**：

- 切 workspace 清缓存
- activity 从 snapshot 消失时清 entry
- `local_bash` 仍走老 tail（不破坏）

## 手测 Checklist

- 窄侧栏宽度下 `StreamMessage` 不溢出
- `local_agent` 跑起来 → 展开 → chips + transcript 末 80 行
- 实时追加：agent 继续跑 → chips 和 transcript 实时更新
- 折叠 → 等 5s → 重新展开：无闪烁、不重拉、增量恢复
- 按 Load earlier → 旧消息追加在前，按钮 disabled + 显示进度
- agent 进 stale → 仍能展开 / 看完整内容
- 切 workspace → Map 清空
- 杀掉 transcript 文件 → poll 一轮后 `fileMissing` 提示出现，已读消息保留
- `local_bash` Card 展开 → 仍是老 `<pre>` tail（不被破坏）

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `StreamMessage` 在 ~300px 窄宽下溢出 | 中 | 手测发现就改；最坏退化为 `<pre>`（现状 + 摘要 chips） |
| Load earlier 循环 60+ 次 RPC | 低 | RPC 无状态，串行可行；UI 显示进度避免误以为卡死 |
| Load earlier 与 poll tick 并发追加 | 中 | `loadingEarlier` ref 保护 + poll tick 跳过 |
| Windows 路径 + CRLF | 低 | `bufio.Scanner` 处理 `\r\n`；测试覆盖 |
| 反射 RPC 命名冲突 | 低 | `ReadClaudeSubagentLog` 已 grep 确认无重名 |

## 回滚

- 后端：删 `subagent_log.go` + `bindings.go` 新方法 + `types.go` 新字段
- 前端：`ClaudeActivityPane.tsx` 把 `local_agent` 分支退化回老 `<pre>` 即可

## Future Work（明确不在范围）

- 跨 ropcode 重启重建 activity（需 SQLite）
- `local_bash` / `other` 结构化渲染
- 跨 session activity 历史浏览
- transcript 搜索、跳转到特定 tool_use_id、导出
- 单行 > 1MB 等极端场景
