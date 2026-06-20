import { describe, it, expect } from 'vitest';
import { normalize, collapseWhitespace } from '../src/shared/normalize';

describe('normalize', () => {
  it('lowercases and trims', () => expect(normalize('  Hello WORLD ')).toBe('hello world'));
  it('collapses internal whitespace', () => expect(normalize('a\t\t b')).toBe('a b'));
  it('preserves emoji', () => expect(normalize('Nice 🎉')).toBe('nice 🎉'));
  it('preserves non-Latin', () => expect(normalize('Привет МИР')).toBe('привет мир'));
  it('NFC-normalizes composed vs decomposed', () => expect(normalize('é')).toBe(normalize('é')));
});

describe('collapseWhitespace', () => {
  it('keeps single newlines, trims line ends', () =>
    expect(collapseWhitespace('a  \n  b\n\n\nc')).toBe('a\nb\nc'));
});
