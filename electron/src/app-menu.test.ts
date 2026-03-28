import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAppMenuTemplate } from './app-menu';

type MenuLike = { label?: string; submenu?: MenuLike[] };

function flattenLabels(items: MenuLike[]): string[] {
  const labels: string[] = [];
  for (const item of items) {
    if (item.label) labels.push(item.label);
    if (Array.isArray(item.submenu)) {
      labels.push(...flattenLabels(item.submenu));
    }
  }
  return labels;
}

test('buildAppMenuTemplate includes Install CLI to PATH on macOS', () => {
  const template = buildAppMenuTemplate('darwin', async () => {});
  const labels = flattenLabels(template as MenuLike[]);
  assert.ok(labels.includes('Install CLI to PATH'));
});

test('buildAppMenuTemplate includes Install CLI to PATH on Windows and Linux', () => {
  for (const platform of ['linux', 'win32'] as const) {
    const template = buildAppMenuTemplate(platform, async () => {});
    const labels = flattenLabels(template as MenuLike[]);
    assert.ok(labels.includes('Install CLI to PATH'));
  }
});
