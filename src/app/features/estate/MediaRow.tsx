import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { NavGutter, NavItem, NavItemContent, NavLink } from '../../components/nav';
import { NAV_ROOM_ICON_REST_OPACITY, NavLabel } from '../../components/nav/styles.css';
import { EstateRoom } from './buildEstate';
import { isFileZone } from '../albums/isFileZone';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDS } from '../../components/message/pose/poses';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { useEstateRootId } from './useEstate';
import {
  STEWARDSHIPS_KEY,
  MediaRow as MediaRowState,
  lookupMediaRoom,
  mediaRoomIdFromStewardships,
  mediaRow,
  typedMediaRoom,
} from './mediaRoom';

const mediaIcon = (
  <Avatar size="200" radii="400">
    <Icon src={Icons.Photo} size="100" style={{ opacity: NAV_ROOM_ICON_REST_OPACITY }} />
  </Avatar>
);

/** A Media row that is not a link: not set up, still looking, or the lookup failed. Says so; shows no data. */
export function MediaNote({ note, title }: { note: string; title?: string }) {
  return (
    <NavItem variant="Background" radii="400">
      <NavItemContent>
        <Box as="span" grow="Yes" alignItems="Center" gap="200" title={title}>
          <NavGutter>{mediaIcon}</NavGutter>
          <Text className={NavLabel} as="span" size="Inherit" truncate priority="300">
            {`Media · ${note}`}
          </Text>
        </Box>
      </NavItemContent>
    </NavItem>
  );
}

/** The joined Media row: opens the room, which shows its album view. */
export function MediaLink({ to }: { to: string }) {
  return (
    <NavItem variant="Background" radii="400">
      <NavLink to={to}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <NavGutter>{mediaIcon}</NavGutter>
            <Text className={NavLabel} as="span" size="Inherit" truncate>
              Media
            </Text>
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

/** The Mind's media room as the navigator sees it right now. */
export const useMindMedia = (mind: string, rooms: readonly EstateRoom[]): MediaRowState => {
  const mx = useMatrixClient();
  const { rootId } = useEstateRootId();
  const joined = useAtomValue(allRoomsAtom);
  const invited = useAtomValue(allInvitesAtom);
  const config = useClientConfig();
  const server = mx.getDomain() ?? '';
  // A joined room whose type says it is a file zone is the Media row; the alias or carried id only finds a
  // room the client cannot type yet (not joined).
  const typed = typedMediaRoom(rooms, (roomId) => {
    const room = mx.getRoom(roomId);
    return (
      !!room &&
      isFileZone(
        {
          roomId,
          aliases: [room.getCanonicalAlias(), ...room.getAltAliases()].filter(
            (a): a is string => !!a
          ),
          createType: room.currentState.getStateEvents('m.room.create', '')?.getContent().type,
        },
        config
      )
    );
  });
  const carried = mediaRoomIdFromStewardships(
    rootId
      ? mx.getRoom(rootId)?.currentState.getStateEvents(STEWARDSHIPS_KEY, '')?.getContent()
      : undefined,
    mind
  );
  const lookup = useQuery({
    queryKey: ['mind-media', mind, server, carried],
    queryFn: () => lookupMediaRoom(mx, mind, server, carried),
    staleTime: 60_000,
    enabled: MINDS.includes(mind) && !typed,
  });
  const membership = new Map<string, 'join' | 'invite'>();
  invited.forEach((id) => membership.set(id, 'invite'));
  joined.forEach((id) => membership.set(id, 'join'));
  if (typed) return { kind: 'room', room: { ...typed, name: 'Media' } };
  return mediaRow(lookup.data, membership);
};
