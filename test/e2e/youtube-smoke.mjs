// Real-Chrome E2E smoke test: loads the built extension (dist/) into Chrome and
// exercises the YouTube adapter against a youtube-SHAPED FIXTURE served at a
// youtube.com URL via request interception. This avoids any dependency on live
// YouTube DOM (per the project's test rules) while running the real extension.
//
// Verifies, end-to-end through the real extension + messaging:
//   - the extension loads and its service worker boots
//   - the content script captures messages already present
//   - new messages added live are captured (MutationObserver path)
//   - duplicate re-appends do not double-count (dedup)
//   - locating a mounted comment highlights its node
//   - locating an unmounted comment reports found:false (captured text still retained)
//
// chrome.* is driven through an extension page (the side panel URL), since the MV3
// service-worker context does not expose chrome.* to CDP evaluation. The content
// script is injected via chrome.scripting (deterministic; same code path as the
// static youtube content_script, which the manifest checks already cover).
//
// Run: npm run test:e2e
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(__dirname, '../../dist');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const CHAT_URL = 'https://www.youtube.com/live_chat?is_popout=1';
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head><body>
<yt-live-chat-item-list-renderer>
  <div id="items">
    <yt-live-chat-text-message-renderer id="msg-1">
      <span id="timestamp">0:01</span><span id="author-name">Ann</span><span id="message">Hello world</span>
    </yt-live-chat-text-message-renderer>
    <yt-live-chat-text-message-renderer id="msg-2">
      <span id="author-name">Bob</span><span id="message">nice <img class="emoji" alt="🎉"> party <a href="#">link</a></span>
    </yt-live-chat-text-message-renderer>
  </div>
</yt-live-chat-item-list-renderer>
</body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
});

