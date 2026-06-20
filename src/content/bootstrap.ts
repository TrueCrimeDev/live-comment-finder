import type { AdapterContext, CaptureState, GenericSelectors } from '../shared/model';
import type { Message } from '../shared/messages';
import { validateMessage } from '../shared/messages';
import type { LiveCommentAdapter } from './adapters/types';
import { resolveAdapter } from './adapters/registry';
import { youtubeAdapter } from './adapters/youtube';
import { createGenericAdapter, inferItemSelector } from './adapters/generic';
import { CaptureController } from './capture-controller';
import { flashHighlight } from './highlight';
import { startPicker } from './picker/overlay';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../settings';

const BATCH_MS = 250;

/**
 * Boot the per-frame capture pipeline. Runs in every matching frame (YouTube
 * chat is an iframe). A frame only announces status / answers snapshots / locates
 * comments when it actually owns a feed or the requested comment, so the empty
 * watch-page frame never clobbers the chat iframe.
 */
export async function boot(): Promise<void> {
  const host = location.hostname;
  // Start with defaults so the message listener can register synchronously
  // (before any await); real settings are loaded just below.
  let settings: Settings = DEFAULT_SETTINGS;

  const adapters: LiveCommentAdapter[] = [youtubeAdapter];
  const ctx: AdapterContext = { document, location, source: 'pending' };
  let adapter: LiveCommentAdapter | null = null;
  let controller: CaptureController | null = null;
  let observer: MutationObserver | null = null;
  let currentFeed: Element | null = null;
  let state: CaptureState = 'unsupported';
  let lastAnnounced: CaptureState | null = null;
  let resolveTimer: number | null = null;
  let teardownPicker: (() => void) | null = null;

  const send = (msg: Message): void => {
    void chrome.runtime.sendMessage(msg).catch(() => {});
  };

  function announce(force = false): void {
    // Stay silent for 'unsupported' so a non-feed frame never clobbers a feed frame's status.
    if (state === 'unsupported') return;
    if (!force && state === lastAnnounced) return;
    lastAnnounced = state;
    send({ type: 'CAPTURE_STATUS', state, source: adapter?.id, capturedCount: controller?.snapshot().length ?? 0 });
  }

  function startObserving(feed: Element, a: LiveCommentAdapter): void {
    stopObserving();
    ctx.source = a.id;
    controller = new CaptureController({
      source: a.id,
      capacity: settings.maxComments,
      emit: (batch) => send({ type: 'NEW_COMMENT_BATCH', comments: batch }),
    });
    controller.ingest(a.parseComment(feed, ctx)); // capture what is already visible

    let queued: Node[] = [];
    let timer: number | null = null;
    const flush = (): void => {
      timer = null;
      const nodes = queued;
      queued = [];
      controller?.ingest(nodes.flatMap((n) => a.parseComment(n, ctx)));
    };
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) m.addedNodes.forEach((n) => queued.push(n));
      if (timer === null) timer = window.setTimeout(flush, BATCH_MS);
    });
    observer.observe(feed, { childList: true, subtree: true });
    currentFeed = feed;

    state = controller.paused ? 'paused' : 'connected';
    announce(true);
  }

  function stopObserving(): void {
    observer?.disconnect();
    observer = null;
    currentFeed = null;
  }

  function reset(): void {
    stopObserving();
    controller = null;
    state = 'unsupported';
    lastAnnounced = null;
  }

  async function tryStart(): Promise<void> {
    if (controller) return; // already capturing
    adapter = await resolveAdapter(adapters, ctx);
    if (!adapter) {
      state = 'unsupported';
      return; // site not recognized; stay silent so we never clobber a feed frame
    }
    const feed = await adapter.locateFeed(ctx);
    if (!feed) {
      // Site recognized but the feed isn't mounted yet. Announce once; the
      // lifecycle observer keeps re-checking until it appears (YouTube and other
      // SPAs hydrate their chat feed asynchronously after document_idle).
      state = 'feed-not-found';
      announce();
      return;
    }
    startObserving(feed, adapter);
  }

  /** Throttled re-resolve while we have no feed yet (the feed may appear later). */
  function scheduleResolve(): void {
    if (resolveTimer !== null || controller) return;
    resolveTimer = window.setTimeout(() => {
      resolveTimer = null;
      void tryStart();
    }, 400);
  }

  async function onGenericPicked(container: Element): Promise<void> {
    const itemSel = inferItemSelector(container) ?? container.tagName.toLowerCase();
    const selectors: GenericSelectors = { item: itemSel };
    const current = await loadSettings();
    await saveSettings({ genericByHost: { ...current.genericByHost, [host]: selectors } });
    const generic = createGenericAdapter(selectors);
    adapters.push(generic);
    ctx.genericSelectors = selectors;
    adapter = generic;
    startObserving(container, generic);
    send({ type: 'SELECTION_COMPLETED', cancelled: false, selectors, host });
    send({ type: 'SNAPSHOT', comments: controller?.snapshot() ?? [], state });
  }

  // --- Lifecycle observer: handles SPA navigation, late-appearing feeds, and
  //     feeds that get torn down (chat reloads). The feed often hydrates after
  //     document_idle, so a one-shot locateFeed at boot is not enough. ---
  let lastUrl = location.href;
  const lifecycleObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      reset();
      void tryStart();
      scheduleResolve();
      return;
    }
    if (controller && currentFeed && !currentFeed.isConnected) {
      // The observed feed was detached (e.g. chat reloaded) — re-resolve.
      reset();
    }
    if (!controller) scheduleResolve();
  });
  lifecycleObserver.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((raw) => {
    const msg = validateMessage(raw);
    if (!msg) return undefined;
    switch (msg.type) {
      case 'REQUEST_SNAPSHOT':
        if (controller) send({ type: 'SNAPSHOT', comments: controller.snapshot(), state });
        return undefined;
      case 'PAUSE_CAPTURE':
        if (controller) {
          controller.pause();
          state = 'paused';
          announce(true);
        }
        return undefined;
      case 'RESUME_CAPTURE':
        if (controller) {
          controller.resume();
          state = 'connected';
          announce(true);
        }
        return undefined;
      case 'STOP_CAPTURE':
        stopObserving();
        return undefined;
      case 'START_CAPTURE':
        void tryStart();
        return undefined;
      case 'CLEAR_HISTORY':
        controller?.clear();
        announce(true);
        return undefined;
      case 'SET_CAPACITY':
        settings = { ...settings, maxComments: msg.capacity };
        controller?.setCapacity(msg.capacity);
        announce(true);
        return undefined;
      case 'LOCATE_COMMENT': {
        const owned = controller?.locateId(msg.id);
        if (!owned) return undefined; // a different frame owns this comment
        const el = owned.locator && adapter?.locateComment ? adapter.locateComment(owned.locator, ctx) : null;
        if (el) flashHighlight(el);
        send({ type: 'LOCATE_RESULT', id: msg.id, found: !!el });
        return undefined;
      }
      case 'BEGIN_ELEMENT_SELECTION':
        teardownPicker?.();
        teardownPicker = startPicker({
          onPick: (picked) => void onGenericPicked(picked),
          onCancel: () => send({ type: 'SELECTION_COMPLETED', cancelled: true }),
        });
        return undefined;
      default:
        return undefined;
    }
  });

  // Async init: load real settings, register any saved generic adapter, then start.
  settings = await loadSettings();
  const savedSelectors = settings.genericByHost[host];
  if (savedSelectors) {
    adapters.push(createGenericAdapter(savedSelectors));
    ctx.genericSelectors = savedSelectors;
  }
  await tryStart();
  // If the feed isn't up yet, keep polling (the lifecycle observer also re-checks
  // on DOM mutations, but this covers feeds that appear without further mutations).
  if (!controller) scheduleResolve();
}
