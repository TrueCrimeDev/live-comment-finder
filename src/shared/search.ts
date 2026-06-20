import type { CapturedComment } from './model';
import { normalize } from './normalize';

export type SearchMode = 'substring' | 'case-sensitive' | 'whole-word' | 'exact-phrase' | 'regex';

export interface SearchCriteria {
  query: string;
  author: string;
  mode: SearchMode;
  sort: 'newest' | 'oldest';
}

export interface CompiledQuery {
  /** Test a comment against the compiled criteria. */
  test: (c: CapturedComment) => boolean;
  error?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a RegExp for the text query per mode, or return an error string. */
function buildTextRegex(criteria: SearchCriteria): { re: RegExp | null; error?: string } {
  const { query, mode } = criteria;
  if (query === '') return { re: null };
  try {
    switch (mode) {
      case 'case-sensitive':
        return { re: new RegExp(escapeRegExp(query), 'g') };
      case 'whole-word':
        return { re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(query)}(?![\\p{L}\\p{N}_])`, 'giu') };
      case 'exact-phrase':
        return { re: new RegExp(escapeRegExp(query), 'gi') };
      case 'regex':
        return { re: new RegExp(query, 'gi') };
      case 'substring':
      default:
        return { re: new RegExp(escapeRegExp(query), 'gi') };
    }
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : 'Invalid pattern' };
  }
}

export function compile(criteria: SearchCriteria): CompiledQuery {
  const authorNeedle = normalize(criteria.author);
  const { re, error } = buildTextRegex(criteria);
  if (error) return { test: () => false, error };
  return {
    test: (c: CapturedComment) => {
      if (authorNeedle && !c.searchAuthor.includes(authorNeedle)) return false;
      if (!re) return true;
      re.lastIndex = 0;
      return re.test(c.text);
    },
  };
}

export function search(
  comments: CapturedComment[],
  criteria: SearchCriteria,
): { results: CapturedComment[]; error?: string } {
  const q = compile(criteria);
  if (q.error) return { results: [], error: q.error };
  const filtered = comments.filter(q.test);
  filtered.sort((a, b) => (criteria.sort === 'newest' ? b.capturedAt - a.capturedAt : a.capturedAt - b.capturedAt));
  return { results: filtered };
}

export function matchRanges(text: string, criteria: SearchCriteria): Array<[number, number]> {
  const { re } = buildTextRegex(criteria);
  if (!re) return [];
  const ranges: Array<[number, number]> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}
