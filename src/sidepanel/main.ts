import { createStore } from './state';
import { search, type SearchMode } from '../shared/search';
import { renderResults } from './render';
import { toCSV, toJSON } from '../shared/export';
import { validateMessage, type Message } from '../shared/messages';
import { loadSettings, saveSettings, clampMax } from '../settings';
import type { CapturedComment, CaptureState } from '../shared/model';

const ROW_HEIGHT = 76;
const store = createStore();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q');
const authorInput = $<HTMLInputElement>('author');
const sortSel = $<HTMLSelectElement>('sort');
const maxInput = $<HTMLInputElement>('max');
const resultsEl = $<HTMLElement>('results');
const regexError = $<HTMLParagraphElement>('regex-error');
const resultCount = $<HTMLElement>('result-count');
const capturedCount = $<HTMLElement>('captured-count');
const statusDot = document.querySelector('.dot') as HTMLElement;
const statusText = $<HTMLElement>('status-text');
const empty = $<HTMLParagraphElement>('empty');

let activeTabId: number | undefined;
let selectedId: string | null = null;
let lastResults: CapturedComment[] = [];

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function sendToTab(tabId: number, msg: Message): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

/** Reset the mirror and ask the active tab's frames for their captured history. */
async function requestSnapshot(): Promise<void> {
  activeTabId = await getActiveTabId();
  store.clear();
  if (activeTabId === undefined) {
    store.setStatus('unsupported');
    return;
  }
  // Frames that own a feed answer via a SNAPSHOT broadcast (see runtime.onMessage).
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'REQUEST_SNAPSHOT' } satisfies Message);
  } catch {
    store.setStatus('unsupported'); // no content script in this tab
  }
}

function currentCriteria(): { query: string; author: string; mode: SearchMode; sort: 'newest' | 'oldest' } {
  const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value as SearchMode;
  return { query: q.value, author: authorInput.value, mode, sort: sortSel.value as 'newest' | 'oldest' };
}

function apply(): void {
  const criteria = store.getState().criteria;
  const { results, error } = search(store.getState().comments, criteria);
  regexError.hidden = !error;
  regexError.textContent = error ? `Invalid regex: ${error}` : '';
  lastResults = results;
  resultCount.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
  capturedCount.textContent = `${store.getState().comments.length} captured`;
  empty.hidden = results.length > 0 || !!error;
  if (!empty.hidden) empty.textContent = 'No matching comments.';
  renderResults(resultsEl, results, criteria, { rowHeight: ROW_HEIGHT, onActivate: locate, selectedId });
}

let debounce: number | null = null;
function onInput(): void {
  store.setCriteria(currentCriteria());
  if (debounce) clearTimeout(debounce);
  debounce = window.setTimeout(apply, 120);
}

function locate(id: string): void {
  selectedId = id;
  empty.hidden = true;
  if (activeTabId !== undefined) void sendToTab(activeTabId, { type: 'LOCATE_COMMENT', id });
  apply();
}

