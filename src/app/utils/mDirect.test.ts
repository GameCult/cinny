import { describe, expect, it } from 'vitest';
import { addRoomIdToMDirect, fileDirectRooms, removeRoomIdFromMDirect } from './matrix';
import { wasInvitedAsDirect } from './room';

const ME = '@me:test';
type Content = Record<string, string[]>;

type FakeRoomOpts = {
  membership?: string;
  content?: Record<string, unknown>;
  prev?: Record<string, unknown>;
  friend?: string | null;
};

/** A joined room as the store holds it: my member event, and the friend once synced. */
const fakeRoom = (roomId: string, o: FakeRoomOpts = {}) => {
  const memberEvent = {
    getContent: () => o.content ?? { membership: 'join' },
    getPrevContent: () => o.prev ?? {},
  };
  const friend = o.friend === undefined ? '@friend:test' : o.friend;
  return {
    roomId,
    getMyMembership: () => o.membership ?? 'join',
    getMember: () => ({ events: { member: memberEvent } }),
    getJoinedMembers: () =>
      friend ? [{ userId: friend, events: { member: { getTs: () => 1 } } }] : [],
    getLiveTimeline: () => ({ getState: () => undefined }),
  };
};
const lateDm = (roomId: string, o: FakeRoomOpts = {}) =>
  fakeRoom(roomId, { prev: { membership: 'invite', is_direct: true }, ...o });

/** A client whose account-data write takes a while and lands only when it completes. */
const fakeClient = (rooms: ReturnType<typeof fakeRoom>[], initial?: Content) => {
  let direct: Content | undefined = initial;
  const writes: Content[] = [];
  const mx = {
    getSafeUserId: () => ME,
    getRooms: () => rooms,
    getAccountData: () => (direct ? { getContent: () => direct } : undefined),
    setAccountData: async (_type: string, content: Content) => {
      await new Promise((r) => {
        setTimeout(r, 5);
      });
      writes.push(structuredClone(content));
      direct = structuredClone(content);
    },
  };
  return { mx: mx as never, raw: mx, writes, current: () => direct };
};

describe('wasInvitedAsDirect', () => {
  it('reads the mark from the join event or from the invite it replaced', () => {
    expect(wasInvitedAsDirect(fakeRoom('!a', { content: { is_direct: true } }) as never, ME)).toBe(
      true
    );
    expect(wasInvitedAsDirect(lateDm('!b') as never, ME)).toBe(true);
    expect(wasInvitedAsDirect(fakeRoom('!c') as never, ME)).toBe(false);
  });

  it('ignores a mark on a state the member event has since left', () => {
    const room = fakeRoom('!d', {
      prev: { membership: 'join', is_direct: true },
      content: { is_direct: false },
    });
    expect(wasInvitedAsDirect(room as never, ME)).toBe(false);
  });
});

describe('fileDirectRooms', () => {
  it('files two DMs that arrive in the same sync, none lost', async () => {
    const c = fakeClient([lateDm('!dm2:test'), lateDm('!dm3:test')]);
    await fileDirectRooms(c.mx);
    expect(c.writes).toHaveLength(1);
    expect(c.current()).toEqual({ '@friend:test': ['!dm2:test', '!dm3:test'] });
  });

  it('serializes overlapping runs so a later write builds on the earlier one', async () => {
    const c = fakeClient([lateDm('!dm2:test'), fakeRoom('!room:test')]);
    await Promise.all([
      fileDirectRooms(c.mx),
      addRoomIdToMDirect(c.mx, '!made:test', '@other:test'),
      fileDirectRooms(c.mx),
    ]);
    expect(c.current()).toEqual({ '@friend:test': ['!dm2:test'], '@other:test': ['!made:test'] });
    expect(c.writes).toHaveLength(2);
  });

  it('files a DM found at startup, after a reload while the join was in flight', async () => {
    const reloaded = fakeClient([lateDm('!dm3:test')], { '@friend:test': ['!dm1:test'] });
    await fileDirectRooms(reloaded.mx);
    expect(reloaded.current()).toEqual({ '@friend:test': ['!dm1:test', '!dm3:test'] });
  });

  it('writes nothing when every marked room is already filed', async () => {
    const c = fakeClient([lateDm('!dm2:test')], { '@friend:test': ['!dm2:test'] });
    await fileDirectRooms(c.mx);
    expect(c.writes).toHaveLength(0);
  });

  it('skips rooms that are not joined, not marked, or whose other party has not synced', async () => {
    const c = fakeClient([
      lateDm('!invited:test', { membership: 'invite' }),
      fakeRoom('!plain:test'),
      lateDm('!nofriend:test', { friend: null }),
    ]);
    await fileDirectRooms(c.mx);
    expect(c.writes).toHaveLength(0);
    // the next sync delivers the friend; the same call files it
    const later = fakeClient([lateDm('!nofriend:test')]);
    await fileDirectRooms(later.mx);
    expect(later.current()).toEqual({ '@friend:test': ['!nofriend:test'] });
  });

  it('does not file a room whose mark was cleared when it was converted to a room', async () => {
    const converted = fakeRoom('!conv:test', {
      content: { membership: 'join', is_direct: false },
      prev: { membership: 'join', is_direct: true },
    });
    const c = fakeClient([converted]);
    await fileDirectRooms(c.mx);
    expect(c.writes).toHaveLength(0);
  });

  it('keeps going after a failed write', async () => {
    const c = fakeClient([lateDm('!dm2:test')]);
    const original = c.raw.setAccountData;
    let fail = true;
    c.raw.setAccountData = async (...a: [string, Content]) => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return original(...a);
    };
    await expect(fileDirectRooms(c.mx)).rejects.toThrow('offline');
    await fileDirectRooms(c.mx);
    expect(c.current()).toEqual({ '@friend:test': ['!dm2:test'] });
  });
});

describe('m.direct edits', () => {
  it('moves a room between users and removes it, one write at a time', async () => {
    const c = fakeClient([], { '@a:test': ['!r:test'] });
    await Promise.all([
      addRoomIdToMDirect(c.mx, '!r:test', '@b:test'),
      removeRoomIdFromMDirect(c.mx, '!gone:test'),
    ]);
    expect(c.current()).toEqual({ '@a:test': [], '@b:test': ['!r:test'] });
    await removeRoomIdFromMDirect(c.mx, '!r:test');
    expect(c.current()).toEqual({ '@a:test': [], '@b:test': [] });
  });
});
