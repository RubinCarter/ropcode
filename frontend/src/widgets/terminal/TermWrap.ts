/**
 * TermWrap - xterm.js Terminal wrapper class
 *
 * Provides full terminal functionality including:
 * - WebGL GPU-accelerated rendering
 * - Search functionality
 * - Serialization/deserialization
 * - Web link support
 * - Auto-fit resizing
 */

import { Terminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';

/**
 * Cache WebGL support detection result
 */
let webglSupportCached: boolean | null = null;

/**
 * Detect whether the browser supports WebGL (result is cached)
 * @returns true if WebGL is supported, false otherwise
 */
function detectWebGLSupport(): boolean {
  // Return cached result to avoid recreating WebGL context
  if (webglSupportCached !== null) {
    return webglSupportCached;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') || canvas.getContext('webgl2');
    // Release context immediately
    if (ctx) {
      const ext = ctx.getExtension('WEBGL_lose_context');
      if (ext) {
        ext.loseContext();
      }
    }
    webglSupportCached = !!ctx;
    return webglSupportCached;
  } catch (e) {
    console.warn('WebGL detection failed:', e);
    webglSupportCached = false;
    return false;
  }
}

/**
 * TermWrap configuration options
 */
export interface TermWrapOptions {
  /** Whether to enable WebGL rendering (requires browser support) */
  useWebGL?: boolean;
  /** Whether to lazy-load WebGL (loads asynchronously in background to avoid blocking UI) */
  lazyWebGL?: boolean;
  /** Link click handler */
  onLinkClick?: (event: MouseEvent, uri: string) => void;
  /** Data send handler */
  onData?: (data: string) => void;
  /** Custom keyboard event handler */
  onKey?: (event: KeyboardEvent) => boolean;
}

/**
 * TermWrap - xterm.js Terminal wrapper class
 *
 * Wraps xterm.js Terminal and its common addons, providing a unified interface with graceful error handling
 */
export class TermWrap {
  /** xterm.js Terminal instance */
  public readonly terminal: Terminal;

  /** FitAddon - auto-fit sizing */
  private readonly fitAddon: FitAddon;

  /** SearchAddon - search functionality */
  private readonly searchAddon: SearchAddon;

  /** SerializeAddon - serialization functionality */
  private readonly serializeAddon: SerializeAddon;

  /** WebLinksAddon - web link support */
  private readonly webLinksAddon: WebLinksAddon;

  /** WebglAddon - GPU-accelerated rendering (optional) */
  private webglAddon?: WebglAddon;

  /** Unicode11Addon - correct Unicode character width handling */
  private readonly unicode11Addon: Unicode11Addon;

  /** Container element */
  private readonly container: HTMLDivElement;

  /** Configuration options */
  private readonly options: TermWrapOptions;

  /** Whether WebGL has been successfully loaded */
  private webglLoaded: boolean = false;

  /**
   * Create a TermWrap instance
   *
   * @param container - DOM container to mount the terminal
   * @param terminalOptions - xterm.js Terminal configuration options
   * @param wrapOptions - TermWrap configuration options
   */
  constructor(
    container: HTMLDivElement,
    terminalOptions?: ITerminalOptions & ITerminalInitOnlyOptions,
    wrapOptions?: TermWrapOptions
  ) {
    this.container = container;
    this.options = wrapOptions || {};

    // Create Terminal instance
    console.log('[TermWrap] Creating Terminal instance');
    this.terminal = new Terminal(terminalOptions);

    // Initialize FitAddon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Initialize SearchAddon
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);

    // Initialize SerializeAddon
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);

    // Initialize WebLinksAddon
    this.webLinksAddon = new WebLinksAddon(this.handleLinkClick.bind(this));
    this.terminal.loadAddon(this.webLinksAddon);

    // Initialize Unicode11Addon - correct width handling for Powerline symbols and other Unicode chars
    this.unicode11Addon = new Unicode11Addon();
    this.terminal.loadAddon(this.unicode11Addon);
    this.terminal.unicode.activeVersion = '11';

    // Try to load WebGL addon (if supported and enabled)
    if (this.options.useWebGL !== false && detectWebGLSupport()) {
      if (this.options.lazyWebGL) {
        // Lazy load: load asynchronously in background without blocking initialization
        const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 100);
        idle(() => this.loadWebGLAddon());
      } else {
        // Synchronous load (default behavior)
        this.loadWebGLAddon();
      }
    } else if (this.options.useWebGL === true && !detectWebGLSupport()) {
      console.warn('WebGL is not supported in this browser, falling back to canvas renderer');
    }

    // Open Terminal to container
    this.terminal.open(this.container);

    // Set up event handlers
    if (this.options.onData) {
      this.terminal.onData(this.options.onData);
    }

    if (this.options.onKey) {
      this.terminal.attachCustomKeyEventHandler(this.options.onKey);
    }
  }

  /**
   * Load WebGL addon (with error handling)
   * @private
   */
  private loadWebGLAddon(): void {
    try {
      this.webglAddon = new WebglAddon();

      // Listen for WebGL context loss event
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
   * Handle link click event
   * @private
   */
  private handleLinkClick(event: MouseEvent, uri: string): void {
    if (this.options.onLinkClick) {
      this.options.onLinkClick(event, uri);
    } else {
      // Default behavior: open link in new tab
      event.preventDefault();
      window.open(uri, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Get WebGL support status
   * @returns true if the browser supports WebGL
   */
  public static detectWebGLSupport(): boolean {
    return detectWebGLSupport();
  }

  /**
   * Check if WebGL has been successfully loaded
   * @returns true if WebGL addon is loaded
   */
  public isWebGLLoaded(): boolean {
    return this.webglLoaded;
  }

  /**
   * Search text
   *
   * @param query - Search keyword
   * @param options - Search options (case sensitivity, regex, etc.)
   * @returns Whether a match was found
   */
  public search(query: string, options?: Parameters<SearchAddon['findNext']>[1]): boolean {
    return this.searchAddon.findNext(query, options);
  }

  /**
   * Find next match
   *
   * @param query - Search keyword
   * @param options - Search options
   * @returns Whether a match was found
   */
  public searchNext(query?: string, options?: any): boolean {
    if (query) {
      return this.searchAddon.findNext(query, options);
    }
    return this.searchAddon.findNext(this.searchAddon['_lastSearchTerm'] || '', options);
  }

  /**
   * Find previous match
   *
   * @param query - Search keyword
   * @param options - Search options
   * @returns Whether a match was found
   */
  public searchPrevious(query?: string, options?: any): boolean {
    if (query) {
      return this.searchAddon.findPrevious(query, options);
    }
    return this.searchAddon.findPrevious(this.searchAddon['_lastSearchTerm'] || '', options);
  }

  /**
   * Clear search result highlights
   */
  public clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  /**
   * Serialize terminal content
   *
   * @returns Serialized terminal content (can be used for save and restore)
   */
  public serialize(): string {
    return this.serializeAddon.serialize();
  }

  /**
   * Auto-fit terminal size to container
   *
   * Calling this method automatically adjusts terminal rows and columns to fit the container
   */
  public fit(): void {
    this.fitAddon.fit();
  }

  /**
   * Get current terminal dimensions
   *
   * @returns Terminal rows and columns
   */
  public getDimensions(): { cols: number; rows: number } {
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows
    };
  }

  /**
   * Write data to terminal
   *
   * @param data - Data to write
   * @param callback - Callback after write completes
   */
  public write(data: string | Uint8Array, callback?: () => void): void {
    this.terminal.write(data, callback);
  }

  /**
   * Clear terminal content
   */
  public clear(): void {
    this.terminal.clear();
  }

  /**
   * Reset terminal state
   */
  public reset(): void {
    this.terminal.reset();
  }

  /**
   * Get currently selected text in terminal
   *
   * @returns Selected text content
   */
  public getSelection(): string {
    return this.terminal.getSelection();
  }

  /**
   * Get Terminal instance
   *
   * @returns Terminal instance
   */
  public getTerminal(): Terminal {
    return this.terminal;
  }

  /**
   * Focus the terminal
   */
  public focus(): void {
    this.terminal.focus();
  }

  /**
   * Dispose the terminal instance
   *
   * Cleans up all addons and event listeners, releases resources
   */
  public dispose(): void {
    // Dispose WebGL addon (if loaded)
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch (error) {
        console.error('Error disposing WebGL addon:', error);
      }
      this.webglAddon = undefined;
      this.webglLoaded = false;
    }

    // Dispose Terminal instance (automatically cleans up all addons)
    this.terminal.dispose();
  }
}
