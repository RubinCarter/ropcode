import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const systemContainerPath = path.resolve(currentDir, './SystemContainer.tsx');

test('SystemContainer imports Settings statically for first-click responsiveness', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.match(source, /import \{ Settings \} from '@\/components\/Settings';/);
  assert.doesNotMatch(source, /const Settings = lazy\(/);
});
