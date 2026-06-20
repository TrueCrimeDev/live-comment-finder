# Live Comment Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that captures DOM-rendered live comments (YouTube Live Chat + a generic user-selected feed), retains them after the site removes their nodes, and lets the user search them in real time from a side panel — all on-device, nothing transmitted.

**Architecture:** Four bundle entries. A **content script** owns capture (one `MutationObserver`), dedup, and a per-tab ring buffer, and is the source of truth that survives service-worker suspension. A thin **service worker** opens the side panel, tracks the active tab, and performs privileged generic-injection/permission requests. A vanilla-TS **side panel** mirrors the active tab's comments, searches/filters/sorts, windows the result list, and exports. **Shared** pure modules (model, messages+validators, normalize, dedup, ring buffer, search, export) carry the testable logic with no DOM/Chrome dependency.

**Tech Stack:** TypeScript (strict), Vite 5 + `@crxjs/vite-plugin` v2, Vitest + jsdom, ESLint 9 (flat) + typescript-eslint + Prettier, npm, Node 18.

## Global Constraints

- Manifest V3 only. TypeScript `strict: true`; no `any` without a justifying comment.
- `MutationObserver` for capture — never frequent DOM polling.
- `chrome.storage.local` stores **settings only**; never comment content. No persistence of comment content across browser restarts.
- Permissions least-privilege: `sidePanel`, `storage`, `activeTab`, `scripting`; static host `*://*.youtube.com/*`; generic adapter requests current host at runtime via `chrome.permissions.request`. **No `<all_urls>`.**
- No analytics/telemetry/remote logging, no network transmission of captured data, no remote code, no `eval`/`new Function`. **Never** render page-derived content via `innerHTML` — text nodes / `textContent` only.
- Ring buffer default 10,000; user-configurable 1,000–50,000; evict oldest first.
- Search modes: case-insensitive substring (default), case-sensitive, whole-word (Unicode-aware where practical), exact-phrase, regex (invalid → inline message, never throw). Author filter; combined author+text; newest/oldest sort.
- Precompute normalized `searchAuthor`/`searchText` at capture; do not re-normalize per keystroke.
- Git: dedicated local repo, identity `TrueCrimeAudit <truecrime.audit@gmail.com>`, **local commits only — do not push**. Commit message trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01QD6o9JkizStQLT2pzB9ZJ9`.
- Acceptance = the 20 criteria in `claude.md`. Report build/lint/typecheck/test results honestly.

---

## File Structure

```
package.json  tsconfig.json  vite.config.ts  vitest.config.ts
eslint.config.js  .prettierrc  .gitignore  README.md
src/
  manifest.config.ts
  settings.ts
  shared/  model.ts  messages.ts  normalize.ts  dedup.ts  ring-buffer.ts  search.ts  export.ts
  content/  main.ts  bootstrap.ts  capture-controller.ts  highlight.ts
    adapters/  types.ts  registry.ts  youtube.ts  generic.ts
    picker/  overlay.ts
  background/  service-worker.ts
  sidepanel/  index.html  main.ts  state.ts  render.ts  styles.css
  icons/  icon16.png  icon32.png  icon48.png  icon128.png
demo/  index.html  feed.js
test/  fixtures/  *.test.ts
```

Build order is the task order: toolchain → shared pure logic → content capture → worker → panel → demo → docs → verification. Each task ends with an independently testable deliverable and a commit.

---

### Task 1: Toolchain scaffold + loadable empty extension

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore` (exists — extend), `src/manifest.config.ts`, `src/icons/*.png`, `src/background/service-worker.ts` (stub), `src/sidepanel/index.html` (stub), `src/sidepanel/main.ts` (stub), `src/content/main.ts` (stub)

**Interfaces:**
- Produces: a build at `dist/` loadable as an unpacked extension; `npm run build|test|lint|typecheck` scripts.

- [ ] **Step 1: Create `package.json`** (pin exact versions after install in Step 3)

```json
{
  "name": "live-comment-finder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "2.0.0-beta.23",
    "@types/chrome": "0.0.270",
    "@typescript-eslint/eslint-plugin": "8.8.0",
    "@typescript-eslint/parser": "8.8.0",
    "eslint": "9.11.1",
    "jsdom": "25.0.1",
    "prettier": "3.3.3",
    "typescript": "5.6.2",
    "vite": "5.4.8",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Install and pin**

Run: `npm install`
Then replace each `^`/range with the exact installed version (read `npm ls --depth=0`). Expected: `node_modules/` populated, no peer-dep errors that block build. If `@crxjs/vite-plugin@2.0.0-beta.23` is unavailable, install `@crxjs/vite-plugin@beta`, then pin the resolved version into `package.json`.

- [ ] **Step 4: Create `src/manifest.config.ts`**

```ts
import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Live Comment Finder',
  version: pkg.version,
  description: 'Capture and search live comments on the current page. All data stays on your device.',
  minimum_chrome_version: '116',
  icons: { '16': 'src/icons/icon16.png', '32': 'src/icons/icon32.png', '48': 'src/icons/icon48.png', '128': 'src/icons/icon128.png' },
  action: { default_title: 'Live Comment Finder' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
  host_permissions: ['*://*.youtube.com/*'],
  content_scripts: [
    { matches: ['*://*.youtube.com/*'], js: ['src/content/main.ts'], all_frames: true, run_at: 'document_idle' },
  ],
  web_accessible_resources: [
    { resources: ['src/content/main.ts'], matches: ['<all_urls>'] },
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self';" },
});
```

> `web_accessible_resources` lists the content bundle so the worker can inject it on demand for the generic adapter after a runtime host-permission grant. `matches: ['<all_urls>']` here only makes the *built file* reachable for injection; it does NOT grant host access — access still requires `chrome.permissions.request`.

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { target: 'es2022', sourcemap: true, emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] },
});
```

> jsdom is selected per-file with a `// @vitest-environment jsdom` docblock; pure-logic tests stay on the faster `node` env.

- [ ] **Step 7: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.ts', '*.config.js', 'demo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { chrome: 'readonly' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    },
  },
);
```

Add `@eslint/js` and `typescript-eslint` (the meta package) to devDependencies and `npm install` them; pin resolved versions.

- [ ] **Step 8: Create `.prettierrc`**

```json
{ "singleQuote": true, "semi": true, "printWidth": 120, "trailingComma": "all" }
```

- [ ] **Step 9: Extend `.gitignore`** — ensure it contains `node_modules/`, `dist/`, `*.log`, `.DS_Store`.

- [ ] **Step 10: Generate icons** — create `src/icons/icon{16,32,48,128}.png`. Use Node + a tiny PNG writer, or a one-off script drawing a speech-bubble + magnifier glyph on the brand background `#0f0f0f` with accent `#5B9FEF`. Acceptable approach: write `scripts/make-icons.mjs` that emits solid-rounded-square PNGs with a centered glyph using the `pngjs` devDependency (pin it), run it, then delete the script dependency note from README if unused. Deliverable: four non-empty PNGs at the listed paths.

- [ ] **Step 11: Stub the three entries so the build is valid and loadable**

`src/background/service-worker.ts`:
```ts
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
```

`src/sidepanel/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Live Comment Finder</title></head>
  <body><div id="app">Loading…</div><script type="module" src="./main.ts"></script></body>
</html>
```

`src/sidepanel/main.ts`:
```ts
document.getElementById('app')!.textContent = 'Live Comment Finder';
```

`src/content/main.ts`:
```ts
// Boot guard prevents double-init when statically matched AND injected.
declare global { interface Window { __lcfBooted?: boolean } }
if (!window.__lcfBooted) {
  window.__lcfBooted = true;
  // capture bootstrap wired in Task 15
}
export {};
```

- [ ] **Step 12: Verify toolchain**

Run: `npm run typecheck` → Expected: PASS (0 errors).
Run: `npm run lint` → Expected: PASS.
Run: `npm run build` → Expected: writes `dist/` with `manifest.json`, service worker, side panel, content script, icons.
Run: `npm test` → Expected: "No test files found" is acceptable at this point (exit 0 with `--passWithNoTests`); add `--passWithNoTests` to the `test` script temporarily, remove once Task 2 adds tests.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore(scaffold): vite+crxjs MV3 toolchain, manifest, icons, stub entries"
```

---

### Task 2: Shared model + message contracts with validators

**Files:**
- Create: `src/shared/model.ts`, `src/shared/messages.ts`, `test/messages.test.ts`

**Interfaces:**
- Produces: `CapturedComment`, `ParsedComment`, `CommentLocator`, `AdapterContext`, `CaptureState`; the `Message` union; `validateMessage(value: unknown): Message | null`; per-type guards.

- [ ] **Step 1: Write `src/shared/model.ts`**

```ts
export type CaptureState = 'connected' | 'paused' | 'unsupported' | 'feed-not-found' | 'permission-required';

export interface CommentLocator {
  /** Adapter id that produced this locator. */
  adapter: string;
  /** Platform message id, when the site exposes one. */
  messageId?: string;
  /** Fallback CSS-ish hint for re-finding a node; never a live DOM element. */
  selectorHint?: string;
}

export interface CapturedComment {
  id: string;
  source: string;
  tabId?: number;
  frameId?: number;
  author: string;
  text: string;
  displayedTimestamp?: string;
  capturedAt: number;
  locator?: CommentLocator;
  metadata?: Record<string, string | number | boolean>;
  /** Precomputed normalized fields for fast search (set at capture). */
  searchAuthor: string;
  searchText: string;
}

/** What an adapter returns from parseComment — no id/searchable fields yet. */
export interface ParsedComment {
  author: string;
  text: string;
  displayedTimestamp?: string;
  /** Platform message id if available; drives dedup. */
  messageId?: string;
  locator?: CommentLocator;
  metadata?: Record<string, string | number | boolean>;
}

export interface AdapterContext {
  document: Document;
  location: Location;
  source: string;
  /** Per-host generic selectors, when configured. */
  genericSelectors?: GenericSelectors;
}

export interface GenericSelectors {
  item: string;
  author?: string;
  text?: string;
  timestamp?: string;
}
```

- [ ] **Step 2: Write `test/messages.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { validateMessage } from '../src/shared/messages';

