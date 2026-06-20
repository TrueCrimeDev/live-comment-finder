// @vitest-environment jsdom
// Integration test: drives the real demo feed DOM through the capture pipeline
// (generic adapter + MutationObserver + CaptureController) and verifies capture,
// dedup of duplicate mutations, retention after virtualization, and search.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGenericAdapter } from '../src/content/adapters/generic';
import { CaptureController } from '../src/content/capture-controller';
import { search } from '../src/shared/search';
import type { AdapterContext } from '../src/shared/model';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('demo feed integration', () => {
  it('captures, dedups duplicate mutations, retains after virtualization, and searches', async () => {
    const html = readFileSync('demo/index.html', 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    // Run the demo's feed script against this document.
    new Function(readFileSync('demo/feed.js', 'utf8'))();

    const feedEl = document.getElementById('feed')!;
    (document.getElementById('maxnodes') as HTMLInputElement).value = '10'; // force virtualization

    const adapter = createGenericAdapter({ item: '.msg', author: '.who', text: '.body', timestamp: 'time' });
    const ctx: AdapterContext = { document, location: window.location, source: 'generic' };
    const ctrl = new CaptureController({ source: 'generic', capacity: 10_000, emit: () => {} });

    // Mirror the content-script bootstrap: observe the feed, ingest added nodes.
    const obs = new MutationObserver((muts) => {
      const added: Node[] = [];
      for (const m of muts) m.addedNodes.forEach((n) => added.push(n));
      ctrl.ingest(added.flatMap((n) => adapter.parseComment(n, ctx)));
    });
    obs.observe(feedEl, { childList: true, subtree: true });

    document.getElementById('burst')!.dispatchEvent(new MouseEvent('click'));
    await flush();
    obs.disconnect();

    // Virtualization dropped DOM nodes, but capture retained the history.
    expect(feedEl.children.length).toBeLessThanOrEqual(10);
    expect(ctrl.snapshot().length).toBeGreaterThan(10);

    // Duplicate re-appends did not create duplicate captured entries.
    const ids = ctrl.snapshot().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    // A comment whose node was virtualized away is still searchable.
    const res = search(ctrl.snapshot(), { query: 'привет', author: '', mode: 'substring', sort: 'newest' });
    expect(res.results.length).toBeGreaterThan(0);
  });
});
