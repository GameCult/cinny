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
