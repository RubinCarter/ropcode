# Workspace Container 架构重构实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构 workspace 切换架构，实现切换即时、无重渲染、状态完全隔离

**Architecture:** 将现有的全局 Tab 管理拆分为独立的容器模式。每个 Workspace 是一个独立容器，包含自己的 Tab 状态和 RightSidebar。SystemContainer 管理全局工具 Tab。切换只改变容器的 visibility，不触发重渲染。

**Tech Stack:** React, TypeScript, CSS (hidden attribute), Context API

---

## Phase 1: 创建容器状态管理

### Task 1.1: 创建 ContainerContext

**Files:**
- Create: `frontend/src/contexts/ContainerContext.tsx`

**Step 1: 创建 ContainerContext 文件**

```typescript
import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

// 容器类型
export type ContainerType = 'system' | 'workspace';

// 容器状态接口
export interface ContainerState {
  // 激活类型：系统工具 or 项目 workspace
  activeType: ContainerType;
  // 当前激活的 workspace ID（仅 activeType === 'workspace' 时有效）
  activeWorkspaceId: string | null;
  // 已打开的 workspace 列表（projectPath 作为 ID）
  openWorkspaces: string[];
  // 上一次激活的 workspace ID（用于从 system 返回）
  lastActiveWorkspaceId: string | null;
}

interface ContainerContextType extends ContainerState {
  // 切换到系统容器
  switchToSystem: () => void;
  // 切换到指定 workspace
  switchToWorkspace: (workspaceId: string) => void;
  // 关闭 workspace
  closeWorkspace: (workspaceId: string) => void;
  // 检查 workspace 是否已打开
  isWorkspaceOpen: (workspaceId: string) => boolean;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

export const ContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeType, setActiveType] = useState<ContainerType>('system');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [openWorkspaces, setOpenWorkspaces] = useState<string[]>([]);
  const [lastActiveWorkspaceId, setLastActiveWorkspaceId] = useState<string | null>(null);

  // 切换到系统容器
  const switchToSystem = useCallback(() => {
    // 保存当前 workspace 以便返回
    if (activeType === 'workspace' && activeWorkspaceId) {
      setLastActiveWorkspaceId(activeWorkspaceId);
    }
    setActiveType('system');
  }, [activeType, activeWorkspaceId]);

  // 切换到 workspace
  const switchToWorkspace = useCallback((workspaceId: string) => {
    // 如果 workspace 未打开，先添加到 openWorkspaces
    setOpenWorkspaces(prev => {
      if (!prev.includes(workspaceId)) {
        return [...prev, workspaceId];
      }
      return prev;
    });

    setActiveType('workspace');
    setActiveWorkspaceId(workspaceId);
  }, []);

  // 关闭 workspace
  const closeWorkspace = useCallback((workspaceId: string) => {
    setOpenWorkspaces(prev => prev.filter(id => id !== workspaceId));

    // 如果关闭的是当前激活的 workspace，切换到其他
    if (activeWorkspaceId === workspaceId) {
      const remaining = openWorkspaces.filter(id => id !== workspaceId);
      if (remaining.length > 0) {
        // 切换到最后一个打开的 workspace
        setActiveWorkspaceId(remaining[remaining.length - 1]);
      } else {
        // 没有其他 workspace，切换到系统容器
        setActiveType('system');
        setActiveWorkspaceId(null);
      }
    }

    // 清理 lastActiveWorkspaceId
    if (lastActiveWorkspaceId === workspaceId) {
      setLastActiveWorkspaceId(null);
    }
  }, [activeWorkspaceId, openWorkspaces, lastActiveWorkspaceId]);

  // 检查 workspace 是否已打开
  const isWorkspaceOpen = useCallback((workspaceId: string) => {
    return openWorkspaces.includes(workspaceId);
  }, [openWorkspaces]);

  const value: ContainerContextType = {
    activeType,
    activeWorkspaceId,
    openWorkspaces,
    lastActiveWorkspaceId,
    switchToSystem,
    switchToWorkspace,
    closeWorkspace,
    isWorkspaceOpen,
  };

  return (
    <ContainerContext.Provider value={value}>
      {children}
    </ContainerContext.Provider>
  );
};

export const useContainerContext = () => {
  const context = useContext(ContainerContext);
  if (!context) {
    throw new Error('useContainerContext must be used within a ContainerProvider');
  }
  return context;
};
```

**Step 2: 验证文件创建成功**

