import { describe, expect, it, vi } from 'vitest';
import { activateEstateRoom, awaitMyJoin } from './joinEstateRoom';

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
    const named = recordingClient(vi.fn().mockRejectedValue(new Error('Boom')));
    expect(await activateEstateRoom(named.mx, room('joinable'))).toEqual({
      kind: 'refused',
      message: 'Boom',
    });
    const bare = recordingClient(vi.fn().mockRejectedValue({}));
    expect(await activateEstateRoom(bare.mx, room('joinable'))).toEqual({
      kind: 'refused',
      message: 'Could not join',
    });
  });

  it('reports the server refusal and does not decide access itself', async () => {
    const refusal = Object.assign(new Error('M_FORBIDDEN'), {
      data: { error: 'You are not invited to this room.' },
    });
    const { mx, joinRoom } = recordingClient(vi.fn().mockRejectedValue(refusal));
    const result = await activateEstateRoom(mx, room('joinable'));
    expect(result).toEqual({ kind: 'refused', message: 'You are not invited to this room.' });
    expect(joinRoom).toHaveBeenCalledTimes(1);
  });
});

/** A client holding DM invites as the server sends them: the mark is in the invite event only. */
const dmClient = (opts: { refuse?: boolean; invites: Record<string, string> }) => {
  let direct: Record<string, string[]> | undefined;
  const writes: Record<string, string[]>[] = [];
  const joined: string[] = [];
  const mx = {
    getSafeUserId: () => '@me:test',
    getRoom: (roomId: string) => ({
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
    joinRoom: async (roomId: string) => {
      // the join lands only after m.direct has been written: record what it held
      joined.push(JSON.stringify(direct ?? {}));
      if (opts.refuse) throw new Error('M_FORBIDDEN');
      return { roomId };
    },
  };
  return { mx: mx as never, writes, joined, current: () => direct };
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
