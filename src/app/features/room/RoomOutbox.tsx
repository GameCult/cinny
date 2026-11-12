import React, { useEffect, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { Box, Chip, Text, color, config } from 'folds';
import {
  OutboxEntry,
  enqueueOutbox,
  failOutbox,
  loadOutbox,
  removeOutbox,
  retryOutbox,
  subscribeOutbox,
} from '../../state/room/composerStore';

const attempt = (mx: MatrixClient, userId: string, entry: OutboxEntry): Promise<void> =>
  mx
    .sendMessage(entry.roomId, entry.content as never, entry.txnId)
    .then(() => removeOutbox(userId, entry.txnId))
    .catch((e: unknown) =>
      failOutbox(userId, entry.txnId, e instanceof Error ? e.message : String(e))
    );

/** Send a message, keeping it in the durable outbox until the server confirms it. */
export const sendTracked = (
  mx: MatrixClient,
  roomId: string,
  content: Record<string, unknown>
): Promise<void> => {
  const userId = mx.getUserId() ?? '';
  const entry = { roomId, content, txnId: mx.makeTxnId() };
  enqueueOutbox(userId, entry);
  return attempt(mx, userId, { ...entry, status: 'pending', ts: Date.now() });
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

/** Entries still 'pending' that predate this page load lost their promise in a reload: outcome unknown. */
const pageStart = Date.now();

type RoomOutboxProps = { mx: MatrixClient; roomId: string };

/**
 * Messages this client sent that the server has not confirmed: still sending, or failed.
 * They also appear here after a reload, since the outbox is durable. Resending reuses the
 * original txn id, so a send that did land the first time is not duplicated.
 */
export function RoomOutbox({ mx, roomId }: RoomOutboxProps) {
  const userId = mx.getUserId() ?? '';
  const entries = useRoomOutbox(userId, roomId);
  if (entries.length === 0) return null;

  return (
    <Box
      direction="Column"
      gap="100"
      style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
    >
      {entries.map((entry) => {
        const failed = entry.status === 'failed';
        const interrupted = !failed && entry.ts < pageStart;
        const canResend = failed || interrupted;
        return (
          <Box key={entry.txnId} alignItems="Center" gap="200" data-outbox-status={entry.status}>
            <Box grow="Yes" direction="Column">
              <Text
                size="T200"
                style={{ color: failed ? color.Critical.Main : color.Surface.OnContainer }}
              >
                {(() => {
                  if (failed) return `Not sent${entry.error ? `: ${entry.error}` : ''}`;
                  return interrupted ? 'Interrupted by a reload: may not have been sent' : 'Sending…';
                })()}
              </Text>
              <Text size="T300" truncate>
                {String(entry.content.body ?? '')}
              </Text>
            </Box>
            {canResend && (
              <>
            <Chip
              variant="Surface"
              radii="Pill"
              onClick={() => {
                retryOutbox(userId, entry.txnId);
                attempt(mx, userId, entry);
              }}
            >
              <Text size="B300">Resend</Text>
            </Chip>
            <Chip variant="Surface" radii="Pill" onClick={() => removeOutbox(userId, entry.txnId)}>
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
