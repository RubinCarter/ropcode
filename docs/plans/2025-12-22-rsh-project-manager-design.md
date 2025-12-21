# rsh 项目管理系统设计文档

> ⚠️ **远期愿景文档**
>
> 本文档描述的是 rsh 项目管理系统的远期规划。当前阶段的重点是完成 [Widget 移植工作](./2025-12-22-waveterm-widget-migration-design.md)，rsh 的实现将在 Widget 基础设施就绪后进行。
>
> 本文档的目的是预先规划架构，确保 Widget 移植时预留必要的扩展点。

---

## 概述

rsh (ropcode shell helper) 是一个 **AI 多代理编排系统**，设计用于在软件开发项目中实现：

- **主项目（Main Project）** 扮演"项目经理"角色：理解需求、规划任务、拆解分配、验收成果
- **子工作空间（Sub Workspaces）** 扮演"开发者"角色：实现任务、测试代码、交付成果
- **多 AI Provider** 支持：Claude、Codex、Gemini 可以在不同 workspace 并行工作

---

## 核心架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Main Project (项目经理角色)                             │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                         rsh Project Manager                              ││
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ ││
│  │  │  需求理解   │  │  任务规划   │  │  任务分配   │  │     验收管理       │ ││
│  │  │  Parser    │  │  Planner   │  │  Dispatcher│  │    Acceptor       │ ││
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────────────┘ ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│            ┌────────────────────────┼────────────────────────┐               │
│            │                        │                        │               │
│            ▼                        ▼                        ▼               │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │  Workspace A     │    │  Workspace B     │    │  Workspace C     │       │
│  │  ┌────────────┐  │    │  ┌────────────┐  │    │  ┌────────────┐  │       │
│  │  │   Claude   │  │    │  │   Codex    │  │    │  │   Gemini   │  │       │
│  │  └────────────┘  │    │  └────────────┘  │    │  └────────────┘  │       │
│  │  Branch: feat-a  │    │  Branch: feat-b  │    │  Branch: fix-z   │       │
│  │  Task: Feature A │    │  Task: Feature B │    │  Task: Bug Fix Z │       │
│  │  Status: 进行中   │    │  Status: 待审核   │    │  Status: 已完成   │       │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心实体定义

### 1. Project（项目）

```typescript
interface Project {
  id: string;
  name: string;
  rootPath: string;          // 项目根目录
  mainBranch: string;        // 主分支名 (main/master)

  // 项目配置
  config: ProjectConfig;

  // 当前活跃的 workspaces
  workspaces: Workspace[];

  // 任务队列
  tasks: Task[];

  // 需求文档
  requirements: Requirement[];
}

interface ProjectConfig {
  // 默认 AI Provider
  defaultProvider: 'claude' | 'codex' | 'gemini';

  // 每个 provider 的配置
  providers: {
    claude?: ClaudeConfig;
    codex?: CodexConfig;
    gemini?: GeminiConfig;
  };

  // 验收策略
  acceptanceStrategy: 'manual' | 'auto-test' | 'ai-review';

  // 最大并行 workspace 数
  maxParallelWorkspaces: number;
}
```

### 2. Workspace（工作空间）

```typescript
interface Workspace {
  id: string;
  projectId: string;

  // Git 信息
  worktreePath: string;      // git worktree 路径
  branchName: string;        // 分支名
  baseBranch: string;        // 基于哪个分支创建

  // AI Provider
  provider: 'claude' | 'codex' | 'gemini';
  sessionId?: string;        // AI 会话 ID

  // 当前任务
  currentTask?: Task;

  // 状态
  status: WorkspaceStatus;

  // 通信
  lastHeartbeat: Date;
  messageQueue: Message[];
}

type WorkspaceStatus =
  | 'idle'           // 空闲，等待任务
  | 'working'        // 正在执行任务
  | 'awaiting_review'// 等待主项目审核
  | 'blocked'        // 被阻塞（需要澄清/依赖）
  | 'completed';     // 任务完成
```

