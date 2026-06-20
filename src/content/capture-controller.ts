import type { CapturedComment, ParsedComment } from '../shared/model';
import { RingBuffer } from '../shared/ring-buffer';
import { Deduper, commentId } from '../shared/dedup';
import { normalize } from '../shared/normalize';

interface Opts {
  source: string;
  capacity: number;
  emit: (batch: CapturedComment[]) => void;
  now?: () => number;
}

export class CaptureController {
  private buffer: RingBuffer<CapturedComment>;
  private dedup = new Deduper();
  private isPaused = false;
  private readonly now: () => number;

  constructor(private opts: Opts) {
    this.buffer = new RingBuffer<CapturedComment>(opts.capacity);
    this.now = opts.now ?? Date.now;
  }

  get paused(): boolean {
    return this.isPaused;
  }
  pause(): void {
    this.isPaused = true;
  }
  resume(): void {
    this.isPaused = false;
  }
  setCapacity(n: number): void {
    this.buffer.setCapacity(n);
  }

  ingest(parsed: ParsedComment[]): void {
    if (this.isPaused || parsed.length === 0) return;
    const fresh: CapturedComment[] = [];
    for (const p of parsed) {
      const capturedAt = this.now();
      const id = commentId(p, this.opts.source, capturedAt);
      if (this.dedup.has(id)) continue;
      this.dedup.add(id);
      const comment: CapturedComment = {
        id,
        source: this.opts.source,
        author: p.author,
        text: p.text,
        displayedTimestamp: p.displayedTimestamp,
        capturedAt,
        locator: p.locator,
        metadata: p.metadata,
        searchAuthor: normalize(p.author),
        searchText: normalize(p.text),
      };
      const evicted = this.buffer.push(comment);
      if (evicted) this.dedup.delete(evicted.id);
      fresh.push(comment);
    }
    if (fresh.length) this.opts.emit(fresh);
  }

  snapshot(): CapturedComment[] {
    return this.buffer.toArray();
  }
  locateId(id: string): CapturedComment | undefined {
    return this.buffer.toArray().find((c) => c.id === id);
  }
  clear(): void {
    this.buffer.clear();
    this.dedup.clear();
  }
}
