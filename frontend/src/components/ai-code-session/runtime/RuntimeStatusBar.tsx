import React from 'react';
import { SessionStatusBar } from '../SessionStatusBar';
import type { SessionStatusBarModel } from '../utils/sessionStatusBarPresentation';

interface RuntimeStatusBarProps {
  model: SessionStatusBarModel;
  queuedPrompts: any[];
  queueCollapsed: boolean;
  onQueueCollapsedChange: (collapsed: boolean) => void;
  onRemoveQueuedPrompt: (id: string) => void;
}

export const RuntimeStatusBar: React.FC<RuntimeStatusBarProps> = ({
  model,
  queuedPrompts,
  queueCollapsed,
  onQueueCollapsedChange,
  onRemoveQueuedPrompt,
}) => (
  <SessionStatusBar
    model={model}
    queuedPrompts={queuedPrompts}
    queueCollapsed={queueCollapsed}
    onQueueCollapsedChange={onQueueCollapsedChange}
    onRemoveQueuedPrompt={onRemoveQueuedPrompt}
  />
);
