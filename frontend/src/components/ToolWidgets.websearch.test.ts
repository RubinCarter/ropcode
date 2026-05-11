import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const toolWidgetsPath = path.resolve(currentDir, './ToolWidgets.tsx');

async function readSource() {
  return readFile(toolWidgetsPath, 'utf8');
}

test('WebSearchWidget supports Claude server tool result blocks', async () => {
  const source = await readSource();

  assert.match(source, /const rawContent = result\.content \?\? result\.results \?\? result;/);
  assert.match(source, /item\?\.type === 'web_search_result'/);
  assert.match(source, /return \[\{ title: item\.title \|\| item\.url, url: item\.url \}\];/);
  assert.match(source, /searchResults\.sections = \[\{ type: 'links', content: structuredResults \}\];/);
  assert.match(source, /const plainTextLinks = extractPlainTextLinks\(resultContent\);/);
  assert.match(source, /if \(plainTextLinks\.length > 0\) \{[\s\S]*\{ type: 'links', content: plainTextLinks \},[\s\S]*\}/);
  assert.match(source, /else \{[\s\S]*searchResults\.noResults = resultContent\.toLowerCase\(\)\.includes\('no links found'\)/);
});