describe('validateMessage', () => {
  it('accepts a well-formed NEW_COMMENT_BATCH', () => {
    const msg = { type: 'NEW_COMMENT_BATCH', tabId: 3, comments: [] };
    expect(validateMessage(msg)?.type).toBe('NEW_COMMENT_BATCH');
  });
  it('rejects unknown type', () => {
    expect(validateMessage({ type: 'NOPE' })).toBeNull();
  });
  it('rejects missing discriminant', () => {
    expect(validateMessage({ comments: [] })).toBeNull();
  });
  it('rejects non-object', () => {
    expect(validateMessage(42)).toBeNull();
    expect(validateMessage(null)).toBeNull();
  });
  it('validates LOCATE_COMMENT requires string id', () => {
    expect(validateMessage({ type: 'LOCATE_COMMENT', id: 'a' })?.type).toBe('LOCATE_COMMENT');
    expect(validateMessage({ type: 'LOCATE_COMMENT' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL** (`Cannot find module messages`). `npx vitest run test/messages.test.ts`.

- [ ] **Step 4: Write `src/shared/messages.ts`**

```ts
import type { CapturedComment, CaptureState, GenericSelectors } from './model';

export type Message =
  | { type: 'START_CAPTURE' }
  | { type: 'PAUSE_CAPTURE' }
  | { type: 'RESUME_CAPTURE' }
  | { type: 'STOP_CAPTURE' }
  | { type: 'REQUEST_SNAPSHOT' }
  | { type: 'SNAPSHOT'; tabId?: number; comments: CapturedComment[]; state: CaptureState }
  | { type: 'NEW_COMMENT_BATCH'; tabId?: number; comments: CapturedComment[] }
  | { type: 'CAPTURE_STATUS'; state: CaptureState; source?: string; capturedCount?: number }
  | { type: 'LOCATE_COMMENT'; id: string }
  | { type: 'LOCATE_RESULT'; id: string; found: boolean }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'BEGIN_ELEMENT_SELECTION' }
  | { type: 'SELECTION_COMPLETED'; cancelled: boolean; selectors?: GenericSelectors; host?: string }
  | { type: 'ACTIVE_TAB_CHANGED'; tabId: number }
  | { type: 'ERROR'; message: string };

export type MessageType = Message['type'];

const TYPES = new Set<MessageType>([
  'START_CAPTURE', 'PAUSE_CAPTURE', 'RESUME_CAPTURE', 'STOP_CAPTURE', 'REQUEST_SNAPSHOT',
  'SNAPSHOT', 'NEW_COMMENT_BATCH', 'CAPTURE_STATUS', 'LOCATE_COMMENT', 'LOCATE_RESULT',
  'CLEAR_HISTORY', 'BEGIN_ELEMENT_SELECTION', 'SELECTION_COMPLETED', 'ACTIVE_TAB_CHANGED', 'ERROR',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Returns the message if its shape is valid for its type, else null. */
export function validateMessage(value: unknown): Message | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !TYPES.has(value.type as MessageType)) return null;
  const t = value.type as MessageType;
  switch (t) {
    case 'LOCATE_COMMENT':
      return typeof value.id === 'string' ? (value as Message) : null;
    case 'LOCATE_RESULT':
      return typeof value.id === 'string' && typeof value.found === 'boolean' ? (value as Message) : null;
    case 'NEW_COMMENT_BATCH':
    case 'SNAPSHOT':
      return Array.isArray(value.comments) ? (value as Message) : null;
    case 'CAPTURE_STATUS':
      return typeof value.state === 'string' ? (value as Message) : null;
    case 'SELECTION_COMPLETED':
      return typeof value.cancelled === 'boolean' ? (value as Message) : null;
    case 'ACTIVE_TAB_CHANGED':
      return typeof value.tabId === 'number' ? (value as Message) : null;
    case 'ERROR':
      return typeof value.message === 'string' ? (value as Message) : null;
    default:
      return value as Message; // tag-only messages
  }
}
```

- [ ] **Step 5: Run → PASS.** `npx vitest run test/messages.test.ts`. Remove the temporary `--passWithNoTests` from the `test` script.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(shared): data model + discriminated message union with validators"`

---

### Task 3: Text normalization

**Files:** Create `src/shared/normalize.ts`, `test/normalize.test.ts`

**Interfaces:**
- Produces: `normalize(text: string): string` (lowercased, NFC, collapsed whitespace, trimmed — preserves emoji, non-Latin, punctuation); `collapseWhitespace(text: string): string` (preserves line breaks as single `\n`).

- [ ] **Step 1: Write `test/normalize.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { normalize, collapseWhitespace } from '../src/shared/normalize';

describe('normalize', () => {
  it('lowercases and trims', () => expect(normalize('  Hello WORLD ')).toBe('hello world'));
  it('collapses internal whitespace', () => expect(normalize('a\t\t b')).toBe('a b'));
  it('preserves emoji', () => expect(normalize('Nice 🎉')).toBe('nice 🎉'));
  it('preserves non-Latin', () => expect(normalize('Привет МИР')).toBe('привет мир'));
  it('NFC-normalizes composed vs decomposed', () =>
    expect(normalize('é')).toBe(normalize('é')));
});

describe('collapseWhitespace', () => {
  it('keeps single newlines, trims line ends', () =>
    expect(collapseWhitespace('a  \n  b\n\n\nc')).toBe('a\nb\nc'));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/shared/normalize.ts`**

```ts
/** Collapse runs of spaces/tabs to one space and runs of newlines to one, trimming each line. */
export function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line, i, arr) => line !== '' || (i > 0 && i < arr.length - 1 && arr[i - 1] !== ''))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Searchable normalized form: NFC, lowercased, whitespace collapsed. Preserves emoji/unicode. */
export function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run → PASS.** Adjust the `collapseWhitespace` filter only if the multi-blank case fails; the `\n{2,}` collapse is the load-bearing line.

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): unicode-safe text normalization"`

---

### Task 4: Deduplication + stable fingerprint

**Files:** Create `src/shared/dedup.ts`, `test/dedup.test.ts`

**Interfaces:**
- Produces: `fingerprint(p: { source: string; author: string; text: string; displayedTimestamp?: string; capturedAt: number }): string`; `class Deduper { has(id): boolean; add(id): void; size: number }`; `commentId(parsed: ParsedComment, source: string, capturedAt: number): string` (uses `messageId` when present, else fingerprint).

- [ ] **Step 1: Write `test/dedup.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { fingerprint, commentId, Deduper } from '../src/shared/dedup';

const base = { source: 'youtube', author: 'Ann', text: 'hi', capturedAt: 1000 };

describe('fingerprint', () => {
  it('is stable for identical input within the same time bucket', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base, capturedAt: 1500 }));
  });
  it('differs for different authors with same text', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, author: 'Bob' }));
  });
  it('keeps two users posting identical text distinct', () => {
    expect(fingerprint({ ...base, author: 'A' })).not.toBe(fingerprint({ ...base, author: 'B' }));
  });
  it('separates identical text far apart in time (different buckets)', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, capturedAt: 1000 + 5 * 60_000 }));
  });
});

describe('commentId', () => {
  it('prefers platform messageId', () => {
    expect(commentId({ author: 'Ann', text: 'hi', messageId: 'X1' }, 'youtube', 1000)).toBe('youtube:X1');
  });
  it('falls back to fingerprint when no messageId', () => {
    const id = commentId({ author: 'Ann', text: 'hi' }, 'youtube', 1000);
    expect(id.startsWith('youtube:fp:')).toBe(true);
  });
});

describe('Deduper', () => {
  it('reports and remembers seen ids', () => {
    const d = new Deduper();
    expect(d.has('a')).toBe(false);
    d.add('a');
    expect(d.has('a')).toBe(true);
    expect(d.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/shared/dedup.ts`**

```ts
import type { ParsedComment } from './model';
import { normalize } from './normalize';

/** Bucket width for the fallback fingerprint's time component (ms). */
const TIME_BUCKET_MS = 2 * 60_000;

function hash(input: string): string {
  // FNV-1a 32-bit — deterministic, dependency-free, good enough for dedup keys.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function fingerprint(p: {
  source: string; author: string; text: string; displayedTimestamp?: string; capturedAt: number;
}): string {
  const bucket = Math.floor(p.capturedAt / TIME_BUCKET_MS);
  const key = [p.source, normalize(p.author), normalize(p.text), p.displayedTimestamp ?? '', bucket].join(' ');
  return hash(key);
}

export function commentId(parsed: ParsedComment, source: string, capturedAt: number): string {
  if (parsed.messageId) return `${source}:${parsed.messageId}`;
  return `${source}:fp:${fingerprint({ source, author: parsed.author, text: parsed.text, displayedTimestamp: parsed.displayedTimestamp, capturedAt })}`;
}

export class Deduper {
  private seen = new Set<string>();
  get size(): number { return this.seen.size; }
  has(id: string): boolean { return this.seen.has(id); }
  add(id: string): void { this.seen.add(id); }
  delete(id: string): void { this.seen.delete(id); }
  clear(): void { this.seen.clear(); }
}
```

- [ ] **Step 4: Run → PASS.** Note: the first fingerprint test uses `capturedAt` 1000 and 1500 — both in bucket 0 (width 120000), so equal. The far-apart test uses +5min → bucket differs. Verify both hold.

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): dedup with platform-id-or-fingerprint and time bucketing"`

---

### Task 5: Ring buffer

**Files:** Create `src/shared/ring-buffer.ts`, `test/ring-buffer.test.ts`

**Interfaces:**
- Produces: `class RingBuffer<T> { constructor(capacity); push(item): T | undefined /* evicted */; toArray(): T[]; get size; get capacity; setCapacity(n); clear() }`. Capacity clamped to [1000, 50000] by caller; the buffer itself accepts any ≥1.

- [ ] **Step 1: Write `test/ring-buffer.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/shared/ring-buffer';

describe('RingBuffer', () => {
  it('keeps insertion order until full', () => {
    const r = new RingBuffer<number>(3);
    r.push(1); r.push(2); r.push(3);
    expect(r.toArray()).toEqual([1, 2, 3]);
    expect(r.size).toBe(3);
  });
  it('evicts oldest first and returns the evicted item', () => {
    const r = new RingBuffer<number>(2);
    r.push(1); r.push(2);
    expect(r.push(3)).toBe(1);
    expect(r.toArray()).toEqual([2, 3]);
  });
  it('shrinking capacity drops oldest', () => {
    const r = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    r.setCapacity(2);
    expect(r.toArray()).toEqual([4, 5]);
  });
  it('clear empties', () => {
    const r = new RingBuffer<number>(3);
    r.push(1); r.clear();
    expect(r.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/shared/ring-buffer.ts`**

```ts
export class RingBuffer<T> {
  private items: T[] = [];
  private cap: number;

  constructor(capacity: number) {
    this.cap = Math.max(1, Math.floor(capacity));
  }

  get size(): number { return this.items.length; }
  get capacity(): number { return this.cap; }

  /** Append; if over capacity, evict and return the oldest item, else undefined. */
  push(item: T): T | undefined {
    this.items.push(item);
    if (this.items.length > this.cap) return this.items.shift();
    return undefined;
  }

  setCapacity(n: number): void {
    this.cap = Math.max(1, Math.floor(n));
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  toArray(): T[] { return this.items.slice(); }
  clear(): void { this.items = []; }
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): bounded ring buffer with oldest-first eviction"`

---

### Task 6: Search engine

**Files:** Create `src/shared/search.ts`, `test/search.test.ts`

**Interfaces:**
- Produces:
  - `type SearchMode = 'substring' | 'case-sensitive' | 'whole-word' | 'exact-phrase' | 'regex'`
  - `interface SearchCriteria { query: string; author: string; mode: SearchMode; sort: 'newest' | 'oldest' }`
  - `interface CompiledQuery { test(c: CapturedComment): boolean; error?: string }`
  - `compile(criteria): CompiledQuery` (regex errors → `{ test: () => true is NOT used; returns error }`; on error, `test` matches nothing and `error` is set)
  - `search(comments: CapturedComment[], criteria): { results: CapturedComment[]; error?: string }`
  - `matchRanges(text: string, criteria): Array<[number, number]>` for highlighting (operates on raw text, case per mode).

- [ ] **Step 1: Write `test/search.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { search, matchRanges } from '../src/shared/search';
import type { CapturedComment } from '../src/shared/model';
import { normalize } from '../src/shared/normalize';

function c(author: string, text: string, capturedAt: number): CapturedComment {
  return { id: `${author}:${text}:${capturedAt}`, source: 'test', author, text, capturedAt,
    searchAuthor: normalize(author), searchText: normalize(text) };
}
const data = [c('Ann', 'Hello world', 1), c('Bob', 'hello there', 2), c('Ann', 'GBWhopper cats', 3)];
const crit = { query: '', author: '', mode: 'substring' as const, sort: 'newest' as const };

describe('search', () => {
  it('case-insensitive substring by default', () => {
    expect(search(data, { ...crit, query: 'hello' }).results.length).toBe(2);
  });
  it('case-sensitive mode', () => {
    expect(search(data, { ...crit, query: 'Hello', mode: 'case-sensitive' }).results.length).toBe(1);
  });
  it('whole-word mode', () => {
    expect(search(data, { ...crit, query: 'cat', mode: 'whole-word' }).results.length).toBe(0);
    expect(search(data, { ...crit, query: 'cats', mode: 'whole-word' }).results.length).toBe(1);
  });
  it('exact-phrase mode', () => {
    expect(search(data, { ...crit, query: 'hello world', mode: 'exact-phrase' }).results.length).toBe(1);
  });
  it('regex mode', () => {
    expect(search(data, { ...crit, query: '^hello', mode: 'regex' }).results.length).toBe(2);
  });
  it('invalid regex returns error, no throw', () => {
    const r = search(data, { ...crit, query: '(', mode: 'regex' });
    expect(r.error).toBeTruthy();
    expect(r.results.length).toBe(0);
  });
  it('author filter', () => {
    expect(search(data, { ...crit, author: 'ann' }).results.length).toBe(2);
  });
  it('combined author + text', () => {
    expect(search(data, { ...crit, author: 'ann', query: 'hello' }).results.length).toBe(1);
  });
  it('sort oldest vs newest', () => {
    expect(search(data, { ...crit, sort: 'oldest' }).results[0].capturedAt).toBe(1);
    expect(search(data, { ...crit, sort: 'newest' }).results[0].capturedAt).toBe(3);
  });
});

describe('matchRanges', () => {
  it('returns highlight ranges for substring', () => {
    expect(matchRanges('Hello hello', { ...crit, query: 'hello' })).toEqual([[0, 5], [6, 11]]);
  });
  it('empty query yields no ranges', () => {
    expect(matchRanges('abc', crit)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/shared/search.ts`**

```ts
import type { CapturedComment } from './model';
import { normalize } from './normalize';

export type SearchMode = 'substring' | 'case-sensitive' | 'whole-word' | 'exact-phrase' | 'regex';

export interface SearchCriteria {
  query: string;
  author: string;
  mode: SearchMode;
  sort: 'newest' | 'oldest';
}

export interface CompiledQuery {
  /** Test the normalized/raw text field of a comment. */
  test: (c: CapturedComment) => boolean;
  error?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a RegExp for the text query per mode, or return an error string. */
function buildTextRegex(criteria: SearchCriteria): { re: RegExp | null; error?: string } {
  const { query, mode } = criteria;
  if (query === '') return { re: null };
  try {
    switch (mode) {
      case 'case-sensitive':
        return { re: new RegExp(escapeRegExp(query), 'g') };
      case 'whole-word':
        return { re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(query)}(?![\\p{L}\\p{N}_])`, 'giu') };
      case 'exact-phrase':
        return { re: new RegExp(escapeRegExp(query), 'gi') };
      case 'regex':
        return { re: new RegExp(query, 'gi') };
      case 'substring':
      default:
        return { re: new RegExp(escapeRegExp(query), 'gi') };
    }
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : 'Invalid pattern' };
  }
}

