import React, {
  ComponentProps,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Avatar, Box, Chip, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import { PageNav, PageNavContent, PageNavHeader } from '../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavGutter,
  NavItem,
  NavItemContent,
  NavLevel,
} from '../../components/nav';
import { NAV_ROOM_ICON_REST_OPACITY, NavAction, NavLabel } from '../../components/nav/styles.css';
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
import { getCanonicalAliasOrRoomId } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { MINDS } from '../../components/message/pose/poses';
import { MediaLink, MediaNote, useMindMedia } from './MediaRow';
import { MediaRow as MediaRowState } from './mediaRoom';
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
import { EstateGroup, EstateRoom, EstateTier, splitGroups } from './buildEstate';
import { activateEstateRoom, awaitMyJoin } from './joinEstateRoom';
import { useEstate, useEstateRootId } from './useEstate';
import * as css from './EstateNavigator.css';
import { DeskEntry } from '../desk';
import { SkyStateControl } from '../scene/SkyStateControl';

type IconSrc = ComponentProps<typeof Icon>['src'];

/** How long a tap waits for the client store to hold the room it just joined. */
const JOIN_ARRIVAL_TIMEOUT_MS = 20000;

const estateRoomPath = (mx: ReturnType<typeof useMatrixClient>, room: EstateRoom): string => {
  const alias = getCanonicalAliasOrRoomId(mx, room.roomId);
  if (room.direct) return getDirectRoomPath(alias);
  // A Space the user has not joined has no Space route; the room still resolves from Home.
  if (room.parentId && mx.getRoom(room.parentId)?.getMyMembership() === 'join') {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, room.parentId), alias);
  }
  return getHomeRoomPath(alias);
};

function JoinRow({ room, icon = Icons.Hash }: { room: EstateRoom; icon?: IconSrc }) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const [state, join] = useAsyncCallback(
    useCallback(async () => {
      const result = await activateEstateRoom(mx, room);
      if (result.kind === 'refused') throw new Error(result.message);
      // joinRoom resolves before the store holds the room; opening it now shows the invite card.
      if (!(await awaitMyJoin(mx, room.roomId, JOIN_ARRIVAL_TIMEOUT_MS))) {
        // The join is accepted; when the room arrives the row becomes a joined row by itself.
        throw new Error('Joined. The room is still on its way and will open from this list.');
      }
      navigate(estateRoomPath(mx, room));
    }, [mx, navigate, room])
  );
  const busy = state.status === AsyncStatus.Loading;

  return (
    <NavItem variant="Background" radii="400">
      <Box grow="Yes" alignItems="Center" gap="200" style={{ padding: '0 8px 0 0', minHeight: 38 }}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <NavGutter>
              <Avatar size="200" radii="400">
                <Icon src={icon} size="100" style={{ opacity: NAV_ROOM_ICON_REST_OPACITY }} />
              </Avatar>
            </NavGutter>
            <Text className={NavLabel} as="span" size="Inherit" truncate>
              {room.name}
            </Text>
          </Box>
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
          className={NavAction}
          variant={room.state === 'invited' ? 'Primary' : 'Secondary'}
          fill="Soft"
          radii="Pill"
          before={busy ? <Spinner size="100" /> : undefined}
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
      {!closed && <NavLevel>{children}</NavLevel>}
    </NavCategory>
  );
}

/** The Media row every Mind in the roster has: its file-zone room, or an honest note that there is none yet. */
function MindMedia({ media }: { media: MediaRowState }) {
  const mx = useMatrixClient();
  if (media.kind === 'checking') return <MediaNote note="looking" />;
  if (media.kind === 'unset') return <MediaNote note="not set up" />;
  if (media.kind === 'error') return <MediaNote note="unavailable" title={media.message} />;
  if (media.room.state === 'joined') return <MediaLink to={estateRoomPath(mx, media.room)} />;
  return <JoinRow room={media.room} icon={Icons.Photo} />;
}

function GroupSection({ tierId, group }: { tierId: string; group: EstateGroup }) {
  const media = useMindMedia(group.mind);
  const hasMedia = MINDS.includes(group.mind);
  // The media room is the Media row; it is not listed a second time among the Mind's rooms.
  const rooms =
    media.kind === 'room' ? group.rooms.filter((r) => r.roomId !== media.room.roomId) : group.rooms;
  return (
    <Collapsible categoryId={`${tierId}|${group.mind}`} label={group.label} rooms={group.rooms}>
      <DeskEntry mind={group.mind} />
      {hasMedia && <MindMedia media={media} />}
      {rooms.map((r) => (
        <EstateRow key={r.roomId} room={r} />
      ))}
    </Collapsible>
  );
}

/**
 * Groups of rooms the user has not joined, behind one quiet entry. Closed until opened, on every screen; the opening is
 * remembered per device like any other section.
 */
function Browse({ tierId, groups }: { tierId: string; groups: EstateGroup[] }) {
  const [toggled, setToggled] = useAtom(useClosedNavCategoriesAtom());
  const key = makeNavCategoryId('estate', 'browse', tierId);
  const open = toggled.has(key);
  const count = groups.reduce((n, g) => n + g.rooms.length, 0);

  return (
    <NavCategory>
      <NavCategoryHeader>
        <RoomNavCategoryButton
          closed={!open}
          onClick={() => setToggled({ type: open ? 'DELETE' : 'PUT', categoryId: key })}
        >
          {`Browse ${count} more ${count === 1 ? 'room' : 'rooms'}`}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      {open && (
        <NavLevel>
          {groups.map((g) => (
            <GroupSection key={g.mind} tierId={tierId} group={g} />
          ))}
        </NavLevel>
      )}
    </NavCategory>
  );
}

function Tier({ tier }: { tier: EstateTier }) {
  const allRooms = useMemo(() => [...tier.loose, ...tier.groups.flatMap((g) => g.rooms)], [tier]);
  const { front, browse } = useMemo(() => splitGroups(tier), [tier]);
  return (
    <Collapsible categoryId={tier.id} label={tier.label} rooms={allRooms}>
      {tier.loose.map((r) => (
        <EstateRow key={r.roomId} room={r} />
      ))}
      {front.map((g) => (
        <GroupSection key={g.mind} tierId={tier.id} group={g} />
      ))}
      {browse.length > 0 && <Browse tierId={tier.id} groups={browse} />}
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
              <NavGutter>
                <Avatar size="200" radii="400">
                  <Icon
                    src={Icons.Plus}
                    size="100"
                    style={{ opacity: NAV_ROOM_ICON_REST_OPACITY }}
                  />
                </Avatar>
              </NavGutter>
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
                    <NavGutter>
                      <Avatar size="200" radii="400">
                        <Icon
                          src={Icons.Link}
                          size="100"
                          style={{ opacity: NAV_ROOM_ICON_REST_OPACITY }}
                        />
                      </Avatar>
                    </NavGutter>
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
    <Text size="T300" style={{ color: color.Critical.Main, padding: 16, overflowWrap: 'anywhere' }}>
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
  // A phone's list is the estate and nothing else: no Create Room, no Join with Address.
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;

  return (
    <PageNav>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300" className={css.Targets}>
          <Box grow="Yes">
            <Text size="H4" truncate>
              {title}
            </Text>
          </Box>
          <SkyStateControl />
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
          {!mobile && <EntryPoints />}
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
