import { isExactClearCommand } from './clearCommand';

export type PromptSubmitClassification =
  | { action: 'ignore'; reason: 'empty' }
  | { action: 'backend-clear' }
  | { action: 'reject'; reason: 'missing-project' }
  | { action: 'send' };

export interface ClassifyPromptSubmitInput {
  prompt: string;
  hasProjectPath: boolean;
}

export function classifyPromptSubmit(input: ClassifyPromptSubmitInput): PromptSubmitClassification {
  const trimmedPrompt = input.prompt.trim();

  if (!trimmedPrompt) {
    return { action: 'ignore', reason: 'empty' };
  }

  if (!input.hasProjectPath) {
    return { action: 'reject', reason: 'missing-project' };
  }

  if (isExactClearCommand(trimmedPrompt)) {
    return { action: 'backend-clear' };
  }

  return { action: 'send' };
}
