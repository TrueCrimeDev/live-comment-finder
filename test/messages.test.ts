import { describe, it, expect } from 'vitest';
import { validateMessage } from '../src/shared/messages';

describe('validateMessage', () => {
  it('accepts a well-formed NEW_COMMENT_BATCH', () => {
    const msg = { type: 'NEW_COMMENT_BATCH', tabId: 3, comments: [] };
    expect(validateMessage(msg)?.type).toBe('NEW_COMMENT_BATCH');
  });
  it('rejects unknown type', () => {
    expect(validateMessage({ type: 'NOPE' })).toBeNull();
  });
  it('rejects missing discriminant', () => {
    expect(validateMessage({ comments: [] })).toBeNull();
  });
  it('rejects non-object', () => {
    expect(validateMessage(42)).toBeNull();
    expect(validateMessage(null)).toBeNull();
  });
  it('validates LOCATE_COMMENT requires string id', () => {
    expect(validateMessage({ type: 'LOCATE_COMMENT', id: 'a' })?.type).toBe('LOCATE_COMMENT');
    expect(validateMessage({ type: 'LOCATE_COMMENT' })).toBeNull();
  });
});
