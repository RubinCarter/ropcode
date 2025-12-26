/**
 * WebViewWidget Component
 *
 * Electron webview-based browser widget with advanced features:
 * - Navigation controls (back, forward, refresh, home)
 * - Smart URL input with protocol detection
 * - Element selector functionality
 * - In-page search using findInPage API
 * - User agent switching (Desktop/iPhone/Android)
 * - Zoom control
 * - Media mute control
 * - Error handling
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useWebStore, USER_AGENTS, MOBILE_VIEWPORT_WIDTH, type UserAgentType } from '@/widgets/web/WebModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Globe,
  RefreshCw,
  Copy,
  MousePointerClick,
  Send,
  X,
  ChevronLeft,
  ChevronRight,
  Home,
  Search,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Smartphone,
  Monitor,
} from 'lucide-react';

interface WebViewWidgetProps {
  url: string;
  workspacePath?: string;
  className?: string;
  onUrlChange?: (newUrl: string) => void;
}

type WebviewElement = HTMLElement & {
  src: string;
  partition: string;
  allowpopups: string;
  preload: string;
  useragent?: string;
  getWebContentsId: () => number;
  loadURL: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  setZoomFactor: (factor: number) => void;
  getZoomFactor: () => number;
  setAudioMuted: (muted: boolean) => void;
  isAudioMuted: () => boolean;
  setUserAgent: (userAgent: string) => void;
  getUserAgent: () => string;
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => void;
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void;
  getTitle: () => string;
  executeJavaScript: (code: string) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  addEventListener: (event: string, listener: any) => void;
  removeEventListener: (event: string, listener: any) => void;
};

export function WebViewWidget({ url, workspacePath, className, onUrlChange }: WebViewWidgetProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [preloadPath, setPreloadPath] = useState<string>('');
  // Store initial URL to prevent re-renders from resetting webview src
  const [initialUrl] = useState(url);

  const {
    inputUrl,
    homepageUrl,
    isLoading,
    domReady,
    canGoBack,
    canGoForward,
    error,
    title,
    userAgentType,
    zoomFactor,
    mediaPlaying,
    mediaMuted,
    searchOpen,
    searchQuery,
    searchResultIndex,
    searchResultCount,
    isSelectingElement,
    selectedElement,
    userMessage,
    webContentsId,
    setUrl,
    setInputUrl,
    setLoading,
    setDomReady,
    setCanGoBack,
    setCanGoForward,
    setError,
    setTitle,
    setUserAgentType,
    setZoomFactor,
    setMediaPlaying,
    setMediaMuted,
    setSearchOpen,
    setSearchQuery,
    setSearchResult,
    setIsSelectingElement,
    setSelectedElement,
    setUserMessage,
    setWebContentsId,
  } = useWebStore();

  // Get preload script path on mount
  useEffect(() => {
    const getPreload = async () => {
      try {
        const path = await window.electronAPI?.getWebviewPreload();
        if (path) {
          setPreloadPath(path);
        } else {
          setPreloadPath('none');
        }
      } catch {
        setPreloadPath('none');
      }
    };
    getPreload();
  }, []);

  // Initialize webview URL only on mount or when url prop changes
  const initializedRef = useRef(false);
  useEffect(() => {
    if (url && !initializedRef.current) {
      setInputUrl(url);
      setUrl(url);
      initializedRef.current = true;
    }
  }, [url, setInputUrl, setUrl]);

  // Setup webview event listeners
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !preloadPath) return;

    const handleDidNavigate = (e: any) => {
      const navigatedUrl = e.url;
      setUrl(navigatedUrl);
      setInputUrl(navigatedUrl);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      setError(null);
      if (onUrlChange) {
        onUrlChange(navigatedUrl);
      }
    };

    const handleDidStartLoading = () => {
      setLoading(true);
      setError(null);
    };

    const handleDidStopLoading = () => {
      setLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const handleDomReady = () => {
      setDomReady(true);
      if (typeof webview.getTitle === 'function') {
        setTitle(webview.getTitle());
      }

      // Store WebContents ID for communication (only available in Electron)
      try {
        if (typeof webview.getWebContentsId === 'function') {
          const id = webview.getWebContentsId();
          setWebContentsId(id);
        }
      } catch (err) {
        console.error('Failed to get webContentsId:', err);
      }

    };

    const handleDidFailLoad = (e: any) => {
      if (e.errorCode === -3) {
        // ERR_ABORTED - ignore, user navigation
        return;
      }
      setLoading(false);
      setError(`Failed to load (${e.errorCode}): ${e.errorDescription}`);
    };

    const handleNewWindow = (e: any) => {
      const newUrl = e.url;
      // Open in same webview instead of new window
      webview.loadURL(newUrl);
    };

    const handleMediaStartedPlaying = () => {
      setMediaPlaying(true);
    };

    const handleMediaPaused = () => {
      setMediaPlaying(false);
    };

    const handleFoundInPage = (e: any) => {
      if (e.result) {
        setSearchResult(e.result.activeMatchOrdinal, e.result.matches);
      }
    };

    // Handle IPC messages from webview preload script (via sendToHost)
    const handleIpcMessage = (e: any) => {
      const { channel, args } = e;
      if (channel === 'webview:elementSelected') {
        const elementInfo = args[0];
        setSelectedElement(elementInfo);
        setIsSelectingElement(false);
      }
    };

    // Register event listeners
    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate);
    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleDidFailLoad);
    webview.addEventListener('new-window', handleNewWindow);
    webview.addEventListener('media-started-playing', handleMediaStartedPlaying);
    webview.addEventListener('media-paused', handleMediaPaused);
    webview.addEventListener('found-in-page', handleFoundInPage);
    webview.addEventListener('ipc-message', handleIpcMessage);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
      webview.removeEventListener('new-window', handleNewWindow);
      webview.removeEventListener('media-started-playing', handleMediaStartedPlaying);
      webview.removeEventListener('media-paused', handleMediaPaused);
      webview.removeEventListener('found-in-page', handleFoundInPage);
      webview.removeEventListener('ipc-message', handleIpcMessage);
    };
  }, [
    preloadPath,
    setUrl,
    setInputUrl,
    setLoading,
    setDomReady,
    setCanGoBack,
    setCanGoForward,
    setError,
    setTitle,
    setMediaPlaying,
    setSearchResult,
    setWebContentsId,
    setSelectedElement,
    setIsSelectingElement,
    onUrlChange,
  ]);

  // Listen for element selection from webview (legacy - now handled via ipc-message)
  useEffect(() => {
    if (!window.electronAPI?.onWebviewElementSelected) return;

    const handleElementSelected = (elementInfo: any) => {
      setSelectedElement(elementInfo);
      setIsSelectingElement(false);
    };

    window.electronAPI.onWebviewElementSelected(handleElementSelected);
  }, [setSelectedElement, setIsSelectingElement]);

  // Auto-detect and set background color based on page color scheme
  useEffect(() => {
    const webview = webviewRef.current;
    if (!domReady || !webview) return;

    const detectColorScheme = async () => {
      try {
        // @ts-ignore - executeJavaScript is available on webview
        const isDark = await webview.executeJavaScript(`
          (() => {
            const meta = document.querySelector('meta[name="color-scheme"]');
            const isDark = meta?.content?.includes('dark') ||
                          window.matchMedia('(prefers-color-scheme: dark)').matches;
            return isDark;
          })()
        `);

        if (webview) {
          webview.style.backgroundColor = isDark ? '#000000' : '#ffffff';
        }
      } catch (err) {
        // Default to dark background
        if (webview) {
          webview.style.backgroundColor = '#1a1a1a';
        }
      }
    };

    // Wait 100ms for CSS to load
    const timer = setTimeout(detectColorScheme, 100);
    return () => clearTimeout(timer);
  }, [domReady]);

  // Navigation handlers
  const handleGoBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, []);

  const handleGoForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, []);

  const handleRefresh = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  const handleGoHome = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.loadURL(homepageUrl);
    }
  }, [homepageUrl]);

  // URL input handler with smart protocol detection
  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = inputUrl.trim();

    if (!targetUrl) return;

    // Smart protocol detection
    if (!targetUrl.match(/^[a-z]+:\/\//i)) {
      // Check if it looks like a domain
      if (targetUrl.match(/^[\w-]+(\.[\w-]+)+/)) {
        targetUrl = `https://${targetUrl}`;
      } else {
        // Treat as search query
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
      }
    }

    setInputUrl(targetUrl);
    setUrl(targetUrl);
    webviewRef.current?.loadURL(targetUrl);
  }, [inputUrl, setInputUrl, setUrl]);

  // Element selector script to inject into webview
  const ELEMENT_SELECTOR_SCRIPT = `
    (function() {
      if (window.__elementSelectorActive) return;
      window.__elementSelectorActive = true;

      let highlightOverlay = document.getElementById('__element-selector-overlay');
      if (!highlightOverlay) {
        highlightOverlay = document.createElement('div');
        highlightOverlay.id = '__element-selector-overlay';
        highlightOverlay.style.cssText = 'position:fixed;background:rgba(59,130,246,0.2);border:2px solid rgb(59,130,246);pointer-events:none;z-index:2147483647;transition:all 0.1s ease;box-sizing:border-box;display:none;';
        document.body.appendChild(highlightOverlay);
      }

      function getUniqueSelector(element) {
        if (element.id) return '#' + element.id;
        const path = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let selector = current.nodeName.toLowerCase();
          if (current.className && typeof current.className === 'string') {
            const classes = current.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) selector += '.' + classes.slice(0, 2).join('.');
          }
          let sibling = current, nth = 1;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.nodeName === current.nodeName) nth++;
          }
          if (nth > 1) selector += ':nth-of-type(' + nth + ')';
          path.unshift(selector);
          current = current.parentElement;
          if (path.length > 3) break;
        }
        return path.join(' > ');
      }

      function handleMouseOver(e) {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target;
        if (target.id === '__element-selector-overlay') return;
        const rect = target.getBoundingClientRect();
        highlightOverlay.style.left = rect.left + 'px';
        highlightOverlay.style.top = rect.top + 'px';
        highlightOverlay.style.width = rect.width + 'px';
        highlightOverlay.style.height = rect.height + 'px';
        highlightOverlay.style.display = 'block';
      }

      function handleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target;
        if (target.id === '__element-selector-overlay') return;

        const elementInfo = {
          tagName: target.tagName,
          innerText: (target.innerText || '').substring(0, 500),
          outerHTML: (target.outerHTML || '').substring(0, 2000),
          selector: getUniqueSelector(target),
          url: window.location.href
        };

        // Clean up
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('click', handleClick, true);
        document.body.style.cursor = '';
        highlightOverlay.style.display = 'none';
        window.__elementSelectorActive = false;

        // Send result back
        window.__elementSelectorResult = elementInfo;
      }

      document.body.style.cursor = 'crosshair';
      document.addEventListener('mouseover', handleMouseOver, true);
      document.addEventListener('click', handleClick, true);
    })();
  `;

  const STOP_ELEMENT_SELECTOR_SCRIPT = `
    (function() {
      window.__elementSelectorActive = false;
      document.body.style.cursor = '';
      const overlay = document.getElementById('__element-selector-overlay');
      if (overlay) overlay.style.display = 'none';
    })();
  `;

  // Element selector - inject script directly into webview
  const handleStartSelectElement = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    setIsSelectingElement(true);

    // Inject element selector script
    webview.executeJavaScript(ELEMENT_SELECTOR_SCRIPT).then(() => {
      // Poll for result
      const checkResult = () => {
        webview.executeJavaScript('window.__elementSelectorResult').then((result: any) => {
          if (result) {
            setSelectedElement(result);
            setIsSelectingElement(false);
            webview.executeJavaScript('window.__elementSelectorResult = null');
          } else if (webviewRef.current) {
            webview.executeJavaScript('window.__elementSelectorActive').then((active: boolean) => {
              if (active) {
                setTimeout(checkResult, 100);
              }
            });
          }
        }).catch(() => {
          setIsSelectingElement(false);
        });
      };

      setTimeout(checkResult, 100);
    }).catch(() => {
      setIsSelectingElement(false);
    });
  }, [setIsSelectingElement, setSelectedElement]);

  const handleCancelSelectElement = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    setIsSelectingElement(false);
    webview.executeJavaScript(STOP_ELEMENT_SELECTOR_SCRIPT).catch(() => {});
  }, [setIsSelectingElement]);

  const handleCopySelectedElement = useCallback(() => {
    if (selectedElement) {
      navigator.clipboard.writeText(selectedElement.outerHTML);
    }
  }, [selectedElement]);

  const handleClearSelectedElement = useCallback(() => {
    setSelectedElement(null);
  }, [setSelectedElement]);

  // Search handlers
  const handleSearchToggle = useCallback(() => {
    setSearchOpen(!searchOpen);
    if (searchOpen) {
      webviewRef.current?.stopFindInPage('clearSelection');
      setSearchQuery('');
    }
  }, [searchOpen, setSearchOpen, setSearchQuery]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (query) {
      webviewRef.current?.findInPage(query);
    } else {
      webviewRef.current?.stopFindInPage('clearSelection');
    }
  }, [setSearchQuery]);

  const handleSearchNext = useCallback(() => {
    if (searchQuery) {
      webviewRef.current?.findInPage(searchQuery, { forward: true, findNext: true });
    }
  }, [searchQuery]);

  const handleSearchPrevious = useCallback(() => {
    if (searchQuery) {
      webviewRef.current?.findInPage(searchQuery, { forward: false, findNext: true });
    }
  }, [searchQuery]);

  // User Agent switching
  const handleUserAgentChange = useCallback((type: UserAgentType) => {
    setUserAgentType(type);

    if (!webviewRef.current || !domReady) {
      return;
    }

    const userAgent = USER_AGENTS[type];

    // Set user agent
    if (userAgent) {
      webviewRef.current.setUserAgent(userAgent);
    } else {
      webviewRef.current.setUserAgent('');
    }

    webviewRef.current.reload();
  }, [setUserAgentType, domReady]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(5, zoomFactor + 0.1);
    setZoomFactor(newZoom);
    webviewRef.current?.setZoomFactor(newZoom);
  }, [zoomFactor, setZoomFactor]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.1, zoomFactor - 0.1);
    setZoomFactor(newZoom);
    webviewRef.current?.setZoomFactor(newZoom);
  }, [zoomFactor, setZoomFactor]);

  const handleZoomReset = useCallback(() => {
    setZoomFactor(1);
    webviewRef.current?.setZoomFactor(1);
  }, [setZoomFactor]);

  // Media mute toggle
  const handleToggleMute = useCallback(() => {
    const newMuted = !mediaMuted;
    setMediaMuted(newMuted);
    webviewRef.current?.setAudioMuted(newMuted);
  }, [mediaMuted, setMediaMuted]);

  // Send message to chat
  const handleSendToChat = useCallback(() => {
    if (!selectedElement || !userMessage.trim()) return;

    // This would integrate with your chat system
    console.log('Send to chat:', {
      message: userMessage,
      element: selectedElement,
    });

    // Clear after sending
    setUserMessage('');
    setSelectedElement(null);
  }, [selectedElement, userMessage, setUserMessage, setSelectedElement]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b">
        {/* Navigation Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGoBack}
            disabled={!canGoBack}
            title="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGoForward}
            disabled={!canGoForward}
            title="Forward"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGoHome}
            title="Home"
          >
            <Home className="h-4 w-4" />
          </Button>
        </div>

        {/* URL Input */}
        <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center gap-2">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Enter URL or search..."
              className="pl-9"
            />
          </div>
        </form>

        {/* Search */}
        <Button
          variant={searchOpen ? 'secondary' : 'ghost'}
          size="icon"
          onClick={handleSearchToggle}
          title="Find in page"
        >
          <Search className="h-4 w-4" />
        </Button>

        {/* Element Selector */}
        <Button
          variant={isSelectingElement ? 'secondary' : 'ghost'}
          size="icon"
          onClick={isSelectingElement ? handleCancelSelectElement : handleStartSelectElement}
          title="Select element"
        >
          <MousePointerClick className="h-4 w-4" />
        </Button>

        {/* User Agent Switcher */}
        <div className="flex items-center gap-1">
          <Button
            variant={userAgentType === 'default' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => handleUserAgentChange('default')}
            title="Desktop mode"
          >
            <Monitor className="h-4 w-4" />
          </Button>
          <Button
            variant={userAgentType !== 'default' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => handleUserAgentChange(
              userAgentType === 'mobile:iphone' ? 'mobile:android' : 'mobile:iphone'
            )}
            title="Mobile mode"
          >
            <Smartphone className="h-4 w-4" />
          </Button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomReset}
            title="Reset zoom"
            className="min-w-[50px]"
          >
            {Math.round(zoomFactor * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {/* Media Mute */}
        {mediaPlaying && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleMute}
            title={mediaMuted ? 'Unmute' : 'Mute'}
          >
            {mediaMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {/* Search Bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 p-2 border-b bg-muted/50">
          <Input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search in page..."
            className="flex-1"
            autoFocus
          />
          {searchResultCount > 0 && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {searchResultIndex}/{searchResultCount}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSearchPrevious}
            disabled={!searchQuery || searchResultCount === 0}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSearchNext}
            disabled={!searchQuery || searchResultCount === 0}
          >
            Next
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSearchToggle}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Element Selection Info */}
      {isSelectingElement && (
        <div className="p-2 bg-blue-500/10 border-b border-blue-500/20 text-blue-600 text-sm">
          Click on an element to select...
        </div>
      )}

      {/* Selected Element Panel */}
      {selectedElement && !isSelectingElement && (
        <div className="p-3 border-b bg-muted/30 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 text-sm">
              <div className="font-semibold mb-1">
                Selected: &lt;{selectedElement.tagName.toLowerCase()}&gt;
              </div>
              <div className="text-muted-foreground truncate">
                {selectedElement.selector}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopySelectedElement}
                title="Copy HTML"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClearSelectedElement}
                title="Clear"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {selectedElement.innerText && (
            <div className="text-sm">
              <div className="font-medium mb-1">Text content:</div>
              <div className="text-muted-foreground line-clamp-2">
                {selectedElement.innerText}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="Describe what you want AI to do with this element..."
              className="flex-1 min-h-[60px]"
            />
            <Button
              onClick={handleSendToChat}
              disabled={!userMessage.trim()}
              size="icon"
              className="self-end"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Webview Container - GPU accelerated */}
      <div
        className="flex-1 relative overflow-hidden flex justify-center bg-muted/30"
        style={{
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          className="relative h-full"
          style={{
            width: userAgentType !== 'default' && MOBILE_VIEWPORT_WIDTH[userAgentType as keyof typeof MOBILE_VIEWPORT_WIDTH]
              ? `${MOBILE_VIEWPORT_WIDTH[userAgentType as keyof typeof MOBILE_VIEWPORT_WIDTH]}px`
              : '100%',
            maxWidth: '100%',
          }}
        >
          <webview
            ref={webviewRef}
            src={initialUrl}
            partition="persist:webview"
            // @ts-ignore - webview specific attributes
            allowpopups="true"
            webpreferences="contextIsolation=yes, nodeIntegration=no"
            {...(preloadPath && preloadPath !== 'none' ? { preload: preloadPath } : {})}
            useragent={USER_AGENTS[userAgentType]}
            data-webcontentsid={webContentsId ?? undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              transform: 'translateZ(0)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
