export type PromptThinkingConfig = {
  provider: string;
  prompt: string;
  phrase?: string | null;
  isClearCommand?: boolean;
  shouldForwardClear?: boolean;
};

const CLAUDE_PROMPT_THINKING_PHRASES = new Set([
  "think",
  "think hard",
  "think harder",
  "ultrathink",
]);

export function isClaudePromptThinkingPhrase(phrase: string | undefined | null): phrase is string {
  return Boolean(phrase && CLAUDE_PROMPT_THINKING_PHRASES.has(phrase));
}

export function buildPromptWithThinking(config: PromptThinkingConfig): string {
  const finalPrompt = config.prompt.trim();
  if (
    config.provider === "claude" &&
    isClaudePromptThinkingPhrase(config.phrase) &&
    !config.isClearCommand &&
    !config.shouldForwardClear
  ) {
    return `${finalPrompt}.\n\n${config.phrase}.`;
  }
  return finalPrompt;
}
