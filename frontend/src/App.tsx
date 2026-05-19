import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { OutputCacheProvider } from "@/lib/outputCache";
import { TabProvider } from "@/contexts/TabContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { WorkspaceTodoProvider } from "@/contexts/WorkspaceTodoContext";
import { ContainerProvider } from "@/contexts/ContainerContext";
import { SystemTabProvider } from "@/contexts/SystemTabContext";
import { CustomTitlebar } from "@/components/CustomTitlebar";
import { NFOCredits } from "@/components/NFOCredits";
import { ClaudeBinaryDialog } from "@/components/ClaudeBinaryDialog";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { MainLayout } from "@/components/MainLayout";
import { useTabState } from "@/hooks/useTabState";
import { useAppLifecycle } from "@/hooks";
import { StartupIntro } from "@/components/StartupIntro";
import { wsClient } from "@/lib/ws-rpc-client";
import { mergeInstancesFromUrl } from '@/lib/instanceStore';
import { getInitialWebSocketConfig } from '@/lib/ws-config';

// WebSocket 连接配置
// 页面由 Go 后端 serve，location.port 就是 Go 端口
// 优先级: Electron preload > Go 注入全局变量 > location.port > URL 参数
mergeInstancesFromUrl();

const { port: wsPort, authKey } = getInitialWebSocketConfig(window);

// WebSocket 连接 Promise（用于组件等待连接完成）
let wsConnectionPromise: Promise<void> | null = null;

// 初始化 WebSocket 连接（仅在 Electron 或有配置时）
if (wsPort) {
  wsConnectionPromise = wsClient.connect(parseInt(String(wsPort), 10), authKey || undefined)
    .then(() => console.log('[App] WebSocket connected'))
    .catch((err) => {
      console.error('[App] WebSocket connection failed:', err);
      throw err;
    });
}

// 导出等待连接的方法供其他组件使用
export const waitForWebSocket = async (timeout: number = 10000): Promise<void> => {
  if (!wsPort) {
    return;
  }

  if (wsConnectionPromise) {
    await wsConnectionPromise.catch(() => undefined);
  }

  return wsClient.waitForConnection(timeout);
};

/**
 * AppContent component - Contains the main app logic, wrapped by providers
 */
