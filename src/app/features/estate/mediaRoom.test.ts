import { describe, expect, it } from 'vitest';
import {
  commonsAlias,
  commonsRow,
  lookupMediaRoom,
  lookupZoneRoom,
  mediaAlias,
  mediaRoomIdFromStewardships,
  mediaRow,
  MediaLookup,
  typedMediaRoom,
} from './mediaRoom';

const notFound = Object.assign(new Error('Room alias not found'), {
  httpStatus: 404,
  errcode: 'M_NOT_FOUND',
});

const clientFor = (answer: () => Promise<{ room_id: string; servers?: string[] }>) => {
  const asked: string[] = [];
  return {
    asked,
    mx: {
      getRoomIdForAlias: (alias: string) => {
        asked.push(alias);
        return answer();
      },
    },
  };
};

describe('the Media row of a Mind', () => {
  it("looks the room up by Eureka's alias pattern", async () => {
    const { mx, asked } = clientFor(async () => ({
      room_id: '!v:gamecult.org',
      servers: ['gamecult.org'],
    }));
    expect(mediaAlias('void', 'gamecult.org')).toBe('#void-files:gamecult.org');
    expect(await lookupMediaRoom(mx, 'void', 'gamecult.org')).toEqual({
      found: true,
      roomId: '!v:gamecult.org',
      via: ['gamecult.org'],
    });
    expect(asked).toEqual(['#void-files:gamecult.org']);
  });

  it('uses a room id the stewardships state carries and asks nobody', async () => {
    const { mx, asked } = clientFor(async () => {
      throw new Error('must not be asked');
    });
    const carried = mediaRoomIdFromStewardships(
      { void: ['GameCult/x'], '@rooms': { file_zones: { void: '!c:gamecult.org' } } },
      'void'
    );
    expect(carried).toBe('!c:gamecult.org');
    expect(await lookupMediaRoom(mx, 'void', 'gamecult.org', carried)).toMatchObject({
      found: true,
      roomId: '!c:gamecult.org',
    });
    expect(asked).toEqual([]);
  });

  it('ignores a stewardships state that carries no id for the Mind, or something that is not a room id', () => {
    expect(mediaRoomIdFromStewardships({ void: ['GameCult/x'] }, 'void')).toBeUndefined();
    expect(
      mediaRoomIdFromStewardships({ '@rooms': { file_zones: { void: 'nope' } } }, 'void')
    ).toBeUndefined();
    // the project ids beside it, another Mind's id, and the old provisional key carry nothing for this Mind
    expect(
      mediaRoomIdFromStewardships(
        {
          '@rooms': { projects: { x: '!p:s' }, file_zones: { kiko: '!k:s' } },
          media: { void: '!m:s' },
        },
        'void'
      )
    ).toBeUndefined();
    // a Mind named "constructor" must not read an inherited property as an id
    expect(
      mediaRoomIdFromStewardships({ '@rooms': { file_zones: {} } }, 'constructor')
    ).toBeUndefined();
    expect(mediaRoomIdFromStewardships(undefined, 'void')).toBeUndefined();
  });

  it('says not set up when the alias does not exist, and unavailable when the lookup fails otherwise', async () => {
    const missing = clientFor(async () => {
      throw notFound;
    });
    expect(await lookupMediaRoom(missing.mx, 'kiko', 'gamecult.org')).toEqual({
      found: false,
      reason: 'unset',
    });
    const down = clientFor(async () => {
      throw Object.assign(new Error('gateway'), { httpStatus: 502 });
    });
    expect(await lookupMediaRoom(down.mx, 'kiko', 'gamecult.org')).toMatchObject({
      found: false,
      reason: 'error',
      message: 'gateway',
    });
  });

  it("joins the found room to the user's membership: joined opens, invited and unjoined are joinable", () => {
    const found = { found: true as const, roomId: '!m:gamecult.org', via: ['gamecult.org'] };
    const state = (m?: 'join' | 'invite') =>
      mediaRow(found, new Map(m ? [['!m:gamecult.org', m]] : []));
    expect(state('join')).toMatchObject({ kind: 'room', room: { state: 'joined', name: 'Media' } });
    expect(state('invite')).toMatchObject({ kind: 'room', room: { state: 'invited' } });
    expect(state()).toMatchObject({
      kind: 'room',
      room: { state: 'joinable', via: ['gamecult.org'], direct: false },
    });
  });

  it('shows no room while the lookup is out, and none for a room that is not there', () => {
    expect(mediaRow(undefined, new Map())).toEqual({ kind: 'checking' });
    expect(mediaRow({ found: false, reason: 'unset' }, new Map())).toEqual({ kind: 'unset' });
  });

  it('takes the joined room whose type says file zone, whatever its alias, before any alias lookup', () => {
    const room = (roomId: string, state: 'joined' | 'joinable') => ({
      roomId,
      name: roomId,
      state,
      via: [],
      parentId: null,
      direct: false,
    });
    const rooms = [
      room('!chat', 'joined'),
      room('!old-files-slug', 'joined'),
      room('!unjoined', 'joinable'),
    ];
    const zones = new Set(['!old-files-slug', '!unjoined']);
    expect(typedMediaRoom(rooms, (id) => zones.has(id))?.roomId).toBe('!old-files-slug');
    expect(typedMediaRoom(rooms, () => false)).toBeUndefined();
  });
});

describe('the Commons row', () => {
  const none = new Map<string, 'join' | 'invite'>();

  it('is found by the alias #commons:<server>', async () => {
    const { mx, asked } = clientFor(async () => ({ room_id: '!c:gamecult.org' }));
    const lookup = await lookupZoneRoom(mx, commonsAlias('gamecult.org'), 'gamecult.org');
    expect(asked).toEqual(['#commons:gamecult.org']);
    expect(commonsRow(true, lookup, new Map([['!c:gamecult.org', 'join']]))).toMatchObject({
      roomId: '!c:gamecult.org',
      name: 'Commons',
      state: 'joined',
    });
  });

  it('shows no row when the room is absent, the lookup failed or is still out', async () => {
    const missing = await lookupZoneRoom(
      clientFor(async () => {
        throw notFound;
      }).mx,
      commonsAlias('gamecult.org'),
      'gamecult.org'
    );
    const failed = await lookupZoneRoom(
      clientFor(async () => {
        throw new Error('down');
      }).mx,
      commonsAlias('gamecult.org'),
      'gamecult.org'
    );
    expect(commonsRow(true, missing, none)).toBeUndefined();
    expect(commonsRow(true, failed, none)).toBeUndefined();
    expect(commonsRow(true, undefined, none)).toBeUndefined();
  });

  it('shows no row with the flag off, even for a found room', () => {
    const found: MediaLookup = { found: true, roomId: '!c:gamecult.org', via: ['gamecult.org'] };
    expect(commonsRow(false, found, new Map([['!c:gamecult.org', 'join']]))).toBeUndefined();
  });

  it('offers a join to a viewer who has not joined, and an accept to an invited one', () => {
    const found: MediaLookup = { found: true, roomId: '!c:gamecult.org', via: ['gamecult.org'] };
    expect(commonsRow(true, found, none)?.state).toBe('joinable');
    expect(commonsRow(true, found, new Map([['!c:gamecult.org', 'invite']]))?.state).toBe(
      'invited'
    );
  });
});
