import type { AdapterContext } from '../../shared/model';
import type { LiveCommentAdapter } from './types';

export async function resolveAdapter(
  adapters: LiveCommentAdapter[],
  ctx: AdapterContext,
): Promise<LiveCommentAdapter | null> {
  for (const a of adapters) {
    if (await a.canHandle(ctx)) return a;
  }
  return null;
}
