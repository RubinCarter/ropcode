# Web Widget Migration: iframe to webview - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ropcode's iframe-based web widget with Electron's webview tag, providing more powerful browser control APIs while preserving existing features (element selector, local HTML support).

**Architecture:** Create new webview-based component and Electron IPC handlers. Frontend uses Zustand for state management. Webview preload script bridges element selector functionality.

**Tech Stack:** Electron webview, React, TypeScript, Zustand

---

## Task 1: Add Webview IPC Handlers to Electron Main Process

**Files:**
- Modify: `electron/src/main.ts:76-129`

**Step 1: Import webContents from electron**

Add `webContents` to the import statement at line 2:

```typescript
import { app, BrowserWindow, ipcMain, dialog, webContents } from 'electron';
```

**Step 2: Add webview-related state variable**

After line 7 (`let goServerInfo: GoServerInfo | null = null;`), add:

```typescript
let focusedWebviewId: number | null = null;
```

**Step 3: Add webview IPC handlers in registerIpcHandlers function**

At the end of `registerIpcHandlers()` function (before the closing `}`), add:

```typescript
  // Webview 相关
  ipcMain.handle('webview:getPreloadPath', () => {
    return path.join(__dirname, 'preload-webview.js');
  });

  ipcMain.on('webview:setFocus', (_, webContentsId: number | null) => {
    focusedWebviewId = webContentsId;
  });

  ipcMain.handle('webview:clearStorage', async (_, webContentsId: number) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (wc) {
        await wc.session.clearStorageData();
      }
    } catch (e) {
      console.error('[Electron] Failed to clear webview storage:', e);
    }
  });

  ipcMain.on('webview:imageContextMenu', (_, { src }: { src: string }) => {
    // TODO: Implement image context menu (save/copy)
    console.log('[Electron] Image context menu:', src);
  });
```

**Step 4: Verify syntax**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko && npm run build:electron`

Expected: Build succeeds without errors

**Step 5: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat(electron): add webview IPC handlers for focus, storage, and preload"
```

---

## Task 2: Create Webview Preload Script

**Files:**
- Create: `electron/src/preload-webview.ts`

**Step 1: Create the preload-webview.ts file**

```typescript
// electron/src/preload-webview.ts
// Preload script for webview - handles image context menu and element selector bridge

const { ipcRenderer } = require('electron');

// Handle image right-click context menu
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement;
  if (target.tagName === 'IMG') {
    setTimeout(() => {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const imgElem = target as HTMLImageElement;
      ipcRenderer.send('webview:imageContextMenu', { src: imgElem.src });
    }, 50);
  }
});

// Element Selector Script - injected into webview for element selection feature
(function initElementSelector() {
  // Avoid duplicate injection
  if ((window as any).__elementSelectorInjected) return;
  (window as any).__elementSelectorInjected = true;

  let isSelecting = false;
  let highlightOverlay: HTMLDivElement | null = null;

  function createHighlightOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.id = '__element-selector-overlay';
    overlay.style.cssText = `
      position: fixed;
      background: rgba(59, 130, 246, 0.2);
      border: 2px solid rgb(59, 130, 246);
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.1s ease;
      box-sizing: border-box;
      display: none;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function getUniqueSelector(element: Element): string {
    if (element.id) {
      return '#' + element.id;
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      let sibling: Element | null = current;
      let nth = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.nodeName === current.nodeName) nth++;
      }

      if (nth > 1) {
        selector += ':nth-of-type(' + nth + ')';
      }

      path.unshift(selector);
      current = current.parentElement;

      if (path.length > 3) break;
    }

    return path.join(' > ');
  }

  function highlightElement(element: Element) {
    if (!highlightOverlay) {
      highlightOverlay = createHighlightOverlay();
    }

    const rect = element.getBoundingClientRect();
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
    highlightOverlay.style.display = 'block';
  }

  function hideHighlight() {
    if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
  }

  function handleMouseOver(e: MouseEvent) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.id === '__element-selector-overlay') return;

    highlightElement(target);
  }

  function handleClick(e: MouseEvent) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.id === '__element-selector-overlay') return;

    const elementInfo = {
      tagName: target.tagName,
      innerText: target.innerText?.substring(0, 500) || '',
      outerHTML: target.outerHTML?.substring(0, 2000) || '',
      selector: getUniqueSelector(target),
      url: window.location.href
    };

    // Send via IPC to main process, which forwards to renderer
    ipcRenderer.send('webview:elementSelected', elementInfo);

    stopSelection();
  }

  function startSelection() {
    isSelecting = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('click', handleClick, true);
  }

  function stopSelection() {
    isSelecting = false;
    document.body.style.cursor = '';
    hideHighlight();
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('click', handleClick, true);
  }

  // Listen for commands from renderer process via IPC
  ipcRenderer.on('webview:startElementSelection', () => {
    startSelection();
  });

  ipcRenderer.on('webview:stopElementSelection', () => {
    stopSelection();
  });

  // Notify that script is ready
  ipcRenderer.send('webview:elementSelectorReady');

  console.log('[WebView Preload] Element selector initialized');
})();

