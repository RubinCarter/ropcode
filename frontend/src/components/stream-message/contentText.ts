export function stringifyMessageValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'result', 'output', 'content']) {
      const nested = record[key];
      if (typeof nested === 'string') {
        return nested;
      }
    }

    if (Array.isArray(value)) {
      return value.map((item) => stringifyMessageValue(item)).join('\n');
    }

    return stringifyObjectValue(value);
  }

  return String(value || '');
}

function stringifyObjectValue(value: object): string {
  try {
    return JSON.stringify(value, safeJsonReplacer, 2);
  } catch (_err) {
    return Object.prototype.toString.call(value);
  }
}

function safeJsonReplacer(key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    if (key === 'parent' || key === 'children' || key === 'nextSibling' || key === 'previousSibling') {
      return '[Circular Reference]';
    }
    if (typeof (value as { nodeType?: unknown }).nodeType === 'number') {
      return '[HTMLElement]';
    }
  }

  if (typeof value === 'function') {
    return '[Function]';
  }

  return value;
}
