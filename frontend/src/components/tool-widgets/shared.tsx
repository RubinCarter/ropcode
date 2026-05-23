import React, { useState } from 'react';
import type { ControlledExpansionProps } from './types';

export function useControlledExpansion({
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
}: ControlledExpansionProps = {}) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const setExpanded = (nextExpanded: boolean) => {
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };
  return [expanded, setExpanded] as const;
}

export function extractToolResultText(result: any): string {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (result.content?.text) return result.content.text;
  if (Array.isArray(result.content)) {
    return result.content
      .map((item: any) => (typeof item === 'string' ? item : item.text || JSON.stringify(item)))
      .join('\n');
  }
  if (result.content && typeof result.content === 'object') {
    return JSON.stringify(result.content, null, 2);
  }
  return '';
}
