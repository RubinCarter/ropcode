import { useEffect, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { TermWrap } from '@/widgets/terminal/TermWrap';

/**
 * Terminal instance manager
 * Uses TermWrap to manage all Terminal instances
 */
class TerminalInstanceManager {
  private instances = new Map<string, {
    termWrap: TermWrap | null;  // Created on attach
    container: HTMLDivElement | null;
    refCount: number;
  }>();

  /**
   * Get or create a Terminal instance placeholder
   * The actual TermWrap is created on attach (requires container element)
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
   * Attach Terminal to a container, creating TermWrap
   */
  attach(key: string, container: HTMLDivElement): TermWrap | null {
    const instance = this.instances.get(key);
    if (!instance) {
      console.error('[TerminalManager] Instance does not exist:', key);
      return null;
    }

    // If TermWrap hasn't been created yet, create it
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
      // TermWrap already exists, handle container change
      const terminal = instance.termWrap.getTerminal();
      const currentElement = (terminal as any)?.element as HTMLElement | null;

      if (currentElement && currentElement.parentElement !== container) {
        console.log('[TerminalManager] Moving xterm DOM to new container:', key);
        container.appendChild(currentElement);
        instance.container = container;
      }
    }

    // Fit to container size
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
   * Detach Terminal from container (without destroying the instance)
   */
  detach(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    console.log('[TerminalManager] Detaching container:', key);
    instance.container = null;
  }

  /**
   * Release reference
   */
  release(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.refCount--;
    console.log('[TerminalManager] Ref count decreased:', key, instance.refCount);
  }

  /**
   * Destroy Terminal instance
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
   * Get instance (if it exists)
   */
  get(key: string): { termWrap: TermWrap | null } | undefined {
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
    console.log('[TerminalManager] Clearing all instances');
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
  const [termWrap, setTermWrap] = useState<TermWrap | null>(null);

  // Create/get instance
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

// Export manager for use elsewhere
export { terminalManager };
