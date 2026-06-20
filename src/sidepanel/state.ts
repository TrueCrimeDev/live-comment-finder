import type { CapturedComment, CaptureState } from '../shared/model';
import type { SearchCriteria } from '../shared/search';

export interface PanelState {
  comments: CapturedComment[];
  criteria: SearchCriteria;
  status: CaptureState;
  source?: string;
}

const DEFAULT_CRITERIA: SearchCriteria = { query: '', author: '', mode: 'substring', sort: 'newest' };

export interface PanelStore {
  getState(): PanelState;
  subscribe(fn: (s: PanelState) => void): () => void;
  setComments(list: CapturedComment[]): void;
  addBatch(list: CapturedComment[]): void;
  setCriteria(patch: Partial<SearchCriteria>): void;
  setStatus(status: CaptureState, source?: string): void;
  clear(): void;
}

export function createStore(initial?: Partial<PanelState>): PanelStore {
  let state: PanelState = {
    comments: initial?.comments ?? [],
    criteria: initial?.criteria ?? { ...DEFAULT_CRITERIA },
    status: initial?.status ?? 'unsupported',
    source: initial?.source,
  };
  const ids = new Set(state.comments.map((c) => c.id));
  const subs = new Set<(s: PanelState) => void>();
  const emit = (): void => subs.forEach((f) => f(state));

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    setComments(list) {
      state = { ...state, comments: list.slice() };
      ids.clear();
      list.forEach((c) => ids.add(c.id));
      emit();
    },
    addBatch(list) {
      const add = list.filter((c) => !ids.has(c.id));
      if (!add.length) return;
      add.forEach((c) => ids.add(c.id));
      state = { ...state, comments: state.comments.concat(add) };
      emit();
    },
    setCriteria(patch) {
      state = { ...state, criteria: { ...state.criteria, ...patch } };
      emit();
    },
    setStatus(status, source) {
      state = { ...state, status, source: source ?? state.source };
      emit();
    },
    clear() {
      state = { ...state, comments: [] };
      ids.clear();
      emit();
    },
  };
}