function AppContent() {
  const { createClaudeMdTab, createSettingsTab, createUsageTab, createMCPTab, createAgentsTab } = useTabState();
  const [showNFO, setShowNFO] = useState(false);
  const [showClaudeBinaryDialog, setShowClaudeBinaryDialog] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar_width_px');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed)) return Math.min(640, Math.max(240, parsed));
    } catch {}
    return 360;
  });
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightSidebarWidthPercent, setRightSidebarWidthPercent] = useState(35);

  // Initialize analytics lifecycle tracking
  useAppLifecycle();

  // Initialize global provider API configs
  useEffect(() => {
    import('@/stores/providerApiStore').then(({ useProviderApiStore }) => {
      useProviderApiStore.getState().loadConfigs();
    });
  }, []);

  // Note: currentProjectPath is now managed by ContainerContext, used directly in CustomTitlebar

  // Listen for sidebar state changes
  useEffect(() => {
    const handleSidebarCollapse = (event: Event) => {
      const customEvent = event as CustomEvent<{ collapsed: boolean }>;
      setSidebarCollapsed(customEvent.detail.collapsed);
    };

    const handleSidebarWidthChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ width: number }>;
      setSidebarWidth(customEvent.detail.width);
    };

    const handleRightSidebarStateChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ isOpen: boolean; shouldShow?: boolean }>;
      // 使用 shouldShow（如果有），否则回退到 isOpen
      setRightSidebarOpen(customEvent.detail.shouldShow ?? customEvent.detail.isOpen);
    };

    const handleRightSidebarWidthChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ widthPercent: number }>;
      setRightSidebarWidthPercent(customEvent.detail.widthPercent);
    };

    const handleShowToast = (event: Event) => {
      const customEvent = event as CustomEvent<{ message: string; type: "success" | "error" | "info" }>;
      setToast(customEvent.detail);
    };

    window.addEventListener('sidebar-collapsed', handleSidebarCollapse);
    window.addEventListener('sidebar-width-changed', handleSidebarWidthChange);
    window.addEventListener('right-sidebar-state-changed', handleRightSidebarStateChange);
    window.addEventListener('right-sidebar-width-changed', handleRightSidebarWidthChange);
    window.addEventListener('show-toast', handleShowToast);

    return () => {
      window.removeEventListener('sidebar-collapsed', handleSidebarCollapse);
      window.removeEventListener('sidebar-width-changed', handleSidebarWidthChange);
      window.removeEventListener('right-sidebar-state-changed', handleRightSidebarStateChange);
      window.removeEventListener('right-sidebar-width-changed', handleRightSidebarWidthChange);
      window.removeEventListener('show-toast', handleShowToast);
    };
  }, []);

  // Keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey) {
        switch (e.key) {
          case 't':
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('create-chat-tab'));
            break;
          case 'w':
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('close-current-tab'));
            break;
          case 'Tab':
            e.preventDefault();
            if (e.shiftKey) {
              window.dispatchEvent(new CustomEvent('switch-to-previous-tab'));
            } else {
              window.dispatchEvent(new CustomEvent('switch-to-next-tab'));
            }
            break;
          case 'b':
            // Toggle sidebar
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('toggle-sidebar'));
            break;
          default:
            // Handle number keys 1-9
            if (e.key >= '1' && e.key <= '9') {
              e.preventDefault();
              const index = parseInt(e.key) - 1;
              window.dispatchEvent(new CustomEvent('switch-to-tab-by-index', { detail: { index } }));
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for Claude not found events
  useEffect(() => {
    const handleClaudeNotFound = () => {
      setShowClaudeBinaryDialog(true);
    };

    window.addEventListener('claude-not-found', handleClaudeNotFound as EventListener);
    return () => {
      window.removeEventListener('claude-not-found', handleClaudeNotFound as EventListener);
    };
  }, []);

  // Global event listeners for Claude sessions (cwd-based routing)
  // Use module-level variable to ensure listeners are only set up once (防止 React StrictMode 重复设置)
  useEffect(() => {
    // Skip if already set up
    if ((window as any).__claudeGlobalListenersSetup) {
      console.log('[App] Global Claude event listeners already set up, skipping');
      return;
    }

    // ✅ 立即设置标记，防止异步竞态条件（StrictMode 多次执行时）
    (window as any).__claudeGlobalListenersSetup = true;

    // Maintain session_id -> cwd mapping (store on window to persist across hot reloads)
    if (!(window as any).__sessionCwdMap) {
      (window as any).__sessionCwdMap = new Map<string, string>();
    }
    const sessionCwdMap = (window as any).__sessionCwdMap;

    const setupGlobalListeners = async () => {
      const { EventsOn } = await import('@/lib/rpc-events');

      // Shared per-line router used by both legacy single-line claude-output
      // events and the batched claude-output-batch frames produced by the Go
      // coalescer. Keeping the parsing logic in one place avoids drift while
      // we transition.
      const dispatchClaudeOutputLine = (payload: string) => {
        try {
          const msg = JSON.parse(payload);
          let cwd = msg.cwd;

          // If this is an init message, store the session_id -> cwd mapping
          if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id && msg.cwd) {
            sessionCwdMap.set(msg.session_id, msg.cwd);
            console.log('[App] Stored session mapping:', msg.session_id, '->', msg.cwd);
          }

          // If message has no cwd but has session_id, look up cwd from our mapping
          if (!cwd && msg.session_id) {
            cwd = sessionCwdMap.get(msg.session_id);
          }

          if (cwd) {
            window.dispatchEvent(new CustomEvent(`claude-output:${cwd}`, {
              detail: payload,
            }));
          } else {
            console.warn('[App] ⚠️  Cannot route message - no cwd:', msg);
          }
        } catch (err) {
          console.error('[App] Failed to parse claude-output:', err);
        }
      };

      // Global output listener - legacy single-line emitter path. The Go
      // coalescer now batches most stream frames into claude-output-batch
      // events, but a few low-frequency emitters (user-broadcast messages,
      // raw stderr fallbacks) still come through this channel.
      const unlistenOutput = EventsOn('claude-output', (payload: string) => {
        dispatchClaudeOutputLine(payload);
      });

      // Batched output listener - high-frequency stream frames from
      // Claude/Codex/Gemini are coalesced into 16ms windows by the backend
      // and arrive here as { session_id, lines: string[] }. We replay each
      // line through the same routing logic so downstream listeners
      // (`claude-output:${cwd}`) need no awareness of batching.
      const unlistenOutputBatch = EventsOn('claude-output-batch', (payload: { session_id?: string; lines?: string[] }) => {
        if (!payload || !Array.isArray(payload.lines)) return;
        for (const line of payload.lines) {
          if (typeof line === 'string' && line.length > 0) {
            dispatchClaudeOutputLine(line);
          }
        }
      });

      // Global error listener
      const unlistenError = EventsOn('claude-error', (payload: string) => {
        try {
          // Try to parse as JSON first
          const msg = JSON.parse(payload);
          const cwd = msg.cwd;

          if (cwd) {
            window.dispatchEvent(new CustomEvent(`claude-error:${cwd}`, {
              detail: payload
            }));
          }
        } catch (err) {
          // If not JSON, it's a raw error message from stderr
          // Log it but don't crash
          console.warn('[App] Received non-JSON error message:', payload);
        }
      });

      // Global complete listener
      const unlistenComplete = EventsOn('claude-complete', (payload: string) => {
        try {
          // Try to parse as JSON first (new format with cwd)
          const msg = JSON.parse(payload);
          const cwd = msg.cwd;

          if (cwd) {
            // Route full completion payload to specific project
            window.dispatchEvent(new CustomEvent(`claude-complete:${cwd}`, {
              detail: msg
            }));
          } else {
            // Fallback: broadcast globally for backward compatibility
            window.dispatchEvent(new CustomEvent('claude-complete', {
              detail: msg
            }));
          }
        } catch (err) {
          // If not JSON, it's old format (boolean/string) - broadcast globally
          window.dispatchEvent(new CustomEvent('claude-complete', {
            detail: payload
          }));
        }
      });

      // Store unlisten functions globally for cleanup
      (window as any).__claudeGlobalUnlisteners = {
        output: unlistenOutput,
        outputBatch: unlistenOutputBatch,
        error: unlistenError,
        complete: unlistenComplete,
      };

      console.log('[App] Global Claude event listeners set up');
    };

    setupGlobalListeners();

    // Cleanup only when App truly unmounts (not on StrictMode re-mount)
    return () => {
      // Don't cleanup on StrictMode re-mount, only on true unmount
      // StrictMode doesn't actually unmount, so this won't run in dev
    };
  }, []);

  return (
    <div className="h-screen flex flex-col" style={{ height: 'calc(var(--app-height, 100vh))' }}>
      {/* Custom Titlebar with integrated TabManager */}
      <CustomTitlebar
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        rightSidebarOpen={rightSidebarOpen}
        rightSidebarWidthPercent={rightSidebarWidthPercent}
      />

      {/* Main Layout - Sidebar + Content Area */}
      <div className="flex-1 overflow-hidden">
        <MainLayout
          onAgentsClick={() => createAgentsTab()}
          onUsageClick={() => createUsageTab()}
          onClaudeClick={() => createClaudeMdTab()}
          onMCPClick={() => createMCPTab()}
          onSettingsClick={() => createSettingsTab()}
          onInfoClick={() => setShowNFO(true)}
        />
      </div>

      {/* NFO Credits Modal */}
      {showNFO && <NFOCredits onClose={() => setShowNFO(false)} />}

      {/* Claude Binary Dialog */}
      <ClaudeBinaryDialog
        open={showClaudeBinaryDialog}
        onOpenChange={setShowClaudeBinaryDialog}
        onSuccess={() => {
          setToast({ message: "Claude binary path saved successfully", type: "success" });
          // Trigger a refresh of the Claude version check
          window.location.reload();
        }}
        onError={(message) => setToast({ message, type: "error" })}
      />

      {/* Toast Container */}
      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>
    </div>
  );
}

