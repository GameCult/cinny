import { describe, expect, it, vi } from 'vitest';
import {
  activateEstateRoom,
  awaitMyJoin,
  joinEstateRoomIdOrAlias,
  joinEstateRoomOrThrow,
  runJoinCommand,
} from './joinEstateRoom';

const room = (state: 'joined' | 'invited' | 'joinable') => ({
  roomId: '!r:gamecult.org',
  state,
  via: ['gamecult.org'],
});

/** A client that records every call; anything but joinRoom is a peek or a side door. */
const recordingClient = (joinRoom = vi.fn().mockResolvedValue({ roomId: '!r:gamecult.org' })) => {
  const calls: string[] = [];
  const mx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => {
      if (prop === 'joinRoom') {
        return (...args: unknown[]) => {
          calls.push('joinRoom');
          return joinRoom(...args);
        };
      }
      if (prop === 'getRoom') return () => null;
      if (prop === 'getSafeUserId') return () => '@me:test';
      return () => {
        calls.push(prop);
        throw new Error(`unexpected client call: ${prop}`);
      };
    },
  });
  return { mx: mx as never, calls, joinRoom };
};

describe('activateEstateRoom', () => {
  it('opens a joined room without touching the client', async () => {
    const { mx, calls } = recordingClient();
    expect(await activateEstateRoom(mx, room('joined'))).toEqual({
      kind: 'open',
      roomId: '!r:gamecult.org',
    });
    expect(calls).toEqual([]);
  });

  it.each(['invited', 'joinable'] as const)(
    'joins a %s room on the tap, through the hierarchy servers, and nothing else',
    async (state) => {
      const { mx, calls, joinRoom } = recordingClient();
      const result = await activateEstateRoom(mx, room(state));
      expect(result).toEqual({ kind: 'joined', roomId: '!r:gamecult.org' });
      expect(joinRoom).toHaveBeenCalledWith('!r:gamecult.org', { viaServers: ['gamecult.org'] });
      expect(calls).toEqual(['joinRoom']); // no peekInRoom, no read, no second path
    }
  );

  it('falls back to the error message, then to a generic one', async () => {
    const named = recordingClient(
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Boom'), { httpStatus: 403, errcode: 'M_FORBIDDEN' })
        )
    );
    expect(await activateEstateRoom(named.mx, room('joinable'))).toEqual({
      kind: 'refused',
      message: 'Boom',
    });
    const bare = recordingClient(
      vi.fn().mockRejectedValue({ httpStatus: 403, errcode: 'M_FORBIDDEN' })
    );
    expect(await activateEstateRoom(bare.mx, room('joinable'))).toEqual({
      kind: 'refused',
      message: 'Could not join',
    });
  });

  it('reports the server refusal and does not decide access itself', async () => {
    const refusal = Object.assign(new Error('M_FORBIDDEN'), {
      httpStatus: 403,
      errcode: 'M_FORBIDDEN',
      data: { error: 'You are not invited to this room.' },
    });
    const { mx, joinRoom } = recordingClient(vi.fn().mockRejectedValue(refusal));
    const result = await activateEstateRoom(mx, room('joinable'));
    expect(result).toEqual({ kind: 'refused', message: 'You are not invited to this room.' });
    expect(joinRoom).toHaveBeenCalledTimes(1);
  });
});

/** A client holding DM invites as the server sends them: the mark is in the invite event only. */
const dmClient = (opts: {
  status?: number;
  errcode?: string;
  refuse?: boolean;
  drop?: boolean;
  invites: Record<string, string>;
}) => {
  let direct: Record<string, string[]> | undefined;
  const writes: Record<string, string[]>[] = [];
  const joined: string[] = [];
  const joinOpts: unknown[] = [];
  const mx = {
    getSafeUserId: () => '@me:test',
    getRoom: (roomId: string) => ({
      getMyMembership: () => 'invite',
      getMember: () => ({
        events: {
          member: {
            getContent: () => ({ membership: 'invite', is_direct: true }),
            getSender: () => opts.invites[roomId],
          },
        },
      }),
    }),
    getAccountData: () => (direct ? { getContent: () => direct } : undefined),
    setAccountData: async (_t: string, content: Record<string, string[]>) => {
      await new Promise((r) => {
        setTimeout(r, 5);
      });
      writes.push(structuredClone(content));
      direct = structuredClone(content);
    },
    joinRoom: async (roomId: string, joinArgs?: unknown) => {
      joinOpts.push(joinArgs);
      // the join lands only after m.direct has been written: record what it held
      joined.push(JSON.stringify(direct ?? {}));
      if (opts.refuse)
        throw Object.assign(new Error('M_FORBIDDEN'), { httpStatus: 403, errcode: 'M_FORBIDDEN' });
      if (opts.status)
        throw Object.assign(new Error('Gateway Time-out'), {
          httpStatus: opts.status,
          errcode: opts.errcode,
        });
      if (opts.drop) throw new Error('fetch failed');
      return { roomId };
    },
  };
  return { mx: mx as never, writes, joined, joinOpts, current: () => direct };
};
const tap = (id: string) => ({ roomId: id, state: 'invited' as const, via: ['test'] });

