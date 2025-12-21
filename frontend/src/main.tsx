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

// Initialize analytics before rendering
analytics.initialize();

// Start resource monitoring (check every 2 minutes)
resourceMonitor.startMonitoring(120000);

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