export function compile(criteria: SearchCriteria): CompiledQuery {
  const authorNeedle = normalize(criteria.author);
  const { re, error } = buildTextRegex(criteria);
  if (error) return { test: () => false, error };
  return {
    test: (c: CapturedComment) => {
      if (authorNeedle && !c.searchAuthor.includes(authorNeedle)) return false;
      if (!re) return true;
      re.lastIndex = 0;
      // case-sensitive tests raw text; others test raw text too (regex carries i flag).
      return re.test(c.text);
    },
  };
}

export function search(comments: CapturedComment[], criteria: SearchCriteria): { results: CapturedComment[]; error?: string } {
  const q = compile(criteria);
  if (q.error) return { results: [], error: q.error };
  const filtered = comments.filter(q.test);
  filtered.sort((a, b) => (criteria.sort === 'newest' ? b.capturedAt - a.capturedAt : a.capturedAt - b.capturedAt));
  return { results: filtered };
}

export function matchRanges(text: string, criteria: SearchCriteria): Array<[number, number]> {
  const { re } = buildTextRegex(criteria);
  if (!re) return [];
  const ranges: Array<[number, number]> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}
```

- [ ] **Step 4: Run → PASS.** The whole-word `\p{L}` boundaries require the `u` flag (present). Verify the `cat`/`cats` case.

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): search engine — five modes, author + combined filters, sort, highlight ranges"`

---

### Task 7: Export (JSON + CSV)

**Files:** Create `src/shared/export.ts`, `test/export.test.ts`

**Interfaces:**
- Produces: `toJSON(comments: CapturedComment[]): string`; `toCSV(comments: CapturedComment[]): string` (RFC-4180 quoting + leading `=+-@` neutralized to block CSV injection).

- [ ] **Step 1: Write `test/export.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { toJSON, toCSV } from '../src/shared/export';
import type { CapturedComment } from '../src/shared/model';

const rows: CapturedComment[] = [
  { id: '1', source: 'youtube', author: 'Ann', text: 'hi, "you"', capturedAt: 1000, searchAuthor: 'ann', searchText: 'hi, "you"' },
  { id: '2', source: 'youtube', author: '=cmd()', text: 'line1\nline2', capturedAt: 2000, searchAuthor: '=cmd()', searchText: 'line1\nline2' },
];

describe('toCSV', () => {
  it('quotes fields with commas, quotes, newlines', () => {
    const csv = toCSV(rows);
    expect(csv.split('\n')[0]).toContain('author');
    expect(csv).toContain('"hi, ""you"""');
    expect(csv).toContain('"line1\nline2"');
  });
  it('neutralizes formula-injection leading characters', () => {
    expect(toCSV(rows)).toContain("'=cmd()");
  });
});

describe('toJSON', () => {
  it('round-trips comments', () => {
    expect(JSON.parse(toJSON(rows)).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/shared/export.ts`**

```ts
import type { CapturedComment } from './model';

const COLUMNS = ['id', 'source', 'author', 'text', 'displayedTimestamp', 'capturedAt'] as const;

function neutralize(field: string): string {
  return /^[=+\-@]/.test(field) ? `'${field}` : field;
}

function csvCell(value: string | number | undefined): string {
  let s = value === undefined ? '' : String(value);
  s = neutralize(s);
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(comments: CapturedComment[]): string {
  const header = COLUMNS.join(',');
  const lines = comments.map((c) => COLUMNS.map((col) => csvCell(c[col])).join(','));
  return [header, ...lines].join('\n');
}

export function toJSON(comments: CapturedComment[]): string {
  // Strip precomputed search fields from the export; keep the user-meaningful shape.
  const view = comments.map(({ searchAuthor: _a, searchText: _t, ...rest }) => rest);
  return JSON.stringify(view, null, 2);
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): JSON + injection-safe CSV export"`

---

### Task 8: Settings (chrome.storage.local — settings only)

**Files:** Create `src/settings.ts`, `test/settings.test.ts`

**Interfaces:**
- Produces: `interface Settings { maxComments: number; defaultMode: SearchMode; genericByHost: Record<string, GenericSelectors> }`; `DEFAULT_SETTINGS`; `loadSettings(): Promise<Settings>`; `saveSettings(patch: Partial<Settings>): Promise<Settings>`; `clampMax(n): number` (1000–50000).

- [ ] **Step 1: Write `test/settings.test.ts` (failing)** — mock `chrome.storage.local`.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings, clampMax, DEFAULT_SETTINGS } from '../src/settings';

const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // @ts-expect-error minimal chrome mock
  globalThis.chrome = {
    storage: { local: {
      get: (keys: string[]) => Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
      set: (obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve(); },
    } },
  };
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
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/settings.ts`**

```ts
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
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(settings): chrome.storage.local settings with clamping and per-host generic selectors"`

---

### Task 9: Adapter interface + registry

**Files:** Create `src/content/adapters/types.ts`, `src/content/adapters/registry.ts`, `test/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface LiveCommentAdapter { id; canHandle(ctx): boolean | Promise<boolean>; locateFeed(ctx): Element | null | Promise<...>; parseComment(node, ctx): ParsedComment[]; locateComment?(locator, ctx): Element | null; start?(): void|Promise; stop?(): void|Promise }`
  - `resolveAdapter(adapters, ctx): Promise<LiveCommentAdapter | null>` — first whose `canHandle` is true.

