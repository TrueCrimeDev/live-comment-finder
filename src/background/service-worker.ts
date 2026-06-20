import type { Message } from '../shared/messages';
import { validateMessage } from '../shared/messages';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Tell the side panel when the user switches tabs so it can reset context.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.runtime.sendMessage({ type: 'ACTIVE_TAB_CHANGED', tabId } satisfies Message).catch(() => {});
});

/** Resolve the (content-hashed) content-script bundle path from the live manifest. */
function contentScriptFile(): string | null {
  const cs = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
  return cs ?? null;
}

/**
 * The side panel asks the worker to start generic element selection on the
 * active tab. Privileged work the panel cannot do itself: request the host
 * permission at runtime, inject the content bundle (no-op if already present),
 * then relay the begin-selection message to the tab.
 */
chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = validateMessage(raw);
  if (!msg || msg.type !== 'BEGIN_ELEMENT_SELECTION') return undefined;

  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      sendResponse({ ok: false, reason: 'no-tab' });
      return;
    }
    let origin: string;
    try {
      origin = `${new URL(tab.url).origin}/*`;
    } catch {
      sendResponse({ ok: false, reason: 'bad-url' });
      return;
    }
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) {
      void chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS', state: 'permission-required' } satisfies Message);
      sendResponse({ ok: false, reason: 'permission' });
      return;
    }
    const file = contentScriptFile();
    if (file) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: [file] });
      } catch {
        // Already injected (boot guard) or restricted frame — relaying still works if present.
      }
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'BEGIN_ELEMENT_SELECTION' } satisfies Message).catch(() => {});
    sendResponse({ ok: true });
  })();

  return true; // async sendResponse
});
