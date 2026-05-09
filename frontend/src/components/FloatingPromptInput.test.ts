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

test('uses defaultProvider directly for Claude capability picker branch', async () => {
  const source = await readSource();

  assert.match(source, /const usesClaudeCapabilityPicker = defaultProvider === 'claude';/);
  assert.doesNotMatch(source, /const usesClaudeCapabilityPicker = selectedProvider === 'claude';/);
});

test('reports current provider model API and thinking config to parent components', async () => {
  const source = await readSource();

  assert.match(source, /onConfigChange\?: \(config: \{ provider: string; model: string; providerApiId: string \| null; thinkingMode: ThinkingMode \}\) => void;/);
  assert.match(source, /onConfigChange\?\.\(\{[\s\S]*provider: selectedProvider,[\s\S]*model: selectedModel,[\s\S]*providerApiId: selectedProviderApiId,[\s\S]*thinkingMode: selectedThinkingMode,[\s\S]*\}\);/);
});

test('cycles thinking mode with Shift Tab only when prompt pickers are closed', async () => {
  const source = await readSource();

  assert.match(source, /e\.key === 'Tab' &&[\s\S]*e\.shiftKey[\s\S]*!showFilePicker[\s\S]*!showSlashCommandPicker[\s\S]*!showSkillPicker[\s\S]*!providerPickerOpen[\s\S]*!modelPickerOpen[\s\S]*!thinkingModePickerOpen[\s\S]*!isIMEComposingRef\.current/);
  assert.match(source, /const nextIndex = currentIndex === -1 \? 0 : \(currentIndex \+ 1\) % currentThinkingModes\.length;/);
  assert.match(source, /setSelectedThinkingMode\(nextMode\.id\);/);
});
