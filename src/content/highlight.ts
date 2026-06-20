const STYLE_ID = 'lcf-highlight-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-lcf-highlight] {
      outline: 3px solid #5B9FEF !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 3px rgba(91,159,239,0.45) !important;
      border-radius: 4px !important;
    }
    @media (prefers-reduced-motion: no-preference) {
      [data-lcf-highlight] { transition: outline-color .2s ease; }
    }`;
  document.head.appendChild(style);
}

/** Temporarily highlight an element and scroll it into view. Non-destructive: removes itself after durationMs. */
export function flashHighlight(el: Element, durationMs = 2500): void {
  ensureStyle();
  el.setAttribute('data-lcf-highlight', '1');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(() => el.removeAttribute('data-lcf-highlight'), durationMs);
}
