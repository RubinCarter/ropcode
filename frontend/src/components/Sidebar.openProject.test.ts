import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('Sidebar open-project success handler tolerates missing callback payload', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './Sidebar.tsx'), 'utf8');

  assert.match(source, /const handleOpenProjectSuccess = useCallback\(\(project\?: Project\)/);
  assert.match(source, /if \(project\?\.path\) \{/);
  assert.match(source, /handleProjectClick\(project\);/);
});
