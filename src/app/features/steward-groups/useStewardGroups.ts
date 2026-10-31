import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatrixClient, MatrixEvent, RoomStateEvent } from 'matrix-js-sdk';
import { atomWithStorage } from 'jotai/utils';
import { useAtom } from 'jotai';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import {
  groupByStewards,
  HierarchyLike,
  parseSteward,
  StewardEntry,
  STEWARD_EVENT_TYPE,
} from './stewardGroups';

// Explicit open/closed choices by group id. Absent = default: closed on phones, open elsewhere.
const stewardGroupChoicesAtom = atomWithStorage<Record<string, boolean>>(
  'gamecultStewardGroupOpen',
  {}
);

type Options<T> = {
  mx: MatrixClient;
  spaceId: string;
  items: T[];
  keepVisible: (roomId: string) => boolean;
};

export const useStewardGroups = <T extends HierarchyLike>({
  mx,
  spaceId,
  items,
  keepVisible,
}: Options<T>) => {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const [choices, setChoices] = useAtom(stewardGroupChoicesAtom);
  const [stateVersion, setStateVersion] = useState(0);

  useEffect(() => {
    const onState = (mEvent: MatrixEvent) => {
      if (mEvent.getType() === STEWARD_EVENT_TYPE) setStateVersion((v) => v + 1);
    };
    mx.on(RoomStateEvent.Events, onState);
    return () => {
      mx.removeListener(RoomStateEvent.Events, onState);
    };
  }, [mx]);

  const stewardOf = useCallback(
    (roomId: string) =>
      // stateVersion is read so a late-arriving steward event re-derives this lookup
      stateVersion >= 0
        ? parseSteward(
            mx.getRoom(roomId)?.currentState.getStateEvents(STEWARD_EVENT_TYPE, '')?.getContent()
          )
        : undefined,
    [mx, stateVersion]
  );

  const isGroupOpen = useCallback((id: string) => choices[id] ?? !mobile, [choices, mobile]);

  const entries: StewardEntry<T>[] = useMemo(
    () => groupByStewards(items, { spaceId, stewardOf, isGroupOpen, keepVisible }),
    [items, spaceId, stewardOf, isGroupOpen, keepVisible]
  );

  const toggleGroup = useCallback(
    (id: string) => setChoices((prev) => ({ ...prev, [id]: !(prev[id] ?? !mobile) })),
    [setChoices, mobile]
  );

  return { entries, toggleGroup };
};
