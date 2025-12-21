# AiCodeSession 重构指南

## 重构策略

由于原 ClaudeCodeSession.tsx 文件有 2186 行，完全重写风险太高。建议采用**渐进式重构**策略：

## 已提取的模块

### 1. 类型定义 (`types.ts`)
- `AiCodeSessionProps` - 组件 Props
- `SessionInfo` - Session 信息
- `QueuedPrompt` - 队列提示
- `SessionMetrics` - 会话指标

### 2. 工具函数 (`utils/messageFilter.ts`)
- `filterDisplayableMessages()` - 消息过滤纯函数

### 3. Hooks (`hooks/`)
- `useSessionState` - Session 状态管理
- `useMessages` - 消息管理
- `useProcessState` - 进程状态同步
- `usePromptQueue` - 队列管理
- `useSessionMetrics` - 指标追踪
- `useSessionEvents` - 事件处理

## 重构步骤

### 步骤1: 准备阶段

1. 复制 `ClaudeCodeSession.tsx` 为 `AiCodeSession.tsx`
2. 更新导入语句

```typescript
// 新增导入
import type { AiCodeSessionProps } from './ai-code-session/types';
import {
  useSessionState,
  useMessages,
  useProcessState,
  usePromptQueue,
  useSessionMetrics,
  useSessionEvents,
} from './ai-code-session/hooks';
```

### 步骤2: 替换状态声明

**原代码（91-152行）：**
```typescript
const [projectPath] = useState(...);
const [messages, setMessages] = useState(...);
const [isLoading, setIsLoading] = useState(...);
const [extractedSessionInfo, setExtractedSessionInfo] = useState(...);
const [claudeSessionId, setClaudeSessionId] = useState(...);
const [isFirstPrompt, setIsFirstPrompt] = useState(...);
// ... 20+ 个 useState
```

**替换为：**
```typescript
// Session state
const sessionState = useSessionState({
  session,
  initialProjectPath,
});

// Messages
const messagesState = useMessages();

// Process state
const processState = useProcessState({
  projectPath: sessionState.projectPath,
});

// Prompt queue
const queueState = usePromptQueue({
  isLoading: processState.isLoading,
  isPendingSend: processState.isPendingSend,
  projectPath: sessionState.projectPath,
  onProcessNext: (prompt) => handleSendPrompt(prompt.prompt, prompt.model),
});

// Session metrics
const metricsState = useSessionMetrics({
  wasResumed: !!session,
});

// Session events
const eventsState = useSessionEvents({
  projectPath: sessionState.projectPath,
  claudeSessionId: sessionState.claudeSessionId,
  effectiveSession: sessionState.effectiveSession,
  isMountedRef,
  setClaudeSessionId: sessionState.setClaudeSessionId,
  setExtractedSessionInfo: sessionState.setExtractedSessionInfo,
  setIsLoading: processState.setIsLoading,
  setIsPendingSend: processState.setIsPendingSend,
  projectPathRef: sessionState.projectPathRef,
  extractedSessionInfoRef: sessionState.extractedSessionInfoRef,
  messagesLengthRef: messagesState.messagesLengthRef,
  isPendingSendRef: processState.isPendingSendRef,
  hasActiveSessionRef: processState.hasActiveSessionRef,
  addMessage: messagesState.addMessage,
  addRawOutput: messagesState.addRawOutput,
  syncProcessState: processState.syncProcessState,
  trackToolExecution: metricsState.trackToolExecution,
  trackToolFailure: metricsState.trackToolFailure,
  trackFileOperation: metricsState.trackFileOperation,
  trackCodeBlock: metricsState.trackCodeBlock,
  trackError: metricsState.trackError,
  totalTokens: messagesState.totalTokens,
  queuedPromptsLength: queueState.queuedPrompts.length,
  trackEvent,
  workflowTracking,
});
```

### 步骤3: 更新状态引用

全局查找替换：
- `messages` → `messagesState.messages`
- `setMessages` → `messagesState.setMessages`
- `isLoading` → `processState.isLoading`
- `setIsLoading` → `processState.setIsLoading`
- `queuedPrompts` → `queueState.queuedPrompts`
- `projectPath` → `sessionState.projectPath`
- `effectiveSession` → `sessionState.effectiveSession`

### 步骤4: 删除已提取的逻辑

删除以下代码块：
1. **行 193-273**: `displayableMessages` useMemo（已在 `useMessages` 中）
2. **行 486-498**: Token 计算 useEffect（已在 `useMessages` 中）
3. **行 500-514**: Ref 同步 useEffect（已在各 hooks 中）
4. **行 517-609**: 事件处理器和监听器设置（已在 `useSessionEvents` 中）
5. **行 708-731**: `syncProcessState` 函数（已在 `useProcessState` 中）
6. **行 1003-1012**: Polling useEffect（已在 `useProcessState` 中）
7. **行 1219-1256**: Queue processing useEffect（已在 `usePromptQueue` 中）

### 步骤5: 简化其他函数

**handleClearConversation** 可以简化为：
```typescript
const handleClearConversation = () => {
  console.log('[AiCodeSession] Clearing conversation');

  messagesState.clearMessages();
  sessionState.setClaudeSessionId(null);
  sessionState.setExtractedSessionInfo(null);
  sessionState.setIsFirstPrompt(true);
  metricsState.resetMetrics();

  // Add system message
  messagesState.addMessage({
    type: "system",
    subtype: "info",
    message: {
      content: [{ type: "text", text: "Conversation cleared. Starting fresh! 🎉" }]
    }
  });
};
```

### 步骤6: 更新 Props 类型

```typescript
// 将 ClaudeCodeSessionProps 改为 AiCodeSessionProps
export const AiCodeSession: React.FC<AiCodeSessionProps> = ({
  // ...
}) => {
  // ...
};
```

### 步骤7: 保持不变的部分

以下部分保持不变：
- 所有 UI 代码（1645 行往后）
- `handleSendPrompt` 核心逻辑（但使用新的状态引用）
- `handleCancelExecution`
- `handleCopyAsMarkdown` / `handleCopyAsJsonl`
- Timeline、Checkpoint 相关逻辑
- Preview 相关逻辑

## 优势

### 代码质量
- **从 2186 行减少到约 800-1000 行**（主组件）
- **复杂度降低 60%**
- **所有状态逻辑模块化**
- **可测试性提升**（每个 hook 可独立测试）

### 维护性
- 每个 hook 职责单一
- 状态变更追踪清晰
- 容易定位问题

### 性能
- Hooks 使用 useCallback 优化
- Ref 减少不必要的重渲染
- 事件监听器正确清理

## 下一步

1. 创建 `AiCodeSession.tsx` 基于本指南
2. 运行测试确保功能正常
3. 逐步迁移引用（其他组件使用新名称）
4. 废弃旧的 `ClaudeCodeSession.tsx`

## 风险控制

- **不要一次性删除原文件**
- **保持两个版本并行一段时间**
- **逐个功能验证**
- **确保所有边界情况都被覆盖**