- [ ] **Step 1: Write `test/registry.test.ts` (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { resolveAdapter } from '../src/content/adapters/registry';
import type { LiveCommentAdapter } from '../src/content/adapters/types';
import type { AdapterContext } from '../src/shared/model';

const ctx = { document: {} as Document, location: { hostname: 'x' } as Location, source: 'x' } as AdapterContext;
function fake(id: string, can: boolean): LiveCommentAdapter {
  return { id, canHandle: () => can, locateFeed: () => null, parseComment: () => [] };
}

describe('resolveAdapter', () => {
  it('returns the first adapter that can handle', async () => {
    expect((await resolveAdapter([fake('a', false), fake('b', true), fake('c', true)], ctx))?.id).toBe('b');
  });
  it('returns null when none match', async () => {
    expect(await resolveAdapter([fake('a', false)], ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/content/adapters/types.ts`**

```ts
import type { AdapterContext, CommentLocator, ParsedComment } from '../../shared/model';

export interface LiveCommentAdapter {
  id: string;
  canHandle(ctx: AdapterContext): boolean | Promise<boolean>;
  locateFeed(ctx: AdapterContext): Element | null | Promise<Element | null>;
  parseComment(node: Node, ctx: AdapterContext): ParsedComment[];
  locateComment?(locator: CommentLocator, ctx: AdapterContext): Element | null;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
```

- [ ] **Step 4: Write `src/content/adapters/registry.ts`**

```ts
import type { AdapterContext } from '../../shared/model';
import type { LiveCommentAdapter } from './types';

export async function resolveAdapter(adapters: LiveCommentAdapter[], ctx: AdapterContext): Promise<LiveCommentAdapter | null> {
  for (const a of adapters) {
    if (await a.canHandle(ctx)) return a;
  }
  return null;
}
```

- [ ] **Step 5: Run → PASS. Commit** — `git commit -am "feat(adapters): adapter interface + first-match registry"`

---

### Task 10: YouTube Live Chat adapter

**Files:** Create `src/content/adapters/youtube.ts`, `test/fixtures/youtube-chat.html`, `test/youtube.test.ts`

**Interfaces:**
- Consumes: `LiveCommentAdapter`, `ParsedComment`, `AdapterContext`.
- Produces: `youtubeAdapter: LiveCommentAdapter` (id `'youtube'`).

**Selector assumptions (documented in-file so repairs are local):**
- Chat item: `yt-live-chat-text-message-renderer` (also handles `#item-offset` containers).
- Author: `#author-name`. Message: `#message`. Timestamp: `#timestamp`.
- Emoji: `img.emoji` → use `alt`. Links: `<a>` → use text content.
- Ignore: `yt-live-chat-viewer-engagement-message-renderer`, paid/membership system renderers are captured as comments only if they contain `#author-name` + `#message`; moderation/system renderers without those are skipped.

- [ ] **Step 1: Create `test/fixtures/youtube-chat.html`** — a static snippet with: two normal messages, one with an emoji `<img alt="🎉">` inside `#message`, one with a link, one viewer-engagement renderer (no author/message) that must be ignored.

```html
<div id="chat">
  <yt-live-chat-text-message-renderer id="m1">
    <span id="timestamp">12:00</span>
    <span id="author-name">Ann</span>
    <span id="message">Hello world</span>
  </yt-live-chat-text-message-renderer>
  <yt-live-chat-text-message-renderer id="m2">
    <span id="author-name">Bob</span>
    <span id="message">Nice <img class="emoji" alt="🎉" src="x.png"> party <a href="#">link</a></span>
  </yt-live-chat-text-message-renderer>
  <yt-live-chat-viewer-engagement-message-renderer>
    <span id="message">Welcome to live chat!</span>
  </yt-live-chat-viewer-engagement-message-renderer>
</div>
```

- [ ] **Step 2: Write `test/youtube.test.ts` (failing)** — `// @vitest-environment jsdom`

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { youtubeAdapter } from '../src/content/adapters/youtube';
import type { AdapterContext } from '../src/shared/model';

function ctx(): AdapterContext {
  return { document, location: window.location, source: 'youtube' };
}
beforeEach(() => {
  document.body.innerHTML = readFileSync(new URL('./fixtures/youtube-chat.html', import.meta.url), 'utf8');
});

describe('youtubeAdapter.parseComment', () => {
  it('parses author + text for a normal message', () => {
    const node = document.getElementById('m1')!;
    const [p] = youtubeAdapter.parseComment(node, ctx());
    expect(p.author).toBe('Ann');
    expect(p.text).toBe('Hello world');
    expect(p.messageId).toBe('m1');
  });
  it('includes emoji alt text and link text in mixed content', () => {
    const [p] = youtubeAdapter.parseComment(document.getElementById('m2')!, ctx());
    expect(p.text).toContain('🎉');
    expect(p.text).toContain('party');
    expect(p.text).toContain('link');
  });
  it('ignores system/engagement renderers (no author)', () => {
    const node = document.querySelector('yt-live-chat-viewer-engagement-message-renderer')!;
    expect(youtubeAdapter.parseComment(node, ctx())).toEqual([]);
  });
  it('locateFeed finds the chat container when present', () => {
    expect(youtubeAdapter.locateFeed(ctx())).not.toBeNull();
  });
});
```

> `locateFeed` test: the fixture lacks YouTube's real `#items` container, so in the test add a wrapper — adjust the fixture to nest messages under `<div id="items">`. Update Step 1 fixture to wrap the two text-message renderers in `<div id="items">…</div>` inside `#chat`.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Write `src/content/adapters/youtube.ts`**

```ts
import type { AdapterContext, CommentLocator, ParsedComment } from '../../shared/model';
import type { LiveCommentAdapter } from './types';
import { collapseWhitespace } from '../../shared/normalize';

// --- Selectors (repair here if YouTube changes its DOM) ---
const ITEM = 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer';
const FEED = '#items.yt-live-chat-item-list-renderer, #items, yt-live-chat-item-list-renderer #items';
const AUTHOR = '#author-name';
const MESSAGE = '#message';
const TIMESTAMP = '#timestamp';

/** Extract human-visible text from a #message node: text + emoji alt + link text, in order. */
function extractMessageText(message: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === 'IMG') {
        const alt = el.getAttribute('alt');
        if (alt) out += alt;
        return;
      }
      el.childNodes.forEach(walk);
    }
  };
  message.childNodes.forEach(walk);
  return collapseWhitespace(out);
}

function parseOne(el: Element): ParsedComment | null {
  const authorEl = el.querySelector(AUTHOR);
  const messageEl = el.querySelector(MESSAGE);
  if (!authorEl || !messageEl) return null; // not a real comment (system/moderation UI)
  const author = collapseWhitespace(authorEl.textContent ?? '');
  const text = extractMessageText(messageEl);
  if (author === '' && text === '') return null;
  const messageId = el.id || el.getAttribute('id') || undefined;
  const displayedTimestamp = el.querySelector(TIMESTAMP)?.textContent?.trim() || undefined;
  const locator: CommentLocator = { adapter: 'youtube', messageId, selectorHint: messageId ? `#${messageId}` : undefined };
  return { author, text, displayedTimestamp, messageId, locator };
}

export const youtubeAdapter: LiveCommentAdapter = {
  id: 'youtube',
  canHandle: (ctx: AdapterContext) => /(^|\.)youtube\.com$/.test(ctx.location.hostname) || /(^|\.)youtube-nocookie\.com$/.test(ctx.location.hostname),
  locateFeed: (ctx: AdapterContext) => ctx.document.querySelector(FEED),
  parseComment: (node: Node, ctx: AdapterContext): ParsedComment[] => {
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as Element;
    const results: ParsedComment[] = [];
    const items = el.matches(ITEM) ? [el] : Array.from(el.querySelectorAll(ITEM));
    for (const item of items) {
      const parsed = parseOne(item);
      if (parsed) results.push(parsed);
    }
    void ctx;
    return results;
  },
  locateComment: (locator: CommentLocator, ctx: AdapterContext): Element | null =>
    locator.messageId ? ctx.document.getElementById(locator.messageId) : null,
};
```

- [ ] **Step 5: Run → PASS.** Adjust `FEED` only if `locateFeed` fails against the wrapped fixture.

- [ ] **Step 6: Commit** — `git commit -am "feat(adapters): YouTube Live Chat adapter with emoji/link/mixed-content parsing + fixtures"`

---

### Task 11: Generic adapter + per-host selectors

**Files:** Create `src/content/adapters/generic.ts`, `test/fixtures/generic-feed.html`, `test/generic.test.ts`

**Interfaces:**
- Consumes: `LiveCommentAdapter`, `GenericSelectors`.
- Produces: `createGenericAdapter(selectors: GenericSelectors): LiveCommentAdapter` (id `'generic'`); `inferItemSelector(container: Element): string | null` (detect the repeated child structure).

- [ ] **Step 1: Create `test/fixtures/generic-feed.html`**

```html
<ul id="feed">
  <li class="row"><span class="u">Ann</span><span class="b">first</span><time>1m</time></li>
  <li class="row"><span class="u">Bob</span><span class="b">second 🎈</span><time>2m</time></li>
</ul>
```

- [ ] **Step 2: Write `test/generic.test.ts` (failing)** — `// @vitest-environment jsdom`

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGenericAdapter, inferItemSelector } from '../src/content/adapters/generic';
import type { AdapterContext } from '../src/shared/model';

const selectors = { item: '.row', author: '.u', text: '.b', timestamp: 'time' };
function ctx(): AdapterContext {
  return { document, location: window.location, source: 'generic', genericSelectors: selectors };
}
beforeEach(() => {
  document.body.innerHTML = readFileSync(new URL('./fixtures/generic-feed.html', import.meta.url), 'utf8');
});

describe('generic adapter', () => {
  it('parses author/text/timestamp via configured selectors', () => {
    const a = createGenericAdapter(selectors);
    const [p] = a.parseComment(document.querySelector('.row')!, ctx());
    expect(p.author).toBe('Ann');
    expect(p.text).toBe('first');
  });
  it('preserves emoji in text', () => {
    const a = createGenericAdapter(selectors);
    const rows = document.querySelectorAll('.row');
    const [p] = a.parseComment(rows[1], ctx());
    expect(p.text).toContain('🎈');
  });
  it('inferItemSelector finds the repeated child', () => {
    expect(inferItemSelector(document.getElementById('feed')!)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Write `src/content/adapters/generic.ts`**

```ts
import type { AdapterContext, CommentLocator, GenericSelectors, ParsedComment } from '../../shared/model';
import type { LiveCommentAdapter } from './types';
import { collapseWhitespace } from '../../shared/normalize';

/** Find the most common repeated immediate-child pattern under a container. */
export function inferItemSelector(container: Element): string | null {
  const counts = new Map<string, number>();
  for (const child of Array.from(container.children)) {
    const cls = child.classList.length ? `.${Array.from(child.classList).join('.')}` : child.tagName.toLowerCase();
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 1;
  for (const [sel, n] of counts) if (n > bestN) { best = sel; bestN = n; }
  return best;
}

function text(el: Element | null): string {
  return el ? collapseWhitespace(el.textContent ?? '') : '';
}

export function createGenericAdapter(selectors: GenericSelectors): LiveCommentAdapter {
  return {
    id: 'generic',
    canHandle: () => true,
    locateFeed: (ctx: AdapterContext) => ctx.document.querySelector(selectors.item)?.parentElement ?? null,
    parseComment: (node: Node, ctx: AdapterContext): ParsedComment[] => {
      if (node.nodeType !== Node.ELEMENT_NODE) return [];
      const el = node as Element;
      const items = el.matches(selectors.item) ? [el] : Array.from(el.querySelectorAll(selectors.item));
      const out: ParsedComment[] = [];
      for (const item of items) {
        const author = selectors.author ? text(item.querySelector(selectors.author)) : '';
        const body = selectors.text ? text(item.querySelector(selectors.text)) : text(item);
        if (author === '' && body === '') continue;
        const displayedTimestamp = selectors.timestamp ? text(item.querySelector(selectors.timestamp)) || undefined : undefined;
        const locator: CommentLocator = { adapter: `generic:${ctx.location.hostname}` };
        out.push({ author, text: body, displayedTimestamp, locator });
      }
      return out;
    },
  };
}
```

- [ ] **Step 5: Run → PASS. Commit** — `git commit -am "feat(adapters): generic feed adapter + repeated-structure inference"`

---

### Task 12: Element picker overlay

**Files:** Create `src/content/picker/overlay.ts`, `test/picker.test.ts`

**Interfaces:**
- Produces: `startPicker(opts: { onPick: (el: Element) => void; onCancel: () => void }): () => void` (returns a teardown). Highlights the element under the pointer with a non-destructive overlay box; click picks; Escape cancels; teardown removes overlay + listeners.

- [ ] **Step 1: Write `test/picker.test.ts` (failing)** — `// @vitest-environment jsdom`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { startPicker } from '../src/content/picker/overlay';

describe('startPicker', () => {
  it('invokes onPick with the clicked element and cleans up', () => {
    document.body.innerHTML = '<div id="t" style="width:10px;height:10px"></div>';
    const onPick = vi.fn(); const onCancel = vi.fn();
    startPicker({ onPick, onCancel });
    const target = document.getElementById('t')!;
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lcf-overlay]')).toBeNull(); // cleaned up
  });
  it('Escape cancels and removes the overlay', () => {
    const onPick = vi.fn(); const onCancel = vi.fn();
    startPicker({ onPick, onCancel });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lcf-overlay]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/content/picker/overlay.ts`**

```ts
interface PickerOpts {
  onPick: (el: Element) => void;
  onCancel: () => void;
}

export function startPicker(opts: PickerOpts): () => void {
  const box = document.createElement('div');
  box.setAttribute('data-lcf-overlay', 'box');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #5B9FEF',
    background: 'rgba(91,159,239,0.15)', borderRadius: '4px', transition: 'none', boxSizing: 'border-box',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  let current: Element | null = null;

  const move = (e: MouseEvent): void => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const click = (e: MouseEvent): void => {
    e.preventDefault(); e.stopPropagation();
    const picked = current ?? document.elementFromPoint(e.clientX, e.clientY);
    teardown();
    if (picked) opts.onPick(picked);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { teardown(); opts.onCancel(); }
  };

  function teardown(): void {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  return teardown;
}
```

- [ ] **Step 4: Run → PASS.** jsdom returns 0-size rects and may need `elementFromPoint`; if `elementFromPoint` is undefined in jsdom, the click handler's fallback to `current` (set on mousemove) covers the test — the mousemove handler sets `current` from `elementFromPoint`, which jsdom stubs as returning `document.body`. Adjust the test to dispatch with explicit coordinates, or stub `document.elementFromPoint = () => target`. Use the stub in the test for determinism.

- [ ] **Step 5: Commit** — `git commit -am "feat(picker): non-destructive element picker overlay with Escape cancel + full cleanup"`

---

### Task 13: Temporary highlight

**Files:** Create `src/content/highlight.ts`, `test/highlight.test.ts`

**Interfaces:**
- Produces: `flashHighlight(el: Element, durationMs?: number): void` — adds a temporary outline visible on light+dark, scrolls into view, removes itself and any injected style after `durationMs` (default 2500), respects `prefers-reduced-motion`.

- [ ] **Step 1: Write `test/highlight.test.ts` (failing)** — `// @vitest-environment jsdom`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flashHighlight } from '../src/content/highlight';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('flashHighlight', () => {
  it('adds a marker then removes it after the duration', () => {
    document.body.innerHTML = '<div id="t">x</div>';
    const el = document.getElementById('t')!;
    el.scrollIntoView = vi.fn();
    flashHighlight(el, 1000);
    expect(el.hasAttribute('data-lcf-highlight')).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(el.hasAttribute('data-lcf-highlight')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/content/highlight.ts`**

```ts
const STYLE_ID = 'lcf-highlight-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-lcf-highlight] {
      outline: 3px solid #5B9FEF !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 3px rgba(91,159,239,0.45) !important;
      border-radius: 4px !important;
    }
    @media (prefers-reduced-motion: no-preference) {
      [data-lcf-highlight] { transition: outline-color .2s ease; }
    }`;
  document.head.appendChild(style);
}

export function flashHighlight(el: Element, durationMs = 2500): void {
  ensureStyle();
  el.setAttribute('data-lcf-highlight', '1');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(() => el.removeAttribute('data-lcf-highlight'), durationMs);
}
```

- [ ] **Step 4: Run → PASS. Commit** — `git commit -am "feat(content): temporary accessible highlight, reduced-motion aware"`

---

### Task 14: Capture controller

**Files:** Create `src/content/capture-controller.ts`, `test/capture-controller.test.ts`

**Interfaces:**
- Consumes: `RingBuffer`, `Deduper`, `commentId`, `normalize`, `ParsedComment`, `CapturedComment`.
- Produces: `class CaptureController { constructor(opts: { source: string; capacity: number; emit: (batch: CapturedComment[]) => void }); ingest(parsed: ParsedComment[]): void; snapshot(): CapturedComment[]; clear(): void; pause(): void; resume(): void; get paused(): boolean; setCapacity(n): void; locateId(id): CapturedComment | undefined }`. Ingest dedups, assigns ids + searchable fields, stores, emits new ones in a microtask-batched call.

- [ ] **Step 1: Write `test/capture-controller.test.ts` (failing)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { CaptureController } from '../src/content/capture-controller';
import type { ParsedComment } from '../src/shared/model';

const p = (author: string, text: string, messageId?: string): ParsedComment => ({ author, text, messageId });

describe('CaptureController', () => {
  it('captures, dedups by messageId, and emits new comments', () => {
    const emit = vi.fn();
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit });
    ctrl.ingest([p('Ann', 'hi', 'a'), p('Ann', 'hi', 'a')]); // duplicate id
    expect(ctrl.snapshot().length).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].length).toBe(1);
  });
  it('precomputes searchable fields', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit: () => {} });
    ctrl.ingest([p('ANN', 'HeLLo', 'x')]);
    expect(ctrl.snapshot()[0].searchText).toBe('hello');
    expect(ctrl.snapshot()[0].searchAuthor).toBe('ann');
  });
  it('pause stops capture; resume restarts', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit: () => {} });
    ctrl.pause();
    ctrl.ingest([p('A', 'x', '1')]);
    expect(ctrl.snapshot().length).toBe(0);
    ctrl.resume();
    ctrl.ingest([p('A', 'x', '1')]);
    expect(ctrl.snapshot().length).toBe(1);
  });
  it('evicts oldest beyond capacity and forgets its dedup key', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 2, emit: () => {} });
    ctrl.ingest([p('A', '1', '1'), p('A', '2', '2'), p('A', '3', '3')]);
    expect(ctrl.snapshot().map((c) => c.text)).toEqual(['2', '3']);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/content/capture-controller.ts`**

```ts
import type { CapturedComment, ParsedComment } from '../shared/model';
import { RingBuffer } from '../shared/ring-buffer';
import { Deduper, commentId } from '../shared/dedup';
import { normalize } from '../shared/normalize';

interface Opts {
  source: string;
  capacity: number;
  emit: (batch: CapturedComment[]) => void;
  now?: () => number;
}

export class CaptureController {
  private buffer: RingBuffer<CapturedComment>;
  private dedup = new Deduper();
  private isPaused = false;
  private readonly now: () => number;

  constructor(private opts: Opts) {
    this.buffer = new RingBuffer<CapturedComment>(opts.capacity);
    this.now = opts.now ?? Date.now;
  }

  get paused(): boolean { return this.isPaused; }
  pause(): void { this.isPaused = true; }
  resume(): void { this.isPaused = false; }
  setCapacity(n: number): void { this.buffer.setCapacity(n); }

  ingest(parsed: ParsedComment[]): void {
    if (this.isPaused || parsed.length === 0) return;
    const fresh: CapturedComment[] = [];
    for (const p of parsed) {
      const capturedAt = this.now();
      const id = commentId(p, this.opts.source, capturedAt);
      if (this.dedup.has(id)) continue;
      this.dedup.add(id);
      const comment: CapturedComment = {
        id, source: this.opts.source, author: p.author, text: p.text,
        displayedTimestamp: p.displayedTimestamp, capturedAt, locator: p.locator, metadata: p.metadata,
        searchAuthor: normalize(p.author), searchText: normalize(p.text),
      };
      const evicted = this.buffer.push(comment);
      if (evicted) this.dedup.delete(evicted.id);
      fresh.push(comment);
    }
    if (fresh.length) this.opts.emit(fresh);
  }

  snapshot(): CapturedComment[] { return this.buffer.toArray(); }
  locateId(id: string): CapturedComment | undefined { return this.buffer.toArray().find((c) => c.id === id); }
  clear(): void { this.buffer.clear(); this.dedup.clear(); }
}
```

- [ ] **Step 4: Run → PASS. Commit** — `git commit -am "feat(content): capture controller — dedup, searchable precompute, ring buffer, pause/resume"`

---

### Task 15: Content bootstrap (observer lifecycle, SPA nav, message wiring)

**Files:** Create `src/content/bootstrap.ts`; modify `src/content/main.ts`.

**Interfaces:**
- Consumes: adapters, `resolveAdapter`, `CaptureController`, `flashHighlight`, `startPicker`, `validateMessage`, `Message`, `loadSettings`.
- Produces: `boot(): Promise<void>` — resolves adapter, locates feed, observes it, parses existing + new nodes, wires `chrome.runtime.onMessage` for snapshot/control/locate/selection, handles SPA URL changes, and cleans up.

This task has no unit test (it is the Chrome/DOM integration seam); it is verified via the demo page in Task 20 and the build. Keep logic thin — all testable pieces already live in tested modules.

- [ ] **Step 1: Write `src/content/bootstrap.ts`**

```ts
import type { AdapterContext, CaptureState } from '../shared/model';
import type { Message } from '../shared/messages';
import { validateMessage } from '../shared/messages';
import type { LiveCommentAdapter } from './adapters/types';
import { resolveAdapter } from './adapters/registry';
import { youtubeAdapter } from './adapters/youtube';
import { createGenericAdapter } from './adapters/generic';
import { CaptureController } from './capture-controller';
import { flashHighlight } from './highlight';
import { startPicker } from './picker/overlay';
import { loadSettings, saveSettings } from '../settings';

const BATCH_MS = 250;

export async function boot(): Promise<void> {
  const settings = await loadSettings();
  const host = location.hostname;
  const hostSelectors = settings.genericByHost[host];

  const adapters: LiveCommentAdapter[] = [youtubeAdapter];
  if (hostSelectors) adapters.push(createGenericAdapter(hostSelectors));

  const ctx: AdapterContext = { document, location, source: 'pending', genericSelectors: hostSelectors };
  let adapter = await resolveAdapter(adapters, ctx);
  let state: CaptureState = 'unsupported';

  let controller: CaptureController | null = null;
  let observer: MutationObserver | null = null;
  let pendingTeardownPicker: (() => void) | null = null;

  function sendStatus(): void {
    void chrome.runtime.sendMessage({
      type: 'CAPTURE_STATUS', state, source: adapter?.id, capturedCount: controller?.snapshot().length ?? 0,
    } satisfies Message);
  }

  function startObserving(feed: Element, a: LiveCommentAdapter): void {
    ctx.source = a.id;
    controller = new CaptureController({
      source: a.id, capacity: settings.maxComments,
      emit: (batch) => void chrome.runtime.sendMessage({ type: 'NEW_COMMENT_BATCH', comments: batch } satisfies Message),
    });
    // Capture what is already visible.
    controller.ingest(a.parseComment(feed, ctx));
    let queued: Node[] = [];
    let timer: number | null = null;
    const flush = (): void => {
      timer = null;
      const nodes = queued; queued = [];
      const parsed = nodes.flatMap((n) => a.parseComment(n, ctx));
      controller?.ingest(parsed);
    };
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) m.addedNodes.forEach((n) => queued.push(n));
      if (timer === null) timer = window.setTimeout(flush, BATCH_MS);
    });
    observer.observe(feed, { childList: true, subtree: true });
    state = 'connected';
    sendStatus();
  }

  function stopObserving(): void {
    observer?.disconnect(); observer = null;
  }

  async function tryStart(): Promise<void> {
    adapter = await resolveAdapter(adapters, ctx);
    if (!adapter) { state = 'unsupported'; sendStatus(); return; }
    const feed = await adapter.locateFeed(ctx);
    if (!feed) { state = 'feed-not-found'; sendStatus(); return; }
    stopObserving();
    startObserving(feed, adapter);
  }

  // --- SPA navigation: re-resolve feed on URL change ---
  let lastUrl = location.href;
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stopObserving();
      void tryStart();
    }
  });
  navObserver.observe(document, { childList: true, subtree: true });

  // --- message handling ---
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = validateMessage(raw);
    if (!msg) return undefined;
    switch (msg.type) {
      case 'REQUEST_SNAPSHOT':
        sendResponse({ type: 'SNAPSHOT', comments: controller?.snapshot() ?? [], state } satisfies Message);
        return true;
      case 'PAUSE_CAPTURE': controller?.pause(); state = 'paused'; sendStatus(); return undefined;
      case 'RESUME_CAPTURE': controller?.resume(); state = controller ? 'connected' : 'feed-not-found'; sendStatus(); return undefined;
      case 'STOP_CAPTURE': stopObserving(); return undefined;
      case 'START_CAPTURE': void tryStart(); return undefined;
      case 'CLEAR_HISTORY': controller?.clear(); sendStatus(); return undefined;
      case 'LOCATE_COMMENT': {
        const comment = controller?.locateId(msg.id);
        const el = comment?.locator && adapter?.locateComment ? adapter.locateComment(comment.locator, ctx) : null;
        if (el) flashHighlight(el);
        void chrome.runtime.sendMessage({ type: 'LOCATE_RESULT', id: msg.id, found: !!el } satisfies Message);
        return undefined;
      }
      case 'BEGIN_ELEMENT_SELECTION': {
        pendingTeardownPicker?.();
        pendingTeardownPicker = startPicker({
          onPick: (picked) => {
            void onGenericPicked(picked);
          },
          onCancel: () => void chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETED', cancelled: true } satisfies Message),
        });
        return undefined;
      }
      default: return undefined;
    }
  });

  async function onGenericPicked(container: Element): Promise<void> {
    const { inferItemSelector } = await import('./adapters/generic');
    const itemSel = inferItemSelector(container) ?? '*';
    const selectors = { item: itemSel };
    await saveSettings({ genericByHost: { ...(await loadSettings()).genericByHost, [host]: selectors } });
    const generic = createGenericAdapter(selectors);
    adapters.push(generic);
    ctx.genericSelectors = selectors;
    stopObserving();
    startObserving(container, generic);
    void chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETED', cancelled: false, selectors, host } satisfies Message);
  }

  await tryStart();
  void state; void pendingTeardownPicker;
}
```

- [ ] **Step 2: Wire `src/content/main.ts`**

```ts
import { boot } from './bootstrap';

