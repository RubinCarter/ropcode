function describeElement(element: Element | null): Record<string, unknown> | null {
  if (!element) return null;

  const html = element.outerHTML || '';
  return {
    tagName: element.tagName,
    id: element.id || undefined,
    className: typeof element.className === 'string' ? element.className : undefined,
    textContent: element.textContent?.trim().slice(0, 160),
    ariaLabel: element.getAttribute('aria-label') || undefined,
    title: element.getAttribute('title') || undefined,
    dataState: element.getAttribute('data-state') || undefined,
    dataRadixCollectionItem: element.getAttribute('data-radix-collection-item') || undefined,
    html: html.length > 500 ? `${html.slice(0, 500)}...` : html,
  };
}

export function writeRendererDiagnostic(scope: string, payload: Record<string, unknown>): void {
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
  const hoveredButton = typeof document !== 'undefined'
    ? document.querySelector('button:hover,[role="button"]:hover')
    : null;

  window.electronAPI?.writeRendererLog?.('error', scope, [
    JSON.stringify({
      ...payload,
      location: typeof window !== 'undefined' ? window.location.href : undefined,
      activeElement: describeElement(activeElement),
      hoveredButton: describeElement(hoveredButton),
    }, null, 2),
  ]);
}

export function writeRendererErrorDiagnostic(scope: string, error: Error, errorInfo?: React.ErrorInfo): void {
  writeRendererDiagnostic(scope, {
    errorName: error.name,
    errorMessage: error.message,
    errorStack: error.stack,
    componentStack: errorInfo?.componentStack,
  });
}
