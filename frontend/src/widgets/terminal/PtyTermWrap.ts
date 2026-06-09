import { Terminal, type ITerminalInitOnlyOptions, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getInitialWebSocketConfig } from '@/lib/ws-config';
import { connectBulkStream, type BulkStreamConnection } from '@/lib/ws/bulkStreamClient';
import type { BulkFrame } from '@/stores/bulkStore';

export interface PtyTermWrapOptions {
  source?: string;
  id: string;
  port?: number | string;
  authKey?: string;
  terminalOptions?: ITerminalOptions & ITerminalInitOnlyOptions;
  reloadOnRepeatedFailure?: boolean;
  onData?: (data: string) => void | Promise<void>;
  onResize?: (rows: number, cols: number) => void | Promise<void>;
  onLinkClick?: (event: MouseEvent, uri: string) => void;
  onShellStateChange?: (state: PtyShellState) => void;
  useWebGL?: boolean;
}

export type PtyShellIntegrationStatus = 'ready' | 'running-command' | null;

export interface PtyShellState {
  integration: boolean;
  status: PtyShellIntegrationStatus;
  shell?: string;
  lastCommand: string | null;
  lastExitCode: number | null;
  inputEmpty: boolean | null;
  cwd: string | null;
  commandHistory: string[];
}

interface TerminalTheme {
  background: string;
  foreground: string;
  selectionBackground?: string;
  selectionInactiveBackground?: string;
}

const RESIZE_DEBOUNCE_MS = 50;

let webglSupportCached: boolean | null = null;

export class PtyTermWrap {
  public readonly terminal: Terminal;

  private readonly source: string;
  private readonly id: string;
  private readonly options: PtyTermWrapOptions;
  private readonly fitAddon: FitAddon;
  private readonly searchAddon: SearchAddon;
  private readonly serializeAddon: SerializeAddon;
  private webglAddon: WebglAddon | null = null;
  private webglContextLoss: { dispose(): void } | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private writeInFlight = false;
  private writeQueue: string[] = [];
  private seenFrameIds = new Set<string>();
  private bulkConnection: BulkStreamConnection | null = null;
  private inputDisposable: { dispose(): void } | null = null;
  private disposed = false;
  private promptMarkers: ReturnType<Terminal['registerMarker']>[] = [];
  private shellState: PtyShellState = {
    integration: false,
    status: null,
    lastCommand: null,
    lastExitCode: null,
    inputEmpty: null,
    cwd: null,
    commandHistory: [],
  };

  constructor(options: PtyTermWrapOptions) {
    this.options = options;
    this.source = options.source ?? 'pty';
    this.id = options.id;
    this.terminal = new Terminal({
      fontSize: 13,
      fontFamily: '"MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
      ...options.terminalOptions,
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (this.options.onLinkClick) {
        this.options.onLinkClick(event, uri);
        return;
      }
      event.preventDefault();
      window.open(uri, '_blank', 'noopener,noreferrer');
    });
    const unicode11Addon = new Unicode11Addon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(webLinksAddon);
    this.terminal.loadAddon(unicode11Addon);
    this.terminal.unicode.activeVersion = '11';
    this.registerShellIntegrationHandlers();

    if (options.useWebGL !== false && detectWebGLSupport()) {
      this.setRenderer('webgl');
    }

    if (options.onData) {
      this.inputDisposable = this.terminal.onData((data) => {
        void options.onData?.(data);
      });
    }
  }

  attach(container: HTMLDivElement): void {
    if (this.disposed) return;
    this.container = container;
    const element = this.terminal.element;
    if (!element) {
      this.terminal.open(container);
    } else if (element.parentElement !== container) {
      container.appendChild(element);
    }
    this.observeResize();
    this.fitAndReport();
    this.connectBulkStream();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container = null;
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
    this.bulkConnection?.close();
    this.bulkConnection = null;
    this.inputDisposable?.dispose();
    this.inputDisposable = null;
    this.promptMarkers.forEach((marker) => marker?.dispose());
    this.promptMarkers = [];
    this.webglContextLoss?.dispose();
    this.webglContextLoss = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.writeQueue = [];
    this.terminal.dispose();
  }

