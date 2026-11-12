import { Text, color, config } from 'folds';
import { Room } from 'matrix-js-sdk';
import React from 'react';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useSkyInk } from '../../hooks/useTheme';
import { scrimStyle } from '../scene/skyInk';
import {
  ROOM_NOTICE_EVENT_TYPE,
  parseRoomNotice,
  roomTrainingLine,
} from '../../utils/trainingNotice';

// The room's notice state event decides the line; no event, or a malformed one, no line. The
// collector reads the version from the same event, so nothing is stored in the browser.
export function RoomTrainingLine({ room }: { room: Room }) {
  const event = useStateEvent(room, ROOM_NOTICE_EVENT_TYPE);
  const { previewDemo } = useClientConfig();
  const skyInk = useSkyInk();
  const line = roomTrainingLine(parseRoomNotice(event?.getContent()), previewDemo);
  if (!line) return null;
  return (
    <Text
      size="T200"
      style={{
        padding: `${config.space.S100} 0`,
        color: color.SurfaceVariant.OnContainer,
        ...scrimStyle(skyInk),
      }}
    >
      {line}
    </Text>
  );
}
