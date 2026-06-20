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
  const view = comments.map((c) => ({
    id: c.id,
    source: c.source,
    tabId: c.tabId,
    frameId: c.frameId,
    author: c.author,
    text: c.text,
    displayedTimestamp: c.displayedTimestamp,
    capturedAt: c.capturedAt,
    locator: c.locator,
    metadata: c.metadata,
  }));
  return JSON.stringify(view, null, 2);
}
