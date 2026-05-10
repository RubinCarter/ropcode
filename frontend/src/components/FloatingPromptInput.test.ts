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
