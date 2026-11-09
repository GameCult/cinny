import React, { useEffect, useState } from 'react';
import { Text } from 'folds';
import { Room, RoomEvent } from 'matrix-js-sdk';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import {
  POSE_KEY,
  poseStatusLine,
  poseStatuses,
  splitNewestStatus,
} from '../../components/message/pose/poses';
import * as css from './RoomViewPoseStatus.css';

// Client-status lines about each Mind's current pose. They are drawn from the
// timeline already in memory and are never sent as anyone's message.
export function RoomViewPoseStatus({ room }: { room: Room }) {
  const [poseBubbles] = useSetting(settingsAtom, 'poseBubbles');
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onTimeline = () => bump((n) => n + 1);
    room.on(RoomEvent.Timeline, onTimeline);
    return () => {
      room.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [room]);

  if (!poseBubbles) return null;

  const statuses = poseStatuses(
    room
      .getLiveTimeline()
      .getEvents()
      .filter((e) => e.getType() === 'm.room.message' && e.getSender())
      .map((e) => {
        const sender = e.getSender() as string;
        return {
          sender,
          localpart: getMxIdLocalPart(sender),
          name: getMemberDisplayName(room, sender),
          ts: e.getTs(),
          label: e.getContent()[POSE_KEY],
        };
      })
  );
  if (statuses.length === 0) return null;

  const { newest, rest } = splitNewestStatus(statuses);

  return (
    <div className={css.StatusBlock} data-open={open}>
      {statuses.map((st) => (
        <Text
          key={st.mind}
          className={css.StatusRow}
          data-newest={st === newest}
          size="T200"
          priority="300"
        >
          {poseStatusLine(st)}
        </Text>
      ))}
      {rest.length > 0 && (
        <button
          type="button"
          className={css.StatusToggle}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Text as="span" size="T200">
            {open ? 'fewer' : `+${rest.length} more`}
          </Text>
        </button>
      )}
    </div>
  );
}
