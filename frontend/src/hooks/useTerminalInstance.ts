import { useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

/**
 * Terminal 实例管理器
 * 负责在全局范围内管理 Terminal 实例，确保每个 workspace + terminal ID 组合只有一个实例
 */
class TerminalInstanceManager {
  private instances = new Map<string, {
    terminal: Terminal;
    fitAddon: FitAddon;
    container: HTMLDivElement | null;
    refCount: number;
  }>();

  /**
   * 获取或创建 Terminal 实例
   */
  getOrCreate(key: string): { terminal: Terminal; fitAddon: FitAddon } {
    let instance = this.instances.get(key);

    if (!instance) {
      console.log('[TerminalManager] 创建新的 Terminal 实例:', key);

      const terminal = new Terminal({
        fontSize: 13,
        fontFamily: '"MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      instance = {
        terminal,
        fitAddon,
        container: null,
        refCount: 0,
      };

      this.instances.set(key, instance);
    }

    instance.refCount++;
    console.log('[TerminalManager] 引用计数增加:', key, instance.refCount);

    return {
      terminal: instance.terminal,
      fitAddon: instance.fitAddon,
    };
  }

  /**
   * 将 Terminal 附加到容器
   */
  attach(key: string, container: HTMLDivElement): void {
    const instance = this.instances.get(key);
    if (!instance) {
      console.error('[TerminalManager] 实例不存在:', key);
      return;
    }

    const term = instance.terminal as any;
    const currentElement: HTMLElement | null = term?.element || null;

    // 如果 xterm 的 element 已存在，直接把现有 DOM 节点移动到新容器，避免重复 open()
    if (currentElement) {
      if (currentElement.parentElement !== container) {
        console.log('[TerminalManager] 迁移现有 xterm DOM 到新容器:', key);
        container.appendChild(currentElement);
      }
      instance.container = container;
    } else {
      // 第一次附加：调用 open
      console.log('[TerminalManager] 首次 open 到容器:', key);
      instance.terminal.open(container);
      instance.container = container;
    }

    // 附加/迁移后尽量适配一次尺寸
    try {
      if (container.offsetWidth > 0) {
        instance.fitAddon.fit();
      }
    } catch (error) {
      console.warn('[TerminalManager] Fit failed (attach):', error);
    }
  }

  /**
   * 从容器分离 Terminal（但不销毁实例）
   */
  detach(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    console.log('[TerminalManager] 分离容器:', key);
    // xterm.js 不提供显式的 detach 方法
    // 当 Terminal 附加到新容器时会自动处理
    instance.container = null;
  }

  /**
   * 释放引用
   */
  release(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.refCount--;
    console.log('[TerminalManager] 引用计数减少:', key, instance.refCount);

    // 引用计数为 0 时不立即销毁，保持实例以便快速恢复
    // 只有在显式调用 destroy 时才销毁
  }

  /**
   * 销毁 Terminal 实例
   */
  destroy(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    console.log('[TerminalManager] 销毁 Terminal 实例:', key);
    instance.terminal.dispose();
    this.instances.delete(key);
  }

  /**
   * 获取实例（如果存在）
   */
  get(key: string): { terminal: Terminal; fitAddon: FitAddon } | undefined {
    const instance = this.instances.get(key);
    if (!instance) return undefined;

    return {
      terminal: instance.terminal,
      fitAddon: instance.fitAddon,
    };
  }

  /**
   * 检查实例是否存在
   */
  has(key: string): boolean {
    return this.instances.has(key);
  }

  /**
   * 清理所有实例
   */
  clear(): void {
    console.log('[TerminalManager] 清理所有实例');
    this.instances.forEach((_instance, key) => {
      this.destroy(key);
    });
  }
}

// 全局单例
const terminalManager = new TerminalInstanceManager();

/**
 * Terminal 实例管理 Hook
 *
 * @param workspaceId - Workspace ID
 * @param terminalId - Terminal ID
 * @param containerRef - 容器 ref
 * @returns Terminal 实例和 FitAddon
 */
export function useTerminalInstance(
  workspaceId: string,
  terminalId: string
) {
  // 生成唯一的 key
  const key = `${workspaceId}::${terminalId}`;
  const [instance, setInstance] = useState<{ terminal: Terminal; fitAddon: FitAddon } | null>(null);

  console.log('[useTerminalInstance] Hook 调用:', { workspaceId, terminalId, key });

  // 创建/获取实例
  useEffect(() => {
    console.log('[useTerminalInstance] 创建/获取实例:', { key });
    const inst = terminalManager.getOrCreate(key);
    setInstance(inst);

    return () => {
      // 组件卸载时释放引用
      terminalManager.release(key);
    };
  }, [key]);

  return {
    terminal: instance?.terminal || null,
    fitAddon: instance?.fitAddon || null,
    managerKey: key,
  };
}

// 导出管理器以供其他地方使用
export { terminalManager };
