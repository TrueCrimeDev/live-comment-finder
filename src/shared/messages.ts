import type { CapturedComment, CaptureState, GenericSelectors } from './model';

export type Message =
  | { type: 'START_CAPTURE' }
  | { type: 'PAUSE_CAPTURE' }
  | { type: 'RESUME_CAPTURE' }
  | { type: 'STOP_CAPTURE' }
  | { type: 'REQUEST_SNAPSHOT' }
  | { type: 'SNAPSHOT'; tabId?: number; comments: CapturedComment[]; state: CaptureState }
  | { type: 'NEW_COMMENT_BATCH'; tabId?: number; comments: CapturedComment[] }
  | { type: 'CAPTURE_STATUS'; state: CaptureState; source?: string; capturedCount?: number }
  | { type: 'LOCATE_COMMENT'; id: string }
  | { type: 'LOCATE_RESULT'; id: string; found: boolean }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'BEGIN_ELEMENT_SELECTION' }
  | { type: 'SELECTION_COMPLETED'; cancelled: boolean; selectors?: GenericSelectors; host?: string }
  | { type: 'ACTIVE_TAB_CHANGED'; tabId: number }
  | { type: 'ERROR'; message: string };

export type MessageType = Message['type'];

const TYPES = new Set<MessageType>([
  'START_CAPTURE',
  'PAUSE_CAPTURE',
  'RESUME_CAPTURE',
  'STOP_CAPTURE',
  'REQUEST_SNAPSHOT',
  'SNAPSHOT',
  'NEW_COMMENT_BATCH',
  'CAPTURE_STATUS',
  'LOCATE_COMMENT',
  'LOCATE_RESULT',
  'CLEAR_HISTORY',
  'BEGIN_ELEMENT_SELECTION',
  'SELECTION_COMPLETED',
  'ACTIVE_TAB_CHANGED',
  'ERROR',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Returns the message if its shape is valid for its type, else null. */
export function validateMessage(value: unknown): Message | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !TYPES.has(value.type as MessageType)) return null;
  const t = value.type as MessageType;
  switch (t) {
    case 'LOCATE_COMMENT':
      return typeof value.id === 'string' ? (value as Message) : null;
    case 'LOCATE_RESULT':
      return typeof value.id === 'string' && typeof value.found === 'boolean' ? (value as Message) : null;
    case 'NEW_COMMENT_BATCH':
    case 'SNAPSHOT':
      return Array.isArray(value.comments) ? (value as Message) : null;
    case 'CAPTURE_STATUS':
      return typeof value.state === 'string' ? (value as Message) : null;
    case 'SELECTION_COMPLETED':
      return typeof value.cancelled === 'boolean' ? (value as Message) : null;
    case 'ACTIVE_TAB_CHANGED':
      return typeof value.tabId === 'number' ? (value as Message) : null;
    case 'ERROR':
      return typeof value.message === 'string' ? (value as Message) : null;
    default:
      return value as Message; // tag-only messages
  }
}
