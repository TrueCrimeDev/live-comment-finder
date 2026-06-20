import type { AdapterContext, CommentLocator, ParsedComment } from '../../shared/model';

export interface LiveCommentAdapter {
  id: string;
  canHandle(ctx: AdapterContext): boolean | Promise<boolean>;
  locateFeed(ctx: AdapterContext): Element | null | Promise<Element | null>;
  parseComment(node: Node, ctx: AdapterContext): ParsedComment[];
  locateComment?(locator: CommentLocator, ctx: AdapterContext): Element | null;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