console.log('[WebView Preload] Loaded successfully');
```

**Step 2: Update tsconfig to include new file**

Verify `electron/tsconfig.json` includes `src/**/*.ts` pattern (should already be included).

**Step 3: Build and verify**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko && npm run build:electron`

Expected: Build succeeds, `electron/dist/preload-webview.js` is created

**Step 4: Commit**

```bash
git add electron/src/preload-webview.ts
git commit -m "feat(electron): add webview preload script with element selector"
```

---

## Task 3: Update Main Preload to Expose Webview APIs

**Files:**
- Modify: `electron/src/preload.ts:1-45`

**Step 1: Add webview APIs to contextBridge**

At the end of the `electronAPI` object (before the closing `});`), add:

```typescript
  // Webview 相关
  getWebviewPreload: () => ipcRenderer.invoke('webview:getPreloadPath'),
  setWebviewFocus: (webContentsId: number | null) => ipcRenderer.send('webview:setFocus', webContentsId),
  clearWebviewStorage: (webContentsId: number) => ipcRenderer.invoke('webview:clearStorage', webContentsId),
  onWebviewElementSelected: (callback: (elementInfo: any) => void) => {
    ipcRenderer.on('webview:elementSelected', (_, elementInfo) => callback(elementInfo));
  },
  sendToWebview: (webContentsId: number, channel: string, ...args: any[]) => {
    ipcRenderer.send('webview:sendToWebview', webContentsId, channel, ...args);
  },
```

**Step 2: Add IPC handler for forwarding to webview in main.ts**

Add to `registerIpcHandlers()` in `main.ts`:

```typescript
  ipcMain.on('webview:sendToWebview', (_, webContentsId: number, channel: string, ...args: any[]) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (wc) {
        wc.send(channel, ...args);
      }
    } catch (e) {
      console.error('[Electron] Failed to send to webview:', e);
    }
  });

  ipcMain.on('webview:elementSelected', (event, elementInfo) => {
    // Forward to main window renderer
    mainWindow?.webContents.send('webview:elementSelected', elementInfo);
  });
```

**Step 3: Build and verify**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko && npm run build:electron`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add electron/src/preload.ts electron/src/main.ts
git commit -m "feat(electron): expose webview APIs to renderer process"
```

---

## Task 4: Update TypeScript Type Definitions

**Files:**
- Modify: `frontend/src/vite-env.d.ts:1-34`

**Step 1: Add webview API types**

Add to the `electronAPI` interface (before the closing `};`):

```typescript
    // Webview 相关
    getWebviewPreload: () => Promise<string>;
    setWebviewFocus: (webContentsId: number | null) => void;
    clearWebviewStorage: (webContentsId: number) => Promise<void>;
    onWebviewElementSelected: (callback: (elementInfo: {
      tagName: string;
      innerText: string;
      outerHTML: string;
      selector: string;
      url: string;
    }) => void) => void;
    sendToWebview: (webContentsId: number, channel: string, ...args: any[]) => void;
```

**Step 2: Verify types compile**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko/frontend && npx tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
git add frontend/src/vite-env.d.ts
git commit -m "feat(types): add webview API type definitions"
```

---

## Task 5: Create Enhanced WebView Store

**Files:**
- Modify: `frontend/src/widgets/web/WebModel.ts`

**Step 1: Replace the entire WebModel.ts with enhanced version**

```typescript
/**
 * Web Widget Zustand Store (Enhanced for Webview)
 *
 * 管理 Web 浏览器 Widget 的状态，支持 Electron webview 特性
 */

