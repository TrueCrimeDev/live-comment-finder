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
