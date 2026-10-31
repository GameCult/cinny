import { useCallback, useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useFetchSpaceHierarchyLevel } from '../../hooks/useSpaceHierarchy';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { getStateEvent } from '../../utils/room';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { mDirectAtom } from '../../state/mDirectList';
import { StateEvent } from '../../../types/matrix/room';
import { buildEstate, EstateHierarchyRoom, EstateTier, Stewardships } from './buildEstate';

const HIERARCHY_DEPTH = 10;

type AliasedRoom = { roomId: string; getCanonicalAlias(): string | null; getAltAliases(): string[] };

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
 * Feeds buildEstate: the server hierarchy of the root Space, the root's
 * stewardships from the client store, the user's membership and m.direct.
 * Recomputes on membership, Space child and stewardships changes.
 */
export const useEstate = (rootId: string): Estate => {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const { fetching, error, rooms } = useFetchSpaceHierarchyLevel(rootId, true, HIERARCHY_DEPTH);
  const joined = useAtomValue(allRoomsAtom);
  const invited = useAtomValue(allInvitesAtom);
  const mDirects = useAtomValue(mDirectAtom);

  const [stewardshipsVersion, bumpStewardships] = useForceUpdate();

  const refetchHierarchy = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [rootId, 'hierarchy_level'] }),
    [queryClient, rootId]
  );
  useStateEventCallback(
    mx,
    useCallback(
      (event) => {
        if (event.getType() === StateEvent.SpaceChild) refetchHierarchy();
        if (event.getType() === StateEvent.GameCultStewardships) bumpStewardships();
      },
      [refetchHierarchy, bumpStewardships]
    )
  );
  // What the server lets this user see changes with invitations.
  useEffect(() => {
    refetchHierarchy();
  }, [invited.length, refetchHierarchy]);

  const stewardships = useMemo(
    () => {
      const rootRoom = mx.getRoom(rootId);
      return rootRoom
        ? (getStateEvent(rootRoom, StateEvent.GameCultStewardships)?.getContent() as
            | Stewardships
            | undefined)
        : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, rootId, stewardshipsVersion, joined, invited]
  );

  const tiers = useMemo(() => {
    const membership = new Map<string, 'join' | 'invite'>();
    invited.forEach((id) => membership.set(id, 'invite'));
    joined.forEach((id) => membership.set(id, 'join'));
    const domain = mx.getDomain();
    const mindLabels = new Map<string, string>();
    Object.keys(stewardships ?? {}).forEach((mind) => {
      const name = mx.getUser(`@${mind}:${domain}`)?.displayName;
      if (name) mindLabels.set(mind, name);
    });
    return buildEstate({
      rootId,
      hierarchy: Array.from(rooms.values()) as unknown as EstateHierarchyRoom[],
      stewardships,
      membership,
      directRoomIds: Array.from(mDirects).filter((id) => joined.includes(id)),
      mindLabels,
    });
  }, [mx, rootId, rooms, stewardships, joined, invited, mDirects]);

  return { fetching, error, tiers };
};
