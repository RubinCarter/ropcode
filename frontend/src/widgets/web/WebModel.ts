/**
 * Web Widget Zustand Store (Enhanced for Webview)
 *
 * Manages Web browser widget state with Electron webview support.
 */

import { create } from 'zustand';

/**
 * Selected element info
 */
export interface SelectedElement {
  tagName: string;
  innerText: string;
  outerHTML: string;
  selector: string;
  url: string;
}

/**
 * User Agent type
 */
export type UserAgentType = 'default' | 'mobile:iphone' | 'mobile:android';

/**
 * Web Widget state interface
 */
interface WebState {
  /** current URL */
  url: string;

  /** URL input value */
  inputUrl: string;

  /** homepage URL */
  homepageUrl: string;

  /** loading state */
  isLoading: boolean;

  /** Whether DOM is ready */
  domReady: boolean;

  /** Whether back navigation is available */
  canGoBack: boolean;

  /** Whether forward navigation is available */
  canGoForward: boolean;

  /** error info */
  error: string | null;

  /** page title */
  title: string;

  /** User Agent type */
  userAgentType: UserAgentType;

  /** Zoom factor */
  zoomFactor: number;

  /** Media is playing */
  mediaPlaying: boolean;

  /** Media is muted */
  mediaMuted: boolean;

  /** Whether in-page search is open */
  searchOpen: boolean;

  /** Search query */
  searchQuery: string;

  /** Search result index */
  searchResultIndex: number;

  /** Search result total count */
  searchResultCount: number;

  /** Whether element selection is active */
  isSelectingElement: boolean;

  /** Selected element */
  selectedElement: SelectedElement | null;

  /** User message (sent to chat) */
  userMessage: string;

  /** WebContents ID */
  webContentsId: number | null;
}

/**
 * Web Widget Actions interface
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

// User Agent constants
export const USER_AGENTS = {
  default: undefined,
  'mobile:iphone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'mobile:android': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
} as const;

// Mobile device viewport width (used for container width constraint)
export const MOBILE_VIEWPORT_WIDTH = {
  'mobile:iphone': 390,
  'mobile:android': 412,
} as const;
