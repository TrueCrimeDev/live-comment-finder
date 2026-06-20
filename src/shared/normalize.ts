/** Collapse runs of spaces/tabs to one space and runs of newlines to one, trimming each line. */
export function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Searchable normalized form: NFC, lowercased, whitespace collapsed. Preserves emoji/unicode. */
export function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}