Run: `ls -la frontend/src/contexts/ContainerContext.tsx`
Expected: 文件存在

**Step 3: Commit**

```bash
git add frontend/src/contexts/ContainerContext.tsx
git commit -m "feat: add ContainerContext for workspace container management"
```

---

### Task 1.2: 创建 WorkspaceTabContext（每个 Workspace 独立的 Tab 状态）

**Files:**
- Create: `frontend/src/contexts/WorkspaceTabContext.tsx`

**Step 1: 创建 WorkspaceTabContext 文件**

```typescript
import React, { createContext, useState, useContext, useCallback } from 'react';

// Workspace 内的 Tab 类型（只包含 workspace 专属的）
export type WorkspaceTabType = 'chat' | 'diff' | 'file' | 'webview' | 'agent-execution' | 'agent' | 'claude-file';

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  sessionId?: string;
  sessionData?: any;
  agentRunId?: string;
  agentData?: any;
  claudeFileId?: string;
  diffFilePath?: string;
  filePath?: string;
  webviewUrl?: string;
  projectPath?: string;
  providerId?: string;
  providerSessions?: Record<string, { sessionId: string; sessionData: any }>;
  status: 'active' | 'idle' | 'running' | 'complete' | 'error';
  hasUnsavedChanges: boolean;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkspaceTabContextType {
  workspaceId: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>) => string;
  removeTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<WorkspaceTab>) => void;
  setActiveTab: (id: string) => void;
  getTabById: (id: string) => WorkspaceTab | undefined;
  findTabByType: (type: WorkspaceTabType) => WorkspaceTab | undefined;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextType | undefined>(undefined);

interface WorkspaceTabProviderProps {
  workspaceId: string;
  children: React.ReactNode;
}

export const WorkspaceTabProvider: React.FC<WorkspaceTabProviderProps> = ({ workspaceId, children }) => {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const generateTabId = () => {
    return `wstab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const addTab = useCallback((tabData: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const newTab: WorkspaceTab = {
      ...tabData,
      id: generateTabId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, []);

  const removeTab = useCallback((id: string) => {
    setTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== id);

      // 如果删除的是当前激活的 tab，切换到其他
      if (activeTabId === id && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }

      return filtered;
    });
  }, [activeTabId]);

  const updateTab = useCallback((id: string, updates: Partial<WorkspaceTab>) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.id === id
          ? { ...tab, ...updates, updatedAt: new Date() }
          : tab
      )
    );
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.find(tab => tab.id === id)) {
        setActiveTabId(id);
      }
      return prev;
    });
  }, []);

  const getTabById = useCallback((id: string): WorkspaceTab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const findTabByType = useCallback((type: WorkspaceTabType): WorkspaceTab | undefined => {
    return tabs.find(tab => tab.type === type);
  }, [tabs]);

  const value: WorkspaceTabContextType = {
    workspaceId,
    tabs,
    activeTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    getTabById,
    findTabByType,
  };

  return (
    <WorkspaceTabContext.Provider value={value}>
      {children}
    </WorkspaceTabContext.Provider>
  );
};

export const useWorkspaceTabContext = () => {
  const context = useContext(WorkspaceTabContext);
  if (!context) {
    throw new Error('useWorkspaceTabContext must be used within a WorkspaceTabProvider');
  }
  return context;
};
```

**Step 2: Commit**

```bash
git add frontend/src/contexts/WorkspaceTabContext.tsx
git commit -m "feat: add WorkspaceTabContext for per-workspace tab state"
```

---

### Task 1.3: 创建 SystemTabContext（全局工具 Tab 状态）

**Files:**
- Create: `frontend/src/contexts/SystemTabContext.tsx`

**Step 1: 创建 SystemTabContext 文件**

```typescript
import React, { createContext, useState, useContext, useCallback } from 'react';

// System Tab 类型（全局工具）
export type SystemTabType = 'agents' | 'usage' | 'mcp' | 'settings' | 'claude-md' | 'create-agent' | 'import-agent';

export interface SystemTab {
  id: string;
  type: SystemTabType;
  title: string;
  icon?: string;
  claudeFileId?: string; // for claude-md if needed
  status: 'active' | 'idle';
  createdAt: Date;
  updatedAt: Date;
}

interface SystemTabContextType {
  tabs: SystemTab[];
  activeTabId: string | null;
  activateTab: (type: SystemTabType) => string;
  getTabById: (id: string) => SystemTab | undefined;
  getActiveTab: () => SystemTab | undefined;
}

