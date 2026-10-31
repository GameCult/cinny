import { describe, expect, it, vi } from 'vitest';
import { activateEstateRoom } from './joinEstateRoom';

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
      return (...args: unknown[]) => {
        void args;
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
