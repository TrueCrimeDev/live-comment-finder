import { describe, it, expect } from 'vitest';
import { search, matchRanges } from '../src/shared/search';
import type { CapturedComment } from '../src/shared/model';
import { normalize } from '../src/shared/normalize';

function c(author: string, text: string, capturedAt: number): CapturedComment {
  return {
    id: `${author}:${text}:${capturedAt}`,
    source: 'test',
    author,
    text,
    capturedAt,
    searchAuthor: normalize(author),
    searchText: normalize(text),
  };
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
    expect(matchRanges('Hello hello', { ...crit, query: 'hello' })).toEqual([
      [0, 5],
      [6, 11],
    ]);
  });
  it('empty query yields no ranges', () => {
    expect(matchRanges('abc', crit)).toEqual([]);
  });
});