### 3. Task（任务）

```typescript
interface Task {
  id: string;
  projectId: string;

  // 任务来源
  requirementId?: string;    // 关联的需求 ID
  parentTaskId?: string;     // 父任务 ID（用于任务拆解）

  // 任务描述
  title: string;
  description: string;       // 详细描述
  acceptanceCriteria: string[];  // 验收标准

  // 任务类型
  type: TaskType;
  priority: 'critical' | 'high' | 'medium' | 'low';

  // 预估复杂度 (用于分配策略)
  complexity: 'simple' | 'medium' | 'complex';

  // 分配信息
  assignedWorkspaceId?: string;
  assignedProvider?: 'claude' | 'codex' | 'gemini';

  // 状态
  status: TaskStatus;

  // 时间戳
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;

  // 结果
  result?: TaskResult;
}

type TaskType =
  | 'feature'        // 新功能
  | 'bugfix'         // Bug 修复
  | 'refactor'       // 重构
  | 'test'           // 测试
  | 'docs'           // 文档
  | 'research';      // 调研

type TaskStatus =
  | 'pending'        // 待分配
  | 'assigned'       // 已分配，待开始
  | 'in_progress'    // 进行中
  | 'review'         // 待审核
  | 'revision'       // 需修改
  | 'accepted'       // 已验收
  | 'rejected';      // 被拒绝

interface TaskResult {
  // 代码变更
  commits: string[];         // commit SHA 列表
  filesChanged: string[];    // 变更的文件

  // 测试结果
  testsPassed: boolean;
  testCoverage?: number;

  // AI 报告
  summary: string;           // AI 生成的工作总结
  challenges?: string[];     // 遇到的挑战
  suggestions?: string[];    // 建议
}
```

### 4. Requirement（需求）

```typescript
interface Requirement {
  id: string;
  projectId: string;

  // 原始需求
  rawInput: string;          // 用户原始输入

  // 解析后的需求
  title: string;
  description: string;
  goals: string[];           // 目标列表
  constraints: string[];     // 约束条件

  // 拆解的任务
  tasks: Task[];

  // 状态
  status: 'draft' | 'planned' | 'in_progress' | 'completed';

  // 验收标准
  acceptanceCriteria: string[];
}
```

---

## 核心流程

### Flow 1: 需求理解与任务拆解

```
用户输入需求
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  1. 需求解析 (Requirement Parser)                       │
│     - 使用 AI 理解用户需求                               │
│     - 提取目标、约束、验收标准                            │
│     - 生成结构化需求文档                                 │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  2. 任务规划 (Task Planner)                             │
│     - 分析需求，识别技术组件                              │
│     - 拆解为可独立执行的任务                              │
│     - 确定任务依赖关系                                   │
│     - 评估任务复杂度                                     │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  3. 用户确认                                           │
│     - 展示任务拆解结果                                   │
│     - 用户可调整任务、优先级                              │
│     - 确认后进入分配阶段                                 │
└────────────────────────────────────────────────────────┘
```

### Flow 2: 任务分配与 Workspace 创建

```
已确认的任务列表
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  1. 任务调度 (Task Dispatcher)                          │
│     - 检查可用 workspace 数量                            │
│     - 根据任务类型选择合适的 AI Provider                  │
│     - 考虑任务依赖关系，确定执行顺序                       │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  2. Workspace 创建                                     │
│     - git worktree add <path> -b <branch>              │
│     - 初始化 AI Provider 会话                           │
│     - 注入任务上下文                                    │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  3. 任务启动                                           │
│     - 发送任务指令到 Workspace                          │
│     - 开始监听进度报告                                   │
│     - 记录开始时间                                      │
└────────────────────────────────────────────────────────┘
```

### Flow 3: 任务执行与进度同步

