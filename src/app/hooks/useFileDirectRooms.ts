import { useEffect } from 'react';
import { useMatrixClient } from './useMatrixClient';
import { fileDirectRooms } from '../utils/matrix';

/** Keeps direct messages filed in m.direct: on startup, on every sync, on every membership change. */
export const useFileDirectRooms = (): void => {
  const mx = useMatrixClient();
  useEffect(() => {
    const file = () => {
      fileDirectRooms(mx).catch(() => undefined);
    };
    file();
    mx.on('sync' as never, file);
    mx.on('Room.myMembership' as never, file);
    return () => {
      mx.off('sync' as never, file);
      mx.off('Room.myMembership' as never, file);
    };
  }, [mx]);
};
