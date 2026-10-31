import React, { MouseEventHandler, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Avatar, Box, Chip, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import { PageNav, PageNavContent, PageNavHeader } from '../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
} from '../../components/nav';
import { UseStateProvider } from '../../components/UseStateProvider';
import { JoinAddressPrompt } from '../../components/join-address-prompt';
import { RoomNavCategoryButton, RoomNavItem } from '../room-nav';
import { InboxTab, SettingsTab, UnverifiedTab } from '../../pages/client/sidebar';
import {
  encodeSearchParamValueArray,
  getDirectRoomPath,
  getHomeCreatePath,
  getHomeRoomPath,
  getSpaceRoomPath,
  withSearchParam,
} from '../../pages/pathUtils';
import { _RoomSearchParams } from '../../pages/paths';
import { searchModalAtom } from '../../state/searchModal';
import { isDirectInvite } from '../../utils/room';
import {
  addRoomIdToMDirect,
  getCanonicalAliasOrRoomId,
  guessDmRoomUserId,
} from '../../utils/matrix';
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
import { activateEstateRoom, awaitMyJoin } from './joinEstateRoom';
import { useEstate, useEstateRootId } from './useEstate';
import * as css from './EstateNavigator.css';

/** How long a tap waits for the client store to hold the room it just joined. */
const JOIN_ARRIVAL_TIMEOUT_MS = 20000;
/** How long after a timed-out tap the store may still deliver the room and have its DM filed. */
const LATE_ARRIVAL_WINDOW_MS = 10 * 60 * 1000;

const estateRoomPath = (mx: ReturnType<typeof useMatrixClient>, room: EstateRoom): string => {
  const alias = getCanonicalAliasOrRoomId(mx, room.roomId);
  if (room.direct) return getDirectRoomPath(alias);
  // A Space the user has not joined has no Space route; the room still resolves from Home.
  if (room.parentId && mx.getRoom(room.parentId)?.getMyMembership() === 'join') {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, room.parentId), alias);
  }
  return getHomeRoomPath(alias);
};

function JoinRow({ room }: { room: EstateRoom }) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const [state, join] = useAsyncCallback(
    useCallback(async () => {
      const userId = mx.getSafeUserId();
      const dmRoom = mx.getRoom(room.roomId);
      const dmUserId =
        room.direct && dmRoom && isDirectInvite(dmRoom, userId)
          ? guessDmRoomUserId(dmRoom, userId)
          : undefined;
      const result = await activateEstateRoom(mx, room);
      if (result.kind === 'refused') throw new Error(result.message);
      // joinRoom resolves before the store holds the room; opening it now shows the invite card.
      if (!(await awaitMyJoin(mx, room.roomId, JOIN_ARRIVAL_TIMEOUT_MS))) {
        // The join is accepted; when the room arrives the row becomes a joined row by itself,
        // so a DM is filed then (a failed write leaves it under Elsewhere, where it can be found).
        if (dmUserId) {
          awaitMyJoin(mx, room.roomId, LATE_ARRIVAL_WINDOW_MS)
            .then((arrived) => arrived && addRoomIdToMDirect(mx, room.roomId, dmUserId))
            .catch(() => undefined);
        }
        throw new Error('Joined. The room is still on its way and will open from this list.');
      }
      if (dmUserId) await addRoomIdToMDirect(mx, room.roomId, dmUserId);
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
          <Text
            as="span"
            size="T200"
            style={{ color: color.Critical.Main, overflowWrap: 'anywhere' }}
          >
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
      direct={room.direct}
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

function EntryPoints() {
  const navigate = useNavigate();
  return (
    <NavCategory>
      <NavItem variant="Background" radii="400">
        <NavButton onClick={() => navigate(getHomeCreatePath())}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Plus} size="100" />
              </Avatar>
              <Text as="span" size="Inherit" truncate>
                Create Room
              </Text>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
      <UseStateProvider initial={false}>
        {(open, setOpen) => (
          <>
            <NavItem variant="Background" radii="400">
              <NavButton onClick={() => setOpen(true)}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Link} size="100" />
                    </Avatar>
                    <Text as="span" size="Inherit" truncate>
                      Join with Address
                    </Text>
                  </Box>
                </NavItemContent>
              </NavButton>
            </NavItem>
            {open && (
              <JoinAddressPrompt
                onCancel={() => setOpen(false)}
                onOpen={(roomIdOrAlias, viaServers, eventId) => {
                  setOpen(false);
                  const path = getHomeRoomPath(roomIdOrAlias, eventId);
                  navigate(
                    viaServers
                      ? withSearchParam<_RoomSearchParams>(path, {
                          viaServers: encodeSearchParamValueArray(viaServers),
                        })
                      : path
                  );
                }}
              />
            )}
          </>
        )}
      </UseStateProvider>
    </NavCategory>
  );
}

/** A short message that wraps inside the navigator; never a raw request error. */
function EstateError({ message }: { message: string }) {
  return (
    <Text
      size="T300"
      style={{ color: color.Critical.Main, padding: 16, overflowWrap: 'anywhere' }}
    >
      {message}
    </Text>
  );
}

function EstateTiers({ rootId }: { rootId: string }) {
  const { fetching, error, tiers } = useEstate(rootId);

  return (
    <>
      {tiers.map((tier) => (
        <Tier key={tier.id} tier={tier} />
      ))}
      {fetching && (
        <Box justifyContent="Center" style={{ padding: 16 }}>
          <Spinner />
        </Box>
      )}
      {error && (
        <EstateError message="Could not load the room list. Check your connection and reload." />
      )}
    </>
  );
}

/** The single navigator: every nav slot that lists rooms mounts this. */
export function EstateNavigator() {
  const openRoomFinder = useSetAtom(searchModalAtom);
  const { rootId, error } = useEstateRootId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const mx = useMatrixClient();
  const title = (rootId && mx.getRoom(rootId)?.name) || 'GameCult';

  return (
    <PageNav>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300" className={css.Targets}>
          <Box grow="Yes">
            <Text size="H4" truncate>
              {title}
            </Text>
          </Box>
          <IconButton
            variant="Background"
            aria-label="Find a room"
            onClick={() => openRoomFinder(true)}
          >
            <Icon src={Icons.Search} size="200" />
          </IconButton>
        </Box>
      </PageNavHeader>
      <PageNavContent scrollRef={scrollRef}>
        <Box direction="Column" gap="300" className={css.Targets}>
          <EntryPoints />
          {rootId && <EstateTiers rootId={rootId} />}
          {!rootId && error && (
            <EstateError message="Could not find the GameCult space. Check your connection and reload." />
          )}
          {!rootId && !error && (
            <Box justifyContent="Center" style={{ padding: 16 }}>
              <Spinner />
            </Box>
          )}
        </Box>
      </PageNavContent>
      <Box
        shrink="No"
        alignItems="Center"
        justifyContent="Center"
        gap="200"
        style={{ padding: 8 }}
        className={css.Targets}
      >
        <UnverifiedTab />
        <InboxTab />
        <SettingsTab />
      </Box>
    </PageNav>
  );
}
