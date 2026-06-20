import type { GenericSelectors } from './shared/model';
import type { SearchMode } from './shared/search';

export interface Settings {
  maxComments: number;
  defaultMode: SearchMode;
  genericByHost: Record<string, GenericSelectors>;
}

export const DEFAULT_SETTINGS: Settings = { maxComments: 10_000, defaultMode: 'substring', genericByHost: {} };

const KEY = 'settings';

export function clampMax(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxComments;
  return Math.min(50_000, Math.max(1_000, Math.floor(n)));
}

export async function loadSettings(): Promise<Settings> {
  const got = (await chrome.storage.local.get([KEY])) as Record<string, Partial<Settings> | undefined>;
  const s = got[KEY] ?? {};
  return {
    maxComments: clampMax(s.maxComments ?? DEFAULT_SETTINGS.maxComments),
    defaultMode: s.defaultMode ?? DEFAULT_SETTINGS.defaultMode,
    genericByHost: s.genericByHost ?? {},
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  next.maxComments = clampMax(next.maxComments);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
