import { MatrixClient } from 'matrix-js-sdk';
import { EstateRoom } from './buildEstate';

export type EstateActivation =
  | { kind: 'open'; roomId: string }
  | { kind: 'joined'; roomId: string }
  | { kind: 'refused'; message: string };

type JoinClient = Pick<MatrixClient, 'joinRoom'>;

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
