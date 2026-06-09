import { useEffect, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { PtyTermWrap, type PtyShellState } from '@/widgets/terminal/PtyTermWrap';
import { api } from '@/lib/api';

/**
 * Terminal instance manager
 * Uses TermWrap to manage all Terminal instances
 */
class TerminalInstanceManager {
  private instances = new Map<string, {
    termWrap: PtyTermWrap | null;  // Created on attach
    container: HTMLDivElement | null;
    refCount: number;
    destroyTimer: number | null;
  }>();

  /**
   * Get or create a Terminal instance placeholder
   * The actual TermWrap is created on attach (requires container element)
   */
  getOrCreate(key: string): { termWrap: PtyTermWrap | null } {
    let instance = this.instances.get(key);

    if (!instance) {
      instance = {
        termWrap: null,
        container: null,
        refCount: 0,
        destroyTimer: null,
      };
      this.instances.set(key, instance);
    }

    if (instance.destroyTimer !== null) {
      window.clearTimeout(instance.destroyTimer);
      instance.destroyTimer = null;
    }

    instance.refCount++;

    return {
      termWrap: instance.termWrap,
    };
  }

  /**
   * Attach Terminal to a container, creating TermWrap
   */
  attach(
    key: string,
    container: HTMLDivElement,
    sessionId: string,
    onShellStateChange?: (state: PtyShellState) => void,
  ): PtyTermWrap | null {
    const instance = this.instances.get(key);
    if (!instance) {
      console.error('[TerminalManager] Instance does not exist:', key);
      return null;
    }

    // If TermWrap hasn't been created yet, create it
    if (!instance.termWrap) {
      instance.termWrap = new PtyTermWrap({
        id: sessionId,
        useWebGL: false,
        onData: (data) => api.writeToPty(sessionId, data),
        onResize: (rows, cols) => api.resizePty(sessionId, rows, cols),
        onShellStateChange,
        terminalOptions: {
          fontSize: 13,
          fontFamily: '"MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
          cursorBlink: true,
          cursorStyle: 'block',
          scrollback: 10000,
          allowProposedApi: true,
        },
      });
      instance.termWrap.attach(container);
      instance.container = container;
    } else {
      // TermWrap already exists, handle container change
      instance.termWrap.setShellStateChangeHandler(onShellStateChange);
      instance.termWrap.attach(container);
      instance.container = container;
    }

    // Fit to container size
    try {
      if (container.offsetWidth > 0 && instance.termWrap) {
        instance.termWrap.fitAndReport();
      }
    } catch (error) {
      console.warn('[TerminalManager] Fit failed:', error);
    }

    return instance.termWrap;
  }

  /**
   * Detach Terminal from container (without destroying the instance)
   */
  detach(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.termWrap?.detach();
    instance.container = null;
  }

  /**
   * Release reference
   */
  release(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.refCount--;
    if (instance.refCount <= 0) {
      instance.refCount = 0;
      if (instance.destroyTimer !== null) return;
      instance.destroyTimer = window.setTimeout(() => {
        const current = this.instances.get(key);
        if (!current || current.refCount > 0) return;
        current.destroyTimer = null;
        this.destroy(key);
      }, 100);
    }
  }

  /**
   * Destroy Terminal instance
   */
  destroy(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    if (instance.destroyTimer !== null) {
      window.clearTimeout(instance.destroyTimer);
      instance.destroyTimer = null;
    }

    if (instance.termWrap) {
      instance.termWrap.dispose();
    }

    this.instances.delete(key);
  }

  /**
   * Get instance (if it exists)
   */
  get(key: string): { termWrap: PtyTermWrap | null } | undefined {
    const instance = this.instances.get(key);
    if (!instance) return undefined;

    return {
      termWrap: instance.termWrap,
    };
  }

  /**
   * Check if instance exists
   */
  has(key: string): boolean {
    return this.instances.has(key);
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances.forEach((_instance, key) => {
      this.destroy(key);
    });
  }
}

// Global singleton
const terminalManager = new TerminalInstanceManager();

/**
 * Terminal instance management Hook
 *
 * @param workspaceId - Workspace ID
 * @param terminalId - Terminal ID
 * @returns TermWrap instance
 */
export function useTerminalInstance(
  workspaceId: string,
  terminalId: string
) {
  const key = `${workspaceId}::${terminalId}`;
  const [termWrap, setTermWrap] = useState<PtyTermWrap | null>(null);

  // Create/get instance
  useEffect(() => {
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

// Export manager for use elsewhere
export { terminalManager };
