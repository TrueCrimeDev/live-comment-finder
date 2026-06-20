import type { CapturedComment } from '../shared/model';
import { matchRanges, type SearchCriteria } from '../shared/search';

/** Insert text into `el`, wrapping the given [start,end) ranges in <mark>. Text nodes only — no innerHTML. */
export function highlightInto(el: HTMLElement, text: string, ranges: Array<[number, number]>): void {
  el.textContent = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue; // skip overlaps defensively
    if (start > cursor) el.appendChild(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    el.appendChild(mark);
    cursor = end;
  }
  if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString();
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
  highlightInto(
    author,
    c.author,
    criteria.author ? matchRanges(c.author, { ...criteria, query: criteria.author, mode: 'substring' }) : [],
  );
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
    void navigator.clipboard?.writeText(`${c.author}: ${c.text}`);
  });

  row.append(head, body, copy);
  return row;
}

interface RenderOpts {
  rowHeight: number;
  onActivate: (id: string) => void;
  selectedId?: string | null;
}

/** Windowed render: only mount rows in the visible range + small overscan. */
export function renderResults(
  container: HTMLElement,
  results: CapturedComment[],
  criteria: SearchCriteria,
  opts: RenderOpts,
): void {
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
  spacerBottom.style.height = `${Math.max(0, total - last) * opts.rowHeight}px`;

  for (let i = first; i < last; i++) {
    const row = buildRow(results[i], criteria);
    if (results[i].id === opts.selectedId) {
      row.classList.add('selected');
      row.setAttribute('aria-selected', 'true');
    }
    row.addEventListener('click', () => opts.onActivate(results[i].id));
    list.appendChild(row);
  }
  container.append(spacerTop, list, spacerBottom);
}
