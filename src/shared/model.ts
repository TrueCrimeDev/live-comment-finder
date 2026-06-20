export type CaptureState = 'connected' | 'paused' | 'unsupported' | 'feed-not-found' | 'permission-required';

export interface CommentLocator {
  /** Adapter id that produced this locator. */
  adapter: string;
  /** Platform message id, when the site exposes one. */
  messageId?: string;
  /** Fallback CSS-ish hint for re-finding a node; never a live DOM element. */
  selectorHint?: string;
}

export interface CapturedComment {
  id: string;
  source: string;
  tabId?: number;
  frameId?: number;
  author: string;
  text: string;
  displayedTimestamp?: string;
  capturedAt: number;
  locator?: CommentLocator;
  metadata?: Record<string, string | number | boolean>;
  /** Precomputed normalized fields for fast search (set at capture). */
  searchAuthor: string;
  searchText: string;
}

/** What an adapter returns from parseComment — no id/searchable fields yet. */
export interface ParsedComment {
  author: string;
  text: string;
  displayedTimestamp?: string;
  /** Platform message id if available; drives dedup. */
  messageId?: string;
  locator?: CommentLocator;
  metadata?: Record<string, string | number | boolean>;
}

export interface GenericSelectors {
  item: string;
  author?: string;
  text?: string;
  timestamp?: string;
}

export interface AdapterContext {
  document: Document;
  location: Location;
  source: string;
  /** Per-host generic selectors, when configured. */
  genericSelectors?: GenericSelectors;
}
