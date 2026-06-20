// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { startPicker } from '../src/content/picker/overlay';

describe('startPicker', () => {
  it('invokes onPick with the clicked element and cleans up', () => {
    document.body.innerHTML = '<div id="t" style="width:10px;height:10px"></div>';
    const onPick = vi.fn();
    const onCancel = vi.fn();
    startPicker({ onPick, onCancel });
    const target = document.getElementById('t')!;
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toBe(target);
    expect(document.querySelector('[data-lcf-overlay]')).toBeNull(); // cleaned up
  });
  it('Escape cancels and removes the overlay', () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    startPicker({ onPick, onCancel });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lcf-overlay]')).toBeNull();
  });
});
