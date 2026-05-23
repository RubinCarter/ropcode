import React from 'react';
import { FloatingPromptInput, type FloatingPromptInputRef } from '../../FloatingPromptInput';

interface SessionComposerProps {
  inputRef: React.Ref<FloatingPromptInputRef>;
  onSend: (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    provider?: string,
    options?: { forceFreshClaudeSession?: boolean },
  ) => Promise<boolean>;
  onCancel: () => Promise<void>;
  stopStatusLabel?: string;
  isLoading: boolean;
  interactiveSessionId: string | null;
  disabled: boolean;
  projectPath: string;
  defaultProvider: string;
  onProviderChange?: (provider: string) => void;
  onConfigChange: (config: any) => void;
  onProviderApiHotSwapDuringStream: (configName: string) => void;
  extraMenuItems?: React.ReactNode;
}

export const SessionComposer: React.FC<SessionComposerProps> = ({
  inputRef,
  onSend,
  onCancel,
  stopStatusLabel,
  isLoading,
  interactiveSessionId,
  disabled,
  projectPath,
  defaultProvider,
  onProviderChange,
  onConfigChange,
  onProviderApiHotSwapDuringStream,
  extraMenuItems,
}) => (
  <FloatingPromptInput
    ref={inputRef}
    onSend={onSend}
    onCancel={onCancel}
    stopStatusLabel={stopStatusLabel}
    isLoading={isLoading}
    interactiveSessionId={interactiveSessionId}
    disabled={disabled}
    projectPath={projectPath}
    defaultProvider={defaultProvider}
    onProviderChange={onProviderChange}
    onConfigChange={onConfigChange}
    onProviderApiHotSwapDuringStream={onProviderApiHotSwapDuringStream}
    extraMenuItems={extraMenuItems}
  />
);
