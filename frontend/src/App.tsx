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

const SIDEBAR_RAIL_WIDTH = 64;
const SIDEBAR_DEFAULT_WIDTH = 360;
const SIDEBAR_MIN_WIDTH = 304;
const SIDEBAR_MAX_WIDTH = 640;

const clampSidebarWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

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
      if (Number.isFinite(parsed)) return clampSidebarWidth(parsed);
    } catch {}
    return SIDEBAR_DEFAULT_WIDTH;
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
      setSidebarWidth(customEvent.detail.width <= SIDEBAR_RAIL_WIDTH
        ? SIDEBAR_RAIL_WIDTH
        : clampSidebarWidth(customEvent.detail.width));
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
