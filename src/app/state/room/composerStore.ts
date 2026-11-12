import { Descendant } from 'slate';

/**
 * Durable composer state. The in-memory jotai atoms in roomInputDrafts.ts are a cache of this;
 * a page reload keeps only what was written here.
 *
 * Draft: the unsent editor contents of one room, rewritten on input and removed when emptied.
 * Outbox: a sent message stays here, with its txn id, until the server confirms it. A reload
 * mid-send therefore leaves it behind to be shown and resent; resending under the same txn id
 * makes the server deduplicate if the first attempt did land.
 */

export type OutboxStatus = 'pending' | 'failed';

export type OutboxEntry = {
  txnId: string;
  roomId: string;
  /** Event type; absent means m.room.message. */
  type?: string;
  content: Record<string, unknown>;
  status: OutboxStatus;
  error?: string;
  ts: number;
  /** The page that last sent it: only that page's watchdog may judge it stalled. */
  tab?: string;
};

export const PAGE_ID = Math.random().toString(36).slice(2);

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStore = (): Store | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};

const draftKey = (userId: string, roomId: string) => `ratatoskr.draft.${userId}.${roomId}`;
const outboxKey = (userId: string) => `ratatoskr.outbox.${userId}`;

const readJson = <T>(store: Store | undefined, key: string): T | undefined => {
  try {
    const raw = store?.getItem(key);
    if (raw === null || raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const writeJson = (store: Store | undefined, key: string, value: unknown): boolean => {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // quota or private mode: the in-memory atom still holds the draft for this session
    return false;
  }
};

const removeKey = (store: Store | undefined, key: string): void => {
  try {
    store?.removeItem(key);
  } catch {
    // nothing durable to remove
  }
};

const isEmptyDraft = (draft: Descendant[]): boolean =>
  draft.length === 0 ||
  (draft.length === 1 &&
    'children' in draft[0] &&
    draft[0].children.length === 1 &&
    'text' in draft[0].children[0] &&
    draft[0].children[0].text === '');

export const loadDraft = (
  userId: string,
  roomId: string,
  store: Store | undefined = defaultStore()
): Descendant[] => {
  const draft = readJson<Descendant[]>(store, draftKey(userId, roomId));
  return Array.isArray(draft) ? draft : [];
};

export const saveDraft = (
  userId: string,
  roomId: string,
  draft: Descendant[],
  store: Store | undefined = defaultStore()
): void => {
  if (isEmptyDraft(draft)) {
    removeKey(store, draftKey(userId, roomId));
    return;
  }
  if (!writeJson(store, draftKey(userId, roomId), draft))
    removeKey(store, draftKey(userId, roomId));
};

export const clearDraft = (
  userId: string,
  roomId: string,
  store: Store | undefined = defaultStore()
): void => {
  removeKey(store, draftKey(userId, roomId));
};

/** Outbox contents whose last write to storage failed: memory is then the only copy, so it wins. */
const unpersisted = new Map<string, OutboxEntry[]>();

export const loadOutbox = (
  userId: string,
  store: Store | undefined = defaultStore()
): OutboxEntry[] => {
  const held = unpersisted.get(userId);
  if (held) return held;
  const entries = readJson<OutboxEntry[]>(store, outboxKey(userId));
  return Array.isArray(entries) ? entries : [];
};

const outboxListeners = new Set<() => void>();
export const subscribeOutbox = (listener: () => void): (() => void) => {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
};

const saveOutbox = (userId: string, entries: OutboxEntry[], store: Store | undefined) => {
  const ok =
    entries.length === 0
      ? (removeKey(store, outboxKey(userId)), true)
      : writeJson(store, outboxKey(userId), entries);
  if (ok) unpersisted.delete(userId);
  else unpersisted.set(userId, entries);
  outboxListeners.forEach((l) => l());
};

export const enqueueOutbox = (
  userId: string,
  entry: Omit<OutboxEntry, 'status' | 'ts'>,
  now: number = Date.now(),
  store: Store | undefined = defaultStore()
): void => {
  const rest = loadOutbox(userId, store).filter((e) => e.txnId !== entry.txnId);
  saveOutbox(userId, [...rest, { ...entry, status: 'pending', ts: now, tab: PAGE_ID }], store);
};

export const failOutbox = (
  userId: string,
  txnId: string,
  error: string,
  store: Store | undefined = defaultStore()
): void => {
  saveOutbox(
    userId,
    loadOutbox(userId, store).map((e) =>
      e.txnId === txnId ? { ...e, status: 'failed', error } : e
    ),
    store
  );
};

/**
 * A resend begins: the entry is pending again from `now`, under `newTxnId` when the SDK still
 * holds the failed attempt's echo under the old one (it refuses to add a second echo for a txn id).
 */
export const retryOutbox = (
  userId: string,
  txnId: string,
  now: number = Date.now(),
  newTxnId: string = txnId,
  store: Store | undefined = defaultStore()
): void => {
  saveOutbox(
    userId,
    loadOutbox(userId, store).map((e) =>
      e.txnId === txnId
        ? { ...e, txnId: newTxnId, status: 'pending', error: undefined, ts: now, tab: PAGE_ID }
        : e
    ),
    store
  );
};

/** Server confirmed the send, or the user discarded it. */
export const removeOutbox = (
  userId: string,
  txnId: string,
  store: Store | undefined = defaultStore()
): void => {
  saveOutbox(
    userId,
    loadOutbox(userId, store).filter((e) => e.txnId !== txnId),
    store
  );
};
