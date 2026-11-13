import { EventStatus, MatrixEvent } from 'matrix-js-sdk';

/**
 * A local echo the server has not accepted: the SDK adds it to the live timeline the moment
 * sendMessage is called, marks it NOT_SENT on failure, and drops it on reload. Rendered like
 * any message it looks delivered and then vanishes. The outbox (RoomOutbox) is the one place
 * that shows unconfirmed sends, so the timeline hides these until the status is SENT.
 */
export const isUnconfirmedLocalEcho = (mEvent: Pick<MatrixEvent, 'status'>): boolean =>
  mEvent.status !== null && mEvent.status !== undefined && mEvent.status !== EventStatus.SENT;
