/**
 * Web Widget Zustand Store
 *
 * 管理 Web 浏览器 Widget 的状态，包括 URL、导航状态、加载状态等
 */

import { create } from 'zustand';

/**
 * Web Widget 状态接口
 */
interface WebState {
  /** 当前 URL */
  url: string;

  /** 主页 URL */
  homepageUrl: string;

  /** 加载状态 */
  isLoading: boolean;

  /** 是否可以后退 */
  canGoBack: boolean;

  /** 是否可以前进 */
  canGoForward: boolean;

  /** 错误信息 */
  error: string | null;

  /** 页面标题 */
  title: string;
}

/**
 * Web Widget Actions 接口
 */
interface WebActions {
  /**
   * 设置当前 URL
   * @param url URL 地址
   */
  setUrl: (url: string) => void;

  /**
   * 设置主页 URL
   * @param url 主页 URL 地址
   */
  setHomepage: (url: string) => void;

  /**
   * 设置加载状态
   * @param loading 是否正在加载
   */
  setLoading: (loading: boolean) => void;

  /**
   * 设置是否可以后退
   * @param canGoBack 是否可以后退
   */
  setCanGoBack: (canGoBack: boolean) => void;

  /**
   * 设置是否可以前进
   * @param canGoForward 是否可以前进
   */
  setCanGoForward: (canGoForward: boolean) => void;

  /**
   * 设置错误信息
   * @param error 错误信息字符串
   */
  setError: (error: string | null) => void;

  /**
   * 设置页面标题
   * @param title 页面标题
   */
  setTitle: (title: string) => void;

  /**
   * 重置到初始状态
   */
  reset: () => void;
}

/**
 * Web Store 完整类型
 */
type WebStore = WebState & WebActions;

/**
 * 初始状态
 */
const initialState: WebState = {
  url: 'https://www.google.com',
  homepageUrl: 'https://www.google.com',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  title: '',
};

/**
 * Web Widget Zustand Store
 *
 * @example
 * ```typescript
 * function WebComponent() {
 *   const { url, isLoading, setUrl, setLoading } = useWebStore();
 *
 *   const handleNavigate = (newUrl: string) => {
 *     setLoading(true);
 *     setUrl(newUrl);
 *   };
 *
 *   return (
 *     <div>
 *       <input value={url} onChange={(e) => handleNavigate(e.target.value)} />
 *       {isLoading && <Spinner />}
 *     </div>
 *   );
 * }
 * ```
 */
export const useWebStore = create<WebStore>((set) => ({
  // 初始状态
  ...initialState,

  // Actions
  setUrl: (url) => set({ url }),

  setHomepage: (url) => set({ homepageUrl: url }),

  setLoading: (loading) => set({ isLoading: loading }),

  setCanGoBack: (canGoBack) => set({ canGoBack }),

  setCanGoForward: (canGoForward) => set({ canGoForward }),

  setError: (error) => set({ error }),

  setTitle: (title) => set({ title }),

  reset: () => set(initialState),
}));
