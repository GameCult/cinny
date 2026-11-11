import React, { useEffect, useMemo, useState } from 'react';
import { Box, Scroll, Text } from 'folds';
import { Room, RoomEvent } from 'matrix-js-sdk';
import { MediaControl } from '../../components/media';
import { AudioContent } from '../../components/message';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { IAudioContent } from '../../../types/matrix/common';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from '../../plugins/react-custom-html-parser';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { markAsRead } from '../../utils/notifications';
import { getBlobSafeMimeType } from '../../utils/mimeTypes';
import { timeDayMonYear } from '../../utils/time';
import { getMemberDisplayName } from '../../utils/room';
import { Album, AlbumFile } from './buildAlbums';
import { useAlbums } from './useAlbums';
import * as css from './AlbumView.css';

/**
 * Audio goes straight to AudioContent, skipping the chat Attachment frame and file-type badge: the
 * title above it is the only label and the transport controls sit on the scene. Anything that is
 * not playable audio falls through to the stock renderer (a file download).
 */
const playableAudio = (content: Record<string, unknown>) => {
  const c = content as IAudioContent;
  const url = c.file?.url ?? c.url;
  const mimeType = getBlobSafeMimeType(c.info?.mimetype ?? '');
  if (!c.info || typeof url !== 'string' || !mimeType.startsWith('audio')) return undefined;
  return { info: c.info, url, mimeType, encInfo: c.file };
};

type FileRowProps = { room: Room; file: AlbumFile; author: string };
function FileRow({ room, file, author }: FileRowProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    [mx, room.roomId, useAuthentication]
  );
  const audio = file.kind === 'audio' ? playableAudio(file.content) : undefined;
  return (
    <Box direction="Column" gap="100">
      <Text size="T300" truncate>
        {file.name}
      </Text>
      {audio ? (
        <AudioContent {...audio} renderMediaControl={(p) => <MediaControl {...p} />} />
      ) : (
        <RenderMessageContent
          displayName={author}
          msgType={file.content.msgtype as string}
          ts={file.ts}
          getContent={<T,>() => file.content as T}
          mediaAutoLoad={mediaAutoLoad}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={LINKIFY_OPTS}
        />
      )}
    </Box>
  );
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** The zone never mounts RoomTimeline, so it sends the read receipt the timeline would. */
function useMarkZoneRead(room: Room) {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  useEffect(() => {
    const mark = () => {
      markAsRead(mx, room.roomId, hideActivity).catch(() => undefined);
    };
    mark();
    room.on(RoomEvent.Timeline, mark);
    return () => {
      room.off(RoomEvent.Timeline, mark);
    };
  }, [mx, room, hideActivity]);
}

type AlbumViewProps = { room: Room; onTimeline: () => void };
export function AlbumView({ room, onTimeline }: AlbumViewProps) {
  useMarkZoneRead(room);
  const { loading, error, albums } = useAlbums(room);
  const [dateFormat] = useSetting(settingsAtom, 'dateFormatString');
  const [openId, setOpenId] = useState<string>();
  const open: Album | undefined = albums.find((a) => a.id === openId);
  const authorOf = (a: Album) => getMemberDisplayName(room, a.author) ?? a.author;
  const encrypted = room.hasEncryptionStateEvent();

  let body: React.ReactNode;
  if (loading) body = <Text>Loading albums…</Text>;
  else if (error) body = <Text>Could not load albums: {error.message}</Text>;
  else if (open) {
    const images = open.files.length > 0 && open.files.every((f) => f.kind === 'image');
    body = (
      <>
        <button type="button" className={css.Back} onClick={() => setOpenId(undefined)}>
          <Text size="B400">‹ Albums</Text>
        </button>
        <Text size="H4">{open.title}</Text>
        <Text size="T200" className={css.Dim}>
          {authorOf(open)} · {countLabel(open.count)} · {timeDayMonYear(open.ts, dateFormat)}
        </Text>
        {open.count === 0 && <Text>This album has no files.</Text>}
        <div className={images ? `${css.Files} ${css.FilesWide}` : css.Files}>
          {open.files.map((f) => (
            <FileRow key={f.id} room={room} file={f} author={authorOf(open)} />
          ))}
        </div>
      </>
    );
  } else if (encrypted)
    body = <Text>This zone is encrypted, so its albums cannot be listed here.</Text>;
  else if (albums.length === 0) body = <Text>No albums yet.</Text>;
  else {
    body = albums.map((a) => (
      <button key={a.id} type="button" className={css.Row} onClick={() => setOpenId(a.id)}>
        <Text size="T400">{a.title}</Text>
        <Text size="T200" className={css.Dim}>
          {authorOf(a)} · {countLabel(a.count)} · {timeDayMonYear(a.ts, dateFormat)}
        </Text>
      </button>
    ));
  }

  return (
    <Scroll hideTrack visibility="Hover">
      <div className={css.Column}>
        {body}
        <button type="button" className={css.Row} onClick={onTimeline}>
          <Text size="B400">Timeline ›</Text>
        </button>
      </div>
    </Scroll>
  );
}
