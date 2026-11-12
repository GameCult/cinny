import { MatrixClient } from 'matrix-js-sdk';
import {
  OutboxEntry,
  enqueueOutbox,
  failOutbox,
  loadOutbox,
  removeOutbox,
  retryOutbox,
} from './composerStore';

/** Entries still 'pending' that predate this page load lost their promise in a reload: outcome unknown. */
export const PAGE_START = Date.now();

const attempt = async (mx: MatrixClient, userId: string, entry: OutboxEntry): Promise<void> => {
  try {
    await mx.sendEvent(entry.roomId, (entry.type ?? 'm.room.message') as never, entry.content as never, entry.txnId);
    removeOutbox(userId, entry.txnId);
  } catch (e) {
    // sendEvent can also throw synchronously (e.g. a txn id the SDK already holds)
    failOutbox(userId, entry.txnId, e instanceof Error ? e.message : String(e));
  }
};

/**
 * Send, keeping the message in the durable outbox until the server confirms it. The timeline
 * hides the SDK's local echo until then, so this is the only place an unconfirmed send shows.
 */
export const sendTracked = (
  mx: MatrixClient,
  roomId: string,
  content: Record<string, unknown>,
  type?: string
): Promise<void> => {
  const userId = mx.getUserId() ?? '';
  const entry = { roomId, content, txnId: mx.makeTxnId(), ...(type ? { type } : {}) };
  enqueueOutbox(userId, entry);
  return attempt(mx, userId, { ...entry, status: 'pending', ts: Date.now() });
};

/**
 * Resend. An echo still held by the SDK under the old txn id (a failure in this session) makes
 * it refuse the same id, so that attempt is abandoned under a fresh id. After a reload the echo
 * is gone and the old id is reused, so a send that did land is deduplicated by the server.
 */
export const resendTracked = (mx: MatrixClient, entry: OutboxEntry): Promise<void> => {
  const userId = mx.getUserId() ?? '';
  const held = mx.getRoom(entry.roomId)?.getEventForTxnId(entry.txnId);
  const txnId = held ? mx.makeTxnId() : entry.txnId;
  retryOutbox(userId, entry.txnId, Date.now(), txnId);
  return attempt(mx, userId, { ...entry, txnId, status: 'pending', ts: Date.now() });
};


/**
 * After a reload, send again every entry the reload interrupted. They have no SDK echo, so each
 * keeps its txn id and the server deduplicates one that did land. Failed entries are left for
 * the user: they failed with an answer, these are only unknown.
 */
export const resendInterrupted = (mx: MatrixClient, since: number = PAGE_START): Promise<void[]> => {
  const userId = mx.getUserId() ?? '';
  return Promise.all(
    loadOutbox(userId)
      .filter((e) => e.status === 'pending' && e.ts < since)
      .map((e) => resendTracked(mx, e))
  );
};
