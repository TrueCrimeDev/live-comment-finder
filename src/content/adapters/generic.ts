import type { AdapterContext, CommentLocator, GenericSelectors, ParsedComment } from '../../shared/model';
import type { LiveCommentAdapter } from './types';
import { collapseWhitespace } from '../../shared/normalize';

/** Find the most common repeated immediate-child pattern under a container. */
export function inferItemSelector(container: Element): string | null {
  const counts = new Map<string, number>();
  for (const child of Array.from(container.children)) {
    const cls = child.classList.length
      ? `.${Array.from(child.classList).join('.')}`
      : child.tagName.toLowerCase();
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 1;
  for (const [sel, n] of counts) {
    if (n > bestN) {
      best = sel;
      bestN = n;
    }
  }
  return best;
}

function text(el: Element | null): string {
  return el ? collapseWhitespace(el.textContent ?? '') : '';
}

export function createGenericAdapter(selectors: GenericSelectors): LiveCommentAdapter {
  return {
    id: 'generic',
    canHandle: () => true,
    locateFeed: (ctx: AdapterContext) => ctx.document.querySelector(selectors.item)?.parentElement ?? null,
    parseComment: (node: Node, ctx: AdapterContext): ParsedComment[] => {
      if (node.nodeType !== Node.ELEMENT_NODE) return [];
      const el = node as Element;
      const items = el.matches(selectors.item) ? [el] : Array.from(el.querySelectorAll(selectors.item));
      const out: ParsedComment[] = [];
      for (const item of items) {
        const author = selectors.author ? text(item.querySelector(selectors.author)) : '';
        const body = selectors.text ? text(item.querySelector(selectors.text)) : text(item);
        if (author === '' && body === '') continue;
        const displayedTimestamp = selectors.timestamp
          ? text(item.querySelector(selectors.timestamp)) || undefined
          : undefined;
        const locator: CommentLocator = { adapter: `generic:${ctx.location.hostname}` };
        out.push({ author, text: body, displayedTimestamp, locator });
      }
      return out;
    },
  };
}
