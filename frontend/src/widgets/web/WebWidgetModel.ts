/**
 * Web Widget Model
 *
 * 管理 Web 浏览器 Widget 的状态和行为
 * 提供 URL 导航、历史记录管理和键盘快捷键支持
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import type { WebWidgetConfig } from '../types';

/**
 * Web Widget 模型类
 *
 * 功能：
 * - URL 管理和导航
 * - 浏览器历史记录（后退/前进）
 * - 键盘快捷键支持
 * - iframe 聚焦控制
 */
export class WebWidgetModel extends BaseWidgetModel {
  /** 当前显示的 URL */
  url: string;

  /** 主页 URL，用于重置或默认导航 */
  homepageUrl: string;

  /** Web Widget 配置 */
  private config: WebWidgetConfig;

  /**
   * 构造函数
   *
   * @param config - Web Widget 配置
   */
  constructor(config?: WebWidgetConfig) {
    super('web', config);
    this.config = config ?? {};

    // 初始化 URL 配置
    this.url = this.config.initialParams?.initialUrl ?? 'about:blank';
    this.homepageUrl = this.config.initialParams?.homepageUrl ?? 'about:blank';

    // 确保 URL 有正确的协议
    this.url = WebWidgetModel.ensureScheme(this.url);
    this.homepageUrl = WebWidgetModel.ensureScheme(this.homepageUrl);
  }

  /**
   * 确保 URL 有正确的协议前缀
   *
   * 如果 URL 没有协议前缀，自动添加 https://
   * 支持的协议：http://, https://, file://, about:, data:
   *
   * @param url - 要检查的 URL
   * @returns 带有协议前缀的 URL
   *
   * @example
   * ```typescript
   * ensureScheme('google.com') // 返回 'https://google.com'
   * ensureScheme('http://example.com') // 返回 'http://example.com'
   * ensureScheme('about:blank') // 返回 'about:blank'
   * ```
   */
  static ensureScheme(url: string): string {
    if (!url || url.trim() === '') {
      return 'about:blank';
    }

    const trimmedUrl = url.trim();

    // 检查是否已有协议
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl);

    if (hasScheme) {
      return trimmedUrl;
    }

    // 没有协议则添加 https://
    return `https://${trimmedUrl}`;
  }

  /**
   * 导航到指定 URL
   *
   * @param url - 目标 URL
   */
  navigateTo(url: string): void {
    if (this.isDisposed) {
      console.warn(`Cannot navigate disposed widget ${this.widgetId}`);
      return;
    }

    this.url = WebWidgetModel.ensureScheme(url);
  }

  /**
   * 导航到主页
   */
  goHome(): void {
    this.navigateTo(this.homepageUrl);
  }

  /**
   * 刷新当前页面
   */
  refresh(): void {
    if (this.isDisposed) {
      console.warn(`Cannot refresh disposed widget ${this.widgetId}`);
      return;
    }

    // 触发 iframe 刷新
    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.contentWindow?.location.reload();
      } catch (error) {
        // 跨域时可能失败，尝试重新加载
        console.warn('Failed to reload iframe, reloading by src:', error);
        const currentSrc = iframe.src;
        iframe.src = 'about:blank';
        // 使用 setTimeout 确保浏览器有时间处理 about:blank
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 0);
      }
    }
  }

  /**
   * 后退到上一页
   */
  goBack(): void {
    if (this.isDisposed) {
      return;
    }

    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.contentWindow?.history.back();
      } catch (error) {
        console.warn('Failed to go back:', error);
      }
    }
  }

  /**
   * 前进到下一页
   */
  goForward(): void {
    if (this.isDisposed) {
      return;
    }

    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.contentWindow?.history.forward();
      } catch (error) {
        console.warn('Failed to go forward:', error);
      }
    }
  }

  /**
   * 获取 iframe 元素
   *
   * @returns iframe 元素或 null
   */
  private getIframe(): HTMLIFrameElement | null {
    if (!this.containerRef) {
      return null;
    }

    return this.containerRef.querySelector('iframe');
  }

  /**
   * 获取 URL 输入框元素
   *
   * @returns URL 输入框元素或 null
   */
  private getUrlInput(): HTMLInputElement | null {
    if (!this.containerRef) {
      return null;
    }

    return this.containerRef.querySelector('input[type="url"], input.url-input');
  }

  /**
   * 初始化 Widget
   *
   * @protected
   */
  protected async onInitialize(): Promise<void> {
    // 注册到全局 Widget 注册表
    widgetRegistry.register(this);

    console.log(`WebWidget ${this.widgetId} initialized with URL: ${this.url}`);
  }

  /**
   * 清理 Widget 资源
   *
   * @protected
   */
  protected onDispose(): void {
    // 从全局 Widget 注册表注销
    widgetRegistry.unregister(this.widgetId);

    console.log(`WebWidget ${this.widgetId} disposed`);
  }

  /**
   * 获取焦点
   *
   * 优先尝试聚焦到 iframe，如果失败则聚焦到 URL 输入框
   *
   * @returns 是否成功获取焦点
   */
  giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // 优先尝试聚焦 iframe
    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.focus();
        return true;
      } catch (error) {
        console.warn('Failed to focus iframe:', error);
      }
    }

    // 如果 iframe 聚焦失败，尝试聚焦 URL 输入框
    const urlInput = this.getUrlInput();
    if (urlInput) {
      urlInput.focus();
      return true;
    }

    // 最后尝试聚焦容器
    return super.giveFocus();
  }

  /**
   * 键盘事件处理
   *
   * 支持的快捷键：
   * - Alt + Left: 后退
   * - Alt + Right: 前进
   * - Ctrl/Cmd + L: 聚焦到 URL 输入框
   * - Ctrl/Cmd + R: 刷新页面
   *
   * @param event - 键盘事件
   * @returns 是否已处理该事件
   */
  keyDownHandler(event: KeyboardEvent): boolean {
    if (this.isDisposed) {
      return false;
    }

    // Alt + Left: 后退
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      this.goBack();
      return true;
    }

    // Alt + Right: 前进
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      this.goForward();
      return true;
    }

    // Ctrl/Cmd + L: 聚焦到 URL 输入框
    if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
      event.preventDefault();
      const urlInput = this.getUrlInput();
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
      return true;
    }

    // Ctrl/Cmd + R: 刷新页面
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
      event.preventDefault();
      this.refresh();
      return true;
    }

    return false;
  }
}
