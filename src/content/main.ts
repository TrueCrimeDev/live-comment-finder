import { boot } from './bootstrap';

declare global {
  interface Window {
    __lcfBooted?: boolean;
  }
}

// Boot guard prevents double-init when statically matched AND injected on demand.
if (!window.__lcfBooted) {
  window.__lcfBooted = true;
  void boot();
}

export {};
