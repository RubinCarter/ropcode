import { useEffect, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { TermWrap } from '@/widgets/terminal/TermWrap';

/**
 * Terminal 实例管理器
 * 使用 TermWrap 管理所有 Terminal 实例
 */
class TerminalInstanceManager {
  private instances = new Map<string, {
    termWrap: TermWrap | null;  // 在 attach 时创建
    container: HTMLDivElement | null;
    refCount: number;
  }>();

  /**
   * 获取或创建 Terminal 实例占位
   * 实际的 TermWrap 在 attach 时创建（需要容器元素）
   */
  getOrCreate(key: string): { termWrap: TermWrap | null } {
    let instance = this.instances.get(key);

    if (!instance) {
      console.log('[TerminalManager] Creating instance placeholder:', key);
      instance = {
        termWrap: null,
        container: null,
        refCount: 0,
      };
      this.instances.set(key, instance);
    }

    instance.refCount++;
    console.log('[TerminalManager] Ref count increased:', key, instance.refCount);

    return {
      termWrap: instance.termWrap,
    };
  }

  /**
   * 将 Terminal 附加到容器，创建 TermWrap
   */
  attach(key: string, container: HTMLDivElement): TermWrap | null {
    const instance = this.instances.get(key);
    if (!instance) {
      console.error('[TerminalManager] Instance does not exist:', key);
      return null;
    }

    // 如果还没有创建 TermWrap，则创建
    if (!instance.termWrap) {
      console.log('[TerminalManager] Creating TermWrap:', key);
      instance.termWrap = new TermWrap(
        container,
        {
          fontSize: 13,
          fontFamily: '"MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
          cursorBlink: true,
          cursorStyle: 'block',
          scrollback: 10000,
          allowProposedApi: true,
        },
        {
          useWebGL: true,
          lazyWebGL: true,
        }
      );
      instance.container = container;
      console.log('[TerminalManager] TermWrap created, WebGL:', instance.termWrap.isWebGLLoaded());
    } else {
      // TermWrap 已存在，处理容器变更
      const terminal = instance.termWrap.getTerminal();
      const currentElement = (terminal as any)?.element as HTMLElement | null;

      if (currentElement && currentElement.parentElement !== container) {
        console.log('[TerminalManager] Moving xterm DOM to new container:', key);
        container.appendChild(currentElement);
        instance.container = container;
      }
    }

    // 适配尺寸
    try {
      if (container.offsetWidth > 0 && instance.termWrap) {
        instance.termWrap.fit();
      }
    } catch (error) {
      console.warn('[TerminalManager] Fit failed:', error);
    }

    return instance.termWrap;
  }

  /**
   * 从容器分离 Terminal（但不销毁实例）
   */
  detach(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    console.log('[TerminalManager] Detaching container:', key);
    instance.container = null;
  }

  /**
   * 释放引用
   */
  release(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.refCount--;
    console.log('[TerminalManager] Ref count decreased:', key, instance.refCount);
  }

  /**
   * 销毁 Terminal 实例
   */
  destroy(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    console.log('[TerminalManager] Destroying instance:', key);

    if (instance.termWrap) {
      instance.termWrap.dispose();
    }

    this.instances.delete(key);
  }

  /**
   * 获取实例（如果存在）
   */
  get(key: string): { termWrap: TermWrap | null } | undefined {
    const instance = this.instances.get(key);
    if (!instance) return undefined;

    return {
      termWrap: instance.termWrap,
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
    console.log('[TerminalManager] Clearing all instances');
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
 * @returns TermWrap 实例
 */
export function useTerminalInstance(
  workspaceId: string,
  terminalId: string
) {
  const key = `${workspaceId}::${terminalId}`;
  const [termWrap, setTermWrap] = useState<TermWrap | null>(null);

  // 创建/获取实例
  useEffect(() => {
    console.log('[useTerminalInstance] Initializing:', { key });
    const inst = terminalManager.getOrCreate(key);
    setTermWrap(inst.termWrap);

    return () => {
      terminalManager.release(key);
    };
  }, [key]);

  return {
    termWrap,
    managerKey: key,
  };
}

// 导出管理器以供其他地方使用
export { terminalManager };
