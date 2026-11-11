import { useQuery } from '@tanstack/react-query';
import { ClientPrefix, Method, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { Album, ZoneEvent, buildAlbums } from './buildAlbums';
import { isFileZone } from './isFileZone';
import { mapLimit } from './mapLimit';

const REPLY_FETCHES_IN_FLIGHT = 6;
const REFRESH_MS = 30_000;

type Chunk = { chunk?: ZoneEvent[] };

/** True when the room is the file zone: by its create type, or listed in the client config. */
export const useIsFileZone = (room: Room): boolean => {
  const config = useClientConfig();
  // Subscribes to alias changes (alt aliases live in the same event).
  useStateEvent(room, StateEvent.RoomCanonicalAlias);
  const createType = room.currentState.getStateEvents('m.room.create', '')?.getContent().type;
  return isFileZone(
    {
      roomId: room.roomId,
      aliases: [room.getCanonicalAlias(), ...room.getAltAliases()].filter((a): a is string => !!a),
      createType,
    },
    config
  );
};

export type AlbumsState = { loading: boolean; error: Error | null; albums: Album[] };

/**
 * Slice 1 reads ONE page of each endpoint (threads: 100 roots; replies per root: 100). A zone with
 * more albums or files than that is truncated; pagination is a later slice. Reads are made with
 * the logged-in client, so the room must be unencrypted: encrypted events carry no msgtype and
 * are skipped.
 */
export const useAlbums = (room: Room): AlbumsState => {
  const mx = useMatrixClient();
  const { roomId } = room;
  const query = useQuery({
    queryKey: ['albums', roomId],
    queryFn: async (): Promise<Album[]> => {
      const get = (path: string, params: Record<string, string>) =>
        mx.http.authedRequest<Chunk>(Method.Get, path, params, undefined, {
          prefix: ClientPrefix.V1,
        });
      const room_ = encodeURIComponent(roomId);
      const roots = (await get(`/rooms/${room_}/threads`, { limit: '100' })).chunk ?? [];
      const inputs = await mapLimit(roots, REPLY_FETCHES_IN_FLIGHT, async (root: ZoneEvent) => ({
        root,
        replies:
          (
            await get(
              `/rooms/${room_}/relations/${encodeURIComponent(root.event_id ?? '')}/m.thread`,
              { limit: '100', dir: 'f' }
            )
          ).chunk ?? [],
      }));
      return buildAlbums(inputs);
    },
    retry: 1,
    refetchInterval: REFRESH_MS,
  });
  return {
    loading: query.isLoading,
    // A failed refetch keeps the albums already loaded; the error shows only when there are none.
    error: query.data ? null : (query.error as Error | null),
    albums: query.data ?? [],
  };
};
