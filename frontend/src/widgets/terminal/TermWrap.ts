/**
 * TermWrap - xterm.js Terminal 封装类
 *
 * 提供完整的终端功能，包括：
 * - WebGL GPU 加速渲染
 * - 搜索功能
 * - 序列化/反序列化
 * - Web 链接支持
 * - 自适应大小调整
 */

import { Terminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';

/**
 * 检测浏览器是否支持 WebGL
 * @returns 如果支持 WebGL 返回 true，否则返回 false
 */
function detectWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') || canvas.getContext('webgl2');
    return !!ctx;
  } catch (e) {
    console.warn('WebGL detection failed:', e);
    return false;
  }
}

/**
 * TermWrap 配置选项
 */
export interface TermWrapOptions {
  /** 是否启用 WebGL 渲染（需要浏览器支持） */
  useWebGL?: boolean;
  /** 链接点击处理器 */
  onLinkClick?: (event: MouseEvent, uri: string) => void;
  /** 数据发送处理器 */
  onData?: (data: string) => void;
  /** 自定义键盘事件处理器 */
  onKey?: (event: KeyboardEvent) => boolean;
}

/**
 * TermWrap - xterm.js Terminal 的封装类
 *
 * 封装了 xterm.js Terminal 及其常用 addons，提供统一的接口和优雅的错误处理
 */
export class TermWrap {
  /** xterm.js Terminal 实例 */
  public readonly terminal: Terminal;

  /** FitAddon - 自适应大小 */
  private readonly fitAddon: FitAddon;

  /** SearchAddon - 搜索功能 */
  private readonly searchAddon: SearchAddon;

  /** SerializeAddon - 序列化功能 */
  private readonly serializeAddon: SerializeAddon;

  /** WebLinksAddon - Web 链接支持 */
  private readonly webLinksAddon: WebLinksAddon;

  /** WebglAddon - GPU 加速渲染（可选） */
  private webglAddon?: WebglAddon;

  /** 容器元素 */
  private readonly container: HTMLDivElement;

  /** 配置选项 */
  private readonly options: TermWrapOptions;

  /** WebGL 是否已成功加载 */
  private webglLoaded: boolean = false;

  /**
   * 创建 TermWrap 实例
   *
   * @param container - 终端挂载的 DOM 容器
   * @param terminalOptions - xterm.js Terminal 配置选项
   * @param wrapOptions - TermWrap 配置选项
   */
  constructor(
    container: HTMLDivElement,
    terminalOptions?: ITerminalOptions & ITerminalInitOnlyOptions,
    wrapOptions?: TermWrapOptions
  ) {
    this.container = container;
    this.options = wrapOptions || {};

    // 创建 Terminal 实例
    console.log('[TermWrap] 创建 Terminal 实例');
    this.terminal = new Terminal(terminalOptions);

    // 初始化 FitAddon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // 初始化 SearchAddon
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);

