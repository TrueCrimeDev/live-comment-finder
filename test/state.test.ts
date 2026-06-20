import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/sidepanel/state';
import type { CapturedComment } from '../src/shared/model';

const c = (id: string): CapturedComment => ({
  id,
  source: 't',
  author: 'a',
  text: id,
  capturedAt: +id,
  searchAuthor: 'a',
  searchText: id,
});

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
