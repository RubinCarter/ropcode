import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';
import { useTerminalInstance, terminalManager } from '@/hooks/useTerminalInstance';
import { usePtySession } from '@/hooks/usePtySession';
import { useThemeContext } from '@/contexts/ThemeContext';
import type { TermWrap } from '@/widgets/terminal/TermWrap';

/**
 * Convert CSS color values to hex format
 * xterm.js does not support modern color formats like oklch, conversion needed
 */
function cssColorToHex(cssColor: string): string {
  // Create temp element to parse color
  const tempEl = document.createElement('div');
  tempEl.style.color = cssColor;
  document.body.appendChild(tempEl);
  const computedColor = getComputedStyle(tempEl).color;
  document.body.removeChild(tempEl);

  // Parse rgb/rgba format
  const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // If parse fails, return original value
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
 * XtermTerminal component
 *
 * using TermWrap manageterminalinstance
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

  // Get manager key
  const { managerKey } = useTerminalInstance(workspaceId, sessionId);

  // Attach Terminal to container, create TermWrap
  useEffect(() => {
    if (!containerRef.current) return;

    const termWrap = terminalManager.attach(managerKey, containerRef.current);
    setAttachedTermWrap(termWrap);

    if (termWrap) {
      // Try delayed fit after attach
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

  // Get terminal instance for PTY use
  const terminal = attachedTermWrap?.getTerminal() || null;

  // PTY session management
  const { isReady } = usePtySession({
    sessionId,
    workspaceId,
    cwd,
    terminal,
    rows: 24,
    cols: 80,
    onExit,
  });

  // Apply theme background color to Terminal
  useEffect(() => {
    if (!attachedTermWrap || !containerRef.current) return;

    const applyTheme = () => {
      const terminal = attachedTermWrap.getTerminal();

      // Get current theme bg/fg colors from CSS variables
      // Note: CSS vars use oklch format but xterm.js needs hex conversion
      const styles = getComputedStyle(document.documentElement);
      const rawBackground = styles.getPropertyValue('--color-background').trim() || '#1e1e1e';
      const rawForeground = styles.getPropertyValue('--color-foreground').trim() || '#d4d4d4';
      const background = cssColorToHex(rawBackground);
      const foreground = cssColorToHex(rawForeground);

      // Determine if light theme (based on applied CSS classes)
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

    // Delay execution to ensure CSS variables are updated
    requestAnimationFrame(() => {
      applyTheme();
    });
  }, [attachedTermWrap, theme, systemTheme, customColors]);

  // Re-fit when becoming active
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

  // Listen for window size changes
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

    let resizeRaf: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          handleResize();
        });
      }
    });
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
