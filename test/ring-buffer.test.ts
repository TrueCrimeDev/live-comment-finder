import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/shared/ring-buffer';

describe('RingBuffer', () => {
  it('keeps insertion order until full', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    r.push(3);
    expect(r.toArray()).toEqual([1, 2, 3]);
    expect(r.size).toBe(3);
  });
  it('evicts oldest first and returns the evicted item', () => {
    const r = new RingBuffer<number>(2);
    r.push(1);
    r.push(2);
    expect(r.push(3)).toBe(1);
    expect(r.toArray()).toEqual([2, 3]);
  });
  it('shrinking capacity drops oldest', () => {
    const r = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    r.setCapacity(2);
    expect(r.toArray()).toEqual([4, 5]);
  });
  it('clear empties', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.clear();
    expect(r.size).toBe(0);
  });
});