```
Workspace 执行任务
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  1. AI 执行循环                                        │
│     - 读取代码库，理解上下文                             │
│     - 实现功能 / 修复 bug                               │
│     - 编写测试                                         │
│     - 运行测试确认通过                                  │
└────────────────────────────────────────────────────────┘
    │
    │ 定期发送心跳和进度
    ▼
┌────────────────────────────────────────────────────────┐
│  2. 进度同步 (Progress Reporter)                        │
│     - Workspace → Main: 进度百分比                      │
│     - Workspace → Main: 当前正在做什么                   │
│     - Workspace → Main: 是否遇到阻塞                    │
│     - Main → Workspace: 是否需要中断/调整                │
└────────────────────────────────────────────────────────┘
    │
    │ 任务完成
    ▼
┌────────────────────────────────────────────────────────┐
│  3. 提交审核                                           │
│     - Workspace 提交所有变更                            │
│     - 生成工作总结报告                                  │
│     - 状态变更为 awaiting_review                        │
│     - 通知 Main Project                                │
└────────────────────────────────────────────────────────┘
```

### Flow 4: 验收流程

```
Workspace 提交审核
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  1. 自动检查                                           │
│     - 运行测试套件                                      │
│     - 代码静态分析                                      │
│     - 检查代码覆盖率                                    │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  2. AI 代码审查 (可选)                                  │
│     - 使用 AI 审查代码质量                               │
│     - 检查是否符合验收标准                               │
│     - 生成审查报告                                      │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────┐
│  3. 项目经理决策                                        │
│     ├─ 接受: 合并到主分支，清理 worktree                  │
│     ├─ 修改: 发回 workspace 继续修改                     │
│     └─ 拒绝: 关闭任务，记录原因                          │
└────────────────────────────────────────────────────────┘
```

---

## 通信协议

### Main ↔ Workspace 消息类型

```typescript
// 从 Main 发往 Workspace
type MainToWorkspaceMessage =
  | { type: 'ASSIGN_TASK'; task: Task }
  | { type: 'REQUEST_STATUS' }
  | { type: 'PAUSE_WORK' }
  | { type: 'RESUME_WORK' }
  | { type: 'ABORT_TASK'; reason: string }
  | { type: 'PROVIDE_CLARIFICATION'; question: string; answer: string }
  | { type: 'REVISION_REQUESTED'; feedback: string };

// 从 Workspace 发往 Main
type WorkspaceToMainMessage =
  | { type: 'HEARTBEAT'; timestamp: Date }
  | { type: 'PROGRESS_UPDATE'; progress: number; currentActivity: string }
  | { type: 'BLOCKED'; reason: string; question?: string }
  | { type: 'TASK_COMPLETED'; result: TaskResult }
  | { type: 'REQUEST_CLARIFICATION'; question: string }
  | { type: 'ERROR'; error: string };
```

### 通信实现方式

**方案 A: 文件系统 (简单，推荐初期)**
```
.rsh/
├── main/
│   ├── inbox/          # Main 接收消息
│   └── outbox/         # Main 发送消息
├── workspaces/
│   ├── workspace-a/
│   │   ├── inbox/      # Workspace A 接收消息
│   │   └── outbox/     # Workspace A 发送消息
│   └── workspace-b/
│       ├── inbox/
│       └── outbox/
└── state.json          # 全局状态
```

**方案 B: WebSocket (实时，后期优化)**
- Main Project 运行 WebSocket 服务器
- 每个 Workspace 作为客户端连接
- 实时双向通信

---

## AI Provider 适配

### Provider 抽象接口

```typescript
interface AIProvider {
  name: 'claude' | 'codex' | 'gemini';

  // 创建新会话
  createSession(workspacePath: string, task: Task): Promise<string>;

  // 发送消息
  sendMessage(sessionId: string, message: string): Promise<string>;

  // 获取会话状态
  getSessionStatus(sessionId: string): Promise<SessionStatus>;

  // 终止会话
  terminateSession(sessionId: string): Promise<void>;
}

interface SessionStatus {
  isActive: boolean;
  tokenUsage: number;
  lastActivity: Date;
}
```

### Claude 适配 (claude-code CLI)

