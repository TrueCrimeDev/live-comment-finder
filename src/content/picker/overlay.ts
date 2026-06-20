interface PickerOpts {
  onPick: (el: Element) => void;
  onCancel: () => void;
}

/**
 * Activate a non-destructive element picker. Highlights the element under the
 * pointer with a fixed overlay box; click selects (via the event target, so it
 * works regardless of layout engine); Escape cancels. Returns a teardown that
 * removes the overlay and all listeners. Teardown also runs automatically on
 * pick or cancel.
 */
export function startPicker(opts: PickerOpts): () => void {
  const box = document.createElement('div');
  box.setAttribute('data-lcf-overlay', 'box');
  Object.assign(box.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    border: '2px solid #5B9FEF',
    background: 'rgba(91,159,239,0.15)',
    borderRadius: '4px',
    boxSizing: 'border-box',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  const move = (e: MouseEvent): void => {
    const el = e.target as Element | null;
    if (!el || el === box) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  };
  const click = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const picked = e.target as Element | null;
    teardown();
    if (picked && picked !== box) opts.onPick(picked);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      teardown();
      opts.onCancel();
    }
  };

  function teardown(): void {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  return teardown;
}
