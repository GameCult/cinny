import React, { useRef, useState } from 'react';
import { Text } from 'folds';
import { useQueryClient } from '@tanstack/react-query';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { uploadContent } from '../../utils/matrix';
import { safeFile } from '../../utils/mimeTypes';
import { getMsgContent } from '../room/msgContent';
import { FILE_HASH_KEY, hashForSend } from './fileReceipt';
import { DEFAULT_TITLE, sendShareSet } from './shareSet';
import * as css from './AlbumView.css';

/** Off unless `fileZoneShare.enabled` is true. An encrypted zone is never offered the share. */
export const useShareEnabled = (room: Room): boolean =>
  !!useClientConfig().fileZoneShare?.enabled && !room.hasEncryptionStateEvent();

type Phase = { kind: 'idle' } | { kind: 'sending'; done: number } | { kind: 'done'; text: string };

/**
 * One row when idle. Picking files (any number, one picker) opens the panel: a title, the picked
 * names, Send. Sending makes one album of them (shareSet.ts). Nothing here is visible until used.
 */
export function ShareSet({ room }: { room: Room }) {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const reset = () => {
    setFiles([]);
    setTitle('');
    if (input.current) input.current.value = '';
  };

  const send = async () => {
    setPhase({ kind: 'sending', done: 0 });
    let settled = 0;
    try {
      const res = await sendShareSet(
        {
          send: async (content) => (await mx.sendMessage(room.roomId, content as any)).event_id,
          contentOf: async (f) => {
            const file = safeFile(f.file);
            const mxc = await new Promise<string>((resolve, reject) => {
              uploadContent(mx, file, { onSuccess: resolve, onError: reject });
            });
            const content = await getMsgContent(
              mx,
              {
                file,
                originalFile: f.file,
                metadata: { markedAsSpoiler: false },
                encInfo: undefined,
              },
              mxc
            );
            const sha256 = await hashForSend(f.file);
            if (sha256) content.info = { ...content.info, [FILE_HASH_KEY]: sha256 };
            return content;
          },
          onFile: () => {
            settled += 1;
            setPhase({ kind: 'sending', done: settled });
          },
        },
        title,
        files.map((file) => ({ name: file.name, mimeType: file.type, file }))
      );
      queryClient.invalidateQueries({ queryKey: ['albums', room.roomId] });
      reset();
      setPhase({
        kind: 'done',
        text: res.failed.length
          ? `Shared ${res.sent}. Not sent: ${res.failed.join(', ')}`
          : `Shared ${res.sent} ${res.sent === 1 ? 'file' : 'files'}.`,
      });
    } catch (e: any) {
      setPhase({ kind: 'done', text: `Could not share: ${e?.message ?? 'send failed'}` });
    }
  };

  return (
    <div className={css.SharePanel}>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []));
          setPhase({ kind: 'idle' });
        }}
      />
      {files.length === 0 && phase.kind !== 'sending' && (
        <button type="button" className={css.Row} onClick={() => input.current?.click()}>
          <Text size="B400">Share files ›</Text>
        </button>
      )}
      {phase.kind === 'done' && <Text size="T200">{phase.text}</Text>}
      {files.length > 0 && (
        <>
          <input
            className={css.ShareTitle}
            value={title}
            placeholder={DEFAULT_TITLE}
            aria-label="Album title"
            disabled={phase.kind === 'sending'}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Text size="T200" className={css.Dim}>
            {files.map((f) => f.name).join(' · ')}
          </Text>
          {phase.kind === 'sending' ? (
            <Text size="T300">
              Sending {phase.done} of {files.length}…
            </Text>
          ) : (
            <>
              <button type="button" className={css.Row} onClick={send}>
                <Text size="B400">
                  Send {files.length} {files.length === 1 ? 'file' : 'files'}
                </Text>
              </button>
              <button type="button" className={css.Row} onClick={reset}>
                <Text size="B400">Cancel</Text>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
