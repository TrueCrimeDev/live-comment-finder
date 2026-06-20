# Live Comment Finder — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan to follow.
**Product requirements:** see `claude.md` at repo root — that file is the authoritative
*what*. This document is the authoritative *how*: stack, module boundaries, message
protocol, data flow, and testing strategy. Where this document and `claude.md` ever
disagree on a requirement, `claude.md` wins.

## 1. Goal

A Chrome MV3 extension, **Live Comment Finder**, that captures DOM-rendered live
comments (YouTube Live Chat first; a generic user-selected feed second), retains them
after the site removes their nodes, and lets the user search captured comments in real
time from a side panel. All data stays on device; nothing is transmitted.

## 2. Locked technical decisions

| Concern        | Decision                                                        |
| -------------- | --------------------------------------------------------------- |
| Manifest       | MV3                                                             |
| Language       | TypeScript, `strict: true`, no implicit `any`                   |
| Build          | Vite + `@crxjs/vite-plugin` (MV3-native, multi-entry, HMR)      |
| UI             | Vanilla TS side panel; manual list windowing (no React)         |
| Tests          | Vitest + jsdom; static HTML fixtures for adapters               |
| Lint/format    | ESLint (typescript-eslint) + Prettier                           |
| Package mgr    | npm (Node 18)                                                   |
| Storage        | `chrome.storage.local` for **settings only**; never comment content |

Rationale for vanilla over React: the spec asks to "avoid large UI frameworks" and use
React "only when it materially improves maintainability." The panel is a single view
(search box, filters, status, one virtualized list). Manual windowing over a plain array
is small and keeps the bundle and CSP tight.

## 3. Runtime contexts

Four cooperating contexts, each its own bundle entry.

### 3.1 Content script (`src/content/`)
Runs in the page **and matching iframes** (YouTube chat renders in an iframe). It is the
**source of truth** for captured comments and must survive service-worker suspension.

Responsibilities: select an adapter, locate the feed, observe the smallest practical
container with one `MutationObserver`, parse added nodes in batches, deduplicate, store
into a per-tab ring buffer, handle SPA navigation (re-resolve feed, swap observers
without leaking), reply to snapshot requests, locate + temporarily highlight a comment on
request, and run the generic element picker.

### 3.2 Service worker (`src/background/`)
Thin router. Opens the side panel on toolbar-icon click
(`chrome.sidePanel.setPanelBehavior` / `open`), tracks the active tab
(`tabs.onActivated`, `tabs.onUpdated`), and relays messages between panel and the correct
tab/frame. **Stores no comment content.** Stateless beyond routing bookkeeping, so its
suspension loses nothing.

### 3.3 Side panel (`src/sidepanel/`)
The UI. Holds an in-memory **mirror** of the active tab's comments, runs search/filter/
sort, renders a windowed result list, and exports JSON/CSV. On open or reconnect, and on
active-tab change, it requests a fresh snapshot and rebuilds its mirror from the content
script — never from the worker.

### 3.4 Shared (`src/shared/`)
Pure modules, no DOM or Chrome dependency, fully unit-tested: message contracts +
validators, the data model, text normalization, dedup, ring buffer, search engine, export.

## 4. Data flow

```
page DOM mutates
  -> MutationObserver batches added nodes
  -> adapter.parseComment(node) -> ParsedComment[]
  -> dedup (platform id, else stable fingerprint) -> CapturedComment
  -> ring buffer (per-tab; default 10k; configurable 1k-50k; evict oldest)
  -> batched NEW_COMMENT_BATCH -> service worker -> side panel mirror -> render

side panel keystroke -> SearchEngine.query(mirror, criteria) -> windowed render
select result      -> LOCATE_COMMENT(id) -> content script: scroll + temp highlight
                                          -> LOCATE_RESULT(found|missing)
panel (re)opens / tab switch -> REQUEST_SNAPSHOT -> content script -> SNAPSHOT(full history)
```

Snapshot-on-connect is the mechanism that makes MV3 worker suspension harmless: the panel
reconstructs state from the content script's retained history.

## 5. Module layout

```
src/
  manifest.config.ts          # typed MV3 manifest (crxjs)
  settings.ts                 # chrome.storage.local — settings only

  shared/
    model.ts                  # CapturedComment, CommentLocator, ParsedComment, AdapterContext
    messages.ts               # discriminated-union messages + runtime validators
    normalize.ts              # normalization preserving emoji / unicode / linebreaks
    dedup.ts                  # id-or-fingerprint dedup; precomputes searchable fields
    ring-buffer.ts            # bounded FIFO, configurable capacity, evict oldest
    search.ts                 # substring/case/whole-word/exact-phrase/regex + author + sort
    export.ts                 # JSON + CSV with CSV-injection-safe escaping

  content/
    bootstrap.ts              # adapter resolution, observer lifecycle, SPA nav, ring buffer owner
    capture-controller.ts     # batching, pause/resume/stop, snapshot replies, status
    highlight.ts              # temporary accessible highlight (visible on light + dark pages)
    adapters/
      types.ts                # LiveCommentAdapter interface
      registry.ts             # ordered adapter resolution (first canHandle wins)
      youtube.ts              # YouTube Live Chat adapter (selectors documented inline)
      generic.ts              # generic adapter; per-host selector settings
    picker/
      overlay.ts              # element picker: hover highlight, click select, Esc cancel, full cleanup

  background/
    service-worker.ts         # side panel open, active-tab tracking, message relay

  sidepanel/
    index.html
    main.ts                   # bootstrap, message wiring, keyboard handling
    state.ts                  # mirror + criteria state, reducer-style updates
    render.ts                 # windowed result rendering, highlight spans (text nodes only)
    styles.css                # dark/light theme, reduced-motion, focus states

demo/
  index.html  feed.js         # simulated live feed: start/pause/burst/reset, virtualization removal

test/
  *.test.ts                   # pure-module unit tests
  fixtures/                   # static HTML representing adapter structures
```