declare global {
  interface Window { __lcfBooted?: boolean }
}

if (!window.__lcfBooted) {
  window.__lcfBooted = true;
  void boot();
}
export {};
```

- [ ] **Step 3: Verify** — `npm run typecheck` → PASS; `npm run build` → PASS (content script bundles).

- [ ] **Step 4: Commit** — `git commit -am "feat(content): bootstrap — observer lifecycle, SPA nav, snapshot/locate/picker message wiring"`

---

### Task 16: Background service worker

**Files:** Modify `src/background/service-worker.ts`.

**Interfaces:**
- Produces: side-panel open behavior; active-tab tracking broadcast `ACTIVE_TAB_CHANGED`; generic-injection handler that requests host permission then injects the content bundle; relays `BEGIN_ELEMENT_SELECTION` to the active tab.

- [ ] **Step 1: Write `src/background/service-worker.ts`**

```ts
import type { Message } from '../shared/messages';
import { validateMessage } from '../shared/messages';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.runtime.sendMessage({ type: 'ACTIVE_TAB_CHANGED', tabId } satisfies Message).catch(() => {});
});

// The side panel asks the worker to begin generic selection on the active tab:
// the worker requests the host permission, injects the content bundle, then relays the begin message.
chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = validateMessage(raw);
  if (!msg) return undefined;
  if (msg.type === 'BEGIN_ELEMENT_SELECTION') {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) { sendResponse({ ok: false }); return; }
      const origin = `${new URL(tab.url).origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
      if (!granted) { sendResponse({ ok: false, reason: 'permission' }); return; }
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: ['src/content/main.ts'] });
      } catch {
        // already injected (boot guard) — fine
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'BEGIN_ELEMENT_SELECTION' } satisfies Message).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true; // async response
  }
  return undefined;
});
```

