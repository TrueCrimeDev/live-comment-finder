import { describe, it, expect } from 'vitest';
import { resolveAdapter } from '../src/content/adapters/registry';
import type { LiveCommentAdapter } from '../src/content/adapters/types';
import type { AdapterContext } from '../src/shared/model';

const ctx = { document: {} as Document, location: { hostname: 'x' } as Location, source: 'x' } as AdapterContext;
function fake(id: string, can: boolean): LiveCommentAdapter {
  return { id, canHandle: () => can, locateFeed: () => null, parseComment: () => [] };
}

describe('resolveAdapter', () => {
  it('returns the first adapter that can handle', async () => {
    expect((await resolveAdapter([fake('a', false), fake('b', true), fake('c', true)], ctx))?.id).toBe('b');
  });
  it('returns null when none match', async () => {
    expect(await resolveAdapter([fake('a', false)], ctx)).toBeNull();
  });
});
