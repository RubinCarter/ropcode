import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(currentDir, '../locales');

function getKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null
      ? getKeys(v as Record<string, unknown>, key)
      : [key];
  });
}

test('en.json and zh.json have identical key sets', async () => {
  const en = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8'));
  const zh = JSON.parse(await fs.readFile(path.join(localesDir, 'zh.json'), 'utf8'));
  const enKeys = getKeys(en).sort();
  const zhKeys = getKeys(zh).sort();

  const missingInZh = enKeys.filter(k => !zhKeys.includes(k));
  const extraInZh = zhKeys.filter(k => !enKeys.includes(k));

  assert.deepEqual(missingInZh, [], `Keys in en.json missing from zh.json: ${missingInZh.join(', ')}`);
  assert.deepEqual(extraInZh, [], `Extra keys in zh.json not in en.json: ${extraInZh.join(', ')}`);
});

test('no empty translation values in either language', async () => {
  for (const lang of ['en', 'zh']) {
    const data = JSON.parse(await fs.readFile(path.join(localesDir, `${lang}.json`), 'utf8'));
    const keys = getKeys(data);
    for (const key of keys) {
      const value = key.split('.').reduce((o: any, k) => o[k], data);
      assert.ok(typeof value === 'string' && value.length > 0, `${lang}: "${key}" must be a non-empty string`);
    }
  }
});

test('interpolation placeholders match between en and zh', async () => {
  const en = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8'));
  const zh = JSON.parse(await fs.readFile(path.join(localesDir, 'zh.json'), 'utf8'));
  const enKeys = getKeys(en);
  const mismatches: string[] = [];

  for (const key of enKeys) {
    const enVal = key.split('.').reduce((o: any, k) => o[k], en) as string;
    const zhVal = key.split('.').reduce((o: any, k) => o[k], zh) as string;
    if (!zhVal) continue;
    const enPlaceholders = (enVal.match(/\{\{\w+\}\}/g) || []).sort();
    const zhPlaceholders = (zhVal.match(/\{\{\w+\}\}/g) || []).sort();
    if (JSON.stringify(enPlaceholders) !== JSON.stringify(zhPlaceholders)) {
      mismatches.push(`"${key}": en=${JSON.stringify(enPlaceholders)} zh=${JSON.stringify(zhPlaceholders)}`);
    }
  }

  assert.deepEqual(mismatches, [], `Placeholder mismatches:\n${mismatches.join('\n')}`);
});

test('no hardcoded user-visible strings remain in translated components', async () => {
  const componentsDir = path.resolve(currentDir, '../components');
  const sidebarRail = await fs.readFile(path.join(componentsDir, 'sidebar/SidebarRail.tsx'), 'utf8');
  // Spot-check: SidebarRail should not have bare "Projects" or "Settings" strings as labels
  assert.ok(!sidebarRail.includes('label="Projects"'), 'SidebarRail still has hardcoded "Projects"');
  assert.ok(!sidebarRail.includes('label="Settings"'), 'SidebarRail still has hardcoded "Settings"');
  assert.ok(sidebarRail.includes('useTranslation'), 'SidebarRail must use useTranslation');
});
