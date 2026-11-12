import React, { useEffect, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { Box, Chip, Text, color, config } from 'folds';
import {
  OutboxEntry,
  loadOutbox,
  removeOutbox,
  subscribeOutbox,
} from '../../state/room/composerStore';
import { PAGE_START, resendTracked } from '../../state/room/outboxSend';

/** A send still unconfirmed after this long is offered Resend: the request may be hung. */
export const SLOW_SEND_MS = 30_000;

export type OutboxView = { label: string; failed: boolean; canResend: boolean };

export const outboxView = (
  entry: Pick<OutboxEntry, 'status' | 'ts' | 'error'>,
  now: number,
  since: number = PAGE_START
): OutboxView => {
  if (entry.status === 'failed') {
    return {
      label: `Not sent${entry.error ? `: ${entry.error}` : ''}`,
      failed: true,
      canResend: true,
    };
  }
  if (entry.ts < since) {
    return {
      label: 'Interrupted by a reload: may not have been sent',
      failed: false,
      canResend: true,
    };
  }
  if (now - entry.ts >= SLOW_SEND_MS) {
    return { label: 'Still sending: slow connection', failed: false, canResend: true };
  }
  return { label: 'Sending…', failed: false, canResend: false };
};

export const useRoomOutbox = (userId: string, roomId: string): OutboxEntry[] => {
  const read = () => loadOutbox(userId).filter((e) => e.roomId === roomId);
  const [entries, setEntries] = useState(read);
  useEffect(() => {
    setEntries(read());
    return subscribeOutbox(() => setEntries(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, roomId]);
  return entries;
};

/** Re-render every few seconds while anything is waiting, so a slow send turns resendable. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [active]);
  return now;
};

type RoomOutboxProps = { mx: MatrixClient; roomId: string };

/**
 * Messages this client sent that the server has not confirmed: sending, slow, interrupted by a
 * reload, or failed, each with Resend where one makes sense and Discard.
 */
export function RoomOutbox({ mx, roomId }: RoomOutboxProps) {
  const userId = mx.getUserId() ?? '';
  const entries = useRoomOutbox(userId, roomId);
  const now = useNow(entries.length > 0);
  if (entries.length === 0) return null;

  return (
    <Box
      direction="Column"
      gap="100"
      style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
    >
      {entries.map((entry) => {
        const view = outboxView(entry, now);
        return (
          <Box key={entry.txnId} alignItems="Center" gap="200" data-outbox-status={entry.status}>
            <Box grow="Yes" direction="Column">
              <Text
                size="T200"
                style={{ color: view.failed ? color.Critical.Main : color.Surface.OnContainer }}
              >
                {view.label}
              </Text>
              <Text size="T300" truncate>
                {String(entry.content.body ?? '')}
              </Text>
            </Box>
            {view.canResend && (
              <>
                <Chip variant="Surface" radii="Pill" onClick={() => resendTracked(mx, entry)}>
                  <Text size="B300">Resend</Text>
                </Chip>
                <Chip
                  variant="Surface"
                  radii="Pill"
                  onClick={() => removeOutbox(userId, entry.txnId)}
                >
                  <Text size="B300">Discard</Text>
                </Chip>
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
