// electron/src/preload-webview.ts
// Preload script for webview - handles image context menu and element selector bridge

const { ipcRenderer } = require('electron');

// Handle image right-click context menu
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement;
  if (target.tagName === 'IMG') {
    setTimeout(() => {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const imgElem = target as HTMLImageElement;
      ipcRenderer.sendToHost('webview:imageContextMenu', { src: imgElem.src });
    }, 50);
  }
});

// Element Selector Script - injected into webview for element selection feature
(function initElementSelector() {
  // Avoid duplicate injection
  if ((window as any).__elementSelectorInjected) return;
  (window as any).__elementSelectorInjected = true;

  let isSelecting = false;
  let highlightOverlay: HTMLDivElement | null = null;

  function createHighlightOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.id = '__element-selector-overlay';
    overlay.style.cssText = `
      position: fixed;
      background: rgba(59, 130, 246, 0.2);
      border: 2px solid rgb(59, 130, 246);
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.1s ease;
      box-sizing: border-box;
      display: none;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function getUniqueSelector(element: Element): string {
    if (element.id) {
      return '#' + element.id;
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      let sibling: Element | null = current;
      let nth = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.nodeName === current.nodeName) nth++;
      }

      if (nth > 1) {
        selector += ':nth-of-type(' + nth + ')';
      }

      path.unshift(selector);
      current = current.parentElement;

      if (path.length > 3) break;
    }

    return path.join(' > ');
  }

  function highlightElement(element: Element) {
    if (!highlightOverlay) {
      highlightOverlay = createHighlightOverlay();
    }

    const rect = element.getBoundingClientRect();
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
    highlightOverlay.style.display = 'block';
  }

  function hideHighlight() {
    if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
  }

  function handleMouseOver(e: MouseEvent) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.id === '__element-selector-overlay') return;

    highlightElement(target);
  }

  function handleClick(e: MouseEvent) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.id === '__element-selector-overlay') return;

    const elementInfo = {
      tagName: target.tagName,
      innerText: target.innerText?.substring(0, 500) || '',
      outerHTML: target.outerHTML?.substring(0, 2000) || '',
      selector: getUniqueSelector(target),
      url: window.location.href
    };

    // Use sendToHost to communicate back to the webview's host (renderer process)
    ipcRenderer.sendToHost('webview:elementSelected', elementInfo);
    stopSelection();
  }

  function startSelection() {
    isSelecting = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('click', handleClick, true);
  }

  function stopSelection() {
    isSelecting = false;
    document.body.style.cursor = '';
    hideHighlight();
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('click', handleClick, true);
  }

  // Expose functions globally for executeJavaScript fallback
  (window as any).__startElementSelection = startSelection;
  (window as any).__stopElementSelection = stopSelection;

  // Listen for IPC messages from webview.send()
  ipcRenderer.on('webview:startElementSelection', () => {
    startSelection();
  });

  ipcRenderer.on('webview:stopElementSelection', () => {
    stopSelection();
  });

  ipcRenderer.sendToHost('webview:elementSelectorReady');
})();
