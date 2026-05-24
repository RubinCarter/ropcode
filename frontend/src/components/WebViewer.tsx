import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Globe, RefreshCw, Copy, MousePointerClick, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { convertFileSrc } from '@/lib/file-utils';
import { parentPath, resolveWorkspacePath } from '@/lib/pathUtils';
import { useWebStore } from '@/widgets/web/WebModel';

interface WebViewerProps {
  url: string;
  workspacePath?: string; // Workspace path for resolving relative URLs
  className?: string;
  onUrlChange?: (newUrl: string) => void;
}

interface SelectedElement {
  tagName: string;
  innerText: string;
  outerHTML: string;
  selector: string;
  url: string;
}

/**
 * Check if URL is a local file path
 */
function isLocalFile(url: string): boolean {
  return !url.startsWith('http://') && !url.startsWith('https://');
}

/**
 * Resolve relative path to absolute path
 */
function resolveFilePath(url: string, workspacePath?: string): string {
  if (!isLocalFile(url)) {
    return url;
  }

  return resolveWorkspacePath(url, workspacePath);
}

/**
 * Process URL, use convertFileSrc for local files
 */
async function processUrl(
  url: string,
  workspacePath?: string,
  setSrcdoc?: (content: string | null) => void
): Promise<string> {
  if (isLocalFile(url)) {
    try {
      // First resolve relative path
      const absolutePath = resolveFilePath(url, workspacePath);

      // If HTML file, read content and inject script
      if (absolutePath.toLowerCase().endsWith('.html') || absolutePath.toLowerCase().endsWith('.htm')) {
        try {
          console.log('[WebViewer] Reading local HTML file:', absolutePath);

          // Use fetch via asset:// protocol to read file
          const assetUrl = convertFileSrc(absolutePath);
          console.log('[WebViewer] Fetching from:', assetUrl);

          const response = await fetch(assetUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const content = await response.text();
          console.log('[WebViewer] Successfully read HTML file, length:', content.length);

          // Get file directory for setting base href
          const baseHref = convertFileSrc(parentPath(absolutePath) + '/');

          // Inject element selector script and base tag
          const scriptTag = `<script>${getElementSelectorScript()}</script>`;
          const baseTag = `<base href="${baseHref}">`;
          let modifiedContent = content;

          // Try injecting before </head> (base tag first, then script)
          if (content.includes('</head>')) {
            modifiedContent = content.replace('</head>', `${baseTag}${scriptTag}</head>`);
          }
          // If no head, try injecting after <body>
          else if (content.includes('<body')) {
            modifiedContent = content.replace(/<body([^>]*)>/, `<head>${baseTag}${scriptTag}</head><body$1>`);
          }
          // If neither exists, inject at the beginning
          else {
            modifiedContent = `<head>${baseTag}${scriptTag}</head>` + content;
          }

          console.log('[WebViewer] Script and base tag injected into HTML content');

          if (setSrcdoc) {
            setSrcdoc(modifiedContent);
          }

          // Return special marker indicating srcdoc usage
          return 'use-srcdoc';
        } catch (error) {
          console.error('[WebViewer] Failed to read HTML file, falling back to convertFileSrc:', error);
          if (setSrcdoc) {
            setSrcdoc(null);
          }
        }
      }

      // For non-HTML files or read failures, use convertFileSrc
      if (setSrcdoc) {
        setSrcdoc(null);
      }
      return convertFileSrc(absolutePath);
    } catch (error) {
      console.error('Failed to convert local file path:', error);
      if (setSrcdoc) {
        setSrcdoc(null);
      }
      return url;
    }
  }

  // Remote URLs need no special processing
  if (setSrcdoc) {
    setSrcdoc(null);
  }
  return url;
}

/**
 * Generate element selector injection script
 * This script runs inside the iframe to enable element highlighting and selection
 */
function getElementSelectorScript(): string {
  return `
    (function() {
      // Prevent duplicate injection
      if (window.__elementSelectorInjected) return;
      window.__elementSelectorInjected = true;

      let isSelecting = false;
      let currentHighlight = null;

      // Create highlight overlay
      function createHighlightOverlay() {
        const overlay = document.createElement('div');
        overlay.id = '__element-selector-overlay';
        overlay.style.cssText = \`
          position: fixed;
          background: rgba(59, 130, 246, 0.2);
          border: 2px solid rgb(59, 130, 246);
          pointer-events: none;
          z-index: 2147483647;
          transition: all 0.1s ease;
          box-sizing: border-box;
        \`;
        document.body.appendChild(overlay);
        return overlay;
      }

      // Generate unique CSS selector
      function getUniqueSelector(element) {
        if (element.id) {
          return '#' + element.id;
        }

        const path = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
          let selector = element.nodeName.toLowerCase();

          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) {
              selector += '.' + classes.slice(0, 2).join('.');
            }
          }

          let sibling = element;
          let nth = 1;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.nodeName === element.nodeName) nth++;
          }

          if (nth > 1) {
            selector += ':nth-of-type(' + nth + ')';
          }

          path.unshift(selector);
          element = element.parentElement;

          if (path.length > 3) break;
        }

        return path.join(' > ');
      }

      // Highlight element
      function highlightElement(element) {
        if (!currentHighlight) {
          currentHighlight = createHighlightOverlay();
        }

        const rect = element.getBoundingClientRect();
        // Use fixed positioning with getBoundingClientRect values
        currentHighlight.style.left = rect.left + 'px';
        currentHighlight.style.top = rect.top + 'px';
        currentHighlight.style.width = rect.width + 'px';
        currentHighlight.style.height = rect.height + 'px';
        currentHighlight.style.display = 'block';
      }

      // Hide highlight
      function hideHighlight() {
        if (currentHighlight) {
          currentHighlight.style.display = 'none';
        }
      }

      // Mouse move event handler
      function handleMouseOver(e) {
        if (!isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target.id === '__element-selector-overlay') return;

        highlightElement(target);
      }

      // Mouse out event handler
      function handleMouseOut(e) {
        if (!isSelecting) return;
        // Don't hide, keep highlight until next element
      }

      // Click event handler
      function handleClick(e) {
        if (!isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target.id === '__element-selector-overlay') return;

        // Extract element info
        const elementInfo = {
          tagName: target.tagName,
          innerText: target.innerText?.substring(0, 500) || '',
          outerHTML: target.outerHTML?.substring(0, 2000) || '',
          selector: getUniqueSelector(target),
          url: window.location.href
        };

        // Send message to parent window
        window.parent.postMessage({
          type: 'element-selected',
          data: elementInfo
        }, '*');

        // Stop selection mode
        stopSelection();
      }

      // Start selection mode
      function startSelection() {
        isSelecting = true;
        document.body.style.cursor = 'crosshair';
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('click', handleClick, true);
      }

      // Stop selection mode
      function stopSelection() {
        isSelecting = false;
        document.body.style.cursor = '';
        hideHighlight();
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleClick, true);
      }

      // Listen for messages from parent window
      window.addEventListener('message', function(event) {
        if (event.data.type === 'start-element-selection') {
          startSelection();
        } else if (event.data.type === 'stop-element-selection') {
          stopSelection();
        } else if (event.data.type === 'ping-element-selector') {
          // Respond to ping, confirm script is injected
          window.parent.postMessage({
            type: 'element-selector-ready'
          }, '*');
        }
      });

      console.log('[ElementSelector] Script injected successfully');

      // Proactively notify parent that script is ready
      window.parent.postMessage({
        type: 'element-selector-ready'
      }, '*');
    })();
  `;
}

/**
 * WebViewer component - displays web content via iframe
 *
 * Features:
 * - Display web content for a given URL
 * - Support local files and remote URLs
 * - URL input and refresh button
 * - Loading state and error handling
  */
export const WebViewer: React.FC<WebViewerProps> = ({
  url,
  workspacePath,
  className,
  onUrlChange,
}) => {
  // Use store for UI state management
  const storeUrl = useWebStore((state) => state.url);
  const setStoreUrl = useWebStore((state) => state.setUrl);
  const isLoading = useWebStore((state) => state.isLoading);
  const setLoading = useWebStore((state) => state.setLoading);
  const storeError = useWebStore((state) => state.error);
  const setError = useWebStore((state) => state.setError);
  const title = useWebStore((state) => state.title);
  const setTitle = useWebStore((state) => state.setTitle);
  const storeReset = useWebStore((state) => state.reset);

  // Local state for component-specific data
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [inputUrl, setInputUrl] = useState(url);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Save original URL (for opening in external browser)
  const originalUrlRef = useRef<string>(url);
  // Element selection mode
  const [isSelectingElement, setIsSelectingElement] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  // User message input
  const [userMessage, setUserMessage] = useState('');
  // Script injection state
  const [isScriptInjected, setIsScriptInjected] = useState(false);
  // srcdoc content for local HTML files
  const [srcdocContent, setSrcdocContent] = useState<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      storeReset();
    };
  }, []);

  // Update state when external URL changes
  useEffect(() => {
    const updateUrl = async () => {
      originalUrlRef.current = url;
      setStoreUrl(url); // Update store URL
      const processedUrl = await processUrl(url, workspacePath, setSrcdocContent);
      setLoading(true);
      setError(null);
      setCurrentUrl(processedUrl);
      setInputUrl(url);
      setIframeKey(prev => prev + 1);
    };
    updateUrl();
  }, [url, workspacePath]);

  // Handle iframe load complete
  const handleIframeLoad = () => {
    setLoading(false);
    setError(null);

    // If using srcdoc, script is already in HTML, mark as injected
    if (srcdocContent) {
      console.log('[WebViewer] Using srcdoc, script pre-injected');
      setIsScriptInjected(true);
      return;
    }

    // Otherwise, reset state and try to inject script
    setIsScriptInjected(false);
    injectElementSelectorScript();
  };

  // Inject element selector script into iframe
  const injectElementSelectorScript = () => {
    if (!iframeRef.current) return;

    let retryCount = 0;
    const maxRetries = 3;

    const attemptInject = () => {
      try {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow) {
          console.warn('[WebViewer] No contentWindow available');
          setIsScriptInjected(false);
          return;
        }

        // Check if iframe document is accessible
        const doc = iframeWindow.document;
        if (!doc) {
          console.warn('[WebViewer] Cannot access iframe document');
          setIsScriptInjected(false);
          return;
        }

        // Ensure both head and body exist
        if (!doc.head || !doc.body) {
          console.warn('[WebViewer] Document not ready, retrying...', {
            hasHead: !!doc.head,
            hasBody: !!doc.body,
            retryCount
          });

          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptInject, 200 * retryCount); // Incremental delay
            return;
          } else {
            console.error('[WebViewer] Failed to inject after retries - DOM not ready');
            setIsScriptInjected(false);
            return;
          }
        }

        // Create and inject script tag
        const script = doc.createElement('script');
        script.textContent = getElementSelectorScript();
        doc.head.appendChild(script);

        console.log('[WebViewer] Element selector script injected successfully');

        // Send ping to verify script loaded successfully
        setTimeout(() => {
          if (!isScriptInjected && iframeRef.current?.contentWindow) {
            console.log('[WebViewer] Sending ping to verify script injection');
            try {
              iframeRef.current.contentWindow.postMessage({
                type: 'ping-element-selector'
              }, '*');
            } catch (e) {
              console.error('[WebViewer] Failed to send ping message:', e);
            }
          }
        }, 200);

        // Set timeout check
        setTimeout(() => {
          if (!isScriptInjected) {
            console.warn('[WebViewer] Script injection verification timeout');
            // For same-origin pages, timing issue possible even without confirmation, retry ping
            if (iframeRef.current?.contentWindow) {
              try {
                iframeRef.current.contentWindow.postMessage({
                  type: 'ping-element-selector'
                }, '*');
              } catch (e) {
                console.error('[WebViewer] Timeout ping failed:', e);
              }
            }
          }
        }, 500);

      } catch (err) {
        // Cross-origin restrictions may cause injection failure
        console.error('[WebViewer] Failed to inject element selector script:', err);
        setIsScriptInjected(false);

        // Only show warning for actual cross-origin errors
        if (err instanceof DOMException && err.name === 'SecurityError') {
          window.dispatchEvent(new CustomEvent('show-toast', {
            detail: {
              message: 'Element selector unavailable for cross-origin pages',
              type: 'warning'
            }
          }));
        }
      }
    };

    // Delay briefly before injection to ensure iframe is loaded
    setTimeout(attemptInject, 50);
  };

  // Handle iframe load error
  const handleIframeError = () => {
    setLoading(false);
    setError('Failed to load webpage. Please check the URL and try again.');
  };

  // Refresh page
  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    const processedUrl = await processUrl(inputUrl, workspacePath, setSrcdocContent);
    setCurrentUrl(processedUrl);
    setIframeKey(prev => prev + 1);
  };

  // Navigate to new URL
  const handleNavigate = async () => {
    const trimmedUrl = inputUrl.trim();
    if (!trimmedUrl) return;

    // Ensure remote URL has protocol prefix (keep local files as-is)
    let normalizedUrl = trimmedUrl;
    if (!isLocalFile(trimmedUrl) &&
        !trimmedUrl.startsWith('http://') &&
        !trimmedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + trimmedUrl;
    }

    setLoading(true);
    setError(null);

    originalUrlRef.current = normalizedUrl;
    const processedUrl = await processUrl(normalizedUrl, workspacePath, setSrcdocContent);
    setCurrentUrl(processedUrl);
    setIframeKey(prev => prev + 1);

    // Notify parent of URL change (use original URL, not processed)
    if (onUrlChange) {
      onUrlChange(normalizedUrl);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  };

  
  // Copy URL to clipboard
  const handleCopyUrl = async () => {
    try {
      const urlToCopy = originalUrlRef.current;
      await navigator.clipboard.writeText(urlToCopy);

      // Trigger success event, show toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'URL copied to clipboard', type: 'success' }
      }));
    } catch (error) {
      console.error('Failed to copy URL:', error);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'Failed to copy URL', type: 'error' }
      }));
    }
  };

  // Toggle element selection mode
  const toggleElementSelection = () => {
    if (!iframeRef.current?.contentWindow) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'Unable to access iframe content', type: 'error' }
      }));
      return;
    }

    // Check if script is injected
    if (!isScriptInjected) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Element selector not available. This may be due to cross-origin restrictions.',
          type: 'error'
        }
      }));
      return;
    }

    const newState = !isSelectingElement;
    setIsSelectingElement(newState);

    // Send message to iframe
    try {
      iframeRef.current.contentWindow.postMessage({
        type: newState ? 'start-element-selection' : 'stop-element-selection'
      }, '*');

      if (newState) {
        window.dispatchEvent(new CustomEvent('show-toast', {
          detail: { message: 'Click an element to select it', type: 'info' }
        }));
      }
    } catch (err) {
      console.error('[WebViewer] Failed to send message to iframe:', err);
    }
  };

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Filter out non-target messages
      if (!event.data || typeof event.data.type !== 'string') return;

      console.log('[WebViewer] Received message:', event.data.type, event.origin);

      if (event.data.type === 'element-selected') {
        const elementData = event.data.data as SelectedElement;
        console.log('[WebViewer] Element selected:', elementData);

        setSelectedElement(elementData);
        setIsSelectingElement(false);

        // Show success toast
        window.dispatchEvent(new CustomEvent('show-toast', {
          detail: { message: 'Element selected successfully', type: 'success' }
        }));
      } else if (event.data.type === 'element-selector-ready') {
        // Script injected and ready
        console.log('[WebViewer] ✓ Element selector script is ready and confirmed');
        setIsScriptInjected(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Toolbar */}
      <div className="px-4 py-2 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          {/* Icon */}
          <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />

          {/* URL input */}
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL (e.g., https://example.com)"
            className="flex-1 h-8 text-sm font-mono"
            spellCheck={false}
          />

          {/* Navigate button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNavigate}
            disabled={!inputUrl.trim() || isLoading}
            className="h-8 px-3"
          >
            Go
          </Button>

          {/* Refresh button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8 w-8 p-0"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </Button>

          {/* Copy URL button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopyUrl}
            className="h-8 w-8 p-0"
            title="Copy URL"
          >
            <Copy className="w-4 h-4" />
          </Button>

          {/* Element selector button */}
          <Button
            size="sm"
            variant={isSelectingElement ? "default" : "ghost"}
            onClick={toggleElementSelection}
            disabled={!isScriptInjected}
            className="h-8 w-8 p-0"
            title={
              !isScriptInjected
                ? "Element selector unavailable (cross-origin page)"
                : isSelectingElement
                ? "Cancel element selection"
                : "Select element"
            }
          >
            <MousePointerClick className={cn('w-4 h-4', isSelectingElement && 'text-primary-foreground')} />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative">
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex items-center gap-2 text-muted-foreground">
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-sm">Loading webpage...</span>
            </div>
          </div>
        )}

        {/* Error message */}
        {storeError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="text-center p-8 max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 text-red-500">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="text-sm font-medium mb-2 text-foreground">Failed to Load</div>
              <div className="text-xs text-muted-foreground mb-4">{storeError}</div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                className="mx-auto"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* iframe */}
        {currentUrl && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            {...(srcdocContent
              ? { srcDoc: srcdocContent }
              : { src: currentUrl }
            )}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            className="w-full h-full border-0"
            title="Web"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
            allow="fullscreen"
          />
        )}

        {/* Selected element preview and message input panel */}
        {selectedElement && (
          <div className="absolute bottom-0 left-0 right-0 bg-background border-t shadow-lg max-h-96 overflow-auto z-20">
            <div className="p-4 space-y-4">
              {/* Title bar */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Selected Element</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedElement(null);
                    setUserMessage('');
                  }}
                  className="h-6 w-6 p-0"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Element info preview */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground min-w-[60px]">Tag:</span>
                  <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{selectedElement.tagName}</span>
                </div>

                <div className="flex items-start gap-2">
                  <span className="font-medium text-muted-foreground min-w-[60px] mt-1">Selector:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                    {selectedElement.selector}
                  </code>
                </div>

                {selectedElement.innerText && (
                  <div className="flex items-start gap-2">
                    <span className="font-medium text-muted-foreground min-w-[60px] mt-1">Text:</span>
                    <p className="text-xs bg-muted p-2 rounded flex-1 max-h-20 overflow-auto">
                      {selectedElement.innerText}
                    </p>
                  </div>
                )}

                <details className="text-xs">
                  <summary className="font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                    HTML (click to expand)
                  </summary>
                  <pre className="mt-2 bg-muted p-2 rounded max-h-32 overflow-auto">
                    <code>{selectedElement.outerHTML}</code>
                  </pre>
                </details>
              </div>

              {/* Message input area */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Add a message (optional)
                </label>
                <Textarea
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  placeholder="Describe what you want to know or do with this element..."
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  This element will be sent to your current chat tab
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedElement(null);
                      setUserMessage('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!selectedElement) return;

                      // Dispatch custom event, send to chat tab
                      window.dispatchEvent(new CustomEvent('webview-element-selected', {
                        detail: {
                          element: selectedElement,
                          message: userMessage,
                          workspaceId: workspacePath
                        }
                      }));

                      // Clear selection state
                      setSelectedElement(null);
                      setUserMessage('');

                      // Show success toast
                      window.dispatchEvent(new CustomEvent('show-toast', {
                        detail: { message: 'Element sent to chat successfully!', type: 'success' }
                      }));
                    }}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Send to Chat
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebViewer;
