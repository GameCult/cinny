import { Text, color, config } from 'folds';
import { Room } from 'matrix-js-sdk';
import React, { useEffect, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { RoomNotice, parseRoomNotice, roomTrainingLine } from '../../utils/trainingNotice';

// The room's own pinned notice decides the line, newest pin first; no notice, no line. The version
// is read by the collector from the same pinned event, so nothing is stored in the browser.
const useRoomNotice = (room: Room): RoomNotice | undefined => {
  const mx = useMatrixClient();
  const pinned = useRoomPinnedEvents(room);
  const [notice, setNotice] = useState<RoomNotice>();

  useEffect(() => {
    let live = true;
    setNotice(undefined);
    (async () => {
      for (let i = pinned.length - 1; i >= 0; i -= 1) {
        const id = pinned[i];
        const local = room.findEventById(id)?.getContent();
        // eslint-disable-next-line no-await-in-loop
        const content = local ?? (await mx.fetchRoomEvent(room.roomId, id).catch(() => undefined))?.content;
        const found = parseRoomNotice(content);
        if (found) {
          if (live) setNotice(found);
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [mx, room, pinned]);

  return notice;
};

export function RoomTrainingLine({ room }: { room: Room }) {
  const line = roomTrainingLine(useRoomNotice(room));
  if (!line) return null;
  return (
    <Text
      size="T200"
      style={{ padding: `${config.space.S100} 0`, color: color.SurfaceVariant.OnContainer }}
    >
      {line}
    </Text>
  );
}
