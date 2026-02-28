import "@/lib/debug-log"; // must be first — patches console before anything logs
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AnalyticsErrorBoundary } from "./components/AnalyticsErrorBoundary";
import { analytics, resourceMonitor } from "./lib/analytics";
import { PostHogProvider } from "posthog-js/react";
import "./assets/shimmer.css";
import "./styles.css";
import AppIcon from "./assets/nfo/asterisk-logo.png";

// Monaco Editor Web Worker 配置
// 使用 Vite 的 ?worker 导入语法来正确打包 worker
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// Handle uncaught promise rejections gracefully
window.addEventListener('unhandledrejection', (event) => {
  // Log the error but prevent it from showing as "uncaught" in console
  console.error('[UnhandledRejection]', event.reason);
  event.preventDefault();
});

// Initialize analytics before rendering
analytics.initialize();

// Start resource monitoring (check every 2 minutes)
resourceMonitor.startMonitoring(120000);

// Lock the app height using window.innerHeight on load.
// On mobile browsers, 100vh includes the URL bar, causing content to be hidden.
// window.innerHeight gives the actual visible area.
//
// iOS Safari keyboard handling:
//   - window.innerHeight does NOT change when iOS keyboard opens
//   - visualViewport.height DOES change (e.g. 695 → 331)
//   - iOS auto-scrolls the page upward, creating a blank gap
//   - Fix: on mobile, continuously sync --app-height with visualViewport.height
//     and lock html/body with position:fixed to prevent iOS scroll
(() => {
  const isMobile = window.innerWidth < 768;
  const initialHeight = window.innerHeight;

  const setAppHeight = (h: number) => {
    document.documentElement.style.setProperty('--app-height', `${h}px`);
  };
  setAppHeight(initialHeight);

  // Update on orientation change
  window.addEventListener('orientationchange', () => {
    setTimeout(() => setAppHeight(window.innerHeight), 100);
  });

  // Desktop: update on any resize (window drag, DevTools, etc.)
  // Mobile: only on width change (keyboard changes height, handled by visualViewport)
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (isMobile) {
      // Mobile: only update on width change (orientation); keyboard is handled by vv
      if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        setAppHeight(window.innerHeight);
      }
    } else {
      // Desktop: always update on resize
      setAppHeight(window.innerHeight);
    }
  });

  // Mobile: continuously sync --app-height with visualViewport.height
  // This handles keyboard open, close, and the iOS "Done" button edge case
  // where vv.height may or may not recover after keyboard dismiss.
  if (isMobile && window.visualViewport) {
    const vv = window.visualViewport;
    const KEYBOARD_THRESHOLD = 100;

    const syncHeight = () => {
      const h = vv.height;
      setAppHeight(h);
      // Detect keyboard state for CSS position:fixed lock
      const isKeyboard = (initialHeight - h) > KEYBOARD_THRESHOLD;
      document.documentElement.classList.toggle('keyboard-open', isKeyboard);
      // Prevent iOS viewport scroll
      window.scrollTo(0, 0);
    };

    vv.addEventListener('resize', syncHeight);

    // Also periodically sync to catch edge cases where resize doesn't fire
    // (e.g. iOS "Done" button dismissing keyboard without resize event)
    setInterval(() => {
      const currentAppH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--app-height')
      ) || 0;
      const diff = Math.abs(currentAppH - vv.height);
      // Only update if there's a meaningful difference (>5px avoids jitter)
      if (diff > 5) {
        syncHeight();
      }
    }, 500);
  }
})();

// Add a macOS-specific class to the <html> element to enable platform-specific styling
// Browser-safe detection using navigator properties (works in Tauri and web preview)
(() => {
  const isMacLike = typeof navigator !== "undefined" &&
    (navigator.platform?.toLowerCase().includes("mac") ||
      navigator.userAgent?.toLowerCase().includes("mac os x"));
  if (isMacLike) {
    document.documentElement.classList.add("is-macos");
  }
})();

// Set favicon to the new app icon (avoids needing /public)
(() => {
  try {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const link = existing ?? document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = AppIcon;
    if (!existing) {
      document.head.appendChild(link);
    }
  } catch (_) {
    // Non-fatal if document/head is not available
  }
})();

// Only use PostHogProvider if API key is configured
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const AppWithProviders = posthogKey ? (
  <PostHogProvider
    apiKey={posthogKey}
    options={{
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
      defaults: '2025-05-24',
      capture_exceptions: true,
      debug: import.meta.env.MODE === "development",
    }}
  >
    <ErrorBoundary>
      <AnalyticsErrorBoundary>
        <App />
      </AnalyticsErrorBoundary>
    </ErrorBoundary>
  </PostHogProvider>
) : (
  <ErrorBoundary>
    <AnalyticsErrorBoundary>
      <App />
    </AnalyticsErrorBoundary>
  </ErrorBoundary>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {AppWithProviders}
  </React.StrictMode>,
);
