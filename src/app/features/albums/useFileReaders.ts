import { useEffect, useState } from 'react';
import { MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { FILE_RECEIVED, FileReader, ReceiptEvent, readersOf } from './fileReceipt';

const asReceiptEvent = (e: MatrixEvent): ReceiptEvent => ({
  event_id: e.getId(),
  type: e.getType(),
  sender: e.getSender(),
  origin_server_ts: e.getTs(),
  content: e.getContent(),
  unsigned: e.isRedacted() ? { redacted_because: true } : undefined,
});

/**
 * Who has read a file, from the receipts in the room's loaded timeline: a plain room event or a thread reply, both
 * count (docs/file-zone-mind-contract.md). `content` is the file event's content, which carries its `info.sha256`.
 */
export const useFileReaders = (
  room: Room,
  fileId: string,
  content: Record<string, unknown>
): FileReader[] => {
  const mx = useMatrixClient();
  const server = mx.getDomain() ?? '';
  const [readers, setReaders] = useState<FileReader[]>([]);
  useEffect(() => {
    const scan = () => {
      const receipts = room
        .getUnfilteredTimelineSet()
        .getLiveTimeline()
        .getEvents()
        .filter((e) => e.getType() === FILE_RECEIVED)
        .map(asReceiptEvent);
      const next = readersOf(receipts, fileId, content, server);
      setReaders((cur) =>
        cur.length === next.length &&
        cur.every((r, i) => r.sender === next[i].sender && r.ts === next[i].ts)
          ? cur
          : next
      );
    };
    scan();
    room.on(RoomEvent.Timeline, scan);
    return () => {
      room.off(RoomEvent.Timeline, scan);
    };
  }, [room, fileId, content, server]);
  return readers;
};
