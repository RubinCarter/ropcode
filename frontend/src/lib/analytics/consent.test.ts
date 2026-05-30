import test from 'node:test';
import assert from 'node:assert/strict';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const storage = new LocalStorageMock();
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

async function freshConsentManager() {
  const mod = await import('./consent');
  (mod.ConsentManager as any).instance = undefined;
  return mod.ConsentManager.getInstance();
}

test('analytics starts disabled without implicit consent', async () => {
  storage.clear();
  const manager = await freshConsentManager();

  const settings = await manager.initialize();

  assert.equal(settings.enabled, false);
  assert.equal(settings.hasConsented, false);
  assert.equal(manager.isEnabled(), false);
});

test('legacy implicit consent is migrated back to opt-in', async () => {
  storage.clear();
  storage.setItem('ropcode-analytics-settings', JSON.stringify({
    enabled: true,
    hasConsented: true,
    userId: 'legacy-user',
  }));
  const manager = await freshConsentManager();

  const settings = await manager.initialize();

  assert.equal(settings.enabled, false);
  assert.equal(settings.hasConsented, false);
  assert.equal(settings.userId, 'legacy-user');
});

test('declining analytics records a completed disabled choice', async () => {
  storage.clear();
  const manager = await freshConsentManager();

  await manager.initialize();
  await manager.revokeConsent();

  assert.equal(manager.isEnabled(), false);
  assert.equal(manager.hasConsented(), true);
});

test('explicit opt-in remains enabled', async () => {
  storage.clear();
  storage.setItem('ropcode-analytics-settings', JSON.stringify({
    enabled: true,
    hasConsented: true,
    consentDate: '2026-05-30T00:00:00.000Z',
    userId: 'opted-in-user',
  }));
  const manager = await freshConsentManager();

  const settings = await manager.initialize();

  assert.equal(settings.enabled, true);
  assert.equal(settings.hasConsented, true);
  assert.equal(settings.userId, 'opted-in-user');
});
