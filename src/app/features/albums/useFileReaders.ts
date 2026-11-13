import { useMemo, useSyncExternalStore } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { FileReader, readersOf } from './fileReceipt';
import { receiptStoreOf } from './receiptStore';

/**
 * Who has read a file, from the receipts in the room's loaded timeline: a plain room event or a thread reply, both
 * count (docs/file-zone-mind-contract.md). `content` is the file event's content, which carries its `info.sha256`.
 * The room's one shared subscription (receiptStore.ts) feeds every file row.
 */
export const useFileReaders = (
  room: Room,
  fileId: string,
  content: Record<string, unknown>
): FileReader[] => {
  const mx = useMatrixClient();
  const server = mx.getDomain() ?? '';
  const store = receiptStoreOf(room);
  const receipts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(
    () => readersOf(receipts, fileId, content, server),
    [receipts, fileId, content, server]
  );
};
