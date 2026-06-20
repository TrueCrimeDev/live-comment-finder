import { describe, it, expect } from 'vitest';
import { toJSON, toCSV } from '../src/shared/export';
import type { CapturedComment } from '../src/shared/model';

const rows: CapturedComment[] = [
  {
    id: '1',
    source: 'youtube',
    author: 'Ann',
    text: 'hi, "you"',
    capturedAt: 1000,
    searchAuthor: 'ann',
    searchText: 'hi, "you"',
  },
  {
    id: '2',
    source: 'youtube',
    author: '=cmd()',
    text: 'line1\nline2',
    capturedAt: 2000,
    searchAuthor: '=cmd()',
    searchText: 'line1\nline2',
  },
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
