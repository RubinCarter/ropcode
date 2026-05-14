import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Terminal, FolderTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ResizeHandle } from './ResizeHandle';
import { VerticalResizeHandle } from './VerticalResizeHandle';
import { GitStatusPane, GitFileChange } from "./GitStatusPane";
import { ActionsConfigDialog } from './ActionsConfigDialog';
import { TerminalTabs, TerminalSession } from './TerminalTabs';
import { TerminalPane, TerminalOutput } from './TerminalPane';
import { TerminalInput } from './TerminalInput';
import { XtermTerminal } from './XtermTerminal';
import { RunTabPane } from './RunTabPane';
import { FileTreeBrowser } from './FileTreeBrowser';
import { api, listen, type Action } from '@/lib/api';
import { useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import {
  generateTerminalId,
  generateTerminalTitle,
  getWorkspaceStorageKey,
  saveTerminalState,
  loadTerminalState,
} from '@/lib/terminalUtils';
import { usesMetaKeyForAppShortcuts } from '@/lib/platform';
import { basename, normalizePath } from '@/lib/pathUtils';

interface RightSidebarProps {
  isOpen?: boolean;
  onToggle?: () => void;
  defaultWidthPercent?: number; // 默认宽度百分比
  className?: string;
  currentProjectPath?: string; // 当前 workspace/project 路径
}

// 每个 workspace 的终端状态
interface WorkspaceTerminalState {
  sessions: TerminalSession[];
  activeSessionId: string;
  outputs: Record<string, TerminalOutput[]>;
  commandHistory: string[];
  // 命令ID到会话ID的映射，用于将输出路由到正确的会话
  commandToSessionMap: Map<string, string>;
  // 每个会话的运行状态：会话ID -> 是否正在运行命令
  sessionRunningState: Map<string, boolean>;
  // 每个会话当前运行的命令ID：会话ID -> 命令ID
  sessionCommandId: Map<string, string>;
  // 命令开始时间戳，用于超时检测：命令ID -> 时间戳
  commandStartTime: Map<string, number>;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen = true,
  onToggle,
  defaultWidthPercent = 35,
  className,
  currentProjectPath
}) => {
  const [widthPercent, setWidthPercent] = useState(defaultWidthPercent);
  const [hasGitSupport, setHasGitSupport] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<'console' | 'files'>('console');

  // 广播右侧栏宽度变化
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('right-sidebar-width-changed', {
      detail: { widthPercent }
    }));
  }, [widthPercent]);

  // 检测 Git 支持
  useEffect(() => {
    if (!currentProjectPath) {
      setHasGitSupport(false);
      return;
    }

    const checkGitSupport = async () => {
      try {
        const isGitRepo = await api.isGitRepository(currentProjectPath);
        setHasGitSupport(isGitRepo);
      } catch (error) {
        console.error('[RightSidebar] Failed to check git support:', error);
        setHasGitSupport(false);
      }
    };

    checkGitSupport();
  }, [currentProjectPath]);

  const [gitPaneHeight, setGitPaneHeight] = useState(250); // Git 面板高度
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const { tabs, addTab, updateTab, setActiveTab } = useWorkspaceTabContext();

  // 创建 Diff Tab（与 File Tab 共用同一个 slot）
  const createDiffTab = useCallback((filePath: string, projectPath: string, gitStatus?: GitFileChange['status']): string | null => {
    const fileName = basename(filePath, filePath);

    // 查找现有的 file 或 diff tab
    const existingTab = tabs.find(tab =>
      (tab.type === 'diff' || tab.type === 'file') &&
      tab.projectPath === projectPath
    );

    if (existingTab) {
      // 更新现有 tab 为 diff
      updateTab(existingTab.id, {
        type: 'diff',
        title: `Diff: ${fileName}`,
        icon: 'file-diff',
        filePath: filePath,
        gitStatus,
        projectPath: projectPath,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    // 创建新 tab
    return addTab({
      type: 'diff',
      title: `Diff: ${fileName}`,
      filePath: filePath,
      gitStatus,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file-diff'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  // 创建 File Tab（与 Diff Tab 共用同一个 slot）
  const createFileTab = useCallback((filePath: string, projectPath: string): string | null => {
    const fileName = basename(filePath, filePath);

    // 查找现有的 file 或 diff tab
    const existingTab = tabs.find(tab =>
      (tab.type === 'file' || tab.type === 'diff') &&
      tab.projectPath === projectPath
    );

    if (existingTab) {
      // 更新现有 tab 为 file
      updateTab(existingTab.id, {
        type: 'file',
        title: fileName,
        icon: 'file',
        filePath: filePath,
        projectPath: projectPath,
        diffFilePath: undefined,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    // 创建新 tab
    return addTab({
      type: 'file',
      title: fileName,
      filePath: filePath,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  // 创建 WebViewer Tab
  const createWebViewerTab = useCallback((url: string, projectPath: string): string | null => {
    let displayName = 'Web';
    try {
      const urlObj = new URL(url);
      displayName = urlObj.hostname || displayName;
    } catch {
      displayName = 'Web';
    }

    // 查找现有的 webview tab
    const existingTab = tabs.find(tab =>
      tab.type === 'webview' &&
      tab.projectPath === projectPath
    );

    if (existingTab) {
      updateTab(existingTab.id, {
        title: displayName,
        url: url,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'webview',
      title: displayName,
      url: url,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'globe'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  // Actions 状态
  const [actions, setActions] = useState<Action[]>([]);
  const [runningActionId, setRunningActionId] = useState<string>();
  const [showActionsConfig, setShowActionsConfig] = useState(false);

  // Run Tab 状态
  const [isRunTabActive, setIsRunTabActive] = useState(false);

  // 处理打开 WebView 浏览器
  const handleOpenWebView = useCallback(() => {
    if (!currentProjectPath) return;
    createWebViewerTab('https://www.google.com', currentProjectPath);
  }, [currentProjectPath, createWebViewerTab]);

  // 使用 Map 存储每个 workspace 的状态
  const workspaceStates = useRef<Map<string, WorkspaceTerminalState>>(new Map());

  // 获取当前 workspace 的状态
  const getCurrentState = useCallback((): WorkspaceTerminalState => {
    const key = getWorkspaceStorageKey(currentProjectPath);

    if (!workspaceStates.current.has(key)) {
      // 尝试从本地存储加载
      const savedState = loadTerminalState(key);

      if (savedState && savedState.sessions.length > 0) {
        // 使用保存的状态
        console.log('[RightSidebar] 📦 从本地存储加载 workspace 终端状态:', key);
        const outputs: Record<string, TerminalOutput[]> = {};
        savedState.sessions.forEach((session: TerminalSession) => {
          outputs[session.id] = [];
        });

        workspaceStates.current.set(key, {
          sessions: savedState.sessions,
          activeSessionId: savedState.activeSessionId,
          outputs,
          commandHistory: savedState.commandHistory || [],
          commandToSessionMap: new Map(),
          sessionRunningState: new Map(),
          sessionCommandId: new Map(),
          commandStartTime: new Map()
        });
      } else {
        // 创建默认状态
        console.log('[RightSidebar] 🆕 创建新的 workspace 终端状态:', key);
        const firstTerminalId = generateTerminalId();
        workspaceStates.current.set(key, {
          sessions: [{ id: firstTerminalId, title: 'Terminal 1', type: 'bash', isPty: true }],
          activeSessionId: firstTerminalId,
          outputs: { [firstTerminalId]: [] },
          commandHistory: [],
          commandToSessionMap: new Map(),
          sessionRunningState: new Map(),
          sessionCommandId: new Map(),
          commandStartTime: new Map()
        });
      }
    }

    return workspaceStates.current.get(key)!;
  }, [currentProjectPath]);

  // 强制更新组件
  const [, forceUpdate] = useState({});
  const triggerUpdate = () => forceUpdate({});

  const state = getCurrentState();

  // 监听 workspace 切换
  const prevProjectPathRef = useRef<string | undefined>();
  useEffect(() => {
    const key = currentProjectPath || 'default';
    const prevKey = prevProjectPathRef.current || 'default';

    if (prevKey !== key) {
      console.log('[RightSidebar] 🔄 Workspace 切换:', prevKey, '->', key);
      const currentState = getCurrentState();
      console.log('[RightSidebar] 📊 新 workspace 状态:', {
        sessions: currentState.sessions.length,
        activeSessionId: currentState.activeSessionId,
        outputCount: Object.keys(currentState.outputs).length,
        historyCount: currentState.commandHistory.length
      });

      // 强制更新组件以显示新 workspace 的状态
      triggerUpdate();
    }

    prevProjectPathRef.current = currentProjectPath;
  }, [currentProjectPath, getCurrentState]);

  // 从路径中提取 projectName 和 workspaceName
  const parseProjectPath = useCallback((path: string | undefined) => {
    if (!path) return null;

    const parts = normalizePath(path).split('/');
    const ropcodeIndex = parts.findIndex(p => p === '.ropcode');

    if (ropcodeIndex > 0) {
      // Workspace 路径: /path/to/project/.ropcode/workspace-name
      return {
        projectName: parts[ropcodeIndex - 1],
        workspaceName: parts[ropcodeIndex + 1]
      };
    } else {
      // Project 路径: /path/to/project (取最后一个非空部分)
      const projectName = parts.filter(p => p).pop();
      return projectName ? { projectName, workspaceName: undefined } : null;
    }
  }, []);

  // 加载 Actions
  const loadActions = useCallback(async () => {
    if (!currentProjectPath) {
      setActions([]);
      return;
    }

    try {
      const parsed = parseProjectPath(currentProjectPath);
      if (!parsed) {
        console.warn('[RightSidebar] 无法解析项目路径:', currentProjectPath);
        setActions([]);
        return;
      }

      const result = await api.getActions(parsed.projectName, parsed.workspaceName);
      const allActions = [
        ...result.global_actions,
        ...result.project_actions,
        ...result.workspace_actions
      ];
      setActions(allActions);
    } catch (error) {
      console.error('Failed to load actions:', error);
      setActions([]);
    }
  }, [currentProjectPath, parseProjectPath]);

  // 监听 currentProjectPath 变化，加载 actions
  useEffect(() => {
    loadActions();
  }, [loadActions]);

  // 创建新终端会话
  const handleNewTerminal = useCallback(() => {
    const currentState = getCurrentState();
    const newId = generateTerminalId();
    const newSession: TerminalSession = {
      id: newId,
      title: generateTerminalTitle(currentState.sessions.length + 1),
      type: 'bash',
      isPty: true
    };

    currentState.sessions.push(newSession);
    currentState.outputs[newId] = [];
    currentState.activeSessionId = newId;

    // 保存到本地存储
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    console.log('[RightSidebar] 🆕 创建新终端:', { id: newId, title: newSession.title });
    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  // 处理 Git 文件点击 - 创建 Diff Tab
  const handleGitFileClick = useCallback((file: GitFileChange) => {
    if (!currentProjectPath) return;

    console.log('[RightSidebar] Git file clicked, creating diff tab:', file.path);
    createDiffTab(file.path, currentProjectPath, file.status);
  }, [currentProjectPath, createDiffTab]);

  // 处理文件树点击 - 创建 File Tab
  const handleFileTreeClick = useCallback((filePath: string) => {
    if (!currentProjectPath) return;

    console.log('[RightSidebar] File tree clicked, creating file tab:', filePath);
    createFileTab(filePath, currentProjectPath);
  }, [currentProjectPath, createFileTab]);

  // 关闭终端会话
  const handleCloseSession = useCallback(async (id: string) => {
    const currentState = getCurrentState();
    if (currentState.sessions.length === 1) {
      console.log('[RightSidebar] ⚠️ 不能关闭最后一个终端');
      return; // 至少保留一个会话
    }

    console.log('[RightSidebar] 🗑️ 关闭终端:', id);

    // 清理 PTY 会话
    try {
      await api.closePtySession(id);
      console.log('[RightSidebar] ✅ PTY 会话已关闭:', id);
    } catch (error) {
      console.error('[RightSidebar] ❌ 关闭 PTY 会话失败:', id, error);
    }

    // 从状态中移除
    currentState.sessions = currentState.sessions.filter(s => s.id !== id);
    delete currentState.outputs[id];

    // 清理相关的运行状态
    currentState.sessionRunningState.delete(id);
    const commandId = currentState.sessionCommandId.get(id);
    if (commandId) {
      currentState.commandToSessionMap.delete(commandId);
      currentState.commandStartTime.delete(commandId);
      currentState.sessionCommandId.delete(id);
    }

    // 如果关闭的是当前激活的会话，切换到第一个
    if (currentState.activeSessionId === id) {
      currentState.activeSessionId = currentState.sessions[0]?.id || '';
    }

    // 保存到本地存储
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  // 执行命令
  const handleSubmitCommand = useCallback(async (command: string) => {
    const currentState = getCurrentState();
    const sessionId = currentState.activeSessionId;
    const projectPath = currentProjectPath;

    if (!sessionId) return;

    // 添加到历史记录
    currentState.commandHistory = [command, ...currentState.commandHistory].slice(0, 50);

    // 添加命令输出
    const commandOutput: TerminalOutput = {
      id: `${Date.now()}-cmd`,
      type: 'command',
      content: command,
      timestamp: new Date()
    };

    currentState.outputs[sessionId].push(commandOutput);
    triggerUpdate();

    // 生成唯一的命令 ID
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 设置会话级别的运行状态
    currentState.sessionRunningState.set(sessionId, true);
    currentState.sessionCommandId.set(sessionId, commandId);

    // 记录命令ID和会话ID的映射，确保输出到正确的会话
    currentState.commandToSessionMap.set(commandId, sessionId);
    // 记录命令开始时间
    currentState.commandStartTime.set(commandId, Date.now());
    console.log('[RightSidebar] 📝 记录命令映射:', { commandId, sessionId, command: command.substring(0, 50) });

    try {
      // 使用异步流式 API 执行命令
      await api.executeCommandAsync(commandId, command, projectPath);

      // 命令已开始执行,输出会通过事件流式传入
      // 不需要在这里处理结果
    } catch (error) {
      const errorOutput: TerminalOutput = {
        id: `${Date.now()}-error`,
        type: 'error',
        content: `Error: ${error}`,
        timestamp: new Date()
      };

      currentState.outputs[sessionId].push(errorOutput);
      triggerUpdate();

      // 清理会话运行状态
      currentState.sessionRunningState.set(sessionId, false);
      currentState.sessionCommandId.delete(sessionId);
      // 清理映射和时间戳
      currentState.commandToSessionMap.delete(commandId);
      currentState.commandStartTime.delete(commandId);
    }
  }, [getCurrentState, currentProjectPath]);

  // 执行 Action
  const handleExecuteAction = useCallback(async (action: Action) => {
    // 判断 action 类型：默认为 'script'
    const actionType = action.actionType || 'script';

    if (actionType === 'web') {
      // Web action: 打开 WebViewer Tab
      if (!action.command) {
        console.error('[RightSidebar] Web action has no URL:', action);
        return;
      }

      if (!currentProjectPath) {
        console.error('[RightSidebar] Cannot open web viewer: no project path');
        return;
      }

      try {
        createWebViewerTab(action.command, currentProjectPath);
      } catch (error) {
        console.error('[RightSidebar] Failed to create web viewer tab:', error);
      }
      return;
    }

    // Script action: 执行命令
    setRunningActionId(action.id);

    // 切换到第一个 Terminal
    const currentState = getCurrentState();
    const firstTerminal = currentState.sessions[0];
    if (firstTerminal) {
      currentState.activeSessionId = firstTerminal.id;
      setIsRunTabActive(false); // 关闭 Run tab
      triggerUpdate();

      // 等待 UI 更新
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        // 如果是 PTY 终端，直接写入命令
        if (firstTerminal.isPty) {
          // 检查 PTY 会话是否存活
          const isAlive = await api.isPtySessionAlive(firstTerminal.id);
          if (isAlive) {
            await api.writeToPty(firstTerminal.id, action.command + '\n');
          } else {
            console.warn('[RightSidebar] PTY session not ready yet:', firstTerminal.id);
            // 等待一下再重试
            await new Promise(resolve => setTimeout(resolve, 500));
            await api.writeToPty(firstTerminal.id, action.command + '\n');
          }
        } else {
          // 旧的命令执行方式
          await handleSubmitCommand(action.command);
        }
      } catch (error) {
        console.error('[RightSidebar] Failed to execute action:', error);
      } finally {
        // 延迟清除运行状态
        setTimeout(() => {
          setRunningActionId(undefined);
        }, 500);
      }
    }
  }, [handleSubmitCommand, getCurrentState, triggerUpdate, createWebViewerTab, currentProjectPath]);

  // 停止当前运行的命令
  const handleStopCommand = useCallback(async () => {
    const currentState = getCurrentState();
    const sessionId = currentState.activeSessionId;
    const commandId = currentState.sessionCommandId.get(sessionId);

    if (!commandId) return;

    try {
      await api.killCommand(commandId);

      // 添加停止消息
      const stopOutput: TerminalOutput = {
        id: `${Date.now()}-stop`,
        type: 'error',
        content: '^C (Command cancelled)',
        timestamp: new Date()
      };

      currentState.outputs[sessionId].push(stopOutput);
      triggerUpdate();
    } catch (error) {
      console.error('Failed to kill command:', error);
    } finally {
      // 清理会话运行状态
      currentState.sessionRunningState.set(sessionId, false);
      currentState.sessionCommandId.delete(sessionId);
      // 清理命令映射和时间戳
      if (commandId) {
        currentState.commandToSessionMap.delete(commandId);
        currentState.commandStartTime.delete(commandId);
      }
    }
  }, [getCurrentState]);

  // 从历史记录选择命令
  const handleSelectHistory = useCallback((command: string) => {
    handleSubmitCommand(command);
  }, [handleSubmitCommand]);

  // 切换会话
  const handleSelectSession = useCallback((id: string) => {
    const currentState = getCurrentState();
    currentState.activeSessionId = id;
    setIsRunTabActive(false); // 切换到终端 tab 时关闭 Run tab

    // 保存到本地存储
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    console.log('[RightSidebar] 🔄 切换到终端:', id);
    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  
  // 切换到 Run tab
  const handleSelectRunTab = useCallback(() => {
    setIsRunTabActive(true);
  }, []);

  // 监听终端输出事件
  useEffect(() => {
    const unlisten = listen('terminal-output', (payload: {
      command_id: string;
      output_type: string;
      content: string;
      exit_code?: number;
    }) => {
      const { command_id, output_type, content, exit_code } = payload;
      const currentState = getCurrentState();

        // 根据命令ID找到对应的会话ID
        const sessionId = currentState.commandToSessionMap.get(command_id);

        if (!sessionId) {
          console.warn('[RightSidebar] ⚠️ 收到未知命令的输出:', command_id);
          return;
        }

        console.log('[RightSidebar] 📥 路由输出到会话:', { command_id, sessionId, output_type, exit_code });

        // 检测 ANSI 清屏序列 (clear 命令的输出)
        const clearScreenPattern = /\x1b\[(?:2J|3J|H)/;
        if (clearScreenPattern.test(content)) {
          // 清空当前会话的输出
          currentState.outputs[sessionId] = [];
          triggerUpdate();

          // 如果是退出事件,标记命令执行完成
          if (output_type === 'exit') {
            currentState.sessionRunningState.set(sessionId, false);
            currentState.sessionCommandId.delete(sessionId);
            currentState.commandToSessionMap.delete(command_id);
          }
          return; // 不添加清屏序列本身
        }

        // 移除其他 ANSI 转义序列（颜色、光标控制等）
        const cleanContent = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

        // 如果清理后内容为空，跳过
        if (!cleanContent.trim() && output_type !== 'exit') {
          return;
        }

        // 添加输出到当前会话
        const output: TerminalOutput = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: output_type === 'stderr' ? 'error' : 'output',
          content: cleanContent,
          timestamp: new Date()
        };

        currentState.outputs[sessionId].push(output);
        triggerUpdate();

        // 如果是退出事件,标记命令执行完成
        if (output_type === 'exit') {
          // 清理会话运行状态
          currentState.sessionRunningState.set(sessionId, false);
          currentState.sessionCommandId.delete(sessionId);
          // 清理命令映射和时间戳
          currentState.commandToSessionMap.delete(command_id);
          currentState.commandStartTime.delete(command_id);
          console.log('[RightSidebar] 🧹 清理命令映射和运行状态:', command_id, sessionId);
        }
      });

    return unlisten;
  }, [getCurrentState]);

  // 注意：不再需要轮询清理僵死的命令状态
  // terminal-output 事件的 exit 处理（line 670-677）已经负责清理会话运行状态
  // 如果出现异常情况，应该通过事件机制处理，而不是依赖轮询

  // 先定义所有变量和回调（在任何条件 return 之前）
  const currentOutputs = state.outputs[state.activeSessionId] || [];
  const isCurrentSessionRunning = state.sessionRunningState.get(state.activeSessionId) || false;
  const currentSession = state.sessions.find(s => s.id === state.activeSessionId);

  // 处理垂直调整大小
  const handleVerticalResize = useCallback((deltaY: number) => {
    setGitPaneHeight(prev => {
      const newHeight = prev + deltaY;
      // 限制最小和最大高度
      return Math.max(150, Math.min(newHeight, 600));
    });
  }, []);

  // 监听全局快捷键 - 使用 capture 阶段确保优先处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = usesMetaKeyForAppShortcuts() ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+J: 切换终端显示
      if (modKey && e.key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        onToggle?.();
        return;
      }

      // Ctrl+C: 停止当前命令（macOS 和其他平台都使用 Ctrl）
      // 必须在终端打开且有命令运行时才拦截
      const currentState = getCurrentState();
      const sessionId = currentState.activeSessionId;
      const isCurrentSessionRunning = currentState.sessionRunningState.get(sessionId) || false;

      if (e.ctrlKey && e.key === 'c' && isCurrentSessionRunning && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleStopCommand();
        return;
      }
    };

    // 使用 capture 阶段确保在其他事件处理器之前捕获
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onToggle, isOpen, handleStopCommand, getCurrentState]);

  // 条件渲染必须在所有 hooks 之后
  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={terminalContainerRef}
      className={cn(
        "relative h-full border-l bg-background/95 backdrop-blur-md flex flex-col",
        className
      )}
      style={{ width: `${widthPercent}%`, minWidth: '200px', flexShrink: 0 }}
      tabIndex={-1}
    >
      {/* 水平调整大小手柄 */}
      <ResizeHandle
        onResize={(newWidth) => {
          // 将像素宽度转换为百分比
          const percent = (newWidth / window.innerWidth) * 100;
          // 限制在 15% - 50% 之间
          setWidthPercent(Math.max(15, Math.min(50, percent)));
        }}
      />

      {/* Tab 切换栏 */}
      <div className="flex items-center border-b bg-muted/10">
        <button
          onClick={() => setActiveRightTab('console')}
          className={cn(
            "flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2",
            activeRightTab === 'console'
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <Terminal className="w-4 h-4" />
          Console
        </button>
        <button
          onClick={() => setActiveRightTab('files')}
          className={cn(
            "flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2",
            activeRightTab === 'files'
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <FolderTree className="w-4 h-4" />
          Files
        </button>
      </div>

      {/* Tab 内容 - Console */}
      {activeRightTab === 'console' && (
        <div className="flex-1 flex flex-col overflow-hidden">
              {/* Git 状态面板 - 只在有 Git 支持时显示 */}
          {hasGitSupport && (
            <>
              <div
                className="border-b"
                style={{ height: gitPaneHeight }}
              >
                <GitStatusPane
                  workspacePath={currentProjectPath}
                  onFileClick={handleGitFileClick}
                />
              </div>

              {/* 垂直调整大小手柄 */}
              <VerticalResizeHandle onResize={handleVerticalResize} />
            </>
          )}

          {/* 终端区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab 管理 */}
        <TerminalTabs
          sessions={state.sessions}
          activeSessionId={isRunTabActive ? undefined : state.activeSessionId}
          onSelectSession={handleSelectSession}
          onCloseSession={handleCloseSession}
          onNewTerminal={handleNewTerminal}
          commandHistory={state.commandHistory}
          onSelectHistory={handleSelectHistory}
          showRunTab={isRunTabActive}
          onSelectRunTab={handleSelectRunTab}
        />

        {/* 根据 isRunTabActive 显示 Run Tab 或 Terminal */}
        {isRunTabActive ? (
          <RunTabPane
            actions={actions}
            onExecute={handleExecuteAction}
            runningActionId={runningActionId}
            isTerminalRunning={isCurrentSessionRunning}
            className="flex-1"
            onActionsConfig={() => setShowActionsConfig(true)}
            onOpenWebView={handleOpenWebView}
          />
        ) : (
          <div className="flex-1 relative">
            {/* 渲染所有 PTY 终端 - Linus 简化版 */}
            {state.sessions.map((session) => (
              session.isPty ? (
                <XtermTerminal
                  key={`${currentProjectPath || 'default'}::${session.id}`}
                  sessionId={session.id}
                  workspaceId={currentProjectPath || 'default'}
                  cwd={currentProjectPath}
                  className="absolute inset-0"
                  isActive={session.id === state.activeSessionId}
                />
              ) : null
            ))}

            {/* 旧的非 PTY 终端（如果有的话） */}
            {currentSession && !currentSession.isPty && (
              <div className="absolute inset-0 flex flex-col" style={{ zIndex: 1 }}>
                {/* 终端输出面板 */}
                <TerminalPane
                  outputs={currentOutputs}
                  isRunning={isCurrentSessionRunning}
                  className="flex-1"
                  workspacePath={currentProjectPath}
                />

                {/* 命令输入框 */}
                <TerminalInput
                  onSubmit={handleSubmitCommand}
                  commandHistory={state.commandHistory}
                  disabled={isCurrentSessionRunning || !currentProjectPath}
                  isRunning={isCurrentSessionRunning}
                  placeholder={currentProjectPath ? 'Enter command...' : 'Please select a project first...'}
                />
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      )}

      {/* Tab 内容 - Files */}
      {activeRightTab === 'files' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <FileTreeBrowser
            workspacePath={currentProjectPath}
            onFileClick={handleFileTreeClick}
          />
        </div>
      )}

      {/* Actions 配置对话框 */}
      {(() => {
        // 只在对话框需要打开时才检查和输出警告
        if (!showActionsConfig) {
          return null;
        }

        if (!currentProjectPath) {
          console.warn('[RightSidebar] ⚠️ 无法打开 Actions 配置：没有当前项目路径');
          return null;
        }

        const parsed = parseProjectPath(currentProjectPath);

        if (!parsed) {
          console.warn('[RightSidebar] ⚠️ 无法打开 Actions 配置：无法解析项目路径:', currentProjectPath);
          return null;
        }

        console.log('[RightSidebar] 打开 Actions 配置对话框:', {
          currentProjectPath,
          parsed
        });

        return (
          <ActionsConfigDialog
            open={showActionsConfig}
            onOpenChange={setShowActionsConfig}
            projectName={parsed.projectName}
            workspaceName={parsed.workspaceName}
            onActionsUpdated={loadActions}
          />
        );
      })()}
    </div>
  );
};

export default RightSidebar;
