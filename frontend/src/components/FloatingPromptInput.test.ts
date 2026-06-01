import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const floatingPromptInputPath = path.resolve(currentDir, './FloatingPromptInput.tsx');

async function readSource() {
  return readFile(floatingPromptInputPath, 'utf8');
}

test('syncs selected provider state when defaultProvider prop changes', async () => {
  const source = await readSource();

  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*setSelectedProvider\(defaultProvider\)[\s\S]*\}, \[defaultProvider\]\)/,
  );
});

test('uses provider-neutral capability picker for slash commands', async () => {
  const source = await readSource();

  assert.match(source, /<ProviderCapabilityPicker[\s\S]*provider=\{effectiveProvider\}/);
  assert.doesNotMatch(source, /<SlashCommandPicker/);
  assert.doesNotMatch(source, /import \{ SlashCommandPicker \}/);
  assert.doesNotMatch(source, /const usesClaudeCapabilityPicker = effectiveProvider === 'claude';/);
  assert.doesNotMatch(source, /const usesClaudeCapabilityPicker = defaultProvider === 'claude';/);
});

test('reports current provider model API and thinking config to parent components', async () => {
  const source = await readSource();

  assert.match(source, /onConfigChange\?: \(config: \{ provider: string; model: string; providerApiId: string \| null; thinkingMode: ThinkingMode \}\) => void;/);
  assert.match(source, /onConfigChange\?\.\(\{[\s\S]*provider: selectedProvider,[\s\S]*model: selectedModel,[\s\S]*providerApiId: selectedProviderApiId,[\s\S]*thinkingMode: selectedThinkingMode,[\s\S]*\}\);/);
});

test('does not reserve Shift Tab for cycling thinking mode', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /e\.key === 'Tab' &&[\s\S]*e\.shiftKey[\s\S]*setSelectedThinkingMode/);
  assert.doesNotMatch(source, /setSelectedThinkingMode\(nextMode\.id\);/);
});

test('opens slash file and skill pickers without low priority transition', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /startTransition/);
  assert.match(source, /if \(typedCharacter === '\/' && isAtWordStart\) \{[\s\S]*setShowSlashCommandPicker\(true\);/);
  assert.match(source, /if \(typedCharacter === '@' && projectPath\?\.trim\(\)\) \{[\s\S]*setShowFilePicker\(true\);/);
  assert.match(source, /if \(typedCharacter === ':' && isAtWordStart\) \{[\s\S]*setShowSkillPicker\(true\);/);
});

test('clears prompt before awaiting send and restores it when not consumed', async () => {
  const source = await readSource();

  assert.match(source, /const promptToSend = prompt;/);
  assert.match(source, /setPrompt\(""\);[\s\S]*const consumed = await onSend/);
  assert.match(source, /if \(consumed === false\) \{[\s\S]*setPrompt\(\(currentPrompt: string\) => currentPrompt \? currentPrompt : promptToSend\);[\s\S]*setEmbeddedImages\(\(currentImages: string\[\]\) => currentImages\.length > 0 \? currentImages : imagesToRestore\);[\s\S]*\}/);
  assert.match(source, /catch \(error\) \{[\s\S]*setPrompt\(\(currentPrompt: string\) => currentPrompt \? currentPrompt : promptToSend\);[\s\S]*setEmbeddedImages\(\(currentImages: string\[\]\) => currentImages\.length > 0 \? currentImages : imagesToRestore\);[\s\S]*throw error;/);
});

test('shows the stop button only during active work or stop feedback', async () => {
  const source = await readSource();

  assert.match(source, /const showStopControl = isLoading \|\| Boolean\(stopStatusLabel\);/);
  assert.match(source, /\{showStopControl && \(/);
  assert.doesNotMatch(source, /\{\(isLoading \|\| interactiveSessionId \|\| stopStatusLabel\) && \(/);
});

test('Codex model picker only exposes GPT-5.5 and current reasoning efforts', async () => {
  const source = await readSource();
  const codexModelsBlock = source.match(/const CODEX_MODELS: Model\[] = \[([\s\S]*?)\];/)?.[1] ?? '';
  const codexThinkingBlock = source.match(/const CODEX_THINKING_MODES: ThinkingModeConfig\[] = \[([\s\S]*?)\];/)?.[1] ?? '';

  assert.match(codexModelsBlock, /id: "gpt-5\.5"/);
  assert.doesNotMatch(codexModelsBlock, /gpt-5\.4|gpt-5\.3|gpt-5\.2|gpt-5\.1/);
  assert.match(codexThinkingBlock, /id: "none"/);
  assert.match(codexThinkingBlock, /id: "minimal"/);
  assert.match(codexThinkingBlock, /id: "xhigh"/);
});

test('DeepSeek provider uses the whale logo icon instead of the generic sparkle', async () => {
  const source = await readSource();
  const deepseekModelsBlock = source.match(/const DEEPSEEK_MODELS: Model\[] = \[([\s\S]*?)\];/)?.[1] ?? '';
  const providersBlock = source.match(/const PROVIDERS: Provider\[] = \[([\s\S]*?)\];/)?.[1] ?? '';

  assert.match(source, /DeepSeekIcon/);
  assert.match(deepseekModelsBlock, /<DeepSeekIcon className="h-3\.5 w-3\.5" \/>/);
  assert.match(providersBlock, /id: "deepseek"[\s\S]*<DeepSeekIcon className="h-3\.5 w-3\.5" \/>/);
  assert.doesNotMatch(providersBlock, /id: "deepseek"[\s\S]*<Sparkles className="h-3\.5 w-3\.5" \/>/);
});

test('Pi provider exposes model and native thinking modes', async () => {
  const source = await readSource();
  const piModelsBlock = source.match(/const PI_MODELS: Model\[] = \[([\s\S]*?)\];/)?.[1] ?? '';
  const piThinkingBlock = source.match(/const PI_THINKING_MODES: ThinkingModeConfig\[] = \[([\s\S]*?)\];/)?.[1] ?? '';
  const providersBlock = source.match(/const PROVIDERS: Provider\[] = \[([\s\S]*?)\];/)?.[1] ?? '';

  assert.match(source, /PiIcon/);
  assert.match(piModelsBlock, /anthropic\/claude-sonnet-4-20250514/);
  assert.match(piModelsBlock, /<PiIcon className="h-3\.5 w-3\.5" \/>/);
  assert.match(piThinkingBlock, /id: "off"/);
  assert.match(piThinkingBlock, /id: "xhigh"/);
  assert.match(providersBlock, /id: "pi"[\s\S]*<PiIcon className="h-3\.5 w-3\.5" \/>/);
  assert.match(source, /defaultProvider === 'codex' \|\| defaultProvider === 'pi' \? 'medium' : 'auto'/);
});

test('does not append numeric thinking budgets to Claude prompts', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /phrase: providerId === 'claude' \|\| providerId === 'gemini' \? \(t\.budget as string\) : undefined/);
  assert.match(source, /buildPromptWithThinking/);
  assert.doesNotMatch(source, /finalPrompt = `\$\{finalPrompt\}\.\\n\\n\$\{thinkingMode\.phrase\}\.`/);
});
