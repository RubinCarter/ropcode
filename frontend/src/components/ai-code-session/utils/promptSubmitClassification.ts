import { shouldUseLocalClearFallback } from './clearCommand';

export type PromptSubmitClassification =
  | { action: 'ignore'; reason: 'empty' }
  | { action: 'local-clear' }
  | { action: 'reject'; reason: 'missing-project' }
  | { action: 'enqueue' }
  | { action: 'send' };

export interface ClassifyPromptSubmitInput {
  prompt: string;
  provider: string;
  hasProjectPath: boolean;
  isLoading: boolean;
  hasInteractiveSession: boolean;
  forceFreshSession?: boolean;
}

export function classifyPromptSubmit(input: ClassifyPromptSubmitInput): PromptSubmitClassification {
  const trimmedPrompt = input.prompt.trim();

  if (!trimmedPrompt) {
    return { action: 'ignore', reason: 'empty' };
  }

  if (!input.hasProjectPath) {
    return { action: 'reject', reason: 'missing-project' };
  }

  if (shouldUseLocalClearFallback(trimmedPrompt, input.provider)) {
    return { action: 'local-clear' };
  }

  if (input.isLoading && !input.hasInteractiveSession && input.forceFreshSession !== true) {
    return { action: 'enqueue' };
  }

  return { action: 'send' };
}
