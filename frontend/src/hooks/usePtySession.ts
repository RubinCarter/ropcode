import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { EventsOn } from '@/lib/rpc-events';
import { api } from '@/lib/api';

type UnlistenFn = () => void;

/**
 * PTY 会话管理器
 * 负责管理 PTY 会话的生命周期，确保每个 session 只创建一次
 */
class PtySessionManager {
  private sessions = new Map<string, {
    created: boolean;
    creationPromise: Promise<void> | null;
    cwd: string | undefined;
    rows: number;
    cols: number;
    listeners: Set<string>; // 监听器 ID 集合
  }>();

  /**
   * 创建或获取 PTY 会话
   */
  async getOrCreate(
    sessionId: string,
    cwd: string | undefined,
    rows: number,
    cols: number
  ): Promise<void> {
    let session = this.sessions.get(sessionId);

    if (session?.created) {
      console.log('[PtyManager] PTY 会话已存在:', sessionId);
      return;
    }

    // 如果正在创建中，等待该 Promise 完成
    if (session?.creationPromise) {
      console.log('[PtyManager] PTY 会话正在创建中，等待...:', sessionId);
      await session.creationPromise;
      return;
    }

    // 创建会话的 Promise
    const creationPromise = (async () => {
      try {
        console.log('[PtyManager] 创建 PTY 会话:', { sessionId, cwd, rows, cols });

        await api.createPtySession(
          sessionId,
          cwd || undefined,
          rows,
          cols,
          undefined
        );

        // 标记为已创建
        const s = this.sessions.get(sessionId);
        if (s) {
          s.created = true;
          s.creationPromise = null;
        }

        console.log('[PtyManager] PTY 会话创建成功:', sessionId);
      } catch (error) {
        console.error('[PtyManager] PTY 会话创建失败:', sessionId, error);
        this.sessions.delete(sessionId);
        throw error;
      }
    })();

    // 保存会话信息
    this.sessions.set(sessionId, {
      created: false,
      creationPromise,
      cwd,
      rows,
      cols,
      listeners: new Set(),
    });

    await creationPromise;
  }

  /**
   * 调整 PTY 尺寸
   */
  async resize(sessionId: string, rows: number, cols: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.created) {
      console.warn('[PtyManager] PTY 会话不存在或未创建，跳过 resize:', sessionId);
      return;
    }

    try {
      await api.resizePty(sessionId, rows, cols);
      session.rows = rows;
      session.cols = cols;
      console.log('[PtyManager] PTY 尺寸已调整:', { sessionId, rows, cols });
    } catch (error) {
      console.error('[PtyManager] PTY 尺寸调整失败:', sessionId, error);
    }
  }

  /**
   * 关闭 PTY 会话
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn('[PtyManager] PTY 会话不存在:', sessionId);
      return;
    }

    try {
      console.log('[PtyManager] 关闭 PTY 会话:', sessionId);
      await api.closePtySession(sessionId);
      this.sessions.delete(sessionId);
    } catch (error) {
      console.error('[PtyManager] PTY 会话关闭失败:', sessionId, error);
      // 即使失败也从管理器中移除
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 注册监听器
   */
  registerListener(sessionId: string, listenerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.add(listenerId);
      console.log('[PtyManager] 注册监听器:', { sessionId, listenerId, count: session.listeners.size });
    }
  }

  /**
   * 注销监听器
   */
  unregisterListener(sessionId: string, listenerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.delete(listenerId);
      console.log('[PtyManager] 注销监听器:', { sessionId, listenerId, count: session.listeners.size });
    }
  }

  /**
   * 获取监听器数量
   */
  getListenerCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.listeners.size || 0;
  }

  /**
   * 检查会话是否存在
   */
  has(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.created || false;
  }

  /**
   * 清理所有会话
   */
  async clear(): Promise<void> {
    console.log('[PtyManager] 清理所有会话');
    const promises = Array.from(this.sessions.keys()).map(id => this.close(id));
    await Promise.allSettled(promises);
  }
}

// 全局单例
const ptySessionManager = new PtySessionManager();

interface UsePtySessionOptions {
  sessionId: string;
  workspaceId: string;
  cwd?: string;
  terminal: Terminal | null | undefined;
  rows: number;
  cols: number;
  onExit?: () => void;
}

/**
 * PTY 会话管理 Hook
 */
