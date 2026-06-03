import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';
import { useTerminalInstance, terminalManager } from '@/hooks/useTerminalInstance';
import { useThemeContext } from '@/contexts/ThemeContext';
import type { PtyShellState, PtyTermWrap } from '@/widgets/terminal/PtyTermWrap';
import { api } from '@/lib/api';
import { EventsOn } from '@/lib/rpc-events';

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
  className?: string;
  isActive: boolean;
  onShellStateChange?: (state: PtyShellState) => void;
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
  className,
  isActive,
  onShellStateChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellStateChangeRef = useRef<typeof onShellStateChange>(onShellStateChange);
  const { theme, systemTheme, customColors } = useThemeContext();
  const [attachedTermWrap, setAttachedTermWrap] = useState<PtyTermWrap | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Get manager key
  const { managerKey } = useTerminalInstance(workspaceId, sessionId);

  useEffect(() => {
    shellStateChangeRef.current = onShellStateChange;
    attachedTermWrap?.setShellStateChangeHandler(onShellStateChange);
  }, [attachedTermWrap, onShellStateChange]);

  // Attach Terminal to container, create TermWrap
  useEffect(() => {
    if (!containerRef.current) return;

    const termWrap = terminalManager.attach(managerKey, containerRef.current, sessionId, (state) => {
      shellStateChangeRef.current?.(state);
    });
    setAttachedTermWrap(termWrap);

    if (termWrap) {
      // Try delayed fit after attach
      const tryFit = () => {
        try {
          termWrap.fitAndReport();
          termWrap.refresh();
        } catch (err) {
          // Fit error is expected when container is not yet visible
        }
      };
      requestAnimationFrame(tryFit);
      setTimeout(tryFit, 50);
    }

    return () => {
      terminalManager.detach(managerKey);
      setAttachedTermWrap((current) => (current === termWrap ? null : current));
    };
  }, [managerKey, sessionId, workspaceId]);

  useEffect(() => {
    if (!attachedTermWrap) return;
    let cancelled = false;
    const readyUnsubscribe = EventsOn('pty-ready', (payload: { session_id: string; success: boolean; error?: string }) => {
      if (payload.session_id !== sessionId) return;
      if (payload.success) {
        setIsReady(true);
      } else {
        attachedTermWrap.terminal.writeln(`\x1b[1;31mError: ${payload.error || 'Failed to start PTY'}\x1b[0m`);
      }
    });

    const create = async () => {
      try {
        const dims = attachedTermWrap.getDimensions();
        const alive = await api.isPtySessionAlive(sessionId);
        if (!alive) {
          await api.createPtySession(
            sessionId,
            cwd || undefined,
            dims.rows || 24,
            dims.cols || 80,
            undefined,
          );
        }
        if (!cancelled) {
          setIsReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          attachedTermWrap.terminal.writeln('\x1b[1;31mError: Failed to create PTY session\x1b[0m');
        }
      }
    };

    create();

    return () => {
      cancelled = true;
      readyUnsubscribe();
    };
  }, [attachedTermWrap, cwd, sessionId]);

  // Apply theme background color to Terminal
  useEffect(() => {
    if (!attachedTermWrap || !containerRef.current) return;

    const applyTheme = () => {
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
        attachedTermWrap.setTheme({
          background,
          foreground,
          selectionBackground,
          selectionInactiveBackground,
        });
        attachedTermWrap.refresh();
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
          attachedTermWrap.fitAndReport();
          attachedTermWrap.refresh();
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
        attachedTermWrap.scheduleFit();
      }
    };

    window.addEventListener('resize', handleResize);
    const onVisible = () => handleResize();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
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
