// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildRow, highlightInto } from '../src/sidepanel/render';
import type { CapturedComment } from '../src/shared/model';

const c: CapturedComment = {
  id: '1',
  source: 'youtube',
  author: 'Ann',
  text: 'Hello world',
  capturedAt: 1000,
  searchAuthor: 'ann',
  searchText: 'hello world',
};
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