function download(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function moveSelection(delta: number): void {
  if (!lastResults.length) return;
  const idx = lastResults.findIndex((c) => c.id === selectedId);
  const next = Math.min(lastResults.length - 1, Math.max(0, (idx === -1 ? -1 : idx) + delta));
  const target = lastResults[next];
  if (!target) return;
  selectedId = target.id;
  apply();
  const row = resultsEl.querySelector(`[data-id="${CSS.escape(selectedId)}"]`) as HTMLElement | null;
  row?.scrollIntoView({ block: 'nearest' });
  row?.focus();
}

// --- input events ---
q.addEventListener('input', onInput);
authorInput.addEventListener('input', onInput);
sortSel.addEventListener('change', onInput);
document.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', onInput));
resultsEl.addEventListener('scroll', () =>
  renderResults(resultsEl, lastResults, store.getState().criteria, {
    rowHeight: ROW_HEIGHT,
    onActivate: locate,
    selectedId,
  }),
);

maxInput.addEventListener('change', () => {
  const capacity = clampMax(Number(maxInput.value));
  maxInput.value = String(capacity);
  void saveSettings({ maxComments: capacity });
  if (activeTabId !== undefined) void sendToTab(activeTabId, { type: 'SET_CAPACITY', capacity });
});

$('clear-filters').addEventListener('click', () => {
  q.value = '';
  authorInput.value = '';
  (document.querySelector('input[name=mode][value=substring]') as HTMLInputElement).checked = true;
  sortSel.value = 'newest';
  onInput();
});
$('pause').addEventListener('click', () => {
  if (activeTabId === undefined) return;
  const paused = store.getState().status === 'paused';
  void sendToTab(activeTabId, { type: paused ? 'RESUME_CAPTURE' : 'PAUSE_CAPTURE' });
});
$('clear').addEventListener('click', () => {
  if (activeTabId !== undefined) void sendToTab(activeTabId, { type: 'CLEAR_HISTORY' });
  store.clear();
  apply();
});
$('export-json').addEventListener('click', () => download('comments.json', toJSON(lastResults), 'application/json'));
$('export-csv').addEventListener('click', () => download('comments.csv', toCSV(lastResults), 'text/csv'));
$('select-feed').addEventListener('click', () =>
  chrome.runtime.sendMessage({ type: 'BEGIN_ELEMENT_SELECTION' } satisfies Message).catch(() => {}),
);

// --- keyboard ---
document.addEventListener('keydown', (e) => {
  const typing = document.activeElement === q || document.activeElement === authorInput;
  if (e.key === '/' && !typing) {
    e.preventDefault();
    q.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    q.focus();
  } else if (e.key === 'Escape') {
    if (q.value || authorInput.value) {
      q.value = '';
      authorInput.value = '';
      onInput();
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSelection(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(-1);
  } else if (e.key === 'Enter' && selectedId) {
    locate(selectedId);
  }
});

function applyStatus(state: CaptureState): void {
  // An active feed (comments present) outranks a stray negative status from a
  // non-feed frame; only accept a negative state when we have nothing captured.
  const positive = state === 'connected' || state === 'paused';
  if (positive || store.getState().comments.length === 0) store.setStatus(state);
}

// --- live updates from content scripts / worker ---
chrome.runtime.onMessage.addListener((raw) => {
  const msg = validateMessage(raw);
  if (!msg) return;
  switch (msg.type) {
    case 'SNAPSHOT':
      store.setComments(msg.comments);
      applyStatus(msg.state);
      apply();
      break;
    case 'NEW_COMMENT_BATCH':
      store.addBatch(msg.comments);
      store.setStatus('connected');
      apply();
      break;
    case 'CAPTURE_STATUS':
      applyStatus(msg.state);
      break;
    case 'ACTIVE_TAB_CHANGED':
      void requestSnapshot().then(apply);
      break;
    case 'SELECTION_COMPLETED':
      if (!msg.cancelled) void requestSnapshot().then(apply);
      break;
    case 'LOCATE_RESULT':
      if (!msg.found) {
        empty.hidden = false;
        empty.textContent = 'This comment is no longer present in the page, but its captured text is still available.';
      }
      break;
  }
});

const STATUS_TEXT: Record<CaptureState, string> = {
  connected: 'Capturing',
  paused: 'Paused',
  unsupported: 'Unsupported page',
  'feed-not-found': 'Feed not found',
  'permission-required': 'Permission required',
};
store.subscribe((s) => {
  statusDot.dataset.state = s.status;
  statusText.textContent = STATUS_TEXT[s.status];
  $('pause').textContent = s.status === 'paused' ? 'Resume' : 'Pause';
});

// --- init ---
void (async () => {
  const settings = await loadSettings();
  maxInput.value = String(settings.maxComments);
  await requestSnapshot();
  apply();
})();
