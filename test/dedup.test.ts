import { describe, it, expect } from 'vitest';
import { fingerprint, commentId, Deduper } from '../src/shared/dedup';

const base = { source: 'youtube', author: 'Ann', text: 'hi', capturedAt: 1000 };

describe('fingerprint', () => {
  it('is stable for identical input within the same time bucket', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base, capturedAt: 1500 }));
  });
  it('differs for different authors with same text', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, author: 'Bob' }));
  });
  it('keeps two users posting identical text distinct', () => {
    expect(fingerprint({ ...base, author: 'A' })).not.toBe(fingerprint({ ...base, author: 'B' }));
  });
  it('separates identical text far apart in time (different buckets)', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, capturedAt: 1000 + 5 * 60_000 }));
  });
});

describe('commentId', () => {
  it('prefers platform messageId', () => {
    expect(commentId({ author: 'Ann', text: 'hi', messageId: 'X1' }, 'youtube', 1000)).toBe('youtube:X1');
  });
  it('falls back to fingerprint when no messageId', () => {
    const id = commentId({ author: 'Ann', text: 'hi' }, 'youtube', 1000);
    expect(id.startsWith('youtube:fp:')).toBe(true);
  });
});

describe('Deduper', () => {
  it('reports and remembers seen ids', () => {
    const d = new Deduper();
    expect(d.has('a')).toBe(false);
    d.add('a');
    expect(d.has('a')).toBe(true);
    expect(d.size).toBe(1);
  });
});
