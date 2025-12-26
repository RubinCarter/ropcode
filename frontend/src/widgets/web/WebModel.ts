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

// 移动设备视口宽度 (用于容器宽度限制)
export const MOBILE_VIEWPORT_WIDTH = {
  'mobile:iphone': 390,
  'mobile:android': 412,
} as const;
