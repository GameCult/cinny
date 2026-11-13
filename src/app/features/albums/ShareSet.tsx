import React, { useRef, useState, useSyncExternalStore } from 'react';
import { Text } from 'folds';
import { useQueryClient } from '@tanstack/react-query';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { uploadContent } from '../../utils/matrix';
import { safeFile } from '../../utils/mimeTypes';
import { getMsgContent } from '../room/msgContent';
import { FILE_HASH_KEY, hashForSend } from './fileReceipt';
import { ShareController, ShareState, createShareController } from './shareController';
import { DEFAULT_TITLE, sendShareSet } from './shareSet';
import * as css from './AlbumView.css';

/** Off unless `fileZoneShare.enabled` is true. An encrypted zone is never offered the share. */
export const shareEnabled = (
  config: { fileZoneShare?: { enabled?: boolean } },
  encrypted: boolean
) => !!config.fileZoneShare?.enabled && !encrypted;

export const useShareEnabled = (room: Room): boolean =>
  shareEnabled(useClientConfig(), room.hasEncryptionStateEvent());

type ShareViewProps = {
  state: ShareState<File>;
  onPickClick: () => void;
  onPicked: (files: File[]) => void;
  onTitle: (title: string) => void;
  onSend: () => void;
  onCancel: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
};

/**
 * One row when idle. Picking files (any number, one picker) opens the panel: a title, the picked
 * names, Send. Nothing but the row is visible until files are picked.
 */
export function ShareSetView({
  state,
  onPickClick,
  onPicked,
  onTitle,
  onSend,
  onCancel,
  inputRef,
}: ShareViewProps) {
  const { files, title, phase, epoch } = state;
  return (
    <div className={css.SharePanel}>
      <input
        key={epoch}
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => onPicked(Array.from(e.target.files ?? []))}
      />
      {files.length === 0 && phase.kind !== 'sending' && (
        <button type="button" className={css.Row} onClick={onPickClick}>
          <Text size="B400">Share files ›</Text>
        </button>
      )}
      {phase.kind === 'done' && (
        <Text size="T200" className={css.ShareNames}>
          {phase.text}
        </Text>
      )}
      {files.length > 0 && (
        <>
          <input
            className={css.ShareTitle}
            value={title}
            placeholder={DEFAULT_TITLE}
            aria-label="Album title"
            disabled={phase.kind === 'sending'}
            onChange={(e) => onTitle(e.target.value)}
          />
          <Text size="T200" className={`${css.Dim} ${css.ShareNames}`}>
            {files.map((f) => f.name).join(' · ')}
          </Text>
          {phase.kind === 'sending' ? (
            <Text size="T300">
              Sending {phase.done} of {files.length}…
            </Text>
          ) : (
            <>
              <button type="button" className={css.Row} onClick={onSend}>
                <Text size="B400">
                  Send {files.length} {files.length === 1 ? 'file' : 'files'}
                </Text>
              </button>
              <button type="button" className={css.Row} onClick={onCancel}>
                <Text size="B400">Cancel</Text>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function ShareSet({ room }: { room: Room }) {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // Built once per mount (AlbumView keys the panel by room): the pick lives in the controller, so a
  // rerender with a new client or Room object must not build another. Live values go through `live`.
  const live = useRef({ mx, room, queryClient });
  live.current = { mx, room, queryClient };
  const [controller]: [ShareController<File>, unknown] = useState(() =>
    createShareController<File>({
      roomId: room.roomId,
      isEncrypted: () => live.current.room.hasEncryptionStateEvent(),
      onSent: () =>
        live.current.queryClient.invalidateQueries({ queryKey: ['albums', room.roomId] }),
      run: (files, title, onFile) =>
        sendShareSet(
          {
            send: async (content) =>
              (await live.current.mx.sendMessage(room.roomId, content as any)).event_id,
            contentOf: async (f) => {
              const file = safeFile(f.file);
              const mxc = await new Promise<string>((resolve, reject) => {
                uploadContent(live.current.mx, file, { onSuccess: resolve, onError: reject });
              });
              const content = await getMsgContent(
                live.current.mx,
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
            onFile,
          },
          title,
          files.map((file) => ({ name: file.name, mimeType: file.type, file }))
        ),
    })
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <ShareSetView
      state={state}
      inputRef={input}
      onPickClick={() => input.current?.click()}
      onPicked={controller.pick}
      onTitle={controller.setTitle}
      onSend={controller.send}
      onCancel={controller.cancel}
    />
  );
}
