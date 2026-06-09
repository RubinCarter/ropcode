import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Terminal, FolderTree, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TooltipProvider, TooltipSimple } from '@/components/ui/tooltip-modern';
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
import { ClaudeActivityPane } from './ClaudeActivityPane';
import type { PtyShellState } from '@/widgets/terminal/PtyTermWrap';
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
import { activityBadgeCount } from '@/lib/claudeActivity';
import type { main } from '@/lib/rpc-client';
import { useTranslation } from 'react-i18next';

const RIGHT_SIDEBAR_RAIL_WIDTH = 64;

interface RightSidebarProps {
  isOpen?: boolean;
  onToggle?: () => void;
  visible?: boolean;
  defaultWidthPercent?: number; // Default width percentage
  className?: string;
  currentProjectPath?: string; // Current workspace/project path
}

// Terminal state per workspace
interface WorkspaceTerminalState {
  sessions: TerminalSession[];
  activeSessionId: string;
  outputs: Record<string, TerminalOutput[]>;
  commandHistory: string[];
  // Command ID to session ID mapping for routing output
  commandToSessionMap: Map<string, string>;
  // Run state per session: sessionID -> isRunning
  sessionRunningState: Map<string, boolean>;
  // Current command per session: sessionID -> commandID
  sessionCommandId: Map<string, string>;
  // Command start timestamps for timeout: commandID -> timestamp
  commandStartTime: Map<string, number>;
}

type RightSidebarTab = 'console' | 'files' | 'tasks';

type RightRailButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  badgeCount?: number;
  onClick?: () => void;
  children: React.ReactNode;
};