```typescript
class ClaudeProvider implements AIProvider {
  name = 'claude' as const;

  async createSession(workspacePath: string, task: Task): Promise<string> {
    // 使用 claude-code CLI 启动新会话
    // claude --cwd <workspacePath> --print --output-format json
    // 返回进程 ID 作为 sessionId
  }

  async sendMessage(sessionId: string, message: string): Promise<string> {
    // 写入 stdin 或使用 --continue 参数
  }
}
```

### Codex 适配

```typescript
class CodexProvider implements AIProvider {
  name = 'codex' as const;

  async createSession(workspacePath: string, task: Task): Promise<string> {
    // 使用 codex CLI
    // codex --cwd <workspacePath>
  }
}
```

### Gemini 适配

```typescript
class GeminiProvider implements AIProvider {
  name = 'gemini' as const;

  async createSession(workspacePath: string, task: Task): Promise<string> {
    // 使用 Gemini CLI 或 API
  }
}
```

---

## rsh 命令设计

### 项目管理命令

```bash
# 初始化 rsh 项目
rsh init

# 查看项目状态
rsh status

# 配置 AI Provider
rsh config provider claude --api-key <key>
rsh config provider codex --api-key <key>
rsh config provider gemini --api-key <key>
```

### 需求管理命令

```bash
# 添加需求
rsh req add "实现用户登录功能，支持邮箱和手机号"

# 查看需求列表
rsh req list

# 查看需求详情
rsh req show <req-id>

# AI 分析需求，生成任务
rsh req analyze <req-id>
```

### 任务管理命令

```bash
# 查看任务列表
rsh task list

# 查看任务详情
rsh task show <task-id>

# 手动创建任务
rsh task add --title "实现登录 API" --type feature

# 分配任务到 workspace
rsh task assign <task-id> --provider claude
rsh task assign <task-id> --workspace <ws-id>

# 启动任务
rsh task start <task-id>
```

### Workspace 管理命令

```bash
# 创建新 workspace
rsh ws create --name feat-login --provider claude

# 查看 workspace 列表
rsh ws list

# 查看 workspace 详情
rsh ws show <ws-id>

# 查看 workspace 日志
rsh ws logs <ws-id>

# 发送消息到 workspace
rsh ws message <ws-id> "请添加输入验证"

# 终止 workspace
rsh ws kill <ws-id>

# 清理已完成的 workspace
rsh ws cleanup
```

### 验收命令

```bash
# 查看待验收列表
rsh review list

# 查看提交详情
rsh review show <task-id>

# 运行验收测试
rsh review test <task-id>

# 接受提交
rsh review accept <task-id>

# 请求修改
rsh review revise <task-id> --feedback "需要添加错误处理"

# 拒绝提交
rsh review reject <task-id> --reason "不符合需求"
```

### 交互式命令

```bash
# 进入交互式项目管理界面
rsh pm

# 进入交互式需求分析
rsh pm analyze "用户需求描述..."

# 进入交互式验收流程
rsh pm review
```

---

## 集成到 ropcode

### 架构集成点

```
┌──────────────────────────────────────────────────────────────────┐
│                         ropcode                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Main Window (Main Project)               │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │              rsh Project Manager Panel                │  │  │
│  │  │  - 需求列表 / 任务看板                                 │  │  │
│  │  │  - Workspace 状态监控                                  │  │  │
│  │  │  - 验收队列                                           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │              Terminal / AI Chat                       │  │  │
│  │  │  - 项目经理 AI 交互                                    │  │  │
│  │  │  - 需求分析对话                                        │  │  │
│  │  │  - 验收决策                                           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Workspace Windows (Sub Projects)              │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                  │  │
│  │  │  Workspace A    │  │  Workspace B    │                  │  │
│  │  │  + Claude       │  │  + Codex        │                  │  │
│  │  │  Terminal       │  │  Terminal       │                  │  │
│  │  │  Files          │  │  Files          │                  │  │
│  │  │  Preview        │  │  Preview        │                  │  │
│  │  └─────────────────┘  └─────────────────┘                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Go 后端扩展

```go
// internal/rsh/manager.go
type RSHManager struct {
    project     *Project
    workspaces  map[string]*Workspace
    taskQueue   *TaskQueue
    providers   map[string]AIProvider

    // 通信
    msgBroker   *MessageBroker

    // 事件
    eventHub    *EventHub
}

