import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { receiptStoreOf } from './receiptStore';
import { readersOf } from './fileReceipt';

const HASH = 'a'.repeat(64);

type Fake = {
  id: string;
  type: string;
  sender: string;
  ts: number;
  content: object;
  redacted?: boolean;
};
const event = (f: Fake) =>
  ({
    getId: () => f.id,
    getType: () => f.type,
    getSender: () => f.sender,
    getTs: () => f.ts,
    getContent: () => f.content,
    isRedacted: () => !!f.redacted,
  } as unknown as MatrixEvent);
const receipt = (id: string, sender: string, fileId = '$f', over: Partial<Fake> = {}): Fake => ({
  id,
  type: 'org.gamecult.file_received',
  sender,
  ts: 1,
  content: { 'org.gamecult.file_received': { event_id: fileId, sha256: HASH } },
  ...over,
});

const fakeRoom = (initial: Fake[] = []) => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let events = initial;
  const room = Object.assign(emitter, {
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => ({ getEvents: () => events.map(event) }),
    }),
  }) as unknown as Room;
  return {
    room,
    emitter,
    set: (next: Fake[]) => {
      events = next;
    },
  };
};
const listeners = (e: EventEmitter) =>
  [RoomEvent.Timeline, RoomEvent.Redaction, RoomEvent.TimelineReset].map((n) => e.listenerCount(n));

describe('receiptStoreOf: one subscription per room', () => {
  it('registers one listener per event for 200 file rows, and none once they are gone', () => {
    const { room, emitter } = fakeRoom();
    const store = receiptStoreOf(room);
    const off = Array.from({ length: 200 }, () => store.subscribe(() => undefined));
    expect(listeners(emitter)).toEqual([1, 1, 1]);
    off.forEach((o) => o());
    expect(listeners(emitter)).toEqual([0, 0, 0]);
  });

  it('is one store per room', () => {
    const a = fakeRoom();
    const b = fakeRoom();
    expect(receiptStoreOf(a.room)).toBe(receiptStoreOf(a.room));
    expect(receiptStoreOf(a.room)).not.toBe(receiptStoreOf(b.room));
  });

  it('notifies rows when a receipt arrives, not for unrelated timeline events, and gives readersOf what it needs', () => {
    const { room, emitter, set } = fakeRoom();
    const store = receiptStoreOf(room);
    const cb = vi.fn();
    store.subscribe(cb);
    expect(store.getSnapshot()).toEqual([]);
    set([{ id: '$m', type: 'm.room.message', sender: '@x:gamecult.org', ts: 1, content: {} }]);
    emitter.emit(RoomEvent.Timeline);
    expect(cb).not.toHaveBeenCalled();
    set([receipt('$r', '@void:gamecult.org')]);
    emitter.emit(RoomEvent.Timeline);
    expect(cb).toHaveBeenCalledTimes(1);
    const snap = store.getSnapshot();
    expect(
      readersOf(snap, '$f', { info: { sha256: HASH } }, 'gamecult.org').map((r) => r.sender)
    ).toEqual(['@void:gamecult.org']);
    emitter.emit(RoomEvent.Timeline);
    expect(store.getSnapshot()).toBe(snap);
  });

  it('rescans on a redaction and on a timeline reset', () => {
    const { room, emitter, set } = fakeRoom([receipt('$r', '@void:gamecult.org')]);
    const store = receiptStoreOf(room);
    const cb = vi.fn();
    store.subscribe(cb);
    expect(store.getSnapshot()).toHaveLength(1);
    set([receipt('$r', '@void:gamecult.org', '$f', { redacted: true })]);
    emitter.emit(RoomEvent.Redaction);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(
      readersOf(store.getSnapshot(), '$f', { info: { sha256: HASH } }, 'gamecult.org')
    ).toEqual([]);
    set([]);
    emitter.emit(RoomEvent.TimelineReset);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('picks up what is already loaded when the first row subscribes', () => {
    const { room } = fakeRoom([receipt('$r', '@aqua:gamecult.org')]);
    const store = receiptStoreOf(room);
    store.subscribe(() => undefined);
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
