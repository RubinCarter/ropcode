# AI Code Session

本目录承载主会话视图。当前结构已经不是早期的 `AiCodeSessionCore` 草稿，公开组件只保留一个薄入口：

```text
frontend/src/components/ai-code-session/
├── AiCodeSession.tsx                 - 公开入口，转发到 SessionController
├── SessionController.tsx             - 会话编排：恢复、发送、停止、历史、预览状态
├── MessageStreamView.tsx             - 消息流容器
├── types.ts                          - 会话组件共享类型
├── composer/
│   └── SessionComposer.tsx           - 输入框/会话操作栏
├── hooks/
│   ├── useSessionFrameEvents.ts      - SessionFrame 事件接入
│   ├── useSessionMessages.ts         - 消息列表、过滤、token 派生
│   ├── useProcessState.ts            - 进程运行状态
│   ├── usePromptQueue.ts             - 排队提示处理
│   ├── useSessionMetrics.ts          - 会话指标
│   └── useSessionState.ts            - 会话身份和项目路径状态
├── layout/
│   └── SessionLayoutChrome.tsx       - 预览分栏、底部输入 dock、Slash 命令弹窗
├── messages/
│   └── SessionMessagePane.tsx        - 消息列表渲染
├── runtime/
│   └── SessionStatusBar.tsx          - 运行状态展示
├── state/
│   └── runtimeTrackerStore.ts        - runtime 状态追踪
└── utils/
    └── messageFilter.ts              - 消息过滤纯函数
```

## 当前边界

- `AiCodeSession.tsx` 必须保持为薄 shell，不直接持有 RPC、WebSocket、发送提示、历史加载或窗口事件逻辑。
- `SessionController.tsx` 仍是主要编排层，当前保留恢复、发送、停止、历史加载、复制菜单和预览控制等副作用。
- 消息和流入口使用 `SessionFrame` 路径；旧的 `useMessages` / `useSessionEvents` 文件已经被 `useSessionMessages` / `useSessionFrameEvents` 替代。
- 布局 chrome、消息 pane、runtime 状态栏、composer 已拆出独立模块；后续拆分应继续从 `SessionController.tsx` 中提取稳定职责，而不是把逻辑放回 `AiCodeSession.tsx`。

## 验证

会话 UI 改动至少运行：

```powershell
cd frontend
npm test
npm run build:typecheck
```

如果改动影响可见 UI、RPC 同步、导航或主会话工作流，还需要从仓库根目录运行：

```powershell
npm --prefix ui-automation run test
```
