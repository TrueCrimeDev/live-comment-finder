export class RingBuffer<T> {
  private items: T[] = [];
  private cap: number;

  constructor(capacity: number) {
    this.cap = Math.max(1, Math.floor(capacity));
  }

  get size(): number {
    return this.items.length;
  }
  get capacity(): number {
    return this.cap;
  }

  /** Append; if over capacity, evict and return the oldest item, else undefined. */
  push(item: T): T | undefined {
    this.items.push(item);
    if (this.items.length > this.cap) return this.items.shift();
    return undefined;
  }

  setCapacity(n: number): void {
    this.cap = Math.max(1, Math.floor(n));
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  toArray(): T[] {
    return this.items.slice();
  }
  clear(): void {
    this.items = [];
  }
}
