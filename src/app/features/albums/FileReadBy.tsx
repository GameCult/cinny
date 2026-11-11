import React from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { getMemberDisplayName } from '../../utils/room';
import { FileReader, readLine } from './fileReceipt';
import { useFileReaders } from './useFileReaders';
import * as css from './AlbumView.css';

type FileReadByProps = {
  room: Room;
  fileId: string;
  content: Record<string, unknown>;
  /** Receipts already read elsewhere (an album's thread replies): merged with the timeline's, a Mind once. */
  also?: FileReader[];
};
/** "read by <Mind>" under a file: the Minds whose verified receipts are in the room's timeline. Nothing when none. */
export function FileReadBy({ room, fileId, content, also = [] }: FileReadByProps) {
  const seen = useFileReaders(room, fileId, content);
  const readers = [...new Map([...also, ...seen].map((r) => [r.sender, r])).values()];
  if (readers.length === 0) return null;
  return (
    <Text size="T200" className={css.Dim}>
      {readLine(readers, (id) => getMemberDisplayName(room, id) ?? id)}
    </Text>
  );
}

/** A timeline message that is a file: audio, image, video or file. */
export const isFileMessage = (mEvent: MatrixEvent): boolean =>
  ['m.audio', 'm.image', 'm.video', 'm.file'].includes(mEvent.getContent().msgtype);
