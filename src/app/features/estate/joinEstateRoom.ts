import { EstateRoom } from './buildEstate';
import { addRoomIdToMDirect, removeRoomIdFromMDirect } from '../../utils/matrix';
import { isDirectInvite } from '../../utils/room';

export type EstateActivation =
  | { kind: 'open'; roomId: string }
  | { kind: 'joined'; roomId: string }
  | { kind: 'refused'; message: string };

const LOST_JOIN_RESPONSE =
  'The connection dropped before the server answered. The join may have gone through; tap again to retry.';

type JoinClient = Parameters<typeof addRoomIdToMDirect>[0];

/**
 * What a tap on an estate row does. A joined room opens; any other room is
 * joined, and only here (plus a first post in the room view). Opening a room
 * never joins it and the client has no peek path. The server decides whether
 * the join is allowed; its refusal is reported, the row is not hidden.
 *
 * An invite marked is_direct carries the mark in the invite event the client
 * already holds, and the join event does not repeat it. So the room is listed
 * in m.direct under the inviter before the join is sent, and taken out again if
 * the join is refused by a server answer. A join that fails without one (lost
 * response, dropped connection) may still have been accepted, so the entry
 * stays and the tap is retryable. Nothing needs to recognise the DM after it
 * arrives. The inbox Accept goes through here too: one owner for joining.
 */
export const activateEstateRoom = async (
  mx: JoinClient,
  room: Pick<EstateRoom, 'roomId' | 'state' | 'via'>
): Promise<EstateActivation> => {
  if (room.state === 'joined') return { kind: 'open', roomId: room.roomId };
  const refusal = (e: unknown): EstateActivation => {
    const err = e as { data?: { error?: string }; message?: string };
    return { kind: 'refused', message: err.data?.error ?? err.message ?? 'Could not join' };
  };
  const answered = (e: unknown) => typeof (e as { httpStatus?: unknown }).httpStatus === 'number';
  const invite = room.state === 'invited' ? mx.getRoom(room.roomId) : null;
  const inviter = isDirectInvite(invite, mx.getSafeUserId())
    ? invite?.getMember(mx.getSafeUserId())?.events?.member?.getSender()
    : undefined;
  try {
    if (inviter) await addRoomIdToMDirect(mx, room.roomId, inviter);
  } catch (e) {
    return refusal(e);
  }
  try {
    const joined = await mx.joinRoom(room.roomId, { viaServers: room.via });
    return { kind: 'joined', roomId: joined.roomId };
  } catch (e) {
    if (!answered(e)) return { kind: 'refused', message: LOST_JOIN_RESPONSE };
    if (inviter) await removeRoomIdFromMDirect(mx, room.roomId).catch(() => undefined);
    return refusal(e);
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
