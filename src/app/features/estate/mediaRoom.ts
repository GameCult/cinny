/**
 * A Mind's media room: the file-zone room Eureka provisions under the alias #<mind>-files:<server>.
 * The navigator shows a Media row for every Mind; this module decides what that row says and where it points.
 * A room id carried by the root Space's org.gamecult.stewardships state wins over the alias; the alias is the
 * fallback for a Mind whose zone the provisioning run has not recorded yet.
 */
import { EstateRoom } from './buildEstate';

export const STEWARDSHIPS_KEY = 'org.gamecult.stewardships';

/** Where provisioning records room ids in the stewardships state (gamecult-ops synapse-accounts-hand-managed.py ROOMS_KEY). "@" is no legal Matrix localpart, so no Mind can own the key. */
export const ROOMS_KEY = '@rooms';

export const mediaAlias = (mind: string, server: string): string => `#${mind}-files:${server}`;

/** The shared Commons room's alias (gamecult-ops synapse-accounts-hand-managed.py COMMONS_ALIAS). */
export const commonsAlias = (server: string): string => `#commons:${server}`;

/**
 * The room id the stewardships state names for a Mind's media room, under `@rooms.file_zones[<mind>]`.
 * The state's mind-to-repos lists are not read here.
 */
export const mediaRoomIdFromStewardships = (content: unknown, mind: string): string | undefined => {
  const rooms = (
    content as
      | Record<string, { file_zones?: Record<string, unknown> } | undefined>
      | null
      | undefined
  )?.[ROOMS_KEY];
  const id = rooms?.file_zones?.[mind];
  return typeof id === 'string' && id.startsWith('!') ? id : undefined;
};

/**
 * The Mind's media room among the rooms the client already knows: the first one whose room type (or the
 * fileZoneRooms config) says it is a file zone. The type is the authority; the alias is only how an unknown
 * room is found, below.
 */
export const typedMediaRoom = (
  rooms: readonly EstateRoom[],
  isZone: (roomId: string) => boolean
): EstateRoom | undefined => rooms.find((r) => r.state === 'joined' && isZone(r.roomId));

type MediaClient = {
  getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers?: string[] }>;
};

export type MediaLookup =
  | { found: true; roomId: string; via: string[] }
  | { found: false; reason: 'unset' | 'error'; message?: string };

/** Resolve a file-zone room (a Mind's media room, or Commons): a carried id if there is one, else the alias. A 404 means it is not set up. */
export const lookupZoneRoom = async (
  mx: MediaClient,
  alias: string,
  server: string,
  carriedId?: string
): Promise<MediaLookup> => {
  if (carriedId) return { found: true, roomId: carriedId, via: [server] };
  try {
    const r = await mx.getRoomIdForAlias(alias);
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

/** Resolve a Mind's media room. */
export const lookupMediaRoom = (
  mx: MediaClient,
  mind: string,
  server: string,
  carriedId?: string
): Promise<MediaLookup> => lookupZoneRoom(mx, mediaAlias(mind, server), server, carriedId);

export type MediaRow =
  | { kind: 'checking' }
  | { kind: 'unset' }
  | { kind: 'error'; message: string }
  | { kind: 'room'; room: EstateRoom };

const MEMBERSHIP_STATE = { join: 'joined', invite: 'invited', none: 'joinable' } as const;

/** What the Media row shows: the lookup result joined to the user's own membership. */
export const mediaRow = (
  lookup: MediaLookup | undefined,
  membership: ReadonlyMap<string, 'join' | 'invite'>,
  name = 'Media'
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
      name,
      state: MEMBERSHIP_STATE[m ?? 'none'],
      via: lookup.via,
      parentId: null,
      direct: false,
    },
  };
};

/**
 * The Commons row: the shared room, or nothing. Off with the share flag; not set up, still looking and a failed lookup
 * show no row (the room is shared furniture, not a per-Mind promise like Media). A found room is joined, invited or
 * joinable, as for Media.
 */
export const commonsRow = (
  enabled: boolean,
  lookup: MediaLookup | undefined,
  membership: ReadonlyMap<string, 'join' | 'invite'>
): EstateRoom | undefined => {
  if (!enabled) return undefined;
  const row = mediaRow(lookup, membership, 'Commons');
  return row.kind === 'room' ? row.room : undefined;
};