> The injected file path is the source path; `@crxjs` rewrites `web_accessible_resources` to the built asset, and `executeScript({files})` resolves it. If CRXJS emits a hashed filename, switch to injecting via `chrome.runtime.getURL` + dynamic import, or list the content script in `web_accessible_resources` by its built name. Verify the emitted name in `dist/manifest.json` during Task 22 and correct the path if needed.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` → PASS.

- [ ] **Step 3: Commit** — `git commit -am "feat(background): side panel open, active-tab tracking, runtime-permission generic injection"`

---

### Task 17: Side panel state

**Files:** Create `src/sidepanel/state.ts`, `test/state.test.ts`

**Interfaces:**
- Produces: `interface PanelState { comments: CapturedComment[]; criteria: SearchCriteria; status: CaptureState; source?: string }`; `createStore(initial)` with `getState()`, `setComments(list)`, `addBatch(list)`, `setCriteria(patch)`, `setStatus(state, source)`, `clear()`, `subscribe(fn)`; dedups `addBatch` by id.

- [ ] **Step 1: Write `test/state.test.ts` (failing)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/sidepanel/state';
import type { CapturedComment } from '../src/shared/model';

const c = (id: string): CapturedComment => ({ id, source: 't', author: 'a', text: id, capturedAt: +id, searchAuthor: 'a', searchText: id });

describe('panel store', () => {
  it('addBatch appends and dedups by id', () => {
    const s = createStore();
    s.setComments([c('1')]);
    s.addBatch([c('1'), c('2')]);
    expect(s.getState().comments.map((x) => x.id)).toEqual(['1', '2']);
  });
  it('setCriteria patches and notifies subscribers', () => {
    const s = createStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.setCriteria({ query: 'hi' });
    expect(s.getState().criteria.query).toBe('hi');
    expect(fn).toHaveBeenCalled();
  });
  it('clear empties comments', () => {
    const s = createStore();
    s.setComments([c('1')]);
    s.clear();
    expect(s.getState().comments.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/sidepanel/state.ts`**

```ts
import type { CapturedComment, CaptureState } from '../shared/model';
import type { SearchCriteria } from '../shared/search';

export interface PanelState {
  comments: CapturedComment[];
  criteria: SearchCriteria;
  status: CaptureState;
  source?: string;
}

const DEFAULT_CRITERIA: SearchCriteria = { query: '', author: '', mode: 'substring', sort: 'newest' };

export function createStore(initial?: Partial<PanelState>) {
  let state: PanelState = {
    comments: initial?.comments ?? [],
    criteria: initial?.criteria ?? { ...DEFAULT_CRITERIA },
    status: initial?.status ?? 'unsupported',
    source: initial?.source,
  };
  const ids = new Set(state.comments.map((c) => c.id));
  const subs = new Set<(s: PanelState) => void>();
  const emit = (): void => subs.forEach((f) => f(state));

  return {
    getState: (): PanelState => state,
    subscribe(fn: (s: PanelState) => void): () => void { subs.add(fn); return () => subs.delete(fn); },
    setComments(list: CapturedComment[]): void {
      state = { ...state, comments: list.slice() };
      ids.clear(); list.forEach((c) => ids.add(c.id)); emit();
    },
    addBatch(list: CapturedComment[]): void {
      const add = list.filter((c) => !ids.has(c.id));
      if (!add.length) return;
      add.forEach((c) => ids.add(c.id));
      state = { ...state, comments: state.comments.concat(add) }; emit();
    },
    setCriteria(patch: Partial<SearchCriteria>): void {
      state = { ...state, criteria: { ...state.criteria, ...patch } }; emit();
    },
    setStatus(status: CaptureState, source?: string): void {
      state = { ...state, status, source: source ?? state.source }; emit();
    },
    clear(): void { state = { ...state, comments: [] }; ids.clear(); emit(); },
  };
}

export type PanelStore = ReturnType<typeof createStore>;
```

- [ ] **Step 4: Run → PASS. Commit** — `git commit -am "feat(sidepanel): observable panel store with id-dedup batches"`

---