/**
 * Main App component - Wraps the app with providers
 */
function App() {
  const [showIntro, setShowIntro] = useState(() => {
    // Read cached preference synchronously to avoid any initial flash
    try {
      const cached = typeof window !== 'undefined'
        ? window.localStorage.getItem('app_setting:startup_intro_enabled')
        : null;
      if (cached === 'true') return true;
      if (cached === 'false') return false;
    } catch (_ignore) {}
    return true; // default if no cache
  });

  useEffect(() => {
    let timer: number | undefined;
    (async () => {
      try {
        const pref = await api.getSetting('startup_intro_enabled');
        const enabled = pref === null ? true : pref === 'true';
        if (enabled) {
          // keep intro visible and hide after duration
          timer = window.setTimeout(() => setShowIntro(false), 2000);
        } else {
          // user disabled intro: hide immediately to avoid any overlay delay
          setShowIntro(false);
        }
      } catch (err) {
        // On failure, show intro once to keep UX consistent
        timer = window.setTimeout(() => setShowIntro(false), 2000);
      }
    })();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <ContainerProvider>
      <SystemTabProvider>
        <ThemeProvider>
          <OutputCacheProvider>
            <TabProvider>
              <WorkspaceTodoProvider>
                <AppContent />
                <StartupIntro visible={showIntro} />
              </WorkspaceTodoProvider>
            </TabProvider>
          </OutputCacheProvider>
        </ThemeProvider>
      </SystemTabProvider>
    </ContainerProvider>
  );
}

export default App;
