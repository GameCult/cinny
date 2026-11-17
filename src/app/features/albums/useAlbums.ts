import { useQuery } from '@tanstack/react-query';
import { ClientPrefix, Method, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { Album, ZoneEvent, buildAlbums } from './buildAlbums';
import { isFileZone } from './isFileZone';
import { mapLimit } from './mapLimit';
import { Page, readPages } from './readPages';

const REPLY_FETCHES_IN_FLIGHT = 6;
const REFRESH_MS = 30_000;

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

export type AlbumsState = {
  loading: boolean;
  error: Error | null;
  albums: Album[];
  /** A read hit the page cap (readPages), so older albums or files are not in the list. */
  truncated: boolean;
};

const PAGE_LIMIT = '100';

/**
 * Reads every page of the zone's threads, then every page of each thread's replies, each capped at
 * MAX_PAGES (readPages). Reads are made with the logged-in client, so the room must be
 * unencrypted: encrypted events carry no msgtype and are skipped.
 */
export const useAlbums = (room: Room): AlbumsState => {
  const mx = useMatrixClient();
  const { roomId } = room;
  const query = useQuery({
    queryKey: ['albums', roomId],
    queryFn: async (): Promise<{ albums: Album[]; truncated: boolean }> => {
      const get = (path: string, params: Record<string, string>) =>
        mx.http.authedRequest<Page<ZoneEvent>>(Method.Get, path, params, undefined, {
          prefix: ClientPrefix.V1,
        });
      const paged = (path: string, params: Record<string, string>) =>
        readPages<ZoneEvent>((from) => get(path, from ? { ...params, from } : params));
      const room_ = encodeURIComponent(roomId);
      const roots = await paged(`/rooms/${room_}/threads`, { limit: PAGE_LIMIT });
      let { truncated } = roots;
      const inputs = await mapLimit(
        roots.items,
        REPLY_FETCHES_IN_FLIGHT,
        async (root: ZoneEvent) => {
          const replies = await paged(
            `/rooms/${room_}/relations/${encodeURIComponent(root.event_id ?? '')}/m.thread`,
            { limit: PAGE_LIMIT, dir: 'f' }
          );
          truncated = truncated || replies.truncated;
          return { root, replies: replies.items };
        }
      );
      return { albums: buildAlbums(inputs, mx.getDomain() ?? ''), truncated };
    },
    retry: 1,
    refetchInterval: REFRESH_MS,
  });
  return {
    loading: query.isLoading,
    // A failed refetch keeps the albums already loaded; the error shows only when there are none.
    error: query.data ? null : (query.error as Error | null),
    albums: query.data?.albums ?? [],
    truncated: query.data?.truncated ?? false,
  };
};