describe('activateEstateRoom for a direct message invite', () => {
  it('lists the room under the inviter before the join is sent', async () => {
    const c = dmClient({ invites: { '!dm1:test': '@friend:test' } });
    await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(c.joined).toEqual([JSON.stringify({ '@friend:test': ['!dm1:test'] })]);
  });

  it('keeps both rooms when two DM joins are tapped together', async () => {
    const c = dmClient({ invites: { '!dm2:test': '@friend:test', '!dm3:test': '@friend:test' } });
    const results = await Promise.all([
      activateEstateRoom(c.mx, tap('!dm2:test')),
      activateEstateRoom(c.mx, tap('!dm3:test')),
    ]);
    expect(results.map((r) => r.kind)).toEqual(['joined', 'joined']);
    expect(c.current()).toEqual({ '@friend:test': ['!dm2:test', '!dm3:test'] });
  });

  it('takes the room out again when the join is refused', async () => {
    const c = dmClient({ refuse: true, invites: { '!dm1:test': '@friend:test' } });
    const result = await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(result).toEqual({ kind: 'refused', message: 'M_FORBIDDEN' });
    expect(c.current()).toEqual({ '@friend:test': [] });
  });
});

describe('activateEstateRoom when the join gets no answer', () => {
  it('keeps the room listed and shows a retryable message', async () => {
    const c = dmClient({ drop: true, invites: { '!dm1:test': '@friend:test' } });
    const result = await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(result.kind).toBe('refused');
    expect((result as { message: string }).message).toMatch(/tap again to retry/);
    expect(c.current()).toEqual({ '@friend:test': ['!dm1:test'] });
  });
});

describe('activateEstateRoom refusal bounds', () => {
  it.each([400, 429, 499])('unfiles the room on a %i that carries an errcode', async (status) => {
    const c = dmClient({
      status,
      errcode: 'M_LIMIT_EXCEEDED',
      invites: { '!dm1:test': '@friend:test' },
    });
    const result = await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(result.kind).toBe('refused');
    expect((result as { message: string }).message).not.toMatch(/tap again to retry/);
    expect(c.current()).toEqual({});
  });

  it.each([399, 500])('keeps the room listed on a %i that carries an errcode', async (status) => {
    const c = dmClient({ status, errcode: 'M_UNKNOWN', invites: { '!dm1:test': '@friend:test' } });
    await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(c.current()).toEqual({ '@friend:test': ['!dm1:test'] });
  });
});

describe('activateEstateRoom when a gateway answers instead of the server', () => {
  it.each([502, 503, 504, 404])('keeps the room listed on a %i with no errcode', async (status) => {
    const c = dmClient({ status, invites: { '!dm1:test': '@friend:test' } });
    const result = await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(result.kind).toBe('refused');
    expect((result as { message: string }).message).toMatch(/tap again to retry/);
    expect(c.current()).toEqual({ '@friend:test': ['!dm1:test'] });
  });

  it('keeps the room listed on a 5xx even when it carries an errcode', async () => {
    const c = dmClient({
      status: 500,
      errcode: 'M_UNKNOWN',
      invites: { '!dm1:test': '@friend:test' },
    });
    await activateEstateRoom(c.mx, tap('!dm1:test'));
    expect(c.current()).toEqual({ '@friend:test': ['!dm1:test'] });
  });
});

