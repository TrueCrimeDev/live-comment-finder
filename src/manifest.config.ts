import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Live Comment Finder',
  version: pkg.version,
  description: 'Capture and search live comments on the current page. All data stays on your device.',
  minimum_chrome_version: '116',
  icons: {
    '16': 'src/icons/icon16.png',
    '32': 'src/icons/icon32.png',
    '48': 'src/icons/icon48.png',
    '128': 'src/icons/icon128.png',
  },
  action: { default_title: 'Live Comment Finder' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
  host_permissions: ['*://*.youtube.com/*'],
  content_scripts: [
    {
      matches: ['*://*.youtube.com/*'],
      js: ['src/content/main.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
  // No web_accessible_resources: the generic adapter is injected via
  // chrome.scripting.executeScript({ files }), which runs the extension's own
  // packaged content bundle directly and does not require WAR exposure.
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self';" },
});
