import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { RoomEvent } from 'matrix-js-sdk';
import { FILE_RECEIVED, ReceiptEvent } from './fileReceipt';

/**
 * One subscription per room to the file receipts in its loaded timeline, shared by every file row: a row costs a
 * callback in a Set, not a Room listener (matrix-js-sdk warns past 100 listeners). The snapshot is the receipt events
 * themselves; each row derives its own readers from it with `readersOf`, so the rules (sender, hash, reference, one per
 * Mind) live in one place and the store holds no verdicts. The snapshot changes identity only when the set of receipts
 * or one's redaction state does, so rows re-render for a receipt, not for every timeline event.
 */
export type ReceiptStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ReceiptEvent[];
};

const asReceiptEvent = (e: MatrixEvent): ReceiptEvent => ({
  event_id: e.getId(),
  type: e.getType(),
  sender: e.getSender(),
  origin_server_ts: e.getTs(),
  content: e.getContent(),
  unsigned: e.isRedacted() ? { redacted_because: true } : undefined,
});

const same = (a: ReceiptEvent[], b: ReceiptEvent[]): boolean =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.event_id === b[i].event_id &&
      !r.unsigned?.redacted_because === !b[i].unsigned?.redacted_because
  );

// A redaction removes a tick and a reset drops the window: both rescan, not only a new event.
const EVENTS = [RoomEvent.Timeline, RoomEvent.Redaction, RoomEvent.TimelineReset] as const;

const make = (room: Room): ReceiptStore => {
  const subscribers = new Set<() => void>();
  let snapshot: ReceiptEvent[] = [];
  const read = (): boolean => {
    const next = room
      .getUnfilteredTimelineSet()
      .getLiveTimeline()
      .getEvents()
      .filter((e) => e.getType() === FILE_RECEIVED)
      .map(asReceiptEvent);
    if (same(snapshot, next)) return false;
    snapshot = next;
    return true;
  };
  const scan = () => {
    if (read()) subscribers.forEach((cb) => cb());
  };
  return {
    subscribe: (onChange) => {
      subscribers.add(onChange);
      if (subscribers.size === 1) {
        EVENTS.forEach((ev) => room.on(ev, scan));
        read(); // the first row sees what is already loaded; it reads the snapshot after subscribing
      }
      return () => {
        subscribers.delete(onChange);
        if (subscribers.size === 0) EVENTS.forEach((ev) => room.off(ev, scan));
      };
    },
    getSnapshot: () => snapshot,
  };
};

const stores = new WeakMap<Room, ReceiptStore>();

export const receiptStoreOf = (room: Room): ReceiptStore => {
  let store = stores.get(room);
  if (!store) {
    store = make(room);
    stores.set(room, store);
  }
  return store;
};
