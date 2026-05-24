/**
 * Web Widget Model
 *
 * Manages Web browser widget state and behavior.
 * Provides URL navigation, history management, and keyboard shortcut support.
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import type { WebWidgetConfig } from '../types';

/**
 * Web Widget model class
 *
 * Features:
 * - URL management and navigation
 * - Browser history (back/forward)
 * - Keyboard shortcut support
 * - iframe focus control
 */
export class WebWidgetModel extends BaseWidgetModel {
  /** Currently displayed URL */
  url: string;

  /** Homepage URL, used for reset or default navigation */
  homepageUrl: string;

  /** Web Widget config */
  private config: WebWidgetConfig;

  /**
   * Constructor
   *
   * @param config - Web Widget config
   */
  constructor(config?: WebWidgetConfig) {
    super('web', config);
    this.config = config ?? {};

    // Initialize URL config
    this.url = this.config.initialParams?.initialUrl ?? 'about:blank';
    this.homepageUrl = this.config.initialParams?.homepageUrl ?? 'about:blank';

    // Ensure URL has correct protocol
    this.url = WebWidgetModel.ensureScheme(this.url);
    this.homepageUrl = WebWidgetModel.ensureScheme(this.homepageUrl);
  }

  /**
   * Ensure URL has correct protocol prefix
   *
   * If URL has no protocol prefix, auto-adds https://
   * Supported protocols: http://, https://, file://, about:, data:
   *
   * @param url - URL to check
   * @returns URL with protocol prefix
   *
   * @example
   * ```typescript
   * ensureScheme('google.com') // returns 'https://google.com'
   * ensureScheme('http://example.com') // returns 'http://example.com'
   * ensureScheme('about:blank') // returns 'about:blank'
   * ```
   */
  static ensureScheme(url: string): string {
    if (!url || url.trim() === '') {
      return 'about:blank';
    }

    const trimmedUrl = url.trim();

    // Check if protocol already exists
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl);

    if (hasScheme) {
      return trimmedUrl;
    }

    // Add https:// if no protocol
    return `https://${trimmedUrl}`;
  }

  /**
   * Navigate to specified URL
   *
   * @param url - Target URL
   */
  navigateTo(url: string): void {
    if (this.isDisposed) {
      console.warn(`Cannot navigate disposed widget ${this.widgetId}`);
      return;
    }

    this.url = WebWidgetModel.ensureScheme(url);
  }

  /**
   * Navigate to homepage
   */
  goHome(): void {
    this.navigateTo(this.homepageUrl);
  }

  /**
   * Refresh current page
   */
  refresh(): void {
    if (this.isDisposed) {
      console.warn(`Cannot refresh disposed widget ${this.widgetId}`);
      return;
    }

    // Trigger iframe refresh
    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.contentWindow?.location.reload();
      } catch (error) {
        // May fail cross-origin, try reloading
        console.warn('Failed to reload iframe, reloading by src:', error);
        const currentSrc = iframe.src;
        iframe.src = 'about:blank';
        // Use setTimeout to ensure browser has time to process about:blank
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 0);
      }
    }
  }

  /**
   * Go back to previous page
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
   * Go forward to next page
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
   * Get iframe element
   *
   * @returns iframe element or null
   */
  private getIframe(): HTMLIFrameElement | null {
    if (!this.containerRef) {
      return null;
    }

    return this.containerRef.querySelector('iframe');
  }

  /**
   * Get URL input element
   *
   * @returns URL input element or null
   */
  private getUrlInput(): HTMLInputElement | null {
    if (!this.containerRef) {
      return null;
    }

    return this.containerRef.querySelector('input[type="url"], input.url-input');
  }

  /**
   * Initialize Widget
   *
   * @protected
   */
  protected async onInitialize(): Promise<void> {
    // Register to global Widget registry
    widgetRegistry.register(this);

    console.log(`WebWidget ${this.widgetId} initialized with URL: ${this.url}`);
  }

  /**
   * Clean up Widget resources
   *
   * @protected
   */
  protected onDispose(): void {
    // Unregister from global Widget registry
    widgetRegistry.unregister(this.widgetId);

    console.log(`WebWidget ${this.widgetId} disposed`);
  }

  /**
   * Get focus
   *
   * Tries to focus the iframe first; falls back to URL input on failure.
   *
   * @returns Whether focus was successfully acquired
   */
  giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // Try focusing iframe first
    const iframe = this.getIframe();
    if (iframe) {
      try {
        iframe.focus();
        return true;
      } catch (error) {
        console.warn('Failed to focus iframe:', error);
      }
    }

    // If iframe focus fails, try focusing URL input
    const urlInput = this.getUrlInput();
    if (urlInput) {
      urlInput.focus();
      return true;
    }

    // Finally try focusing container
    return super.giveFocus();
  }

  /**
   * Keyboard event handler
   *
   * Supported shortcuts:
   * - Alt + Left: Go back
   * - Alt + Right: Go forward
   * - Ctrl/Cmd + L: Focus URL input
   * - Ctrl/Cmd + R: Refresh page
   *
   * @param event - Keyboard event
   * @returns Whether the event was handled
   */
  keyDownHandler(event: KeyboardEvent): boolean {
    if (this.isDisposed) {
      return false;
    }

    // Alt + Left: go back
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      this.goBack();
      return true;
    }

    // Alt + Right: go forward
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      this.goForward();
      return true;
    }

    // Ctrl/Cmd + L: Focus URL input
    if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
      event.preventDefault();
      const urlInput = this.getUrlInput();
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
      return true;
    }

    // Ctrl/Cmd + R: Refresh page
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
      event.preventDefault();
      this.refresh();
      return true;
    }

    return false;
  }
}