import { create } from 'zustand';

/**
 * 选中元素信息
 */
export interface SelectedElement {
  tagName: string;
  innerText: string;
  outerHTML: string;
  selector: string;
  url: string;
}

/**
 * User Agent 类型
 */
export type UserAgentType = 'default' | 'mobile:iphone' | 'mobile:android';

/**
 * Web Widget 状态接口
 */
interface WebState {
  /** 当前 URL */
  url: string;

  /** URL 输入框的值 */
  inputUrl: string;

  /** 主页 URL */
  homepageUrl: string;

  /** 加载状态 */
  isLoading: boolean;

  /** DOM 是否就绪 */
  domReady: boolean;

  /** 是否可以后退 */
  canGoBack: boolean;

  /** 是否可以前进 */
  canGoForward: boolean;

  /** 错误信息 */
  error: string | null;

  /** 页面标题 */
  title: string;

  /** User Agent 类型 */
  userAgentType: UserAgentType;

  /** 缩放比例 */
  zoomFactor: number;

  /** 媒体正在播放 */
  mediaPlaying: boolean;

  /** 媒体已静音 */
  mediaMuted: boolean;

  /** 页内搜索是否打开 */
  searchOpen: boolean;

  /** 搜索查询 */
  searchQuery: string;

  /** 搜索结果索引 */
  searchResultIndex: number;

  /** 搜索结果总数 */
  searchResultCount: number;

  /** 是否正在选择元素 */
  isSelectingElement: boolean;

  /** 选中的元素 */
  selectedElement: SelectedElement | null;

  /** 用户消息（发送到聊天） */
  userMessage: string;

  /** WebContents ID */
  webContentsId: number | null;
}

/**
 * Web Widget Actions 接口
 */
interface WebActions {
  setUrl: (url: string) => void;
  setInputUrl: (url: string) => void;
  setHomepage: (url: string) => void;
  setLoading: (loading: boolean) => void;
  setDomReady: (ready: boolean) => void;
  setCanGoBack: (canGoBack: boolean) => void;
  setCanGoForward: (canGoForward: boolean) => void;
  setError: (error: string | null) => void;
  setTitle: (title: string) => void;
  setUserAgentType: (type: UserAgentType) => void;
  setZoomFactor: (factor: number) => void;
  setMediaPlaying: (playing: boolean) => void;
  setMediaMuted: (muted: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResult: (index: number, count: number) => void;
  setIsSelectingElement: (selecting: boolean) => void;
  setSelectedElement: (element: SelectedElement | null) => void;
  setUserMessage: (message: string) => void;
  setWebContentsId: (id: number | null) => void;
  reset: () => void;
}

type WebStore = WebState & WebActions;

const initialState: WebState = {
  url: 'https://www.google.com',
  inputUrl: 'https://www.google.com',
  homepageUrl: 'https://www.google.com',
  isLoading: false,
  domReady: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  title: '',
  userAgentType: 'default',
  zoomFactor: 1,
  mediaPlaying: false,
  mediaMuted: false,
  searchOpen: false,
  searchQuery: '',
  searchResultIndex: 0,
  searchResultCount: 0,
  isSelectingElement: false,
  selectedElement: null,
  userMessage: '',
  webContentsId: null,
};

export const useWebStore = create<WebStore>((set) => ({
  ...initialState,

  setUrl: (url) => set({ url }),
  setInputUrl: (inputUrl) => set({ inputUrl }),
  setHomepage: (url) => set({ homepageUrl: url }),
  setLoading: (loading) => set({ isLoading: loading }),
  setDomReady: (ready) => set({ domReady: ready }),
  setCanGoBack: (canGoBack) => set({ canGoBack }),
  setCanGoForward: (canGoForward) => set({ canGoForward }),
  setError: (error) => set({ error }),
  setTitle: (title) => set({ title }),
  setUserAgentType: (type) => set({ userAgentType: type }),
  setZoomFactor: (factor) => set({ zoomFactor: Math.max(0.1, Math.min(5, factor)) }),
  setMediaPlaying: (playing) => set({ mediaPlaying: playing }),
  setMediaMuted: (muted) => set({ mediaMuted: muted }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResult: (index, count) => set({ searchResultIndex: index, searchResultCount: count }),
  setIsSelectingElement: (selecting) => set({ isSelectingElement: selecting }),
  setSelectedElement: (element) => set({ selectedElement: element }),
  setUserMessage: (message) => set({ userMessage: message }),
  setWebContentsId: (id) => set({ webContentsId: id }),
  reset: () => set(initialState),
}));

// User Agent 常量
export const USER_AGENTS = {
  default: undefined,
  'mobile:iphone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'mobile:android': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
} as const;
```

**Step 2: Verify types compile**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko/frontend && npx tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
git add frontend/src/widgets/web/WebModel.ts
git commit -m "feat(store): enhance WebModel with webview-specific state"
```

---

## Task 6: Create WebViewWidget Component

**Files:**
- Create: `frontend/src/components/WebViewWidget.tsx`

**Step 1: Create the WebViewWidget.tsx file**

```typescript
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Globe, RefreshCw, Copy, MousePointerClick, Send, X,
  ChevronLeft, ChevronRight, Home, Search, Volume2, VolumeX,
  ZoomIn, ZoomOut, Smartphone, Monitor
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWebStore, USER_AGENTS, SelectedElement, UserAgentType } from '@/widgets/web/WebModel';

// Electron webview 类型
interface WebviewTag extends HTMLElement {
  src: string;
  preload?: string;
  partition?: string;
  useragent?: string;
  allowpopups?: string;
  getURL(): string;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getWebContentsId(): number;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): void;
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
  setUserAgent(userAgent: string): void;
  isAudioMuted(): boolean;
  setAudioMuted(muted: boolean): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  clearHistory(): void;
  focus(): void;
  addEventListener(event: string, callback: (e: any) => void): void;
  removeEventListener(event: string, callback: (e: any) => void): void;
}

interface WebViewWidgetProps {
  url: string;
  workspacePath?: string;
  className?: string;
  onUrlChange?: (newUrl: string) => void;
}

/**
 * 确保 URL 有正确的协议
 */
function ensureUrlScheme(url: string): string {
  if (!url || url.trim() === '') {
    return 'about:blank';
  }

  const trimmedUrl = url.trim();

  // 已有协议
  if (/^(http|https|file|about|data):/.test(trimmedUrl)) {
    return trimmedUrl;
  }

  // 本地地址
  const isLocal = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?/.test(trimmedUrl.split('/')[0]);
  if (isLocal) {
    return `http://${trimmedUrl}`;
  }

