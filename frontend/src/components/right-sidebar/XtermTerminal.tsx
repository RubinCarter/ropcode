import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';
import { useTerminalInstance, terminalManager } from '@/hooks/useTerminalInstance';
import { usePtySession } from '@/hooks/usePtySession';
import { useThemeContext } from '@/contexts/ThemeContext';

interface XtermTerminalProps {
  sessionId: string;
  workspaceId: string;
  cwd?: string;
  onExit?: () => void;
  className?: string;
  isActive: boolean;  // 新增：是否为活动终端
}

/**
 * XtermTerminal 组件 - Linus 简化版
 *
 * 核心原则：
 * 1. Terminal 实例通过全局管理器管理（保持状态）
 * 2. DOM 附加使用简单的 useEffect
 * 3. 显示/隐藏用简单的 CSS class
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

  // 获取或创建 Terminal 实例
  const { terminal, fitAddon, managerKey } = useTerminalInstance(workspaceId, sessionId);

  // 简单：直接在 useEffect 中附加（只在 terminal 实例创建时执行一次）
  useEffect(() => {
    if (!terminal || !containerRef.current) return;

    try {
      terminalManager.attach(managerKey, containerRef.current);

      // 附加后尝试延迟适配与刷新，覆盖容器可见性抖动
      const tryFit = () => {
        if (!fitAddon) return;
        try {
          fitAddon.fit();
          if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1);
          }
        } catch (err) {
          // Fit error is expected when container is not yet visible
        }
      };
      requestAnimationFrame(tryFit);
      setTimeout(tryFit, 50);
    } catch (error) {
      // Attach may fail if already attached, which is expected
    }
  }, [terminal, managerKey, sessionId, workspaceId]);

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
    if (!terminal || !containerRef.current) return;

    // 从 CSS 变量获取当前主题的背景色和前景色
    const styles = getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue('--color-background').trim() || '#1e1e1e';
    const foreground = styles.getPropertyValue('--color-foreground').trim() || '#d4d4d4';

    // 智能判断主题类型，为每种主题提供最佳的选择高亮颜色
    // 支持 dark, gray, light, system, custom 五种主题
    let selectionBackground: string;
    let selectionInactiveBackground: string;

    if (theme === 'light') {
      // 浅色主题：使用蓝色高亮，提供良好的视觉反馈
      selectionBackground = 'rgba(59, 130, 246, 0.3)';
      selectionInactiveBackground = 'rgba(59, 130, 246, 0.15)';
    } else if (theme === 'dark') {
      // 深色主题（背景亮度 0.10）：使用较强的白色高亮
      selectionBackground = 'rgba(255, 255, 255, 0.3)';
      selectionInactiveBackground = 'rgba(255, 255, 255, 0.15)';
    } else if (theme === 'gray') {
      // 灰色主题（背景亮度 0.18）：使用稍弱的白色高亮以适配中等亮度背景
      selectionBackground = 'rgba(255, 255, 255, 0.25)';
      selectionInactiveBackground = 'rgba(255, 255, 255, 0.12)';
    } else if (theme === 'system') {
      // 系统主题：根据实际应用的主题类（gray 或 light）动态判断
      const rootClasses = document.documentElement.classList;
      if (rootClasses.contains('theme-light')) {
        selectionBackground = 'rgba(59, 130, 246, 0.3)';
        selectionInactiveBackground = 'rgba(59, 130, 246, 0.15)';
      } else {
        // system 主题在深色模式下使用 gray
        selectionBackground = 'rgba(255, 255, 255, 0.25)';
        selectionInactiveBackground = 'rgba(255, 255, 255, 0.12)';
      }
    } else {
      // 自定义主题：根据背景色亮度智能选择
      // 解析 OKLCH 颜色获取亮度值
      const oklchMatch = background.match(/oklch\(([\d.]+)/);
      const lightness = oklchMatch ? parseFloat(oklchMatch[1]) : 0.5;

      if (lightness > 0.6) {
        // 亮色背景：使用蓝色高亮
        selectionBackground = 'rgba(59, 130, 246, 0.3)';
        selectionInactiveBackground = 'rgba(59, 130, 246, 0.15)';
      } else {
        // 暗色背景：使用白色高亮，透明度根据亮度调整
        const activeOpacity = lightness < 0.15 ? 0.3 : 0.25;
        const inactiveOpacity = lightness < 0.15 ? 0.15 : 0.12;
        selectionBackground = `rgba(255, 255, 255, ${activeOpacity})`;
        selectionInactiveBackground = `rgba(255, 255, 255, ${inactiveOpacity})`;
      }
    }

    try {
      // 设置 xterm 主题背景和前景色
      terminal.options.theme = {
        background,
        foreground,
        // 设置选中文本的高亮颜色 - 根据主题智能选择最佳颜色
        selectionBackground,
        selectionForeground: undefined, // 保持文字原色，确保可读性
        selectionInactiveBackground,
      };

      // 设置容器背景色
      containerRef.current.style.backgroundColor = background;

      // 设置 xterm DOM 元素背景色
      const termEl = (terminal as any).element as HTMLElement | null;
      if (termEl) {
        termEl.style.backgroundColor = background;
        const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null;
        if (viewport) viewport.style.backgroundColor = background;
      }

      // 触发重绘
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
    } catch (err) {
      // Theme application may fail, which is expected in some cases
    }
  }, [terminal, theme, systemTheme, customColors]);

  // 当变为活动时，重新 fit
  useEffect(() => {
    if (isActive && terminal && fitAddon && containerRef.current) {
      // 使用 RAF 确保容器已可见
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1);
          }
        } catch (error) {
          // Fit errors are expected in some edge cases
        }
      });
    }
  }, [isActive, terminal, fitAddon, sessionId]);

  // 监听窗口尺寸变化
  useEffect(() => {
    if (!terminal || !fitAddon || !isActive) return;

    const handleResize = () => {
      if (containerRef.current && containerRef.current.offsetWidth > 0) {
        try {
          fitAddon.fit();
        } catch (error) {
          // Resize fit errors are expected during rapid size changes
        }
      }
    };

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // 监听窗口尺寸变化
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
  }, [terminal, fitAddon, isActive]);

  return (
    <div
      ref={containerRef}
      className={cn(
        className,
        // 仅活动终端可见且可交互，避免 invisible 叠层造成的渲染问题
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