export function usePtySession(options: UsePtySessionOptions) {
  const {
    sessionId,
    workspaceId,
    cwd,
    terminal,
    rows,
    cols,
    onExit,
  } = options;

  const initializedRef = useRef(false);
  const dataHandlerRef = useRef<((data: string) => Promise<void>) | null>(null);
  const listenerIdRef = useRef<string>(`${workspaceId}::${sessionId}::${Date.now()}`);
  const inputDisposableRef = useRef<any>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  console.log('[usePtySession] Hook 调用:', { sessionId, workspaceId, terminalExists: !!terminal, initialized: initializedRef.current });

  // 统一的初始化流程：先设置监听器，再创建 PTY 会话
  useEffect(() => {
    console.log('[usePtySession] useEffect 触发:', { sessionId, terminalExists: !!terminal, initialized: initializedRef.current });
    if (!terminal || initializedRef.current) return;

    const init = async () => {
      try {
        console.log('[usePtySession] 开始初始化:', sessionId);

        // 1. 先设置 PTY 输出监听器（必须在 PTY 创建之前）
        const listenerId = listenerIdRef.current;
        ptySessionManager.registerListener(sessionId, listenerId);

        // 使用 EventsOn 返回的 unsubscribe 函数来只移除当前组件的监听器
        // 避免使用 EventsOff 移除所有 pty-output 监听器
        const unsubscribe = EventsOn('pty-output', (payload: any) => {
          const { session_id, output_type, content } = payload;

          // 只处理当前会话的输出
          if (session_id !== sessionId) return;

          // 确保 Terminal 实例仍然有效
          if (!terminal) return;

          try {
            if (output_type === 'stdout' || output_type === 'stderr') {
              console.log('[usePtySession] 收到输出:', content.substring(0, 50));
              terminal.write(content);
            } else if (output_type === 'exit') {
              terminal.writeln('\x1b[1;33m\r\nProcess exited\x1b[0m');
              onExit?.();
            }
          } catch (error) {
            console.error('[usePtySession] 写入 Terminal 失败:', error);
          }
        });
        unsubscribeRef.current = unsubscribe;

        console.log('[usePtySession] PTY 输出监听器已设置:', { sessionId, listenerId });

        // 2. 设置输入处理器
        const handleData = async (data: string) => {
          try {
            await api.writeToPty(sessionId, data);
          } catch (error) {
            console.error('[usePtySession] 写入 PTY 失败:', error);
          }
        };

        dataHandlerRef.current = handleData;
        inputDisposableRef.current = terminal.onData(handleData);

        // 3. 最后创建 PTY 会话（此时监听器已就绪）
        const dims = terminal.rows && terminal.cols
          ? { rows: terminal.rows, cols: terminal.cols }
          : { rows, cols };

        console.log('[usePtySession] 创建 PTY 会话:', { sessionId, dims });
        await ptySessionManager.getOrCreate(sessionId, cwd, dims.rows, dims.cols);

        initializedRef.current = true;
        console.log('[usePtySession] PTY 会话初始化完成:', sessionId);
      } catch (error) {
        console.error('[usePtySession] PTY 会话初始化失败:', error);
        terminal?.writeln('\x1b[1;31mError: Failed to create PTY session\x1b[0m');
      }
    };

    init();

    return () => {
      console.log('[usePtySession] 清理 PTY 会话:', sessionId);
      // 使用 unsubscribe 函数只移除当前组件的监听器，而不是移除所有 pty-output 监听器
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      dataHandlerRef.current = null;
      const listenerId = listenerIdRef.current;
      ptySessionManager.unregisterListener(sessionId, listenerId);
    };
  }, [sessionId, cwd, terminal, rows, cols, onExit]);

  // 处理尺寸变化
  useEffect(() => {
    if (!terminal || !initializedRef.current) return;

    const handleResize = async () => {
      if (terminal.rows && terminal.cols) {
        await ptySessionManager.resize(sessionId, terminal.rows, terminal.cols);
      }
    };

    // 初始调整（在 PTY 创建后）
    handleResize();

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    // 找到 Terminal 的容器元素
    const container = (terminal as any).element?.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    // 监听窗口尺寸变化
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [sessionId, terminal, initializedRef.current]);

  return {
    isReady: initializedRef.current,
    sessionId,
  };
}

// 导出管理器以供其他地方使用
export { ptySessionManager };