  setTheme(theme: TerminalTheme): void {
    this.terminal.options.theme = theme;
    if (this.container) {
      this.container.style.backgroundColor = theme.background;
    }
  }

  setShellStateChangeHandler(handler?: (state: PtyShellState) => void): void {
    this.options.onShellStateChange = handler;
  }

  refresh(): void {
    if (this.terminal.rows > 0) {
      this.terminal.refresh(0, this.terminal.rows - 1);
    }
  }

  fitAndReport(): void {
    if (!this.canFit()) {
      return;
    }
    const oldRows = this.terminal.rows;
    const oldCols = this.terminal.cols;
    try {
      this.fitAddon.fit();
    } catch {
      return;
    }
    if (this.terminal.rows !== oldRows || this.terminal.cols !== oldCols) {
      void this.options.onResize?.(this.terminal.rows, this.terminal.cols);
    }
  }

  fit(): void {
    this.fitAndReport();
  }

  scheduleFit(): void {
    if (this.resizeTimer !== null) return;
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.fitAndReport();
    }, RESIZE_DEBOUNCE_MS);
  }

  getDimensions(): { rows: number; cols: number } {
    return { rows: this.terminal.rows, cols: this.terminal.cols };
  }

  getShellState(): PtyShellState {
    return {
      ...this.shellState,
      commandHistory: [...this.shellState.commandHistory],
    };
  }

  getLastCommandOutput(maxLines = 1000): string[] {
    const buffer = this.terminal.buffer.active;
    const totalLines = buffer.length;
    let start = 0;
    let end = totalLines;
    if (this.promptMarkers.length > 0) {
      const markerIndex = this.promptMarkers.length > 1 ? this.promptMarkers.length - 2 : this.promptMarkers.length - 1;
      start = Math.max(0, this.promptMarkers[markerIndex]?.line ?? 0);
      if (this.promptMarkers.length > 1) {
        end = Math.max(start, this.promptMarkers[this.promptMarkers.length - 1]?.line ?? totalLines);
      }
    }
    return this.bufferLinesToText(start, end).slice(-maxLines);
  }

  private setRenderer(renderer: 'webgl' | 'dom'): void {
    if (renderer === 'dom') {
      this.webglContextLoss?.dispose();
      this.webglContextLoss = null;
      this.webglAddon?.dispose();
      this.webglAddon = null;
      return;
    }
    if (this.webglAddon || !detectWebGLSupport()) {
      return;
    }
    try {
      const addon = new WebglAddon();
      this.webglContextLoss = addon.onContextLoss(() => this.setRenderer('dom'));
      this.terminal.loadAddon(addon);
      this.webglAddon = addon;
    } catch {
      this.webglAddon = null;
    }
  }

  private registerShellIntegrationHandlers(): void {
    this.terminal.parser.registerOscHandler(7, (data) => {
      this.handleCwdOSC(data);
      return true;
    });
    this.terminal.parser.registerOscHandler(16162, (data) => {
      this.handleShellIntegrationOSC(data);
      return true;
    });
  }

  private handleCwdOSC(data: string): void {
    try {
      const url = new URL(data);
      if (url.protocol !== 'file:') return;
      let path = decodeURIComponent(url.pathname);
      if (path.startsWith('//')) path = path.slice(1);
      if (/^\/[a-zA-Z]:[\\/]/.test(path)) {
        path = path.slice(1).replace(/\\/g, '/');
      }
      this.updateShellState({ cwd: path });
    } catch {
      // Ignore malformed OSC 7 payloads.
    }
  }

  private handleShellIntegrationOSC(data: string): void {
    if (!data) return;
    const [command, ...rest] = data.split(';');
    const payload = parseShellIntegrationPayload(rest.join(';'));
    switch (command) {
      case 'A':
        this.markPromptReady();
        break;
      case 'C':
        this.markCommandStart(payload);
        break;
      case 'D':
        this.updateShellState({
          status: 'ready',
          lastExitCode: typeof payload.exitcode === 'number' ? payload.exitcode : null,
        });
        break;
      case 'I':
        if (typeof payload.inputempty === 'boolean') {
          this.updateShellState({ inputEmpty: payload.inputempty });
        }
        break;
      case 'M':
        this.updateShellState({
          integration: payload.integration !== false,
          shell: typeof payload.shell === 'string' ? payload.shell : this.shellState.shell,
        });
        break;
      case 'R':
        this.updateShellState({ integration: false, status: null });
        break;
    }
  }

  private markPromptReady(): void {
    const marker = this.terminal.registerMarker(0);
    if (marker) {
      this.promptMarkers.push(marker);
      marker.onDispose(() => {
        this.promptMarkers = this.promptMarkers.filter((candidate) => candidate !== marker);
      });
    }
    this.updateShellState({ status: 'ready', inputEmpty: true });
  }

  private markCommandStart(payload: Record<string, unknown>): void {
    const decoded = typeof payload.cmd64 === 'string' ? decodeBase64(payload.cmd64) : null;
    const command = decoded && decoded.length <= 8192 ? decoded : null;
    const history = command
      ? [command, ...this.shellState.commandHistory.filter((entry) => entry !== command)].slice(0, 100)
      : this.shellState.commandHistory;
    this.updateShellState({
      status: 'running-command',
      lastCommand: command,
      lastExitCode: null,
      inputEmpty: null,
      commandHistory: history,
    });
  }

  private updateShellState(next: Partial<PtyShellState>): void {
    this.shellState = {
      ...this.shellState,
      ...next,
      commandHistory: next.commandHistory ? [...next.commandHistory] : this.shellState.commandHistory,
    };
    this.options.onShellStateChange?.(this.getShellState());
  }

  private bufferLinesToText(start: number, end: number): string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const line = buffer.getLine(i);
      if (!line) continue;
      lines.push(line.translateToString(true));
    }
    return lines;
  }

  private observeResize(): void {
    this.resizeObserver?.disconnect();
    if (!this.container) return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(this.container);
  }

  private canFit(): boolean {
    if (this.disposed || !this.container || !this.container.isConnected) {
      return false;
    }
    if (this.container.offsetWidth <= 0 || this.container.offsetHeight <= 0) {
      return false;
    }
    const element = this.terminal.element;
    return !!element && element.parentElement === this.container && element.isConnected;
  }

  private connectBulkStream(): void {
    if (this.bulkConnection || this.disposed) return;
    const configured = typeof window !== 'undefined'
      ? getInitialWebSocketConfig(window)
      : { port: undefined, authKey: undefined };
    const port = this.options.port ?? configured.port;
    const authKey = this.options.authKey ?? configured.authKey ?? undefined;
    if (!port) return;

    this.bulkConnection = connectBulkStream(port, authKey, this.source, this.id, {
      appendToStore: false,
      reloadOnRepeatedFailure: this.options.reloadOnRepeatedFailure,
      onFrame: (frame) => this.handleFrame(frame),
    });
  }

  private handleFrame(frame: BulkFrame): void {
    if (this.disposed || frame.source !== this.source || frame.id !== this.id) {
      return;
    }
    const frameIdentity = frame.frameId ? `${frame.seq}:${frame.frameId}` : null;
    if (frameIdentity && this.seenFrameIds.has(frameIdentity)) {
      return;
    }
    if (frameIdentity) {
      this.seenFrameIds.add(frameIdentity);
      if (this.seenFrameIds.size > 1000) {
        this.seenFrameIds.clear();
      }
    }
    this.enqueueWrite(frame.data ?? '');
  }

  private enqueueWrite(data: string): void {
    if (!data) return;
    this.writeQueue.push(data);
    this.flushWriteQueue();
  }

  private flushWriteQueue(): void {
    if (this.writeInFlight || this.writeQueue.length === 0 || this.disposed) {
      return;
    }
    const data = this.writeQueue.shift();
    if (!data) return;
    this.writeInFlight = true;
    this.terminal.write(data, () => {
      this.writeInFlight = false;
      if (this.writeQueue.length > 0) {
        this.flushWriteQueue();
      }
    });
  }
}

function parseShellIntegrationPayload(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function decodeBase64(value: string): string | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    return null;
  }
  return null;
}

function detectWebGLSupport(): boolean {
  if (webglSupportCached !== null) {
    return webglSupportCached;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    webglSupportCached = Boolean(ctx);
    return webglSupportCached;
  } catch {
    webglSupportCached = false;
    return false;
  }
}
