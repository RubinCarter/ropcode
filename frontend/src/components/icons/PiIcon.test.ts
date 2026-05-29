import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const piIconPath = path.resolve(currentDir, './PiIcon.tsx');

test('PiIcon uses the official pixel logo paths instead of a generic math glyph', async () => {
  const source = await readFile(piIconPath, 'utf8');

  assert.doesNotMatch(source, /lucide-react|Sigma/);
  assert.match(source, /viewBox="0 0 800 800"/);
  assert.match(source, /M165\.29 165\.29H517\.36V400H400V517\.36H282\.65V634\.72H165\.29ZM282\.65 282\.65V400H400V282\.65Z/);
  assert.match(source, /M517\.36 400H634\.72V634\.72H517\.36Z/);
});