try {
  // 1) Extension loads + service worker boots.
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 20000 },
  );
  const extId = new URL(swTarget.url()).host;
  check('extension loads + service worker boots', !!extId);

  // Drive chrome.* through an extension page (side panel URL).
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/src/sidepanel/index.html`, { waitUntil: 'domcontentloaded' });
  await ext.evaluate(() => {
    window.__snap = [];
    window.__locate = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'SNAPSHOT') window.__snap = m.comments;
      if (m?.type === 'LOCATE_RESULT') window.__locate.push(m);
    });
  });
  check('extension page exposes chrome.runtime', await ext.evaluate(() => typeof chrome?.runtime?.onMessage === 'object'));

  // 2) Serve the youtube-shaped fixture at the youtube URL.
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    // Serve only the top document from the fixture; let everything else (notably
    // the content bundle's chrome-extension:// dynamic import) proceed untouched.
    if (req.resourceType() === 'document') req.respond({ status: 200, contentType: 'text/html', body: FIXTURE });
    else req.continue();
  });
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });

  // 3) Inject the content bundle into the youtube tab (deterministic; boot guard
  //    makes it a no-op if the static content_script already ran).
  const tabId = await ext.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    return tabs[0]?.id;
  });
  check('youtube tab found', typeof tabId === 'number');
  await ext.evaluate(async (id) => {
    const file = chrome.runtime.getManifest().content_scripts[0].js[0];
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: [file] });
    } catch {
      /* already present */
    }
  }, tabId);
  await sleep(1000); // boot + capture existing

  // 4) Add live messages, including a duplicate re-append.
  await page.evaluate(() => {
    const items = document.querySelector('#items');
    const make = (id, who, text) => {
      const r = document.createElement('yt-live-chat-text-message-renderer');
      r.id = id;
      const a = document.createElement('span');
      a.id = 'author-name';
      a.textContent = who;
      const m = document.createElement('span');
      m.id = 'message';
      m.textContent = text;
      r.append(a, m);
      items.appendChild(r);
      return r;
    };
    make('msg-3', 'Cara', 'live one 🚀');
    const dup = make('msg-4', 'Cara', 'live two');
    items.appendChild(dup); // duplicate mutation — must not double-count
    make('msg-5', 'Dee', 'привет всем');
  });
  await sleep(800); // observer batch (250ms) + margin

  // 5) Snapshot via the real REQUEST_SNAPSHOT → SNAPSHOT broadcast path.
  await ext.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'REQUEST_SNAPSHOT' }), tabId);
  await sleep(500);
  const snap = await ext.evaluate(() => window.__snap);

  const texts = snap.map((c) => c.text);
  const authors = new Set(snap.map((c) => c.author));
  check('captured existing + live messages', snap.length >= 5);
  check('captured author from existing fixture (Ann)', authors.has('Ann'));
  check('captured live author (Dee)', authors.has('Dee'));
  check('emoji preserved in mixed content', texts.some((t) => t.includes('🎉')));
  check('emoji preserved in live message', texts.some((t) => t.includes('🚀')));
  check('link text included in mixed content', texts.some((t) => t.includes('link')));
  check('international text captured', texts.some((t) => t.includes('привет')));
  const ids = snap.map((c) => c.id);
  check('no duplicate ids despite re-append', new Set(ids).size === ids.length);

  // 6) Locate a mounted comment → node highlighted.
  const mounted = snap.find((c) => c.locator?.messageId === 'msg-3');
  await ext.evaluate((id, cid) => chrome.tabs.sendMessage(id, { type: 'LOCATE_COMMENT', id: cid }), tabId, mounted.id);
  await sleep(500);
  const highlighted = await page.evaluate(() => !!document.querySelector('[data-lcf-highlight]'));
  check('locating a mounted comment highlights its node', highlighted);
  const mountedResult = (await ext.evaluate(() => window.__locate)).find((r) => r.id === mounted.id);
  check('locate reports found:true for mounted comment', mountedResult?.found === true);

  // 7) Remove a node, then locate it → found:false (text still retained in snapshot).
  await page.evaluate(() => document.getElementById('msg-5')?.remove());
  const removed = snap.find((c) => c.locator?.messageId === 'msg-5');
  await ext.evaluate((id, cid) => chrome.tabs.sendMessage(id, { type: 'LOCATE_COMMENT', id: cid }), tabId, removed.id);
  await sleep(500);
  const removedResult = (await ext.evaluate(() => window.__locate)).find((r) => r.id === removed.id);
  check('locating an unmounted comment reports found:false', removedResult?.found === false);
  check('unmounted comment text still retained in snapshot', removed.text.includes('привет'));

  // 8) Regression: a feed that hydrates AFTER the content script boots must still be
  //    captured (YouTube renders its chat #items asynchronously after document_idle).
  const page2 = await browser.newPage();
  await page2.setRequestInterception(true);
  page2.on('request', (req) => {
    if (req.resourceType() === 'document')
      req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="shell">loading…</div></body></html>' });
    else req.continue();
  });
  await page2.goto('https://www.youtube.com/live_chat?late=1', { waitUntil: 'domcontentloaded' });
  const tab2 = await ext.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    return tabs.find((t) => t.url.includes('late=1'))?.id;
  });
  await ext.evaluate(async (id) => {
    const file = chrome.runtime.getManifest().content_scripts[0].js[0];
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: [file] });
    } catch {
      /* already present */
    }
  }, tab2);
  await sleep(1000); // content boots while no feed exists → feed-not-found
  await page2.evaluate(() => {
    const list = document.createElement('yt-live-chat-item-list-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    const mk = (who, txt) => {
      const r = document.createElement('yt-live-chat-text-message-renderer');
      const a = document.createElement('span');
      a.id = 'author-name';
      a.textContent = who;
      const m = document.createElement('span');
      m.id = 'message';
      m.textContent = txt;
      r.append(a, m);
      items.appendChild(r);
    };
    mk('Eve', 'late hydrated');
    mk('Fay', 'second late');
    list.appendChild(items);
    document.body.appendChild(list); // feed appears AFTER boot
  });
  await sleep(1200); // scheduleResolve (400ms) + batch flush (250ms) + margin
  await ext.evaluate(() => {
    window.__snap = [];
  });
  await ext.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'REQUEST_SNAPSHOT' }).catch(() => {}), tab2);
  await sleep(500);
  const lateSnap = await ext.evaluate(() => window.__snap);
  check('feed that hydrates after boot is captured (regression)', lateSnap.length >= 2);

  console.log(`\n${failures === 0 ? 'E2E PASS' : 'E2E FAIL'} — ${snap.length} comments captured, ${failures} failure(s)`);
} catch (err) {
  console.error('E2E ERROR:', err?.message ?? err);
  failures++;
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
