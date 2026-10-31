import { useCallback, useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useFetchSpaceHierarchyLevel } from '../../hooks/useSpaceHierarchy';
import { isDirectInvite, isRoom, isUnsupportedRoom } from '../../utils/room';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { mDirectAtom } from '../../state/mDirectList';
import { StateEvent } from '../../../types/matrix/room';
import { buildEstate, EstateHierarchyRoom, EstateTier, stewardOfChild } from './buildEstate';

const HIERARCHY_DEPTH = 10;

type AliasedRoom = {
  roomId: string;
  getCanonicalAlias(): string | null;
  getAltAliases(): string[];
};

const findLoadedRoom = (
  mx: ReturnType<typeof useMatrixClient>,
  alias: string
): string | undefined =>
  (mx.getRooms() as AliasedRoom[]).find(
    (r) => r.getCanonicalAlias() === alias || r.getAltAliases().includes(alias)
  )?.roomId;

/** The estate's root Space: featuredCommunities.spaces[0] from the client config. */
export const useEstateRootId = (): { rootId?: string; error?: Error } => {
  const mx = useMatrixClient();
  const alias = useClientConfig().featuredCommunities?.spaces?.[0];
  const loaded = alias && !alias.startsWith('#') ? alias : alias && findLoadedRoom(mx, alias);
  const resolved = useQuery({
    queryKey: ['estate-root', alias],
    queryFn: async () => (await mx.getRoomIdForAlias(alias!)).room_id,
    enabled: !!alias && !loaded,
  });
  if (!alias) return { error: new Error('No estate root Space is configured') };
  return { rootId: loaded || resolved.data, error: resolved.error ?? undefined };
};

export type Estate = {
  fetching: boolean;
  error: Error | null;
  tiers: EstateTier[];
};

/**
 * Feeds buildEstate: the server hierarchy of the root Space (which also carries
 * each room's steward), the user's membership, m.direct and direct invites, and
 * her joined rooms outside the Space. Recomputes on membership and Space child changes.
 */
export const useEstate = (rootId: string): Estate => {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const { fetching, error, rooms } = useFetchSpaceHierarchyLevel(rootId, true, HIERARCHY_DEPTH);
  const joined = useAtomValue(allRoomsAtom);
  const invited = useAtomValue(allInvitesAtom);
  const mDirects = useAtomValue(mDirectAtom);

  const refetchHierarchy = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [rootId, 'hierarchy_level'] }),
    [queryClient, rootId]
  );
  useStateEventCallback(
    mx,
    useCallback(
      (event) => {
        if (event.getType() === StateEvent.SpaceChild) refetchHierarchy();
      },
      [refetchHierarchy]
    )
  );
  // What the server lets this user see changes with invitations.
  useEffect(() => {
    refetchHierarchy();
  }, [invited.length, refetchHierarchy]);

  const tiers = useMemo(() => {
    const membership = new Map<string, 'join' | 'invite'>();
    invited.forEach((id) => membership.set(id, 'invite'));
    joined.forEach((id) => membership.set(id, 'join'));
    const hierarchy = Array.from(rooms.values()) as unknown as EstateHierarchyRoom[];
    const domain = mx.getDomain();
    const mindLabels = new Map<string, string>();
    hierarchy.forEach((r) =>
      r.children_state?.forEach((c) => {
        const mind = stewardOfChild(c.content);
        const name = mind && mx.getUser(`@${mind}:${domain}`)?.displayName;
        if (mind && name) mindLabels.set(mind, name);
      })
    );
    const userId = mx.getUserId();
    const directInvites = invited.filter((id) => isDirectInvite(mx.getRoom(id), userId));
    const directRoomIds = [
      ...new Set([...Array.from(mDirects).filter((id) => joined.includes(id)), ...directInvites]),
    ];
    const strayRoomIds = joined.filter((id) => {
      const r = mx.getRoom(id);
      return !mDirects.has(id) && isRoom(r) && !isUnsupportedRoom(r);
    });
    const roomNames = new Map<string, string>();
    [...directInvites, ...strayRoomIds].forEach((id) => {
      const name = mx.getRoom(id)?.name;
      if (name) roomNames.set(id, name);
    });
    return buildEstate({
      rootId,
      hierarchy,
      membership,
      directRoomIds,
      strayRoomIds,
      roomNames,
      mindLabels,
    });
  }, [mx, rootId, rooms, joined, invited, mDirects]);

  return { fetching, error, tiers };
};
