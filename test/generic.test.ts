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
  document.body.innerHTML = readFileSync('test/fixtures/generic-feed.html', 'utf8');
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