  // 域名
  const domainRegex = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (domainRegex.test(trimmedUrl.split('/')[0])) {
    return `https://${trimmedUrl}`;
  }

  // 搜索
  return `https://www.google.com/search?q=${encodeURIComponent(trimmedUrl)}`;
}

export const WebViewWidget: React.FC<WebViewWidgetProps> = ({
  url: initialUrl,
  workspacePath,
  className,
  onUrlChange,
}) => {
  const webviewRef = useRef<WebviewTag>(null);
  const [preloadPath, setPreloadPath] = useState<string>('');

  // Store state
  const {
    url, inputUrl, isLoading, domReady, canGoBack, canGoForward,
    error, userAgentType, zoomFactor, mediaPlaying, mediaMuted,
    searchOpen, searchQuery, searchResultIndex, searchResultCount,
    isSelectingElement, selectedElement, userMessage, webContentsId,
    setUrl, setInputUrl, setLoading, setDomReady, setCanGoBack, setCanGoForward,
    setError, setUserAgentType, setZoomFactor, setMediaPlaying, setMediaMuted,
    setSearchOpen, setSearchQuery, setSearchResult, setIsSelectingElement,
    setSelectedElement, setUserMessage, setWebContentsId, reset,
  } = useWebStore();

  // 获取 preload 路径
  useEffect(() => {
    const getPreload = async () => {
      if (window.electronAPI?.getWebviewPreload) {
        const path = await window.electronAPI.getWebviewPreload();
        setPreloadPath(`file://${path}`);
      }
    };
    getPreload();
  }, []);

  // 初始化 URL
  useEffect(() => {
    const normalizedUrl = ensureUrlScheme(initialUrl);
    setUrl(normalizedUrl);
    setInputUrl(initialUrl);
  }, [initialUrl]);

  // 清理
  useEffect(() => {
    return () => {
      reset();
    };
  }, []);

  // Webview 事件监听
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleNavigate = (e: any) => {
      setError(null);
      if (e.isMainFrame) {
        const newUrl = e.url;
        setUrl(newUrl);
        setInputUrl(newUrl);
        onUrlChange?.(newUrl);
      }
    };

    const handleStartLoading = () => {
      setLoading(true);
    };

    const handleStopLoading = () => {
      setLoading(false);
      if (webview) {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      }
    };

    const handleDomReady = () => {
      setDomReady(true);
      if (webview) {
        try {
          const wcId = webview.getWebContentsId();
          setWebContentsId(wcId);
          webview.setZoomFactor(zoomFactor);
        } catch (e) {
          console.error('Failed to get webContentsId:', e);
        }
      }
    };

    const handleFailLoad = (e: any) => {
      if (e.errorCode === -3) {
        // ERR_ABORTED - 忽略
        return;
      }
      setError(`Failed to load: ${e.errorDescription}`);
      setLoading(false);
    };

    const handleNewWindow = (e: any) => {
      e.preventDefault();
      // 在新标签页中打开链接 - 这里可以触发事件
      console.log('New window requested:', e.url);
    };

    const handleMediaPlaying = () => setMediaPlaying(true);
    const handleMediaPaused = () => setMediaPlaying(false);

    const handleFoundInPage = (e: any) => {
      if (e.result) {
        setSearchResult(e.result.activeMatchOrdinal - 1, e.result.matches);
      }
    };

    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('did-frame-navigate', handleNavigate);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('new-window', handleNewWindow);
    webview.addEventListener('media-started-playing', handleMediaPlaying);
    webview.addEventListener('media-paused', handleMediaPaused);
    webview.addEventListener('found-in-page', handleFoundInPage);

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('did-frame-navigate', handleNavigate);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('new-window', handleNewWindow);
      webview.removeEventListener('media-started-playing', handleMediaPlaying);
      webview.removeEventListener('media-paused', handleMediaPaused);
      webview.removeEventListener('found-in-page', handleFoundInPage);
    };
  }, [zoomFactor]);

  // 监听元素选择结果
  useEffect(() => {
    if (window.electronAPI?.onWebviewElementSelected) {
      window.electronAPI.onWebviewElementSelected((elementInfo) => {
        setSelectedElement(elementInfo);
        setIsSelectingElement(false);
      });
    }
  }, []);

  // 导航方法
  const handleNavigate = useCallback(() => {
    const normalizedUrl = ensureUrlScheme(inputUrl);
    setUrl(normalizedUrl);
    webviewRef.current?.loadURL(normalizedUrl);
  }, [inputUrl]);

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, []);

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, []);

  const handleRefresh = useCallback(() => {
    if (isLoading) {
      webviewRef.current?.stop();
    } else {
      webviewRef.current?.reload();
    }
  }, [isLoading]);

  const handleHome = useCallback(() => {
    const homeUrl = 'https://www.google.com';
    setUrl(homeUrl);
    setInputUrl(homeUrl);
    webviewRef.current?.loadURL(homeUrl);
  }, []);

  // 搜索
  const handleSearch = useCallback((query: string) => {
    if (!domReady) return;
    if (query) {
      webviewRef.current?.findInPage(query, { findNext: true });
    } else {
      webviewRef.current?.stopFindInPage('clearSelection');
    }
  }, [domReady]);

  const handleSearchNext = useCallback(() => {
    if (searchQuery) {
      webviewRef.current?.findInPage(searchQuery, { forward: true, findNext: false });
    }
  }, [searchQuery]);

  const handleSearchPrev = useCallback(() => {
    if (searchQuery) {
      webviewRef.current?.findInPage(searchQuery, { forward: false, findNext: false });
    }
  }, [searchQuery]);

  // 媒体控制
  const handleToggleMute = useCallback(() => {
    if (webviewRef.current) {
      const newMuted = !webviewRef.current.isAudioMuted();
      webviewRef.current.setAudioMuted(newMuted);
      setMediaMuted(newMuted);
    }
  }, []);

  // 缩放
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoomFactor + 0.1, 3);
    setZoomFactor(newZoom);
    if (domReady) {
      webviewRef.current?.setZoomFactor(newZoom);
    }
  }, [zoomFactor, domReady]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoomFactor - 0.1, 0.3);
    setZoomFactor(newZoom);
    if (domReady) {
      webviewRef.current?.setZoomFactor(newZoom);
    }
  }, [zoomFactor, domReady]);

  // UA 切换
  const handleToggleUserAgent = useCallback(() => {
    const types: UserAgentType[] = ['default', 'mobile:iphone', 'mobile:android'];
    const currentIndex = types.indexOf(userAgentType);
    const nextType = types[(currentIndex + 1) % types.length];
    setUserAgentType(nextType);

    if (webviewRef.current && domReady) {
      const ua = USER_AGENTS[nextType];
      webviewRef.current.setUserAgent(ua || '');
      webviewRef.current.reload();
    }
  }, [userAgentType, domReady]);

  // 元素选择
  const handleToggleElementSelection = useCallback(() => {
    if (!webContentsId) return;

    const newState = !isSelectingElement;
    setIsSelectingElement(newState);

    if (window.electronAPI?.sendToWebview) {
      window.electronAPI.sendToWebview(
        webContentsId,
        newState ? 'webview:startElementSelection' : 'webview:stopElementSelection'
      );
    }
  }, [isSelectingElement, webContentsId]);

  // 复制 URL
  const handleCopyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(url);
  }, [url]);

  // 发送元素到聊天
  const handleSendToChat = useCallback(() => {
    if (!selectedElement) return;

    window.dispatchEvent(new CustomEvent('webview-element-selected', {
      detail: {
        element: selectedElement,
        message: userMessage,
        workspaceId: workspacePath
      }
    }));

    setSelectedElement(null);
    setUserMessage('');
  }, [selectedElement, userMessage, workspacePath]);

  const userAgent = USER_AGENTS[userAgentType];

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* 工具栏 */}
      <div className="px-2 py-1.5 bg-muted/30 border-b flex items-center gap-1">
        {/* 导航按钮 */}
        <Button size="sm" variant="ghost" onClick={handleBack} disabled={!canGoBack} className="h-7 w-7 p-0">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleForward} disabled={!canGoForward} className="h-7 w-7 p-0">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleRefresh} className="h-7 w-7 p-0">
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleHome} className="h-7 w-7 p-0">
          <Home className="w-4 h-4" />
        </Button>

        {/* URL 输入框 */}
        <div className="flex-1 flex items-center gap-1 mx-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
            className="flex-1 h-7 text-sm font-mono"
            spellCheck={false}
          />
        </div>

        {/* 功能按钮 */}
        <Button size="sm" variant="ghost" onClick={handleCopyUrl} className="h-7 w-7 p-0" title="Copy URL">
          <Copy className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSearchOpen(!searchOpen)} className="h-7 w-7 p-0" title="Search">
          <Search className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleZoomOut} className="h-7 w-7 p-0" title="Zoom Out">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleZoomIn} className="h-7 w-7 p-0" title="Zoom In">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleToggleUserAgent}
          className="h-7 w-7 p-0"
          title={`User Agent: ${userAgentType}`}
        >
          {userAgentType === 'default' ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
        </Button>
        {mediaPlaying && (
          <Button size="sm" variant="ghost" onClick={handleToggleMute} className="h-7 w-7 p-0" title="Toggle Mute">
            {mediaMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
        )}
        <Button
          size="sm"
          variant={isSelectingElement ? "default" : "ghost"}
          onClick={handleToggleElementSelection}
          disabled={!domReady}
          className="h-7 w-7 p-0"
          title="Select Element"
        >
          <MousePointerClick className="w-4 h-4" />
        </Button>
      </div>

      {/* 搜索栏 */}
      {searchOpen && (
        <div className="px-2 py-1 bg-muted/20 border-b flex items-center gap-2">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              handleSearch(e.target.value);
            }}
            placeholder="Search in page..."
            className="flex-1 h-7 text-sm"
            autoFocus
          />
          <span className="text-xs text-muted-foreground">
            {searchResultCount > 0 ? `${searchResultIndex + 1}/${searchResultCount}` : '0/0'}
          </span>
          <Button size="sm" variant="ghost" onClick={handleSearchPrev} className="h-6 w-6 p-0">
            <ChevronLeft className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSearchNext} className="h-6 w-6 p-0">
            <ChevronRight className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="h-6 w-6 p-0">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 relative">
        {/* 加载指示器 */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20">
            <div className="h-full bg-primary animate-pulse" style={{ width: '60%' }} />
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="text-center p-8">
              <div className="text-red-500 mb-4">Failed to Load</div>
              <div className="text-sm text-muted-foreground mb-4">{error}</div>
              <Button size="sm" variant="outline" onClick={handleRefresh}>Try Again</Button>
            </div>
          </div>
        )}

        {/* Webview */}
        {preloadPath && (
          <webview
            ref={webviewRef as any}
            src={url}
            preload={preloadPath}
            partition="persist:webview"
            useragent={userAgent}
            allowpopups="true"
            className="w-full h-full border-0"
            style={{ display: 'flex' }}
          />
        )}

        {/* 选中元素面板 */}
        {selectedElement && (
          <div className="absolute bottom-0 left-0 right-0 bg-background border-t shadow-lg max-h-96 overflow-auto z-20">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Selected Element</h3>
                <Button size="sm" variant="ghost" onClick={() => { setSelectedElement(null); setUserMessage(''); }} className="h-6 w-6 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground min-w-[60px]">Tag:</span>
                  <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{selectedElement.tagName}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-medium text-muted-foreground min-w-[60px] mt-1">Selector:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">{selectedElement.selector}</code>
                </div>
                {selectedElement.innerText && (
                  <div className="flex items-start gap-2">
                    <span className="font-medium text-muted-foreground min-w-[60px] mt-1">Text:</span>
                    <p className="text-xs bg-muted p-2 rounded flex-1 max-h-20 overflow-auto">{selectedElement.innerText}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Add a message (optional)</label>
                <Textarea
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  placeholder="Describe what you want to know or do with this element..."
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={() => { setSelectedElement(null); setUserMessage(''); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSendToChat} className="gap-2">
                  <Send className="h-4 w-4" />
                  Send to Chat
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebViewWidget;
```

**Step 2: Verify component compiles**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko/frontend && npx tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
git add frontend/src/components/WebViewWidget.tsx
git commit -m "feat(web): add WebViewWidget component using Electron webview"
```

---

## Task 7: Update TabContent to Use WebViewWidget

**Files:**
- Modify: `frontend/src/components/TabContent.tsx:23,264-283`

**Step 1: Replace WebViewer import with WebViewWidget**

Change line 23 from:
```typescript
const WebViewer = lazy(() => import('@/components/WebViewer').then(m => ({ default: m.WebViewer })));
```

To:
```typescript
const WebViewWidget = lazy(() => import('@/components/WebViewWidget').then(m => ({ default: m.WebViewWidget })));
```

**Step 2: Update the webview case in renderContent**

Replace the `case 'webview':` block (lines 264-283) with:

```typescript
      case 'webview':
        if (!tab.webviewUrl) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4 text-muted-foreground">No URL specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <WebViewWidget
              url={tab.webviewUrl}
              workspacePath={tab.projectPath}
              onUrlChange={(newUrl) => {
                updateTab(tab.id, { webviewUrl: newUrl });
              }}
            />
          </div>
        );
```

**Step 3: Verify it compiles**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko/frontend && npx tsc --noEmit`

Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/components/TabContent.tsx
git commit -m "refactor(tabs): switch from WebViewer to WebViewWidget"
```

---

## Task 8: Build and Test

**Step 1: Build Electron**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko && npm run build:electron`

Expected: Build succeeds

**Step 2: Build Frontend**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko/frontend && npm run build`

Expected: Build succeeds

**Step 3: Run application in dev mode**

Run: `cd /Users/rubin/Documents/data/rubin/code/ropcode/.ropcode/unpleasant-gecko && npm run dev`

Expected: Application starts

**Step 4: Test webview functionality**

1. Open a webview tab
2. Navigate to a URL
3. Test back/forward navigation
4. Test refresh
5. Test search in page
6. Test zoom in/out
7. Test element selector
8. Test UA switching

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete webview migration from iframe"
```

---

## Testing Checklist

- [ ] Basic navigation (load URL, back, forward, refresh)
- [ ] Local HTML file loading (file:// protocol)
- [ ] Element selector functionality
- [ ] In-page search (findInPage)
- [ ] User agent switching
- [ ] Zoom control
- [ ] Media mute control
- [ ] Error handling
- [ ] URL input and keyboard navigation
