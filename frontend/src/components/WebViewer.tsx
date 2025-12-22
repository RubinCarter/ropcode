import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Globe, RefreshCw, Copy, MousePointerClick, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { convertFileSrc } from '@/lib/wails-api';
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
 * 判断是否为本地文件路径
 */
function isLocalFile(url: string): boolean {
  return !url.startsWith('http://') && !url.startsWith('https://');
}

/**
 * 解析相对路径为绝对路径
 */
function resolveFilePath(url: string, workspacePath?: string): string {
  if (!isLocalFile(url)) {
    return url;
  }

  // 如果已经是绝对路径（以 / 或 盘符开头），直接返回
  if (url.startsWith('/') || /^[a-zA-Z]:/.test(url)) {
    return url;
  }

  // 如果是相对路径且有 workspacePath，拼接路径
  if (workspacePath) {
    // 确保路径分隔符正确（处理 Windows 和 Unix）
    const separator = workspacePath.includes('\\') ? '\\' : '/';
    return `${workspacePath}${separator}${url}`;
  }

  return url;
}

/**
 * 处理 URL，如果是本地文件则使用 convertFileSrc 转换
 */
async function processUrl(
  url: string,
  workspacePath?: string,
  setSrcdoc?: (content: string | null) => void
): Promise<string> {
  if (isLocalFile(url)) {
    try {
      // 首先解析相对路径
      const absolutePath = resolveFilePath(url, workspacePath);

      // 如果是 HTML 文件，读取内容并注入脚本
      if (absolutePath.toLowerCase().endsWith('.html') || absolutePath.toLowerCase().endsWith('.htm')) {
        try {
          console.log('[WebViewer] Reading local HTML file:', absolutePath);

          // 使用 fetch 通过 asset:// 协议读取文件
          const assetUrl = convertFileSrc(absolutePath);
          console.log('[WebViewer] Fetching from:', assetUrl);

          const response = await fetch(assetUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const content = await response.text();
          console.log('[WebViewer] Successfully read HTML file, length:', content.length);

          // 获取文件所在目录，用于设置 base href
          const fileDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));
          const baseHref = convertFileSrc(fileDir + '/');

          // 注入元素选择器脚本和 base 标签
          const scriptTag = `<script>${getElementSelectorScript()}</script>`;
          const baseTag = `<base href="${baseHref}">`;
          let modifiedContent = content;

          // 尝试在 </head> 之前注入（优先注入 base 标签，然后是脚本）
          if (content.includes('</head>')) {
            modifiedContent = content.replace('</head>', `${baseTag}${scriptTag}</head>`);
          }
          // 如果没有 head，尝试在 <body> 之后注入
          else if (content.includes('<body')) {
            modifiedContent = content.replace(/<body([^>]*)>/, `<head>${baseTag}${scriptTag}</head><body$1>`);
          }
          // 如果都没有，就在开头注入
          else {
            modifiedContent = `<head>${baseTag}${scriptTag}</head>` + content;
          }

          console.log('[WebViewer] Script and base tag injected into HTML content');

          if (setSrcdoc) {
            setSrcdoc(modifiedContent);
          }

          // 返回一个特殊标记，表示使用 srcdoc
          return 'use-srcdoc';
        } catch (error) {
          console.error('[WebViewer] Failed to read HTML file, falling back to convertFileSrc:', error);
          if (setSrcdoc) {
            setSrcdoc(null);
          }
        }
      }

      // 对于非 HTML 文件或读取失败的情况，使用 convertFileSrc
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

  // 远程 URL 不需要特殊处理
  if (setSrcdoc) {
    setSrcdoc(null);
  }
  return url;
}

/**
 * 生成元素选择器注入脚本
 * 该脚本会在 iframe 内部运行，实现元素高亮和选择功能
 */
function getElementSelectorScript(): string {
  return `
    (function() {
      // 避免重复注入
      if (window.__elementSelectorInjected) return;
      window.__elementSelectorInjected = true;

      let isSelecting = false;
      let currentHighlight = null;

      // 创建高亮覆盖层
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

      // 生成唯一的 CSS 选择器
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

      // 高亮元素
      function highlightElement(element) {
        if (!currentHighlight) {
          currentHighlight = createHighlightOverlay();
        }

        const rect = element.getBoundingClientRect();
        // 使用 fixed 定位，直接使用 getBoundingClientRect 的值
        currentHighlight.style.left = rect.left + 'px';
        currentHighlight.style.top = rect.top + 'px';
        currentHighlight.style.width = rect.width + 'px';
        currentHighlight.style.height = rect.height + 'px';
        currentHighlight.style.display = 'block';
      }

      // 隐藏高亮
      function hideHighlight() {
        if (currentHighlight) {
          currentHighlight.style.display = 'none';
        }
      }

      // 鼠标移动事件处理
      function handleMouseOver(e) {
        if (!isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target.id === '__element-selector-overlay') return;

        highlightElement(target);
      }

      // 鼠标移出事件处理
      function handleMouseOut(e) {
        if (!isSelecting) return;
        // 不隐藏，保持高亮直到下一个元素
      }

      // 点击事件处理
      function handleClick(e) {
        if (!isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target.id === '__element-selector-overlay') return;

        // 提取元素信息
        const elementInfo = {
          tagName: target.tagName,
          innerText: target.innerText?.substring(0, 500) || '',
          outerHTML: target.outerHTML?.substring(0, 2000) || '',
          selector: getUniqueSelector(target),
          url: window.location.href
        };

        // 发送消息到父窗口
        window.parent.postMessage({
          type: 'element-selected',
          data: elementInfo
        }, '*');

        // 停止选择模式
        stopSelection();
      }

      // 启动选择模式
      function startSelection() {
        isSelecting = true;
        document.body.style.cursor = 'crosshair';
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('click', handleClick, true);
      }

      // 停止选择模式
      function stopSelection() {
        isSelecting = false;
        document.body.style.cursor = '';
        hideHighlight();
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleClick, true);
      }

      // 监听来自父窗口的消息
      window.addEventListener('message', function(event) {
        if (event.data.type === 'start-element-selection') {
          startSelection();
        } else if (event.data.type === 'stop-element-selection') {
          stopSelection();
        } else if (event.data.type === 'ping-element-selector') {
          // 响应 ping 请求，确认脚本已注入
          window.parent.postMessage({
            type: 'element-selector-ready'
          }, '*');
        }
      });

      console.log('[ElementSelector] Script injected successfully');

      // 主动通知父窗口脚本已就绪
      window.parent.postMessage({
        type: 'element-selector-ready'
      }, '*');
    })();
  `;
}

/**
 * WebViewer 组件 - 使用 iframe 显示网页内容
 *
 * 功能：
 * - 显示指定 URL 的网页内容
 * - 支持本地文件和远程 URL
 * - URL 输入框和刷新按钮
 * - 加载状态和错误处理
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
  // 保存原始 URL（用于在外部浏览器打开）
  const originalUrlRef = useRef<string>(url);
  // 元素选择模式
  const [isSelectingElement, setIsSelectingElement] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  // 用户消息输入
  const [userMessage, setUserMessage] = useState('');
  // 脚本注入状态
  const [isScriptInjected, setIsScriptInjected] = useState(false);
  // 用于本地 HTML 文件的 srcdoc 内容
  const [srcdocContent, setSrcdocContent] = useState<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      storeReset();
    };
  }, []);

  // 当外部 URL 变化时更新状态
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

  // 处理 iframe 加载完成
  const handleIframeLoad = () => {
    setLoading(false);
    setError(null);

    // 如果使用 srcdoc，脚本已经在 HTML 中，直接标记为已注入
    if (srcdocContent) {
      console.log('[WebViewer] Using srcdoc, script pre-injected');
      setIsScriptInjected(true);
      return;
    }

    // 否则，重置状态并尝试注入脚本
    setIsScriptInjected(false);
    injectElementSelectorScript();
  };

  // 注入元素选择器脚本到 iframe
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

        // 检查是否可以访问 iframe 的 document
        const doc = iframeWindow.document;
        if (!doc) {
          console.warn('[WebViewer] Cannot access iframe document');
          setIsScriptInjected(false);
          return;
        }

        // 确保 head 和 body 都存在
        if (!doc.head || !doc.body) {
          console.warn('[WebViewer] Document not ready, retrying...', {
            hasHead: !!doc.head,
            hasBody: !!doc.body,
            retryCount
          });

          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptInject, 200 * retryCount); // 递增延迟
            return;
          } else {
            console.error('[WebViewer] Failed to inject after retries - DOM not ready');
            setIsScriptInjected(false);
            return;
          }
        }

        // 创建并注入 script 标签
        const script = doc.createElement('script');
        script.textContent = getElementSelectorScript();
        doc.head.appendChild(script);

        console.log('[WebViewer] Element selector script injected successfully');

        // 发送 ping 消息验证脚本是否成功加载
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

        // 设置超时检查
        setTimeout(() => {
          if (!isScriptInjected) {
            console.warn('[WebViewer] Script injection verification timeout');
            // 对于同源页面，即使没收到确认也可能是消息时序问题，再试一次 ping
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
        // 跨域限制可能导致注入失败
        console.error('[WebViewer] Failed to inject element selector script:', err);
        setIsScriptInjected(false);

        // 只在真正的跨域错误时显示警告
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

    // 延迟一小段时间再注入，确保 iframe 加载完成
    setTimeout(attemptInject, 50);
  };

  // 处理 iframe 加载错误
  const handleIframeError = () => {
    setLoading(false);
    setError('Failed to load webpage. Please check the URL and try again.');
  };

  // 刷新页面
  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    const processedUrl = await processUrl(inputUrl, workspacePath, setSrcdocContent);
    setCurrentUrl(processedUrl);
    setIframeKey(prev => prev + 1);
  };

  // 导航到新 URL
  const handleNavigate = async () => {
    const trimmedUrl = inputUrl.trim();
    if (!trimmedUrl) return;

    // 确保远程 URL 有协议前缀（本地文件保持原样）
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

    // 通知父组件 URL 变化（使用原始 URL，不是处理后的）
    if (onUrlChange) {
      onUrlChange(normalizedUrl);
    }
  };

  // 处理 Enter 键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  };

  
  // 复制 URL 到剪贴板
  const handleCopyUrl = async () => {
    try {
      const urlToCopy = originalUrlRef.current;
      await navigator.clipboard.writeText(urlToCopy);

      // 触发成功事件，显示 toast 提示
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

  // 切换元素选择模式
  const toggleElementSelection = () => {
    if (!iframeRef.current?.contentWindow) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'Unable to access iframe content', type: 'error' }
      }));
      return;
    }

    // 检查脚本是否已注入
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

    // 发送消息到 iframe
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

  // 监听来自 iframe 的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 过滤掉非目标消息
      if (!event.data || typeof event.data.type !== 'string') return;

      console.log('[WebViewer] Received message:', event.data.type, event.origin);

      if (event.data.type === 'element-selected') {
        const elementData = event.data.data as SelectedElement;
        console.log('[WebViewer] Element selected:', elementData);

        setSelectedElement(elementData);
        setIsSelectingElement(false);

        // 显示成功提示
        window.dispatchEvent(new CustomEvent('show-toast', {
          detail: { message: 'Element selected successfully', type: 'success' }
        }));
      } else if (event.data.type === 'element-selector-ready') {
        // 脚本已成功注入并就绪
        console.log('[WebViewer] ✓ Element selector script is ready and confirmed');
        setIsScriptInjected(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* 工具栏 */}
      <div className="px-4 py-2 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          {/* 图标 */}
          <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />

          {/* URL 输入框 */}
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL (e.g., https://example.com)"
            className="flex-1 h-8 text-sm font-mono"
            spellCheck={false}
          />

          {/* 导航按钮 */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNavigate}
            disabled={!inputUrl.trim() || isLoading}
            className="h-8 px-3"
          >
            Go
          </Button>

          {/* 刷新按钮 */}
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

          {/* 复制 URL 按钮 */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopyUrl}
            className="h-8 w-8 p-0"
            title="Copy URL"
          >
            <Copy className="w-4 h-4" />
          </Button>

          {/* 元素选择按钮 */}
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

      {/* 内容区域 */}
      <div className="flex-1 relative">
        {/* 加载指示器 */}
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

        {/* 错误提示 */}
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

        {/* 选中元素预览和消息输入面板 */}
        {selectedElement && (
          <div className="absolute bottom-0 left-0 right-0 bg-background border-t shadow-lg max-h-96 overflow-auto z-20">
            <div className="p-4 space-y-4">
              {/* 标题栏 */}
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

              {/* 元素信息预览 */}
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

              {/* 消息输入区域 */}
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

              {/* 操作按钮 */}
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

                      // 触发自定义事件，发送到 chat tab
                      window.dispatchEvent(new CustomEvent('webview-element-selected', {
                        detail: {
                          element: selectedElement,
                          message: userMessage,
                          workspaceId: workspacePath
                        }
                      }));

                      // 清除选择状态
                      setSelectedElement(null);
                      setUserMessage('');

                      // 显示成功提示
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
