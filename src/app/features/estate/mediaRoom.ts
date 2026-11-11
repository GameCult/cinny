/**
 * A Mind's media room: the file-zone room Eureka provisions under the alias #<mind>-files:<server>.
 * The navigator shows a Media row for every Mind; this module decides what that row says and where it points.
 * A room id carried by the root Space's org.gamecult.stewardships state wins over the alias; the alias is the
 * convention until the provisioning projection carries ids (ratatoskr:follow_up:stewardships-carry-room-ids).
 */
import { EstateRoom } from './buildEstate';

export const STEWARDSHIPS_KEY = 'org.gamecult.stewardships';

export const mediaAlias = (mind: string, server: string): string => `#${mind}-files:${server}`;

/**
 * The room id the stewardships state names for a Mind's media room, if it does. The state's mind-to-repos
 * lists are not read here; the id lives under `media[<mind>]` (provisional shape, awaiting the follow-up above).
 */
export const mediaRoomIdFromStewardships = (content: unknown, mind: string): string | undefined => {
  const id = (content as { media?: Record<string, unknown> } | null | undefined)?.media?.[mind];
  return typeof id === 'string' && id.startsWith('!') ? id : undefined;
};

type MediaClient = {
  getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers?: string[] }>;
};

export type MediaLookup =
  | { found: true; roomId: string; via: string[] }
  | { found: false; reason: 'unset' | 'error'; message?: string };

/** Resolve a Mind's media room: a carried id if there is one, else the alias. A 404 means it is not set up. */
export const lookupMediaRoom = async (
  mx: MediaClient,
  mind: string,
  server: string,
  carriedId?: string
): Promise<MediaLookup> => {
  if (carriedId) return { found: true, roomId: carriedId, via: [server] };
  try {
    const r = await mx.getRoomIdForAlias(mediaAlias(mind, server));
    return { found: true, roomId: r.room_id, via: r.servers?.length ? r.servers : [server] };
  } catch (e) {
    const err = e as {
      httpStatus?: number;
      errcode?: string;
      data?: { errcode?: string };
      message?: string;
    };
    const missing = err.httpStatus === 404 || (err.errcode ?? err.data?.errcode) === 'M_NOT_FOUND';
    return missing
      ? { found: false, reason: 'unset' }
      : {
          found: false,
          reason: 'error',
          message: err.message ?? 'Could not look up the media room',
        };
  }
};

export type MediaRow =
  | { kind: 'checking' }
  | { kind: 'unset' }
  | { kind: 'error'; message: string }
  | { kind: 'room'; room: EstateRoom };

const MEMBERSHIP_STATE = { join: 'joined', invite: 'invited', none: 'joinable' } as const;

/** What the Media row shows: the lookup result joined to the user's own membership. */
export const mediaRow = (
  lookup: MediaLookup | undefined,
  membership: ReadonlyMap<string, 'join' | 'invite'>
): MediaRow => {
  if (!lookup) return { kind: 'checking' };
  if (!lookup.found) {
    return lookup.reason === 'unset'
      ? { kind: 'unset' }
      : { kind: 'error', message: lookup.message ?? 'Could not look up the media room' };
  }
  const m = membership.get(lookup.roomId);
  return {
    kind: 'room',
    room: {
      roomId: lookup.roomId,
      name: 'Media',
      state: MEMBERSHIP_STATE[m ?? 'none'],
      via: lookup.via,
      parentId: null,
      direct: false,
    },
  };
};