    // 初始化 SerializeAddon
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);

    // 初始化 WebLinksAddon
    this.webLinksAddon = new WebLinksAddon(this.handleLinkClick.bind(this));
    this.terminal.loadAddon(this.webLinksAddon);

    // 尝试加载 WebGL addon（如果支持且启用）
    if (this.options.useWebGL !== false && detectWebGLSupport()) {
      this.loadWebGLAddon();
    } else if (this.options.useWebGL === true && !detectWebGLSupport()) {
      console.warn('WebGL is not supported in this browser, falling back to canvas renderer');
    }

    // 打开 Terminal 到容器
    this.terminal.open(this.container);

    // 设置事件处理器
    if (this.options.onData) {
      this.terminal.onData(this.options.onData);
    }

    if (this.options.onKey) {
      this.terminal.attachCustomKeyEventHandler(this.options.onKey);
    }
  }

  /**
   * 加载 WebGL addon（带错误处理）
   * @private
   */
  private loadWebGLAddon(): void {
    try {
      this.webglAddon = new WebglAddon();

      // 监听 WebGL context 丢失事件
      this.webglAddon.onContextLoss(() => {
        console.warn('WebGL context lost, disposing WebGL addon');
        this.webglAddon?.dispose();
        this.webglAddon = undefined;
        this.webglLoaded = false;
      });

      this.terminal.loadAddon(this.webglAddon);
      this.webglLoaded = true;
      console.log('WebGL addon loaded successfully');
    } catch (error) {
      console.error('Failed to load WebGL addon, falling back to canvas renderer:', error);
      this.webglAddon = undefined;
      this.webglLoaded = false;
    }
  }

  /**
   * 处理链接点击事件
   * @private
   */
  private handleLinkClick(event: MouseEvent, uri: string): void {
    if (this.options.onLinkClick) {
      this.options.onLinkClick(event, uri);
    } else {
      // 默认行为：在新标签页打开链接
      event.preventDefault();
      window.open(uri, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * 获取 WebGL 支持状态
   * @returns 如果浏览器支持 WebGL 返回 true
   */
  public static detectWebGLSupport(): boolean {
    return detectWebGLSupport();
  }

  /**
   * 检查 WebGL 是否已成功加载
   * @returns 如果 WebGL addon 已加载返回 true
   */
  public isWebGLLoaded(): boolean {
    return this.webglLoaded;
  }

  /**
   * 搜索文本
   *
   * @param query - 搜索关键词
   * @param options - 搜索选项（大小写敏感、正则表达式等）
   * @returns 是否找到匹配项
   */
  public search(query: string, options?: Parameters<SearchAddon['findNext']>[1]): boolean {
    return this.searchAddon.findNext(query, options);
  }

  /**
   * 查找下一个匹配项
   *
   * @param query - 搜索关键词
   * @param options - 搜索选项
   * @returns 是否找到匹配项
   */
  public searchNext(query?: string, options?: any): boolean {
    if (query) {
      return this.searchAddon.findNext(query, options);
    }
    return this.searchAddon.findNext(this.searchAddon['_lastSearchTerm'] || '', options);
  }

  /**
   * 查找上一个匹配项
   *
   * @param query - 搜索关键词
   * @param options - 搜索选项
   * @returns 是否找到匹配项
   */
  public searchPrevious(query?: string, options?: any): boolean {
    if (query) {
      return this.searchAddon.findPrevious(query, options);
    }
    return this.searchAddon.findPrevious(this.searchAddon['_lastSearchTerm'] || '', options);
  }

  /**
   * 清除搜索结果高亮
   */
  public clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  /**
   * 序列化终端内容
   *
   * @returns 序列化后的终端内容（可用于保存和恢复）
   */
  public serialize(): string {
    return this.serializeAddon.serialize();
  }

  /**
   * 自适应调整终端大小以适应容器
   *
   * 调用此方法会自动调整终端的行数和列数以适应容器尺寸
   */
  public fit(): void {
    this.fitAddon.fit();
  }

  /**
   * 获取当前终端尺寸
   *
   * @returns 终端的行数和列数
   */
  public getDimensions(): { cols: number; rows: number } {
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows
    };
  }

  /**
   * 写入数据到终端
   *
   * @param data - 要写入的数据
   * @param callback - 写入完成后的回调函数
   */
  public write(data: string | Uint8Array, callback?: () => void): void {
    this.terminal.write(data, callback);
  }

  /**
   * 清空终端内容
   */
  public clear(): void {
    this.terminal.clear();
  }

  /**
   * 重置终端状态
   */
  public reset(): void {
    this.terminal.reset();
  }

  /**
   * 获取终端当前选中的文本
   *
   * @returns 选中的文本内容
   */
  public getSelection(): string {
    return this.terminal.getSelection();
  }

  /**
   * 获取 Terminal 实例
   *
   * @returns Terminal 实例
   */
  public getTerminal(): Terminal {
    return this.terminal;
  }

  /**
   * 聚焦到终端
   */
  public focus(): void {
    this.terminal.focus();
  }

  /**
   * 销毁终端实例
   *
   * 清理所有 addon 和事件监听器，释放资源
   */
  public dispose(): void {
    // 销毁 WebGL addon（如果已加载）
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch (error) {
        console.error('Error disposing WebGL addon:', error);
      }
      this.webglAddon = undefined;
      this.webglLoaded = false;
    }

    // 销毁 Terminal 实例（会自动清理所有 addons）
    this.terminal.dispose();
  }
}
