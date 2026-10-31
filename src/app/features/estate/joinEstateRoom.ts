import { EstateRoom } from './buildEstate';

export type EstateActivation =
  | { kind: 'open'; roomId: string }
  | { kind: 'joined'; roomId: string }
  | { kind: 'refused'; message: string };

type JoinClient = {
  joinRoom(roomId: string, opts: { viaServers: string[] }): Promise<{ roomId: string }>;
};

/**
 * What a tap on an estate row does. A joined room opens; any other room is
 * joined, and only here (plus a first post in the room view). Opening a room
 * never joins it and the client has no peek path. The server decides whether
 * the join is allowed; its refusal is reported, the row is not hidden.
 */
export const activateEstateRoom = async (
  mx: JoinClient,
  room: Pick<EstateRoom, 'roomId' | 'state' | 'via'>
): Promise<EstateActivation> => {
  if (room.state === 'joined') return { kind: 'open', roomId: room.roomId };
  try {
    const joined = await mx.joinRoom(room.roomId, { viaServers: room.via });
    return { kind: 'joined', roomId: joined.roomId };
  } catch (e) {
    const err = e as { data?: { error?: string }; message?: string };
    return { kind: 'refused', message: err.data?.error ?? err.message ?? 'Could not join' };
  }
};

type MembershipSource = {
  getRoom(roomId: string): { getMyMembership(): string } | null;
  on(event: 'Room.myMembership', handler: (room: { roomId: string }, m: string) => void): unknown;
  off(event: 'Room.myMembership', handler: (room: { roomId: string }, m: string) => void): unknown;
};

/**
 * joinRoom resolves when the server accepts the join, before the client store
 * holds the room; navigating then lands on the invite card. Resolves true once
 * the store says the user's membership is join, false after timeoutMs.
 */
export const awaitMyJoin = (
  mx: MembershipSource,
  roomId: string,
  timeoutMs: number
): Promise<boolean> =>
  new Promise((resolve) => {
    if (mx.getRoom(roomId)?.getMyMembership() === 'join') {
      resolve(true);
      return;
    }
    let finish: (joined: boolean) => void = () => undefined;
    const onMembership = (room: { roomId: string }, membership: string) => {
      if (room.roomId === roomId && membership === 'join') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    finish = (joined) => {
      clearTimeout(timer);
      mx.off('Room.myMembership', onMembership);
      resolve(joined);
    };
    mx.on('Room.myMembership', onMembership);
  });