const SystemTabContext = createContext<SystemTabContextType | undefined>(undefined);

// Tab 配置映射
const TAB_CONFIG: Record<SystemTabType, { title: string; icon: string }> = {
  'agents': { title: 'Agents', icon: 'bot' },
  'usage': { title: 'Usage', icon: 'bar-chart' },
  'mcp': { title: 'MCP Servers', icon: 'server' },
  'settings': { title: 'Settings', icon: 'settings' },
  'claude-md': { title: 'Memory', icon: 'file-text' },
  'create-agent': { title: 'Create Agent', icon: 'plus' },
  'import-agent': { title: 'Import Agent', icon: 'import' },
};

export const SystemTabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<SystemTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const generateTabId = () => {
    return `systab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // 激活或创建系统 Tab（全局工具 Tab 采用单例模式）
  const activateTab = useCallback((type: SystemTabType): string => {
    // 查找是否已存在该类型的 Tab
    const existingTab = tabs.find(tab => tab.type === type);

    if (existingTab) {
      setActiveTabId(existingTab.id);
      return existingTab.id;
    }

    // 创建新 Tab
    const config = TAB_CONFIG[type];
    const newTab: SystemTab = {
      id: generateTabId(),
      type,
      title: config.title,
      icon: config.icon,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, [tabs]);

  const getTabById = useCallback((id: string): SystemTab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const getActiveTab = useCallback((): SystemTab | undefined => {
    if (!activeTabId) return undefined;
    return tabs.find(tab => tab.id === activeTabId);
  }, [tabs, activeTabId]);

  const value: SystemTabContextType = {
    tabs,
    activeTabId,
    activateTab,
    getTabById,
    getActiveTab,
  };

  return (
    <SystemTabContext.Provider value={value}>
      {children}
    </SystemTabContext.Provider>
  );
};

export const useSystemTabContext = () => {
  const context = useContext(SystemTabContext);
  if (!context) {
    throw new Error('useSystemTabContext must be used within a SystemTabProvider');
  }
  return context;
};
```

**Step 2: Commit**

```bash
git add frontend/src/contexts/SystemTabContext.tsx
git commit -m "feat: add SystemTabContext for global utility tabs"
```

---

## Phase 2: 创建容器组件

### Task 2.1: 创建 SystemContainer 组件

**Files:**
- Create: `frontend/src/components/containers/SystemContainer.tsx`

**Step 1: 创建目录和组件文件**

```typescript
import React, { Suspense, lazy } from 'react';
import { useSystemTabContext, SystemTabType } from '@/contexts/SystemTabContext';
import { Loader2 } from 'lucide-react';

// Lazy load components
const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));
const UsageDashboard = lazy(() => import('@/components/UsageDashboard').then(m => ({ default: m.UsageDashboard })));
const MCPManager = lazy(() => import('@/components/MCPManager').then(m => ({ default: m.MCPManager })));
const Settings = lazy(() => import('@/components/Settings').then(m => ({ default: m.Settings })));
const MarkdownEditor = lazy(() => import('@/components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
const CreateAgent = lazy(() => import('@/components/CreateAgent').then(m => ({ default: m.CreateAgent })));

interface SystemContainerProps {
  visible: boolean;
}

export const SystemContainer: React.FC<SystemContainerProps> = ({ visible }) => {
  const { tabs, activeTabId, getActiveTab } = useSystemTabContext();
  const activeTab = getActiveTab();

  const renderContent = () => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <p className="text-lg mb-2">Select an option from the sidebar</p>
            <p className="text-sm">Agents, Usage, Settings, and more</p>
          </div>
        </div>
      );
    }

    switch (activeTab.type) {
      case 'agents':
        return <Agents />;
      case 'usage':
        return <UsageDashboard onBack={() => {}} />;
      case 'mcp':
        return <MCPManager onBack={() => {}} />;
      case 'settings':
        return <Settings onBack={() => {}} />;
      case 'claude-md':
        return <MarkdownEditor onBack={() => {}} />;
      case 'create-agent':
        return (
          <CreateAgent
            onAgentCreated={() => {}}
            onBack={() => {}}
          />
        );
      case 'import-agent':
        return (
          <div className="flex items-center justify-center h-full">
            <div className="p-4">Import agent functionality coming soon...</div>
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <div className="p-4">Unknown tab type: {activeTab.type}</div>
          </div>
        );
    }
  };

  return (
    <div className={`h-full w-full flex flex-col ${visible ? '' : 'hidden'}`}>
      {/* System Tab 内容区域 */}
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
};

export default SystemContainer;
```

**Step 2: Commit**

```bash
mkdir -p frontend/src/components/containers
git add frontend/src/components/containers/SystemContainer.tsx
git commit -m "feat: add SystemContainer for global utility tabs"
```

---

### Task 2.2: 创建 WorkspaceContainer 组件

**Files:**
- Create: `frontend/src/components/containers/WorkspaceContainer.tsx`

**Step 1: 创建 WorkspaceContainer 文件**

```typescript
import React, { Suspense, lazy, useEffect } from 'react';
import { WorkspaceTabProvider, useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import { RightSidebar } from '@/components/right-sidebar';
import { Loader2 } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { providers } from '@/lib/providers';

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer'));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewer = lazy(() => import('@/components/WebViewer').then(m => ({ default: m.WebViewer })));

interface WorkspaceContainerProps {
  workspaceId: string; // projectPath
  visible: boolean;
  project?: Project;
}

// 内部组件：处理 Tab 内容渲染
const WorkspaceContent: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const { tabs, activeTabId, addTab, updateTab, removeTab, getTabById } = useWorkspaceTabContext();
  const activeTab = activeTabId ? getTabById(activeTabId) : undefined;

  // 首次挂载时，自动创建 Chat Tab
  useEffect(() => {
    if (tabs.length === 0) {
      initializeWorkspace();
    }
  }, []);

  const initializeWorkspace = async () => {
    try {
      // 加载 session 列表
      const sessionList = await providers.listSessions(workspaceId, 'claude');

      let selectedSession: any = null;
      if (sessionList.length > 0) {
        // 选择最新的 session
        const sortedSessions = [...sessionList].sort((a, b) => {
          const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
          const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
          return timeB - timeA;
        });
        selectedSession = sortedSessions[0];
      }

      // 创建 Chat Tab
      addTab({
        type: 'chat',
        title: 'Chat',
        sessionId: selectedSession?.id,
        sessionData: selectedSession ? { ...selectedSession, provider: 'claude' } : undefined,
        projectPath: workspaceId,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
    } catch (err) {
      console.error('[WorkspaceContainer] Failed to initialize workspace:', err);
      // 即使失败也创建一个空的 Chat Tab
      addTab({
        type: 'chat',
        title: 'Chat',
        projectPath: workspaceId,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
    }
  };

  const renderTabContent = () => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      );
    }

    switch (activeTab.type) {
      case 'chat':
        return (
          <div className="h-full w-full flex flex-col pt-4">
            <AiCodeSession
              key={`${activeTab.id}-${activeTab.providerId || 'claude'}`}
              session={activeTab.sessionData}
              initialProjectPath={workspaceId}
              defaultProvider={activeTab.providerId || 'claude'}
              onBack={() => removeTab(activeTab.id)}
              onProjectPathChange={() => {}}
              onProviderChange={(providerId) => {
                updateTab(activeTab.id, { providerId });
              }}
            />
          </div>
        );

      case 'agent':
        if (!activeTab.agentRunId) {
          return <div className="p-4">No agent run ID specified</div>;
        }
        return (
          <AgentRunOutputViewer
            agentRunId={activeTab.agentRunId}
            tabId={activeTab.id}
          />
        );

      case 'agent-execution':
        if (!activeTab.agentData) {
          return <div className="p-4">No agent data specified</div>;
        }
        return (
          <AgentExecution
            agent={activeTab.agentData}
            projectPath={workspaceId}
            tabId={activeTab.id}
            onBack={() => {}}
          />
        );

      case 'diff':
        if (!activeTab.diffFilePath) {
          return <div className="p-4">No file path specified</div>;
        }
        return (
          <DiffViewer
            filePath={activeTab.diffFilePath}
            workspacePath={workspaceId}
          />
        );

      case 'file':
        if (!activeTab.filePath) {
          return <div className="p-4">No file path specified</div>;
        }
        return (
          <FileViewer
            filePath={activeTab.filePath}
            workspacePath={workspaceId}
          />
        );

      case 'webview':
        if (!activeTab.webviewUrl) {
          return <div className="p-4">No URL specified</div>;
        }
        return (
          <WebViewer
            url={activeTab.webviewUrl}
            workspacePath={workspaceId}
            onUrlChange={(newUrl) => updateTab(activeTab.id, { webviewUrl: newUrl })}
          />
        );

      default:
        return <div className="p-4">Unknown tab type: {activeTab.type}</div>;
    }
  };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      {renderTabContent()}
    </Suspense>
  );
};

export const WorkspaceContainer: React.FC<WorkspaceContainerProps> = ({
  workspaceId,
  visible,
  project,
}) => {
  const [rightSidebarOpen, setRightSidebarOpen] = React.useState(true);

  return (
    <WorkspaceTabProvider workspaceId={workspaceId}>
      <div className={`h-full w-full flex ${visible ? '' : 'hidden'}`}>
        {/* 主内容区域 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <WorkspaceContent workspaceId={workspaceId} />
        </div>

        {/* 右侧栏 */}
        <RightSidebar
          isOpen={rightSidebarOpen}
          onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
          currentProjectPath={workspaceId}
        />
      </div>
    </WorkspaceTabProvider>
  );
};

export default WorkspaceContainer;
```

**Step 2: Commit**

```bash
git add frontend/src/components/containers/WorkspaceContainer.tsx
git commit -m "feat: add WorkspaceContainer with independent tab state"
```

---

### Task 2.3: 创建 ContainerManager 组件

**Files:**
- Create: `frontend/src/components/containers/ContainerManager.tsx`
- Create: `frontend/src/components/containers/index.ts`

**Step 1: 创建 ContainerManager 文件**

```typescript
import React from 'react';
import { useContainerContext } from '@/contexts/ContainerContext';
import { SystemContainer } from './SystemContainer';
import { WorkspaceContainer } from './WorkspaceContainer';

export const ContainerManager: React.FC = () => {
  const { activeType, activeWorkspaceId, openWorkspaces } = useContainerContext();

  return (
    <div className="flex-1 h-full relative">
      {/* 系统容器 */}
      <SystemContainer visible={activeType === 'system'} />

      {/* Workspace 容器们 */}
      {openWorkspaces.map(workspaceId => (
        <WorkspaceContainer
          key={workspaceId}
          workspaceId={workspaceId}
          visible={activeType === 'workspace' && activeWorkspaceId === workspaceId}
        />
      ))}

      {/* 空状态：没有打开任何容器 */}
      {activeType === 'system' && openWorkspaces.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
          {/* SystemContainer 会处理空状态 */}
        </div>
      )}
    </div>
  );
};

export default ContainerManager;
```

**Step 2: 创建 index.ts 导出文件**

```typescript
export { ContainerManager } from './ContainerManager';
export { SystemContainer } from './SystemContainer';
export { WorkspaceContainer } from './WorkspaceContainer';
```

**Step 3: Commit**

```bash
git add frontend/src/components/containers/ContainerManager.tsx
git add frontend/src/components/containers/index.ts
git commit -m "feat: add ContainerManager to orchestrate containers"
```

---

## Phase 3: 更新 MainLayout 和 Sidebar

### Task 3.1: 更新 MainLayout 使用新的容器架构

**Files:**
- Modify: `frontend/src/components/MainLayout.tsx`

**Step 1: 修改 MainLayout**

将 MainLayout 的中间内容区域从 `<TabContent />` 改为 `<ContainerManager />`，并移除 RightSidebar（现在由 WorkspaceContainer 管理）。

```typescript
// 在文件顶部添加导入
import { ContainerManager } from '@/components/containers';
import { useContainerContext } from '@/contexts/ContainerContext';
import { useSystemTabContext } from '@/contexts/SystemTabContext';

// 修改组件内部
export const MainLayout: React.FC<MainLayoutProps> = ({
  className,
  onSettingsClick,
  onAgentsClick,
  onUsageClick,
  onClaudeClick,
  onMCPClick,
  onInfoClick
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeType, switchToSystem } = useContainerContext();
  const { activateTab } = useSystemTabContext();

  // 包装 navigation callbacks 以使用新的容器系统
  const handleSettingsClick = () => {
    switchToSystem();
    activateTab('settings');
    onSettingsClick?.();
  };

  const handleAgentsClick = () => {
    switchToSystem();
    activateTab('agents');
    onAgentsClick?.();
  };

  const handleUsageClick = () => {
    switchToSystem();
    activateTab('usage');
    onUsageClick?.();
  };

  const handleClaudeClick = () => {
    switchToSystem();
    activateTab('claude-md');
    onClaudeClick?.();
  };

  const handleMCPClick = () => {
    switchToSystem();
    activateTab('mcp');
    onMCPClick?.();
  };

  return (
    <div className={`h-full flex ${className || ''}`}>
      {/* Left Sidebar */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        onSettingsClick={handleSettingsClick}
        onAgentsClick={handleAgentsClick}
        onUsageClick={handleUsageClick}
        onClaudeClick={handleClaudeClick}
        onMCPClick={handleMCPClick}
        onInfoClick={onInfoClick}
      />

      {/* Center Content Area - Container Manager */}
      <ContainerManager />

      {/* RightSidebar 已移入 WorkspaceContainer */}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/MainLayout.tsx
git commit -m "refactor: update MainLayout to use ContainerManager"
```

---

### Task 3.2: 更新 Sidebar 使用新的容器 API

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

**Step 1: 修改 Sidebar 的项目点击处理**

移除 `sidebar-project-selected` 事件，直接调用 `switchToWorkspace`。

```typescript
// 在文件顶部添加导入
import { useContainerContext } from '@/contexts/ContainerContext';

// 在组件内部
const { switchToWorkspace, activeWorkspaceId, activeType, closeWorkspace } = useContainerContext();

// 修改 handleProjectClick
const handleProjectClick = async (project: Project) => {
  // 直接切换到 workspace，不再使用事件
  switchToWorkspace(project.path);

  // 更新访问时间
  try {
    await api.updateProjectAccessTime(project.id);
  } catch (err) {
    console.warn('Failed to update project access time:', err);
  }
};

// 修改 activeProjectPath 的来源
// 旧: const activeProjectPath = activeChatTab?.initialProjectPath;
// 新:
const activeProjectPath = activeType === 'workspace' ? activeWorkspaceId : null;
```

**Step 2: 添加 workspace 关闭按钮到 ProjectList**

需要在 ProjectList 组件中添加关闭按钮支持（或在 Sidebar 中直接处理）。

**Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "refactor: update Sidebar to use ContainerContext directly"
```

---

### Task 3.3: 在 App.tsx 中添加新的 Context Providers

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: 包装 App 组件**

```typescript
// 在文件顶部添加导入
import { ContainerProvider } from '@/contexts/ContainerContext';
import { SystemTabProvider } from '@/contexts/SystemTabContext';

// 在 render 中包装
return (
  <ContainerProvider>
    <SystemTabProvider>
      {/* 现有内容 */}
    </SystemTabProvider>
  </ContainerProvider>
);
```

**Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add ContainerProvider and SystemTabProvider to App"
```

---

## Phase 4: 清理和迁移

### Task 4.1: 保留旧 TabContext 兼容性（可选）

**Files:**
- Modify: `frontend/src/contexts/TabContext.tsx`

如果有其他组件仍在使用旧的 TabContext，可以暂时保留它，或者创建一个兼容层。

**Step 1: 评估依赖**

检查哪些组件仍在使用 `useTabContext`，决定是否需要迁移。

**Step 2: 逐步迁移或创建兼容层**

---

### Task 4.2: 移除不再需要的事件监听

**Files:**
- Modify: `frontend/src/components/TabContent.tsx`

移除 `sidebar-project-selected` 事件监听，因为现在由 ContainerContext 直接处理。

---

### Task 4.3: 添加 workspace 关闭功能到 UI

**Files:**
- Modify: `frontend/src/components/ProjectList.tsx`

在项目列表项上添加关闭按钮（hover 时显示 X）。

---

## Phase 5: 测试和验证

### Task 5.1: 手动测试切换功能

1. 打开应用
2. 点击一个项目 → 验证 WorkspaceContainer 创建并显示
3. 点击另一个项目 → 验证切换即时，无闪烁
4. 点击 Settings → 验证切换到 SystemContainer
5. 点击之前的项目 → 验证状态保留
6. 关闭一个 workspace → 验证正确切换到其他

### Task 5.2: 验证内存和性能

1. 打开多个 workspace
2. 检查内存使用
3. 验证切换时无重渲染（React DevTools Profiler）

---

## 预期收益

1. **切换即时**：只改 CSS visibility，无 DOM 重建
2. **无竞态条件**：单一状态控制激活，无需协调多个状态
3. **状态隔离**：每个 workspace 的 bug 不会影响其他 workspace
4. **代码简化**：移除大量状态同步和事件通信代码
5. **易于调试**：问题定位到单个容器内部
