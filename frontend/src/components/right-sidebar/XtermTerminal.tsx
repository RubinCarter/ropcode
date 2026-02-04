import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';
import { useTerminalInstance, terminalManager } from '@/hooks/useTerminalInstance';
import { usePtySession } from '@/hooks/usePtySession';
import { useThemeContext } from '@/contexts/ThemeContext';
import type { TermWrap } from '@/widgets/terminal/TermWrap';

/**
 * 将 CSS 颜色值转换为 hex 格式
 * xterm.js 不支持 oklch 等现代颜色格式，需要转换
 */
function cssColorToHex(cssColor: string): string {
  // 创建临时元素来解析颜色
  const tempEl = document.createElement('div');
  tempEl.style.color = cssColor;
  document.body.appendChild(tempEl);
  const computedColor = getComputedStyle(tempEl).color;
  document.body.removeChild(tempEl);

  // 解析 rgb/rgba 格式
  const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // 如果解析失败，返回原值
  return cssColor;
}

interface XtermTerminalProps {
  sessionId: string;
  workspaceId: string;
  cwd?: string;
  onExit?: () => void;
  className?: string;
  isActive: boolean;
}

/**
 * XtermTerminal 组件
 *
 * 使用 TermWrap 管理终端实例
 */
export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  sessionId,
  workspaceId,
  cwd,
  onExit,
  className,
  isActive
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme, systemTheme, customColors } = useThemeContext();
  const [attachedTermWrap, setAttachedTermWrap] = useState<TermWrap | null>(null);

  // 获取 manager key
  const { managerKey } = useTerminalInstance(workspaceId, sessionId);

  // 附加 Terminal 到容器，创建 TermWrap
  useEffect(() => {
    if (!containerRef.current) return;

    const termWrap = terminalManager.attach(managerKey, containerRef.current);
    setAttachedTermWrap(termWrap);

    if (termWrap) {
      // 附加后尝试延迟适配
      const tryFit = () => {
        try {
          termWrap.fit();
          const terminal = termWrap.getTerminal();
          if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1);
          }
        } catch (err) {
          // Fit error is expected when container is not yet visible
        }
      };
      requestAnimationFrame(tryFit);
      setTimeout(tryFit, 50);
    }
  }, [managerKey, sessionId, workspaceId]);

  // 获取 terminal 实例供 PTY 使用
  const terminal = attachedTermWrap?.getTerminal() || null;

  // PTY 会话管理
  const { isReady } = usePtySession({
    sessionId,
    workspaceId,
    cwd,
    terminal,
    rows: 24,
    cols: 80,
    onExit,
  });

  // 应用主题背景色到 Terminal
  useEffect(() => {
    if (!attachedTermWrap || !containerRef.current) return;

    const applyTheme = () => {
      const terminal = attachedTermWrap.getTerminal();

      // 从 CSS 变量获取当前主题的背景色和前景色
      // 注意：CSS 变量使用 oklch 格式，但 xterm.js 不支持，需要转换为 hex
      const styles = getComputedStyle(document.documentElement);
      const rawBackground = styles.getPropertyValue('--color-background').trim() || '#1e1e1e';
      const rawForeground = styles.getPropertyValue('--color-foreground').trim() || '#d4d4d4';
      const background = cssColorToHex(rawBackground);
      const foreground = cssColorToHex(rawForeground);

      // 判断是否为浅色主题（基于实际应用的 CSS 类）
      const rootClasses = document.documentElement.classList;
      const isLightTheme = rootClasses.contains('theme-light');

      let selectionBackground: string;
      let selectionInactiveBackground: string;

      if (isLightTheme) {
        selectionBackground = 'rgba(59, 130, 246, 0.3)';
        selectionInactiveBackground = 'rgba(59, 130, 246, 0.15)';
      } else {
        selectionBackground = 'rgba(255, 255, 255, 0.25)';
        selectionInactiveBackground = 'rgba(255, 255, 255, 0.12)';
      }

      try {
        terminal.options.theme = {
          background,
          foreground,
          selectionBackground,
          selectionForeground: undefined,
          selectionInactiveBackground,
        };

        if (containerRef.current) {
          containerRef.current.style.backgroundColor = background;
        }

        const termEl = (terminal as any).element as HTMLElement | null;
        if (termEl) {
          termEl.style.backgroundColor = background;
          const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null;
          if (viewport) viewport.style.backgroundColor = background;
        }

        if (terminal.rows > 0) {
          terminal.refresh(0, terminal.rows - 1);
        }
      } catch (err) {
        // Theme application may fail
      }
    };

    // 延迟执行以确保 CSS 变量已更新
    requestAnimationFrame(() => {
      applyTheme();
    });
  }, [attachedTermWrap, theme, systemTheme, customColors]);

  // 当变为活动时，重新 fit
  useEffect(() => {
    if (isActive && attachedTermWrap && containerRef.current) {
      requestAnimationFrame(() => {
        try {
          attachedTermWrap.fit();
          const terminal = attachedTermWrap.getTerminal();
          if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1);
          }
        } catch (error) {
          // Fit errors are expected
        }
      });
    }
  }, [isActive, attachedTermWrap, sessionId]);

  // 监听窗口尺寸变化
  useEffect(() => {
    if (!attachedTermWrap || !isActive) return;

    const handleResize = () => {
      if (containerRef.current && containerRef.current.offsetWidth > 0) {
        try {
          attachedTermWrap.fit();
        } catch (error) {
          // Resize fit errors are expected
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', handleResize);
    const onVisible = () => handleResize();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attachedTermWrap, isActive]);

  return (
    <div
      ref={containerRef}
      className={cn(
        className,
        isActive ? "z-10" : "opacity-0 pointer-events-none z-0"
      )}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
      data-terminal-id={sessionId}
      data-workspace-id={workspaceId}
      data-ready={isReady}
      data-active={isActive}
    />
  );
};
