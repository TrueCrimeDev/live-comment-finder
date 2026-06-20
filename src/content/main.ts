// Boot guard prevents double-init when statically matched AND injected.
declare global {
  interface Window {
    __lcfBooted?: boolean;
  }
}

if (!window.__lcfBooted) {
  window.__lcfBooted = true;
  // capture bootstrap wired in Task 15
}

export {};