const RightRailButton: React.FC<RightRailButtonProps> = ({
  label,
  active,
  disabled,
  badgeCount = 0,
  onClick,
  children
}) => (
  <TooltipSimple content={label} side="left">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground shadow-sm',
        disabled && 'cursor-not-allowed text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40'
      )}
    >
      {children}
      {badgeCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
          {badgeCount}
        </span>
      )}
    </button>
  </TooltipSimple>
);

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen = true,
  onToggle,
  visible = true,
  defaultWidthPercent = 35,
  className,
  currentProjectPath
}) => {
  const [widthPercent, setWidthPercent] = useState(defaultWidthPercent);
  const [hasGitSupport, setHasGitSupport] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<RightSidebarTab>('console');
  const [activitySnapshot, setActivitySnapshot] = useState<main.ClaudeActivitySnapshot | null>(null);
  const activityCount = activityBadgeCount(activitySnapshot);
  const { t } = useTranslation();

  // Broadcast right sidebar width change
  useEffect(() => {
    if (!visible) return;
    window.dispatchEvent(new CustomEvent('right-sidebar-width-changed', {
      detail: { widthPercent, railWidth: RIGHT_SIDEBAR_RAIL_WIDTH, isOpen, workspacePath: currentProjectPath }
    }));
  }, [widthPercent, isOpen, visible, currentProjectPath]);

  useEffect(() => {
    if (!visible) return;
    window.dispatchEvent(new CustomEvent('right-sidebar-state-changed', {
      detail: { isOpen, shouldShow: true, railWidth: RIGHT_SIDEBAR_RAIL_WIDTH, workspacePath: currentProjectPath }
    }));
  }, [isOpen, visible, currentProjectPath]);

  // Detect Git support
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

  const [gitPaneHeight, setGitPaneHeight] = useState(250); // Git panel height
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const { tabs, activeTabId, addTab, updateTab, setActiveTab } = useWorkspaceTabContext();
  const activeWorkspaceTab = tabs.find(tab => tab.id === activeTabId);
  const activeClaudeChatTab =
    activeWorkspaceTab?.type === 'chat' && (activeWorkspaceTab.providerId ?? 'claude') === 'claude'
      ? activeWorkspaceTab
      : undefined;

  // Create Diff Tab (shares slot with File Tab)
  const createDiffTab = useCallback((filePath: string, projectPath: string, gitStatus?: GitFileChange['status']): string | null => {
    const fileName = basename(filePath, filePath);

    // Find existing file or diff tab
    const existingTab = tabs.find(tab =>
      (tab.type === 'diff' || tab.type === 'file') &&
      tab.projectPath === projectPath
    );

    if (existingTab) {
      // Update existing tab to diff
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

    // Create new tab
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

  // Create File Tab (shares slot with Diff Tab)
  const createFileTab = useCallback((filePath: string, projectPath: string): string | null => {
    const fileName = basename(filePath, filePath);

    // Find existing file or diff tab
    const existingTab = tabs.find(tab =>
      (tab.type === 'file' || tab.type === 'diff') &&
      tab.projectPath === projectPath
    );

    if (existingTab) {
      // Update existing tab to file
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

    // Create new tab
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

  // Create WebViewer Tab
  const createWebViewerTab = useCallback((url: string, projectPath: string): string | null => {
    let displayName = 'Web';
    try {
      const urlObj = new URL(url);
      displayName = urlObj.hostname || displayName;
    } catch {
      displayName = 'Web';
    }

    // Find existing webview tab
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

  // Actions state
  const [actions, setActions] = useState<Action[]>([]);
  const [runningActionId, setRunningActionId] = useState<string>();
  const [showActionsConfig, setShowActionsConfig] = useState(false);

  // Run Tab state
  const [isRunTabActive, setIsRunTabActive] = useState(false);

  // Handle opening WebView browser
  const handleOpenWebView = useCallback(() => {
    if (!currentProjectPath) return;
    createWebViewerTab('https://www.google.com', currentProjectPath);
  }, [currentProjectPath, createWebViewerTab]);

  // Use Map to store state per workspace
  const workspaceStates = useRef<Map<string, WorkspaceTerminalState>>(new Map());

  // Get current workspace state
  const getCurrentState = useCallback((): WorkspaceTerminalState => {
    const key = getWorkspaceStorageKey(currentProjectPath);

    if (!workspaceStates.current.has(key)) {
      // Try to load from local storage
      const savedState = loadTerminalState(key);

      if (savedState && savedState.sessions.length > 0) {
        // Use saved state
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
        // Create default state
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

  // Force update component
  const [, forceUpdate] = useState({});
  const triggerUpdate = () => forceUpdate({});

  const state = getCurrentState();

  // Watch workspace changes
  const prevProjectPathRef = useRef<string | undefined>();
  useEffect(() => {
    const key = currentProjectPath || 'default';
    const prevKey = prevProjectPathRef.current || 'default';

    if (prevKey !== key) {
      // Force update to show new workspace state
      triggerUpdate();
    }

    prevProjectPathRef.current = currentProjectPath;
  }, [currentProjectPath, getCurrentState]);

  // Extract projectName and workspaceName from path
  const parseProjectPath = useCallback((path: string | undefined) => {
    if (!path) return null;

    const parts = normalizePath(path).split('/');
    const ropcodeIndex = parts.findIndex(p => p === '.ropcode');

    if (ropcodeIndex > 0) {
      // Workspace path: /path/to/project/.ropcode/workspace-name
      return {
        projectName: parts[ropcodeIndex - 1],
        workspaceName: parts[ropcodeIndex + 1]
      };
    } else {
      // Project path: /path/to/project (last non-empty segment)
      const projectName = parts.filter(p => p).pop();
      return projectName ? { projectName, workspaceName: undefined } : null;
    }
  }, []);

  // Load Actions
  const loadActions = useCallback(async () => {
    if (!currentProjectPath) {
      setActions([]);
      return;
    }

    try {
      const parsed = parseProjectPath(currentProjectPath);
      if (!parsed) {
        console.warn('[RightSidebar] Failed to parse project path:', currentProjectPath);
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

  // Watch currentProjectPath changes, load actions
  useEffect(() => {
    loadActions();
  }, [loadActions]);

  // Create new terminal session
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

    // Save to local storage
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  // Handle Git file click - create Diff Tab
  const handleGitFileClick = useCallback((file: GitFileChange) => {
    if (!currentProjectPath) return;

    createDiffTab(file.path, currentProjectPath, file.status);
  }, [currentProjectPath, createDiffTab]);

  // Handle file tree click - create File Tab
  const handleFileTreeClick = useCallback((filePath: string) => {
    if (!currentProjectPath) return;

    createFileTab(filePath, currentProjectPath);
  }, [currentProjectPath, createFileTab]);

  // Close terminal session
  const handleCloseSession = useCallback(async (id: string) => {
    const currentState = getCurrentState();
    if (currentState.sessions.length === 1) {
      return; // Keep at least one session
    }

    // Clean up PTY session
    try {
      await api.closePtySession(id);
    } catch (error) {
      console.error('[RightSidebar] Failed to close PTY session:', id, error);
    }

    // Remove from state
    currentState.sessions = currentState.sessions.filter(s => s.id !== id);
    delete currentState.outputs[id];

    // Clean up related run state
    currentState.sessionRunningState.delete(id);
    const commandId = currentState.sessionCommandId.get(id);
    if (commandId) {
      currentState.commandToSessionMap.delete(commandId);
      currentState.commandStartTime.delete(commandId);
      currentState.sessionCommandId.delete(id);
    }

    // If closing active session, switch to first
    if (currentState.activeSessionId === id) {
      currentState.activeSessionId = currentState.sessions[0]?.id || '';
    }

    // Save to local storage
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  // Execute command
  const handleSubmitCommand = useCallback(async (command: string) => {
    const currentState = getCurrentState();
    const sessionId = currentState.activeSessionId;
    const projectPath = currentProjectPath;

    if (!sessionId) return;

    // Add to history
    currentState.commandHistory = [command, ...currentState.commandHistory].slice(0, 50);

    // Add command output
    const commandOutput: TerminalOutput = {
      id: `${Date.now()}-cmd`,
      type: 'command',
      content: command,
      timestamp: new Date()
    };

    currentState.outputs[sessionId].push(commandOutput);
    triggerUpdate();

    // Generate unique command ID
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Set session-level run state
    currentState.sessionRunningState.set(sessionId, true);
    currentState.sessionCommandId.set(sessionId, commandId);

    // Map command ID to session ID for correct output routing
    currentState.commandToSessionMap.set(commandId, sessionId);
    // Record command start time
    currentState.commandStartTime.set(commandId, Date.now());

    try {
      // Execute command via async streaming API
      await api.executeCommandAsync(commandId, command, projectPath);

      // Command started, output streams via events
      // No need to handle result here
    } catch (error) {
      const errorOutput: TerminalOutput = {
        id: `${Date.now()}-error`,
        type: 'error',
        content: `Error: ${error}`,
        timestamp: new Date()
      };

      currentState.outputs[sessionId].push(errorOutput);
      triggerUpdate();

      // Clean up session run state
      currentState.sessionRunningState.set(sessionId, false);
      currentState.sessionCommandId.delete(sessionId);
      // Clean up mappings and timestamps
      currentState.commandToSessionMap.delete(commandId);
      currentState.commandStartTime.delete(commandId);
    }
  }, [getCurrentState, currentProjectPath]);

  // Execute Action
  const handleExecuteAction = useCallback(async (action: Action) => {
    // Determine action type: defaults to 'script'
    const actionType = action.actionType || 'script';

    if (actionType === 'web') {
      // Web action: open WebViewer Tab
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

    // Script action: Execute command
    setRunningActionId(action.id);

    // Switch to first Terminal
    const currentState = getCurrentState();
    const firstTerminal = currentState.sessions[0];
    if (firstTerminal) {
      currentState.activeSessionId = firstTerminal.id;
      setIsRunTabActive(false); // Close Run tab
      triggerUpdate();

      // Wait for UI update
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        // If PTY terminal, write command directly
        if (firstTerminal.isPty) {
          // Check if PTY session is alive
          const isAlive = await api.isPtySessionAlive(firstTerminal.id);
          if (isAlive) {
            await api.writeToPty(firstTerminal.id, action.command + '\n');
          } else {
            console.warn('[RightSidebar] PTY session not ready yet:', firstTerminal.id);
            // Wait briefly then retry
            await new Promise(resolve => setTimeout(resolve, 500));
            await api.writeToPty(firstTerminal.id, action.command + '\n');
          }
        } else {
          // Legacy command execution method
          await handleSubmitCommand(action.command);
        }
      } catch (error) {
        console.error('[RightSidebar] Failed to execute action:', error);
      } finally {
        // Delay clearing run state
        setTimeout(() => {
          setRunningActionId(undefined);
        }, 500);
      }
    }
  }, [handleSubmitCommand, getCurrentState, triggerUpdate, createWebViewerTab, currentProjectPath]);

  // Stop currently running command
  const handleStopCommand = useCallback(async () => {
    const currentState = getCurrentState();
    const sessionId = currentState.activeSessionId;
    const commandId = currentState.sessionCommandId.get(sessionId);

    if (!commandId) return;

    try {
      await api.killCommand(commandId);

      // Add stop message
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
      // Clean up session run state
      currentState.sessionRunningState.set(sessionId, false);
      currentState.sessionCommandId.delete(sessionId);
      // Clean up command mappings and timestamps
      if (commandId) {
        currentState.commandToSessionMap.delete(commandId);
        currentState.commandStartTime.delete(commandId);
      }
    }
  }, [getCurrentState]);

  // Select command from history
  const handleSelectHistory = useCallback((command: string) => {
    handleSubmitCommand(command);
  }, [handleSubmitCommand]);

  const handleTerminalShellState = useCallback((shellState: PtyShellState) => {
    if (shellState.commandHistory.length === 0) return;
    const currentState = getCurrentState();
    const nextHistory = [
      ...shellState.commandHistory,
      ...currentState.commandHistory,
    ].filter((command, index, all) => command && all.indexOf(command) === index).slice(0, 100);
    if (nextHistory.join('\n') === currentState.commandHistory.join('\n')) {
      return;
    }
    currentState.commandHistory = nextHistory;
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);
    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  // Switch session
  const handleSelectSession = useCallback((id: string) => {
    const currentState = getCurrentState();
    currentState.activeSessionId = id;
    setIsRunTabActive(false); // Close Run tab when switching to terminal

    // Save to local storage
    const key = getWorkspaceStorageKey(currentProjectPath);
    saveTerminalState(key, currentState);

    triggerUpdate();
  }, [getCurrentState, currentProjectPath]);

  
  // Switch to Run tab
  const handleSelectRunTab = useCallback(() => {
    setIsRunTabActive(true);
  }, []);

  // Listen for terminal output events
  useEffect(() => {
    const unlisten = listen('terminal-output', (payload: {
      command_id: string;
      output_type: string;
      content: string;
      exit_code?: number;
    }) => {
      const { command_id, output_type, content, exit_code } = payload;
      const currentState = getCurrentState();

        // Find session ID by command ID
        const sessionId = currentState.commandToSessionMap.get(command_id);

        if (!sessionId) {
          console.warn('[RightSidebar] Received output for an unknown command:', command_id);
          return;
        }

        // Detect ANSI clear screen sequence (clear command output)
        const clearScreenPattern = /\x1b\[(?:2J|3J|H)/;
        if (clearScreenPattern.test(content)) {
          // Clear current session output
          currentState.outputs[sessionId] = [];
          triggerUpdate();

          // If exit event, mark command as completed
          if (output_type === 'exit') {
            currentState.sessionRunningState.set(sessionId, false);
            currentState.sessionCommandId.delete(sessionId);
            currentState.commandToSessionMap.delete(command_id);
          }
          return; // Skip the clear sequence itself
        }

        // Strip other ANSI escape sequences (colors, cursor control, etc.)
        const cleanContent = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

        // Skip if content is empty after cleanup
        if (!cleanContent.trim() && output_type !== 'exit') {
          return;
        }

        // Add output to current session
        const output: TerminalOutput = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: output_type === 'stderr' ? 'error' : 'output',
          content: cleanContent,
          timestamp: new Date()
        };

        currentState.outputs[sessionId].push(output);
        triggerUpdate();

        // If exit event, mark command as completed
        if (output_type === 'exit') {
          // Clean up session run state
          currentState.sessionRunningState.set(sessionId, false);
          currentState.sessionCommandId.delete(sessionId);
          // Clean up command mappings and timestamps
          currentState.commandToSessionMap.delete(command_id);
          currentState.commandStartTime.delete(command_id);
        }
      });

    return unlisten;
  }, [getCurrentState]);

  // Note: polling for stale command cleanup is no longer needed
  // terminal-output exit handling (line 670-677) already cleans up session run state
  // Abnormal cases should be handled via events, not polling

  // Define all variables and callbacks before any conditional returns
  const currentOutputs = state.outputs[state.activeSessionId] || [];
  const isCurrentSessionRunning = state.sessionRunningState.get(state.activeSessionId) || false;
  const currentSession = state.sessions.find(s => s.id === state.activeSessionId);

  // Handle vertical resize
  const handleVerticalResize = useCallback((deltaY: number) => {
    setGitPaneHeight(prev => {
      const newHeight = prev + deltaY;
      // Clamp min and max height
      return Math.max(150, Math.min(newHeight, 600));
    });
  }, []);

  // Listen for global shortcuts - use capture phase for priority
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = usesMetaKeyForAppShortcuts() ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+J: toggle terminal visibility
      if (modKey && e.key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        onToggle?.();
        return;
      }

      // Ctrl+C: stop current command (all platforms use Ctrl)
      // Only intercept when terminal is open and command is running
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

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onToggle, isOpen, handleStopCommand, getCurrentState]);

  const selectRightTab = useCallback((tab: RightSidebarTab) => {
    if (tab === 'tasks' && !activeClaudeChatTab) return;

    if (isOpen && activeRightTab === tab) {
      onToggle?.();
      return;
    }

    setActiveRightTab(tab);
    if (!isOpen) {
      onToggle?.();
    }
  }, [activeClaudeChatTab, activeRightTab, isOpen, onToggle]);

  return (
    <TooltipProvider>
      <div
        ref={terminalContainerRef}
        className={cn(
          "relative h-full border-l bg-background/95 backdrop-blur-md flex",
          className
        )}
        style={{
          width: isOpen ? `calc(${widthPercent}% + ${RIGHT_SIDEBAR_RAIL_WIDTH}px)` : RIGHT_SIDEBAR_RAIL_WIDTH,
          minWidth: isOpen ? `${RIGHT_SIDEBAR_RAIL_WIDTH + 200}px` : RIGHT_SIDEBAR_RAIL_WIDTH,
          flexShrink: 0
        }}
        tabIndex={-1}
      >
        {isOpen && (
          <div className="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
            {/* Horizontal resize handle */}
            <ResizeHandle
              onResize={(newWidth) => {
                // Convert pixel width to percentage, subtract fixed rail width
                const panelWidth = Math.max(0, newWidth - RIGHT_SIDEBAR_RAIL_WIDTH);
                const percent = (panelWidth / window.innerWidth) * 100;
                // Clamp between 15% - 50%
                setWidthPercent(Math.max(15, Math.min(50, percent)));
              }}
            />

      {/* Tab content - Console */}
        <div className={cn("flex-1 flex-col overflow-hidden", activeRightTab === 'console' ? 'flex' : 'hidden')}>
              {/* Git status panel - only show with Git support */}
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

              {/* Vertical resize handle */}
              <VerticalResizeHandle onResize={handleVerticalResize} />
            </>
          )}

          {/* Terminal area */}
          <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab management */}
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

        {/* Show Run Tab or Terminal based on isRunTabActive */}
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
            {/* Render all PTY terminals */}
            {state.sessions.map((session) => (
              session.isPty ? (
                <XtermTerminal
                  key={`${currentProjectPath || 'default'}::${session.id}`}
                  sessionId={session.id}
                  workspaceId={currentProjectPath || 'default'}
                  cwd={currentProjectPath}
                  className="absolute inset-0"
                  isActive={activeRightTab === 'console' && session.id === state.activeSessionId}
                  onShellStateChange={handleTerminalShellState}
                />
              ) : null
            ))}

            {/* Legacy non-PTY terminals (if any) */}
            {currentSession && !currentSession.isPty && (
              <div className="absolute inset-0 flex flex-col" style={{ zIndex: 1 }}>
                {/* Terminal output panel */}
                <TerminalPane
                  outputs={currentOutputs}
                  isRunning={isCurrentSessionRunning}
                  className="flex-1"
                  workspacePath={currentProjectPath}
                />

                {/* Command input */}
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

      {/* Tab content - Files */}
        <div className={cn("flex-1 flex-col overflow-hidden", activeRightTab === 'files' ? 'flex' : 'hidden')}>
          <FileTreeBrowser
            workspacePath={currentProjectPath}
            onFileClick={handleFileTreeClick}
          />
        </div>

        <div className={cn("flex-1 flex-col overflow-hidden", activeRightTab === 'tasks' ? 'flex' : 'hidden')}>
          {activeClaudeChatTab ? (
            <ClaudeActivityPane
              workspacePath={currentProjectPath || activeClaudeChatTab.projectPath}
              onSnapshotChange={setActivitySnapshot}
            />
          ) : (
            <div className="flex-1 grid place-items-center px-4 text-center text-sm text-muted-foreground">
              Select a Claude chat tab to view tasks.
            </div>
          )}
        </div>

      {/* Actions config dialog */}
      {(() => {
        // Only check and warn when dialog needs to open
        if (!showActionsConfig) {
          return null;
        }

        if (!currentProjectPath) {
          console.warn('[RightSidebar] Cannot open Actions config: no current project path');
          return null;
        }

        const parsed = parseProjectPath(currentProjectPath);

        if (!parsed) {
          console.warn('[RightSidebar] Cannot open Actions config: failed to parse project path:', currentProjectPath);
          return null;
        }

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
        )}

        <div
          className="flex h-full w-16 flex-shrink-0 flex-col items-center border-l border-border/50 bg-background py-2"
          style={{ width: RIGHT_SIDEBAR_RAIL_WIDTH }}
        >
          <div className="flex flex-col items-center gap-1">
            <RightRailButton
              label={t('tabs.console')}
              active={activeRightTab === 'console'}
              onClick={() => selectRightTab('console')}
            >
              <Terminal className="h-4 w-4" />
            </RightRailButton>
            <RightRailButton
              label={t('tabs.files')}
              active={activeRightTab === 'files'}
              onClick={() => selectRightTab('files')}
            >
              <FolderTree className="h-4 w-4" />
            </RightRailButton>
            <RightRailButton
              label={t('tabs.tasks')}
              active={activeRightTab === 'tasks'}
              disabled={!activeClaudeChatTab}
              badgeCount={activityCount}
              onClick={() => selectRightTab('tasks')}
            >
              <ListChecks className="h-4 w-4" />
            </RightRailButton>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default RightSidebar;