// 核心方法
func (m *RSHManager) CreateWorkspace(opts WorkspaceOptions) (*Workspace, error)
func (m *RSHManager) AssignTask(taskId, workspaceId string) error
func (m *RSHManager) GetWorkspaceStatus(wsId string) (*WorkspaceStatus, error)
func (m *RSHManager) AcceptTask(taskId string) error
func (m *RSHManager) ReviseTask(taskId, feedback string) error
func (m *RSHManager) RejectTask(taskId, reason string) error
```

### 前端组件

```
frontend/src/
├── components/
│   └── rsh/
│       ├── ProjectManagerPanel.tsx   # 主面板
│       ├── RequirementList.tsx       # 需求列表
│       ├── TaskBoard.tsx             # 任务看板
│       ├── WorkspaceMonitor.tsx      # Workspace 监控
│       ├── ReviewQueue.tsx           # 验收队列
│       └── TaskDetail.tsx            # 任务详情
│
└── store/
    └── rshStore.ts                   # rsh 状态管理
```

---

## 实施阶段

### Phase 1: 核心基础设施

1. **数据模型实现**
   - Project, Workspace, Task, Requirement 类型
   - 状态持久化 (JSON 文件 / SQLite)

2. **Worktree 管理**
   - `git worktree add/remove` 封装
   - 分支创建和管理

3. **基础消息传递**
   - 文件系统方式的 inbox/outbox
   - 心跳机制

### Phase 2: AI Provider 集成

1. **Claude 适配器**
   - claude-code CLI 封装
   - 会话管理

2. **任务注入**
   - 任务上下文生成
   - 初始提示词模板

3. **进度采集**
   - 解析 AI 输出
   - 进度估算

### Phase 3: 项目管理功能

1. **需求解析**
   - 自然语言理解
   - 结构化需求生成

2. **任务拆解**
   - 依赖分析
   - 复杂度评估

3. **任务调度**
   - 并行任务管理
   - 资源分配

### Phase 4: 验收系统

1. **自动化测试**
   - 测试运行集成
   - 覆盖率检查

2. **AI 代码审查**
   - 审查提示词
   - 结果解析

3. **验收 UI**
   - Diff 视图
   - 审批工作流

### Phase 5: UI 集成

1. **任务看板**
   - Kanban 视图
   - 拖拽操作

2. **Workspace 监控**
   - 实时状态
   - 日志查看

3. **验收界面**
   - 代码对比
   - 一键操作

---

## 与 Widget 移植的关系

rsh 项目管理系统和 Widget 移植是**互补的**：

1. **Widget 移植提供基础能力**
   - Terminal Widget: 运行 AI CLI、显示日志
   - Files Widget: 浏览 worktree 文件
   - Preview Widget: 查看代码变更
   - Web Widget: 显示文档

2. **rsh 使用 Widget 能力**
   - Workspace 窗口使用 Terminal 运行 AI
   - 验收时使用 Preview 查看代码
   - 项目管理面板使用 Files 导航

3. **并行开发策略**
   - Widget 移植: 可以先独立完成
   - rsh 核心: 使用现有组件开发
   - 最终集成: Widget + rsh 整合

---

## 总结

rsh 项目管理系统将 ropcode 从"单一 AI 工具"升级为"AI 团队协作平台"：

- **项目经理视角**: 一个界面管理多个并行任务
- **多 AI 协作**: Claude、Codex、Gemini 各展所长
- **质量保证**: 结构化的验收流程
- **效率提升**: 并行开发，快速迭代

下一步：
1. 确认架构设计是否符合预期
2. 选择首先实现的模块
3. 开始 Phase 1 基础设施开发
