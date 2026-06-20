import { describe, it, expect, vi } from 'vitest';
import { CaptureController } from '../src/content/capture-controller';
import type { ParsedComment } from '../src/shared/model';

const p = (author: string, text: string, messageId?: string): ParsedComment => ({ author, text, messageId });

describe('CaptureController', () => {
  it('captures, dedups by messageId, and emits new comments', () => {
    const emit = vi.fn();
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit });
    ctrl.ingest([p('Ann', 'hi', 'a'), p('Ann', 'hi', 'a')]); // duplicate id
    expect(ctrl.snapshot().length).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].length).toBe(1);
  });
  it('precomputes searchable fields', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit: () => {} });
    ctrl.ingest([p('ANN', 'HeLLo', 'x')]);
    expect(ctrl.snapshot()[0].searchText).toBe('hello');
    expect(ctrl.snapshot()[0].searchAuthor).toBe('ann');
  });
  it('pause stops capture; resume restarts', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 100, emit: () => {} });
    ctrl.pause();
    ctrl.ingest([p('A', 'x', '1')]);
    expect(ctrl.snapshot().length).toBe(0);
    ctrl.resume();
    ctrl.ingest([p('A', 'x', '1')]);
    expect(ctrl.snapshot().length).toBe(1);
  });
  it('evicts oldest beyond capacity and forgets its dedup key', () => {
    const ctrl = new CaptureController({ source: 'test', capacity: 2, emit: () => {} });
    ctrl.ingest([p('A', '1', '1'), p('A', '2', '2'), p('A', '3', '3')]);
    expect(ctrl.snapshot().map((c) => c.text)).toEqual(['2', '3']);
  });
});
