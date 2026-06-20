import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, clampMax, DEFAULT_SETTINGS } from '../src/settings';

const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys: string[]) => Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
        set: (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
    },
  } as unknown as typeof chrome;
});

describe('settings', () => {
  it('clampMax bounds to [1000, 50000]', () => {
    expect(clampMax(10)).toBe(1000);
    expect(clampMax(99999)).toBe(50000);
    expect(clampMax(12345)).toBe(12345);
  });
  it('loads defaults when empty', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('saves a patch and reloads merged', async () => {
    await saveSettings({ maxComments: 2000 });
    expect((await loadSettings()).maxComments).toBe(2000);
  });
});
