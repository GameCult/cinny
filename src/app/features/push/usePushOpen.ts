import { useEffect } from 'react';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { OPEN_ROOM, PUSH_EVENT_PARAM, PUSH_ROOM_PARAM } from './worker';

/** Opens the room a push notification named: from the worker's message (app open) or the start URL (app was closed). */
export function usePushOpen(): void {
  const { navigateRoom } = useRoomNavigate();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get(PUSH_ROOM_PARAM);
    if (roomId) {
      navigateRoom(roomId, params.get(PUSH_EVENT_PARAM) ?? undefined);
      params.delete(PUSH_ROOM_PARAM);
      params.delete(PUSH_EVENT_PARAM);
      const rest = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
      );
    }
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === OPEN_ROOM && typeof ev.data.roomId === 'string') {
        navigateRoom(
          ev.data.roomId,
          typeof ev.data.eventId === 'string' ? ev.data.eventId : undefined
        );
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [navigateRoom]);
}
