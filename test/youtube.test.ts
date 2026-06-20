// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { youtubeAdapter } from '../src/content/adapters/youtube';
import type { AdapterContext } from '../src/shared/model';

function ctx(): AdapterContext {
  return { document, location: window.location, source: 'youtube' };
}
beforeEach(() => {
  document.body.innerHTML = readFileSync('test/fixtures/youtube-chat.html', 'utf8');
});

describe('youtubeAdapter.parseComment', () => {
  it('parses author + text for a normal message', () => {
    const node = document.getElementById('m1')!;
    const [p] = youtubeAdapter.parseComment(node, ctx());
    expect(p.author).toBe('Ann');
    expect(p.text).toBe('Hello world');
    expect(p.messageId).toBe('m1');
  });
  it('includes emoji alt text and link text in mixed content', () => {
    const [p] = youtubeAdapter.parseComment(document.getElementById('m2')!, ctx());
    expect(p.text).toContain('🎉');
    expect(p.text).toContain('party');
    expect(p.text).toContain('link');
  });
  it('ignores system/engagement renderers (no author)', () => {
    const node = document.querySelector('yt-live-chat-viewer-engagement-message-renderer')!;
    expect(youtubeAdapter.parseComment(node, ctx())).toEqual([]);
  });
  it('locateFeed finds the chat container when present', () => {
    expect(youtubeAdapter.locateFeed(ctx())).not.toBeNull();
  });
});