## 6. Data model (from `claude.md`, restated for reference)

```ts
interface CapturedComment {
  id: string;
  source: string;                 // adapter id, e.g. "youtube" | "generic:host"
  tabId?: number;
  frameId?: number;
  author: string;
  text: string;
  displayedTimestamp?: string;    // message timestamp shown by the site, when present
  capturedAt: number;             // local capture epoch ms
  locator?: CommentLocator;       // adapter-specific; NEVER a raw DOM element
  metadata?: Record<string, string | number | boolean>;
  // precomputed at capture for fast search:
  searchAuthor: string;           // normalized author
  searchText: string;             // normalized text
}
```

A runtime `Map<id, Element>` of currently-mounted nodes lives only in the content script
for locate/highlight; it is never serialized.

## 7. Message protocol

Single discriminated union keyed on `type`. Every inbound message is shape-validated by a
matching validator before use; malformed messages are dropped and logged (dev only).

Request/response pairs and one-way events:

- Control: `START_CAPTURE`, `PAUSE_CAPTURE`, `RESUME_CAPTURE`, `STOP_CAPTURE`
- Sync: `REQUEST_SNAPSHOT` -> `SNAPSHOT`
- Stream: `NEW_COMMENT_BATCH`
- Status: `CAPTURE_STATUS` (state: connected | paused | unsupported | feed-not-found | permission-required)
- Locate: `LOCATE_COMMENT` -> `LOCATE_RESULT` (found | missing)
- History: `CLEAR_HISTORY`
- Generic picker: `BEGIN_ELEMENT_SELECTION` -> `SELECTION_COMPLETED` (selectors | cancelled)
- Errors: `ERROR`

## 8. Dedup & retention

- **Dedup key:** platform-provided message id when available; otherwise a stable
  fingerprint from `source + author + text + displayedTimestamp + bounded capture-time
  bucket`. The time bucket prevents two distinct users posting identical text in the same
  instant from collapsing, while still collapsing observer re-notifications and node moves.
- **Retention:** per-tab ring buffer; default 10,000; user-configurable 1,000–50,000;
  oldest evicted first. Settings persist; comment content does **not** persist across
  browser restarts (no opt-in implemented in this iteration).

## 9. Search

Search over precomputed `searchAuthor` / `searchText`. Modes: case-insensitive substring
(default), case-sensitive, whole-word (Unicode-aware boundaries where practical),
exact-phrase, regex (invalid pattern → inline validation message, never a thrown
exception). Author filter and combined author+text filter. Newest-first / oldest-first
sort. Input debounced lightly; result list windowed so 10,000 comments search and render
without freezing.

## 10. Permissions (least privilege)

- Static: `sidePanel`, `storage`, `activeTab`, `scripting`.
- Static host: `*://*.youtube.com/*` (and `*://*.youtube-nocookie.com/*` for the chat
  iframe) for the YouTube adapter content script.
- Generic adapter: requests the **current host at runtime** via
  `chrome.permissions.request`. No `<all_urls>`.
- Every permission is explained in the README. No analytics, telemetry, remote code,
  `eval`, `new Function`, or `innerHTML` for page-derived content.

## 11. Security & rendering

All captured values render as **text** (textContent / DOM text nodes), including match
highlighting (split into text spans, never `innerHTML`). Restrictive extension CSP. All
page listeners, observers, overlays, and temporary styles are removed on cleanup,
navigation, or stop.

## 12. Testing strategy

- **Pure unit (Vitest):** normalize, dedup (collapse re-notifications; preserve distinct
  identical-text users), ring-buffer eviction, search across all five modes + invalid
  regex + author + combined filters + sort, CSV escaping / JSON export, message validators.
- **Adapter (Vitest + jsdom):** parse standard comments, nested text + emoji (alt text),
  links, mixed content; ignore moderation/system UI. Driven by static fixtures in
  `test/fixtures/` — never against live third-party DOM.
- **Demo-driven integration:** the `demo/` feed exercises capture → search → locate →
  virtualization-removal fallback manually, and where practical via an automated load of
  the built extension against the demo page.

## 13. Acceptance criteria

The 20 criteria in `claude.md` §"Acceptance Criteria" are the definition of done.
Build, lint, typecheck, and test must all pass and be reported honestly.

## 14. Out of scope (YAGNI for this iteration)

Cross-restart persistence of comment content, non-YouTube site adapters beyond the generic
picker, and any cloud/sync feature. The adapter interface is built so these can be added
without touching search or UI.