describe('joinEstateRoomIdOrAlias, the room card and /join', () => {
  it('files a direct invite opened by its link before the join is sent', async () => {
    const c = dmClient({ invites: { '!dm1:test': '@friend:test' } });
    const result = await joinEstateRoomIdOrAlias(c.mx, '!dm1:test', ['test']);
    expect(result).toEqual({ kind: 'joined', roomId: '!dm1:test' });
    expect(c.joined).toEqual([JSON.stringify({ '@friend:test': ['!dm1:test'] })]);
  });

  it('hands the via servers to the join', async () => {
    const c = dmClient({ invites: { '!dm1:test': '@friend:test' } });
    await joinEstateRoomIdOrAlias(c.mx, '!dm1:test', ['other.org']);
    expect(c.joinOpts).toEqual([{ viaServers: ['other.org'] }]);
  });

  it('joins an alias or an unheld room without touching m.direct', async () => {
    const { mx, calls } = recordingClient();
    await joinEstateRoomIdOrAlias(mx, '#room:gamecult.org');
    expect(calls).toEqual(['joinRoom']);
  });
});

describe('joinEstateRoomOrThrow, the lobby, tombstone and predecessor buttons', () => {
  it('files a direct invite and answers the joined room id', async () => {
    const c = dmClient({ invites: { '!dm1:test': '@friend:test' } });
    await expect(joinEstateRoomOrThrow(c.mx, '!dm1:test', ['test'])).resolves.toBe('!dm1:test');
    expect(c.joined).toEqual([JSON.stringify({ '@friend:test': ['!dm1:test'] })]);
  });

  it('throws the refusal and unfiles the room', async () => {
    const c = dmClient({ refuse: true, invites: { '!dm1:test': '@friend:test' } });
    await expect(joinEstateRoomOrThrow(c.mx, '!dm1:test')).rejects.toThrow('M_FORBIDDEN');
    expect(c.current()).toEqual({});
  });
});

describe('runJoinCommand, /join', () => {
  it('reports each refusal and joins the others', async () => {
    const c = dmClient({ refuse: true, invites: { '!dm1:test': '@friend:test' } });
    const reported: string[] = [];
    await runJoinCommand(c.mx, '!dm1:test notanaddress', (m) => reported.push(m));
    expect(reported).toEqual(['M_FORBIDDEN']);
    expect(c.joined).toHaveLength(1);
  });

  it('reports nothing when the join is accepted', async () => {
    const c = dmClient({ invites: { '!dm1:test': '@friend:test' } });
    const reported: string[] = [];
    await runJoinCommand(c.mx, '!dm1:test', (m) => reported.push(m));
    expect(reported).toEqual([]);
    expect(c.joined).toHaveLength(1);
  });
});

describe('awaitMyJoin', () => {
  /** A store that gains the room when the test says so, emitting like the SDK. */
  const store = () => {
    let membership: string | null = null;
    const handlers = new Set<(room: { roomId: string }, m: string) => void>();
    return {
      mx: {
        getRoom: () => (membership ? { getMyMembership: () => membership! } : null),
        on: (_e: string, h: (room: { roomId: string }, m: string) => void) => handlers.add(h),
        off: (_e: string, h: (room: { roomId: string }, m: string) => void) => handlers.delete(h),
      },
      handlers,
      become: (roomId: string, m: string) => {
        membership = m;
        handlers.forEach((h) => h({ roomId }, m));
      },
    };
  };

  it('resolves at once when the store already holds the joined room', async () => {
    const s = store();
    s.become('!r:x', 'join');
    expect(await awaitMyJoin(s.mx, '!r:x', 1000)).toBe(true);
  });

  it('stays pending while the store still shows an invite, then resolves on join', async () => {
    const s = store();
    let settled = false;
    const p = awaitMyJoin(s.mx, '!r:x', 1000).then((v) => {
      settled = true;
      return v;
    });
    s.become('!r:x', 'invite');
    s.become('!other:x', 'join');
    await Promise.resolve();
    expect(settled).toBe(false);
    s.become('!r:x', 'join');
    expect(await p).toBe(true);
    expect(s.handlers.size).toBe(0);
  });

  it('gives up after the timeout and stops listening', async () => {
    vi.useFakeTimers();
    const s = store();
    const p = awaitMyJoin(s.mx, '!r:x', 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe(false);
    expect(s.handlers.size).toBe(0);
    vi.useRealTimers();
  });
});
