import type { ParsedComment } from './model';
import { normalize } from './normalize';

/** Bucket width for the fallback fingerprint's time component (ms). */
const TIME_BUCKET_MS = 2 * 60_000;

function hash(input: string): string {
  // FNV-1a 32-bit — deterministic, dependency-free, good enough for dedup keys.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function fingerprint(p: {
  source: string;
  author: string;
  text: string;
  displayedTimestamp?: string;
  capturedAt: number;
}): string {
  const bucket = Math.floor(p.capturedAt / TIME_BUCKET_MS);
  const key = [p.source, normalize(p.author), normalize(p.text), p.displayedTimestamp ?? '', bucket].join(' ');
  return hash(key);
}

export function commentId(parsed: ParsedComment, source: string, capturedAt: number): string {
  if (parsed.messageId) return `${source}:${parsed.messageId}`;
  return `${source}:fp:${fingerprint({
    source,
    author: parsed.author,
    text: parsed.text,
    displayedTimestamp: parsed.displayedTimestamp,
    capturedAt,
  })}`;
}

export class Deduper {
  private seen = new Set<string>();
  get size(): number {
    return this.seen.size;
  }
  has(id: string): boolean {
    return this.seen.has(id);
  }
  add(id: string): void {
    this.seen.add(id);
  }
  delete(id: string): void {
    this.seen.delete(id);
  }
  clear(): void {
    this.seen.clear();
  }
}
