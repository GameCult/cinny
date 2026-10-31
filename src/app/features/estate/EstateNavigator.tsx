import React, { MouseEventHandler, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Chip, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import { PageNav, PageNavContent, PageNavHeader } from '../../components/page';
import { NavCategory, NavCategoryHeader, NavItem, NavItemContent } from '../../components/nav';
import { RoomNavCategoryButton, RoomNavItem } from '../room-nav';
import { InboxTab, SettingsTab, UnverifiedTab } from '../../pages/client/sidebar';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getHomeSearchPath,
  getSpaceRoomPath,
} from '../../pages/pathUtils';
import { getCanonicalAliasOrRoomId } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useCallEmbed } from '../../hooks/useCallEmbed';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { EstateRoom, EstateTier } from './buildEstate';
import { activateEstateRoom } from './joinEstateRoom';
import { useEstate, useEstateRootId } from './useEstate';

const estateRoomPath = (mx: ReturnType<typeof useMatrixClient>, room: EstateRoom): string => {
  const alias = getCanonicalAliasOrRoomId(mx, room.roomId);
  if (room.parentId === null) return getDirectRoomPath(alias);
  // A Space the user has not joined has no Space route; the room still resolves from Home.
  if (mx.getRoom(room.parentId)?.getMyMembership() === 'join') {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, room.parentId), alias);
  }
  return getHomeRoomPath(alias);
};

function JoinRow({ room }: { room: EstateRoom }) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const [state, join] = useAsyncCallback(
    useCallback(async () => {
      const result = await activateEstateRoom(mx, room);
      if (result.kind === 'refused') throw new Error(result.message);
      navigate(estateRoomPath(mx, room));
    }, [mx, navigate, room])
  );
  const busy = state.status === AsyncStatus.Loading;

  return (
    <NavItem variant="Background" radii="400">
      <Box grow="Yes" alignItems="Center" gap="200" style={{ padding: '0 8px', minHeight: 38 }}>
        <NavItemContent>
          <Text as="span" size="Inherit" truncate>
            {room.name}
          </Text>
        </NavItemContent>
        {state.status === AsyncStatus.Error && (
          <Text as="span" size="T200" style={{ color: color.Critical.Main }} truncate>
            {(state.error as Error).message}
          </Text>
        )}
        <Chip
          variant={room.state === 'invited' ? 'Primary' : 'Secondary'}
          fill="Soft"
          radii="Pill"
          before={busy ? <Spinner size="100" /> : <Icon src={Icons.Plus} size="50" />}
          onClick={join}
          disabled={busy}
          aria-label={`Join ${room.name}`}
        >
          <Text size="B300">Join</Text>
        </Chip>
      </Box>
    </NavItem>
  );
}

function EstateRow({ room }: { room: EstateRoom }) {
  const mx = useMatrixClient();
  const selectedRoomId = useSelectedRoom();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const mxRoom = room.state === 'joined' ? mx.getRoom(room.roomId) : null;

  if (!mxRoom) return <JoinRow room={room} />;
  return (
    <RoomNavItem
      room={mxRoom}
      selected={selectedRoomId === room.roomId}
      direct={room.parentId === null}
      linkPath={estateRoomPath(mx, room)}
      notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
    />
  );
}

type CollapsibleProps = {
  categoryId: string;
  label: string;
  rooms: EstateRoom[];
  children: ReactNode;
};
function Collapsible({ categoryId, label, rooms, children }: CollapsibleProps) {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const selectedRoomId = useSelectedRoom();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const callRoomId = useCallEmbed()?.roomId;
  const [toggled, setToggled] = useAtom(useClosedNavCategoriesAtom());

  const active = rooms.some(
    (r) => r.roomId === selectedRoomId || r.roomId === callRoomId || roomToUnread.has(r.roomId)
  );
  // Phones start collapsed unless the section holds something live; wide screens start open.
  // A tap flips that default; the flip is remembered per device and per screen class.
  const key = makeNavCategoryId('estate', mobile ? 'phone' : 'wide', categoryId);
  const closed = (mobile && !active) !== toggled.has(key);

  const handleClick: MouseEventHandler<HTMLButtonElement> = () =>
    setToggled({ type: toggled.has(key) ? 'DELETE' : 'PUT', categoryId: key });

  return (
    <NavCategory>
      <NavCategoryHeader>
        <RoomNavCategoryButton closed={closed} onClick={handleClick}>
          {label}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      {!closed && children}
    </NavCategory>
  );
}

function Tier({ tier }: { tier: EstateTier }) {
  const allRooms = useMemo(() => [...tier.loose, ...tier.groups.flatMap((g) => g.rooms)], [tier]);
  return (
    <Collapsible categoryId={tier.id} label={tier.label} rooms={allRooms}>
      {tier.loose.map((r) => (
        <EstateRow key={r.roomId} room={r} />
      ))}
      {tier.groups.map((g) => (
        <Collapsible
          key={g.mind}
          categoryId={`${tier.id}|${g.mind}`}
          label={g.label}
          rooms={g.rooms}
        >
          {g.rooms.map((r) => (
            <EstateRow key={r.roomId} room={r} />
          ))}
        </Collapsible>
      ))}
    </Collapsible>
  );
}

function EstateTiers({ rootId }: { rootId: string }) {
  const { fetching, error, tiers } = useEstate(rootId);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <PageNavContent scrollRef={scrollRef}>
      <Box direction="Column" gap="300">
        {tiers.map((tier) => (
          <Tier key={tier.id} tier={tier} />
        ))}
        {fetching && (
          <Box justifyContent="Center" style={{ padding: 16 }}>
            <Spinner />
          </Box>
        )}
        {error && (
          <Text size="T300" style={{ color: color.Critical.Main, padding: 16 }}>
            {error.message}
          </Text>
        )}
      </Box>
    </PageNavContent>
  );
}

/** The single navigator: every nav slot that lists rooms mounts this. */
export function EstateNavigator() {
  const navigate = useNavigate();
  const { rootId, error } = useEstateRootId();
  const mx = useMatrixClient();
  const title = (rootId && mx.getRoom(rootId)?.name) || 'GameCult';

  return (
    <PageNav>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              {title}
            </Text>
          </Box>
          <IconButton
            variant="Background"
            aria-label="Search"
            onClick={() => navigate(getHomeSearchPath())}
          >
            <Icon src={Icons.Search} size="200" />
          </IconButton>
        </Box>
      </PageNavHeader>
      {rootId ? (
        <EstateTiers rootId={rootId} />
      ) : (
        <Box grow="Yes" alignItems="Center" justifyContent="Center">
          {error ? <Text size="T300">{error.message}</Text> : <Spinner />}
        </Box>
      )}
      <Box shrink="No" alignItems="Center" justifyContent="Center" gap="200" style={{ padding: 8 }}>
        <UnverifiedTab />
        <InboxTab />
        <SettingsTab />
      </Box>
    </PageNav>
  );
}