### Task 18: Side panel render + windowing + styles

**Files:** Create `src/sidepanel/render.ts`, `src/sidepanel/styles.css`; expand `src/sidepanel/index.html`; create `test/render.test.ts`.

**Interfaces:**
- Consumes: `search`, `matchRanges`, `CapturedComment`, `SearchCriteria`.
- Produces: `renderResults(container, results, criteria, opts): void` — windowed (renders only the visible slice based on `scrollTop`/row height), each row built with DOM nodes only, match highlighting via text-node splitting (never `innerHTML`); `buildRow(c, criteria): HTMLElement`; `highlightInto(el, text, ranges): void`.

- [ ] **Step 1: Write `test/render.test.ts` (failing)** — `// @vitest-environment jsdom`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildRow, highlightInto } from '../src/sidepanel/render';
import type { CapturedComment } from '../src/shared/model';

const c: CapturedComment = { id: '1', source: 'youtube', author: 'Ann', text: 'Hello world', capturedAt: 1000, searchAuthor: 'ann', searchText: 'hello world' };
const crit = { query: 'world', author: '', mode: 'substring' as const, sort: 'newest' as const };

describe('render', () => {
  it('buildRow renders author + text as text content (no HTML injection)', () => {
    const evil: CapturedComment = { ...c, text: '<img src=x onerror=alert(1)>' };
    const row = buildRow(evil, crit);
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img');
  });
  it('highlightInto wraps matches in <mark> via text nodes', () => {
    const el = document.createElement('div');
    highlightInto(el, 'Hello world', [[6, 11]]);
    expect(el.querySelectorAll('mark').length).toBe(1);
    expect(el.querySelector('mark')!.textContent).toBe('world');
    expect(el.textContent).toBe('Hello world');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `src/sidepanel/render.ts`**

```ts
import type { CapturedComment } from '../shared/model';
import { matchRanges, type SearchCriteria } from '../shared/search';

/** Insert text into `el`, wrapping the given [start,end) ranges in <mark>. Text nodes only. */
export function highlightInto(el: HTMLElement, text: string, ranges: Array<[number, number]>): void {
  el.textContent = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) el.appendChild(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    el.appendChild(mark);
    cursor = end;
  }
  if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
}

function timeLabel(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

export function buildRow(c: CapturedComment, criteria: SearchCriteria): HTMLElement {
  const row = document.createElement('li');
  row.className = 'result';
  row.setAttribute('role', 'option');
  row.dataset.id = c.id;
  row.tabIndex = -1;

  const head = document.createElement('div');
  head.className = 'result-head';
  const author = document.createElement('span');
  author.className = 'result-author';
  highlightInto(author, c.author, criteria.author ? matchRanges(c.author, { ...criteria, query: criteria.author }) : []);
  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = `${c.source}${c.displayedTimestamp ? ' · ' + c.displayedTimestamp : ''} · ${timeLabel(c.capturedAt)}`;
  head.append(author, meta);

  const body = document.createElement('div');
  body.className = 'result-text';
  highlightInto(body, c.text, criteria.query ? matchRanges(c.text, criteria) : []);

  const copy = document.createElement('button');
  copy.className = 'result-copy';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', `Copy comment by ${c.author}`);
  copy.addEventListener('click', (e) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(`${c.author}: ${c.text}`);
  });

  row.append(head, body, copy);
  return row;
}

interface RenderOpts {
  rowHeight: number;
  onActivate: (id: string) => void;
}

/** Windowed render: only mount rows in the visible range + small overscan. */
export function renderResults(container: HTMLElement, results: CapturedComment[], criteria: SearchCriteria, opts: RenderOpts): void {
  const total = results.length;
  const viewport = container.clientHeight || 480;
  const scrollTop = container.scrollTop;
  const overscan = 6;
  const first = Math.max(0, Math.floor(scrollTop / opts.rowHeight) - overscan);
  const visible = Math.ceil(viewport / opts.rowHeight) + overscan * 2;
  const last = Math.min(total, first + visible);

  container.textContent = '';
  const spacerTop = document.createElement('div');
  spacerTop.style.height = `${first * opts.rowHeight}px`;
  const list = document.createElement('ul');
  list.className = 'results';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Search results');
  const spacerBottom = document.createElement('div');
  spacerBottom.style.height = `${(total - last) * opts.rowHeight}px`;

  for (let i = first; i < last; i++) {
    const row = buildRow(results[i], criteria);
    row.addEventListener('click', () => opts.onActivate(results[i].id));
    list.appendChild(row);
  }
  container.append(spacerTop, list, spacerBottom);
}
```

- [ ] **Step 4: Write `src/sidepanel/styles.css`** — dark/light via `prefers-color-scheme`, the project's accent palette, focus rings, reduced-motion, non-color status (dot + label). Include `.result`, `.results`, `mark`, status badge, toolbar/input styles. (Full CSS using `#0f0f0f/#121212/#303030/#5B9FEF` per the design system; `@media (prefers-color-scheme: light)` overrides; `mark { background:#F59E42; color:#0f0f0f }`.)

- [ ] **Step 5: Expand `src/sidepanel/index.html`** — semantic structure with labelled controls:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Live Comment Finder</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="bar">
      <span class="status" id="status" role="status" aria-live="polite"><span class="dot" data-state="unsupported"></span><span id="status-text">Unsupported page</span></span>
      <div class="bar-actions">
        <button id="pause" type="button">Pause</button>
        <button id="clear" type="button">Clear</button>
      </div>
    </header>
    <div class="search">
      <label class="sr-only" for="q">Search comments</label>
      <input id="q" type="search" placeholder="Search comments…" autocomplete="off" />
      <label class="sr-only" for="author">Filter by author</label>
      <input id="author" type="search" placeholder="Author…" autocomplete="off" />
      <p id="regex-error" class="error" role="alert" hidden></p>
      <div class="options">
        <label><input type="radio" name="mode" value="substring" checked /> Substring</label>
        <label><input type="radio" name="mode" value="case-sensitive" /> Case</label>
        <label><input type="radio" name="mode" value="whole-word" /> Word</label>
        <label><input type="radio" name="mode" value="exact-phrase" /> Phrase</label>
        <label><input type="radio" name="mode" value="regex" /> Regex</label>
        <select id="sort" aria-label="Sort order"><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
        <button id="clear-filters" type="button">Clear filters</button>
      </div>
      <div class="counts"><span id="result-count">0 results</span> · <span id="captured-count">0 captured</span></div>
      <div class="exports">
        <button id="export-json" type="button">Export JSON</button>
        <button id="export-csv" type="button">Export CSV</button>
        <button id="select-feed" type="button">Select Comment Feed</button>
      </div>
    </div>
    <main id="results" class="results-viewport" tabindex="0" aria-label="Results"></main>
    <p id="empty" class="empty" hidden></p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Run render test → PASS.** `npx vitest run test/render.test.ts`.

- [ ] **Step 7: Commit** — `git commit -am "feat(sidepanel): windowed text-safe result rendering, highlight, styles, markup"`

---

### Task 19: Side panel controller (wiring, keyboard, export, a11y)

**Files:** Rewrite `src/sidepanel/main.ts`.

**Interfaces:**
- Consumes: `createStore`, `search`, `renderResults`, `toJSON`, `toCSV`, `validateMessage`, `Message`, `loadSettings`.
- Produces: full panel behavior — connects to active tab, requests snapshot, applies live search (debounced), windowed render on scroll, keyboard nav, export downloads, pause/resume/clear, select-feed, regex error display, ARIA count announcements, tab-switch context reset.

- [ ] **Step 1: Write `src/sidepanel/main.ts`**

```ts
import { createStore } from './state';
import { search } from '../shared/search';
import type { SearchMode } from '../shared/search';
import { renderResults } from './render';
import { toCSV, toJSON } from '../shared/export';
import { validateMessage, type Message } from '../shared/messages';

const ROW_HEIGHT = 76;
const store = createStore();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q');
const authorInput = $<HTMLInputElement>('author');
const sortSel = $<HTMLSelectElement>('sort');
const results = $<HTMLElement>('results');
const regexError = $<HTMLParagraphElement>('regex-error');
const resultCount = $<HTMLElement>('result-count');
const capturedCount = $<HTMLElement>('captured-count');
const statusDot = document.querySelector('.dot') as HTMLElement;
const statusText = $<HTMLElement>('status-text');
const empty = $<HTMLParagraphElement>('empty');

let activeTabId: number | undefined;
let selectedId: string | null = null;
let lastResults = store.getState().comments;

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function send(tabId: number, msg: Message): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

async function requestSnapshot(): Promise<void> {
  activeTabId = await getActiveTabId();
  if (activeTabId === undefined) { store.setStatus('unsupported'); return; }
  const reply = validateMessage(await send(activeTabId, { type: 'REQUEST_SNAPSHOT' }));
  if (reply?.type === 'SNAPSHOT') {
    store.setComments(reply.comments);
    store.setStatus(reply.state);
  } else {
    store.setStatus('unsupported');
  }
}

function currentCriteria() {
  const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value as SearchMode;
  return { query: q.value, author: authorInput.value, mode, sort: sortSel.value as 'newest' | 'oldest' };
}

function apply(): void {
  const criteria = store.getState().criteria;
  const { results: found, error } = search(store.getState().comments, criteria);
  regexError.hidden = !error;
  regexError.textContent = error ? `Invalid regex: ${error}` : '';
  lastResults = found;
  resultCount.textContent = `${found.length} result${found.length === 1 ? '' : 's'}`;
  capturedCount.textContent = `${store.getState().comments.length} captured`;
  empty.hidden = found.length > 0 || !!error;
  empty.textContent = found.length === 0 && !error ? 'No matching comments.' : '';
  renderResults(results, found, criteria, { rowHeight: ROW_HEIGHT, onActivate: locate });
}

let debounce: number | null = null;
function onInput(): void {
  store.setCriteria(currentCriteria());
  if (debounce) clearTimeout(debounce);
  debounce = window.setTimeout(apply, 120);
}

function locate(id: string): void {
  selectedId = id;
  const c = store.getState().comments.find((x) => x.id === id);
  if (activeTabId !== undefined) void send(activeTabId, { type: 'LOCATE_COMMENT', id });
  // mounted/unmounted feedback comes back via LOCATE_RESULT
  void c;
}

function download(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- events ---
q.addEventListener('input', onInput);
authorInput.addEventListener('input', onInput);
sortSel.addEventListener('change', onInput);
document.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', onInput));
results.addEventListener('scroll', () => renderResults(results, lastResults, store.getState().criteria, { rowHeight: ROW_HEIGHT, onActivate: locate }));

$('clear-filters').addEventListener('click', () => {
  q.value = ''; authorInput.value = '';
  (document.querySelector('input[name=mode][value=substring]') as HTMLInputElement).checked = true;
  onInput();
});
$('pause').addEventListener('click', async () => {
  if (activeTabId === undefined) return;
  const paused = store.getState().status === 'paused';
  await send(activeTabId, { type: paused ? 'RESUME_CAPTURE' : 'PAUSE_CAPTURE' });
});
$('clear').addEventListener('click', async () => {
  if (activeTabId !== undefined) await send(activeTabId, { type: 'CLEAR_HISTORY' });
  store.clear(); apply();
});
$('export-json').addEventListener('click', () => download('comments.json', toJSON(lastResults), 'application/json'));
$('export-csv').addEventListener('click', () => download('comments.csv', toCSV(lastResults), 'text/csv'));
$('select-feed').addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'BEGIN_ELEMENT_SELECTION' } satisfies Message));

// --- keyboard ---
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q && document.activeElement !== authorInput) { e.preventDefault(); q.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); q.focus(); }
  if (e.key === 'Escape') { if (q.value || authorInput.value) { q.value = ''; authorInput.value = ''; onInput(); } }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const idx = lastResults.findIndex((c) => c.id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(lastResults.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (lastResults[next]) { selectedId = lastResults[next].id; e.preventDefault();
      const row = results.querySelector(`[data-id="${selectedId}"]`) as HTMLElement | null;
      row?.scrollIntoView({ block: 'nearest' }); row?.focus();
    }
  }
  if (e.key === 'Enter' && selectedId) locate(selectedId);
});

// --- live updates from content scripts ---
chrome.runtime.onMessage.addListener((raw) => {
  const msg = validateMessage(raw);
  if (!msg) return;
  if (msg.type === 'NEW_COMMENT_BATCH') { store.addBatch(msg.comments); apply(); }
  else if (msg.type === 'CAPTURE_STATUS') { store.setStatus(msg.state, msg.source); }
  else if (msg.type === 'ACTIVE_TAB_CHANGED') { void requestSnapshot().then(apply); }
  else if (msg.type === 'SELECTION_COMPLETED' && !msg.cancelled) { void requestSnapshot().then(apply); }
  else if (msg.type === 'LOCATE_RESULT' && !msg.found) {
    empty.hidden = false;
    empty.textContent = 'This comment is no longer present in the page, but its captured text is still available.';
  }
});

const STATUS_TEXT: Record<string, string> = {
  connected: 'Capturing', paused: 'Paused', unsupported: 'Unsupported page',
  'feed-not-found': 'Feed not found', 'permission-required': 'Permission required',
};
store.subscribe((s) => {
  statusDot.dataset.state = s.status;
  statusText.textContent = STATUS_TEXT[s.status] ?? s.status;
  $('pause').textContent = s.status === 'paused' ? 'Resume' : 'Pause';
});

void requestSnapshot().then(apply);
```

- [ ] **Step 2: Verify** — `npm run typecheck && npm run lint && npm run build` → PASS.

- [ ] **Step 3: Commit** — `git commit -am "feat(sidepanel): controller — live search, keyboard nav, exports, status, tab-switch reset"`

---

### Task 20: Demo live-feed page

**Files:** Create `demo/index.html`, `demo/feed.js`.

**Interfaces:** A standalone page (no extension dependency) with `#feed` container, controls: Start, Pause, Burst, Reset; interval-configurable; repeats authors/phrases; emoji + international text; simulates virtualization by removing nodes older than a cap; emits duplicate mutation scenarios (re-append same node) to exercise dedup.

- [ ] **Step 1: Write `demo/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>LCF Demo Feed</title>
    <style>body{font-family:system-ui;background:#0f0f0f;color:#eee;margin:0;padding:16px}
      #feed{max-height:60vh;overflow:auto;border:1px solid #303030;border-radius:8px;padding:8px}
      .msg{padding:6px;border-bottom:1px solid #232323}.who{color:#5B9FEF;font-weight:600;margin-right:6px}
      button{background:#202020;color:#eee;border:1px solid #303030;border-radius:6px;padding:6px 12px;margin:4px}</style>
  </head>
  <body>
    <h1>Live Comment Finder — Demo Feed</h1>
    <div><button id="start">Start</button><button id="pause">Pause</button><button id="burst">Burst 50</button><button id="reset">Reset</button>
      <label>Interval <input id="interval" type="number" value="600" min="50" style="width:70px" /> ms</label>
      <label>Max nodes <input id="maxnodes" type="number" value="40" min="5" style="width:70px" /></label></div>
    <ul id="feed" role="log" aria-label="Live demo comments" style="list-style:none"></ul>
    <script src="./feed.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `demo/feed.js`**

```js
const AUTHORS = ['Ann', 'Bob', 'Chen', 'Diego', 'Priya', 'Yuki'];
const PHRASES = ['great stream! 🎉', 'привет всем', 'こんにちは', 'LOL same 😂', 'where is the link?', 'first!', 'great stream! 🎉'];
const feed = document.getElementById('feed');
let timer = null, n = 0;

function add(author, text) {
  const li = document.createElement('li');
  li.className = 'msg';
  li.id = 'c' + n++;
  const who = document.createElement('span'); who.className = 'who'; who.textContent = author;
  const body = document.createElement('span'); body.className = 'body'; body.textContent = text;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString();
  li.append(who, body, document.createTextNode(' '), time);
  feed.appendChild(li);
  // simulate duplicate mutation: re-append the same node (must NOT double-count)
  if (n % 7 === 0) feed.appendChild(li);
  // simulate virtualization: drop oldest beyond cap
  const max = +document.getElementById('maxnodes').value;
  while (feed.children.length > max) feed.removeChild(feed.firstElementChild);
}

function tick() { add(AUTHORS[n % AUTHORS.length], PHRASES[n % PHRASES.length]); }
document.getElementById('start').onclick = () => { if (!timer) timer = setInterval(tick, +document.getElementById('interval').value); };
document.getElementById('pause').onclick = () => { clearInterval(timer); timer = null; };
document.getElementById('burst').onclick = () => { for (let i = 0; i < 50; i++) tick(); };
document.getElementById('reset').onclick = () => { feed.innerHTML = ''; n = 0; };
```

- [ ] **Step 3: Commit** — `git commit -am "feat(demo): simulated live feed with virtualization + duplicate mutation scenarios"`

---

### Task 21: README + permission docs + adapter guide

**Files:** Create `README.md`.

- [ ] **Step 1: Write `README.md`** covering (per `claude.md` Documentation): product overview, feature list, supported sites (YouTube Live Chat + generic), **privacy statement** (on-device only, no transmission, permissions justified), install from release, load unpacked from `dist/`, build/lint/test commands, how to use search (all 5 modes + author + combined + sort + export), how to select a generic feed (Select Comment Feed → runtime permission → pick container → Esc cancels), **permission explanations** (`sidePanel`, `storage`, `activeTab`, `scripting`, host `youtube.com`, runtime host grants for generic — no `<all_urls>`), known limitations (no cross-restart content persistence; sites change DOM; virtualized-removed messages remain searchable but un-locatable), troubleshooting (feed not found → reload; YouTube chat in popout iframe), and an **adapter-development guide** with the 7 steps: add detection (`canHandle`), locate feed (`locateFeed`), parse messages (`parseComment`), generate stable locators (`CommentLocator`), add fixtures (`test/fixtures/`), add tests, register in `adapters` array in `bootstrap.ts`. Include the note that third-party DOM changes may require adapter updates.

- [ ] **Step 2: Commit** — `git commit -am "docs: README with privacy, permissions, usage, and adapter guide"`

---

### Task 22: Final verification + acceptance pass

**Files:** none (verification); fix-forward as needed.

- [ ] **Step 1: Full gate** — run and capture output:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: all exit 0. Record real results.

- [ ] **Step 2: Inspect `dist/manifest.json`** — confirm: MV3, the four entries present, host `*://*.youtube.com/*` only, no `<all_urls>` in `host_permissions`, content script `all_frames:true`. Confirm the emitted content-script asset name and correct the `executeScript({files})` path in `service-worker.ts` if CRXJS hashed it (see Task 16 note); rebuild.

- [ ] **Step 3: Load unpacked** — `chrome://extensions` → Developer mode → Load unpacked → select `dist/`. Confirm no manifest errors.

- [ ] **Step 4: Demo verification** — serve the demo (`npx http-server demo -p 8080` or open `demo/index.html`), open the side panel, use **Select Comment Feed** to pick `#feed`, Start the feed. Verify against `claude.md` acceptance criteria 7–15: capture starts, existing+new comments searchable, comments survive node removal (keep feeding past Max nodes, confirm older matches still searchable), author/phrase/case/word/regex filters, duplicate mutations don't double-count (the `n % 7` re-append), select mounted result scrolls+highlights, select removed result shows the fallback message, pause/resume/clear/JSON/CSV work, generic selection completes and Escape cancels cleanly.

- [ ] **Step 5: Acceptance checklist** — walk all 20 criteria in `claude.md`; note any gap and fix-forward. Confirm no network egress (DevTools Network tab on the panel + page shows no extension-originated requests carrying comment data).

- [ ] **Step 6: Final commit** — `git commit -am "chore: verification pass — lint/typecheck/test/build green; acceptance criteria confirmed"`

---

## Self-Review

**Spec coverage:** capture (T15) · retain-after-removal (T5/T14 ring buffer + content-script source of truth) · search by text/author/both (T6/T19) · on-device only (Global Constraints, T16 no egress) · YouTube adapter (T10) · generic adapter + picker (T11/T12) · adapter isolation (T9 interface) · MV3/TS-strict/sidepanel/SW/content/MutationObserver (T1/T15) · dedup incl. distinct identical-text users (T4) · ring buffer 10k/1k–50k (T5/T8) · 5 search modes + invalid regex (T6) · windowing (T18) · locate + temp highlight + unmounted fallback (T13/T15/T19) · export JSON/CSV injection-safe (T7) · keyboard + a11y (T18/T19) · least-privilege perms + runtime host grant (T1/T16) · demo (T20) · tests (T2–T18) · README + adapter guide (T21) · honest verification (T22). No uncovered requirement found.

**Placeholder scan:** every code step contains complete code; CSS in T18 Step 4 is described by exact palette/selectors rather than full text — acceptable as it carries concrete values and the design system is in scope. No TBD/TODO.

**Type consistency:** `CapturedComment`/`ParsedComment`/`CommentLocator`/`GenericSelectors` defined in T2/T6; `searchAuthor`/`searchText` produced in T14, consumed in T6/T18/T19; `Message` union T2 consumed everywhere; `SearchCriteria` T6 consumed T17/T18/T19; `commentId`/`fingerprint`/`Deduper` T4 consumed T14; `RingBuffer` T5 consumed T14; store API T17 consumed T19. Names align.

## Execution Handoff

Two execution options follow this plan.
