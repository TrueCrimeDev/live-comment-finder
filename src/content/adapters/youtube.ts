import type { AdapterContext, CommentLocator, ParsedComment } from '../../shared/model';
import type { LiveCommentAdapter } from './types';
import { collapseWhitespace } from '../../shared/normalize';

// --- Selectors (repair here if YouTube changes its DOM) ---
const ITEM = 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer';
const FEED = '#items.yt-live-chat-item-list-renderer, yt-live-chat-item-list-renderer #items, #items';
const AUTHOR = '#author-name';
const MESSAGE = '#message';
const TIMESTAMP = '#timestamp';

/** Extract human-visible text from a #message node: text + emoji alt + link text, in order. */
function extractMessageText(message: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === 'IMG') {
        const alt = el.getAttribute('alt');
        if (alt) out += alt;
        return;
      }
      el.childNodes.forEach(walk);
    }
  };
  message.childNodes.forEach(walk);
  return collapseWhitespace(out);
}

function parseOne(el: Element): ParsedComment | null {
  const authorEl = el.querySelector(AUTHOR);
  const messageEl = el.querySelector(MESSAGE);
  if (!authorEl || !messageEl) return null; // not a real comment (system/moderation UI)
  const author = collapseWhitespace(authorEl.textContent ?? '');
  const text = extractMessageText(messageEl);
  if (author === '' && text === '') return null;
  const messageId = el.id || el.getAttribute('id') || undefined;
  const displayedTimestamp = el.querySelector(TIMESTAMP)?.textContent?.trim() || undefined;
  const locator: CommentLocator = {
    adapter: 'youtube',
    messageId,
    selectorHint: messageId ? `#${messageId}` : undefined,
  };
  return { author, text, displayedTimestamp, messageId, locator };
}

export const youtubeAdapter: LiveCommentAdapter = {
  id: 'youtube',
  canHandle: (ctx: AdapterContext) =>
    /(^|\.)youtube\.com$/.test(ctx.location.hostname) || /(^|\.)youtube-nocookie\.com$/.test(ctx.location.hostname),
  locateFeed: (ctx: AdapterContext) => ctx.document.querySelector(FEED),
  parseComment: (node: Node, _ctx: AdapterContext): ParsedComment[] => {
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as Element;
    const items = el.matches(ITEM) ? [el] : Array.from(el.querySelectorAll(ITEM));
    const results: ParsedComment[] = [];
    for (const item of items) {
      const parsed = parseOne(item);
      if (parsed) results.push(parsed);
    }
    return results;
  },
  locateComment: (locator: CommentLocator, ctx: AdapterContext): Element | null =>
    locator.messageId ? ctx.document.getElementById(locator.messageId) : null,
};
