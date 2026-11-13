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
import { Album, AlbumFile, lastEventId } from './buildAlbums';
import { folderOf, listFolder, pathLabel } from './albumFolders';
import { FileReadBy } from './FileReadBy';
import { ShareSet, useShareEnabled } from './ShareSet';
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
      <FileReadBy room={room} fileId={file.id} content={file.content} also={file.readBy} />
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

/** A file, and under it a row that unfolds the versions it supersedes. */
function VersionedFileRow({ room, file, author }: FileRowProps) {
  const [shown, setShown] = useState(false);
  const n = file.earlier.length;
  return (
    <>
      <FileRow room={room} file={file} author={author} />
      {n > 0 && (
        <button type="button" className={css.Row} onClick={() => setShown(!shown)}>
          <Text size="T200" className={css.Dim}>
            {`${shown ? '▾' : '▸'} ${n} earlier ${n === 1 ? 'version' : 'versions'}`}
          </Text>
        </button>
      )}
      {shown &&
        file.earlier.map((e) => <FileRow key={e.id} room={room} file={e} author={author} />)}
    </>
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
  const { loading, error, albums, truncated } = useAlbums(room);
  const [dateFormat] = useSetting(settingsAtom, 'dateFormatString');
  const [openId, setOpenId] = useState<string>();
  const [path, setPath] = useState<string[]>([]);
  const open: Album | undefined = albums.find((a) => a.id === openId);
  const authorOf = (a: Album) => getMemberDisplayName(room, a.author) ?? a.author;
  const encrypted = room.hasEncryptionStateEvent();
  const canShare = useShareEnabled(room);

  let body: React.ReactNode;
  if (loading) body = <Text>Loading albums…</Text>;
  else if (error) body = <Text>Could not load albums: {error.message}</Text>;
  else if (open) {
    const images = open.files.length > 0 && open.files.every((f) => f.kind === 'image');
    body = (
      <>
        <button
          type="button"
          className={css.Back}
          onClick={() => {
            setPath(folderOf(open));
            setOpenId(undefined);
          }}
        >
          <Text size="B400">{`‹ ${
            folderOf(open).length ? pathLabel(folderOf(open)) : 'Albums'
          }`}</Text>
        </button>
        <Text size="H4">{open.title}</Text>
        <Text size="T200" className={css.Dim}>
          {authorOf(open)} · {countLabel(open.count)} · {timeDayMonYear(open.ts, dateFormat)}
        </Text>
        {open.count === 0 && <Text>This album has no files.</Text>}
        {canShare && (
          <ShareSet
            key={open.id}
            room={room}
            into={{ albumId: open.id, lastId: lastEventId(open) }}
          />
        )}
        <div className={images ? `${css.Files} ${css.FilesWide}` : css.Files}>
          {open.files.map((f) => (
            <VersionedFileRow key={f.id} room={room} file={f} author={authorOf(open)} />
          ))}
        </div>
      </>
    );
  } else if (encrypted)
    body = <Text>This zone is encrypted, so its albums cannot be listed here.</Text>;
  else if (albums.length === 0 && path.length === 0) body = <Text>No albums yet.</Text>;
  else {
    const here = listFolder(albums, path);
    body = (
      <>
        {path.length > 0 && (
          <button type="button" className={css.Back} onClick={() => setPath(path.slice(0, -1))}>
            <Text size="B400">{`‹ ${
              path.length > 1 ? pathLabel(path.slice(0, -1)) : 'Albums'
            }`}</Text>
          </button>
        )}
        {path.length > 0 && <Text size="H4">{pathLabel(path)}</Text>}
        {here.folders.map((f) => (
          <button
            key={`d:${f.name}`}
            type="button"
            className={css.Row}
            onClick={() => setPath(f.path)}
          >
            <Text size="T400">{`${f.name} /`}</Text>
            <Text size="T200" className={css.Dim}>
              {f.albums} {f.albums === 1 ? 'album' : 'albums'} · {timeDayMonYear(f.ts, dateFormat)}
            </Text>
          </button>
        ))}
        {here.albums.map(({ album: a, leaf }) => (
          <button key={a.id} type="button" className={css.Row} onClick={() => setOpenId(a.id)}>
            <Text size="T400">{leaf}</Text>
            <Text size="T200" className={css.Dim}>
              {authorOf(a)} · {countLabel(a.count)} · {timeDayMonYear(a.ts, dateFormat)}
            </Text>
          </button>
        ))}
        {here.folders.length === 0 && here.albums.length === 0 && <Text>Nothing here.</Text>}
        {truncated && (
          <Text size="T200" className={css.Dim}>
            The list is cut short: some albums or files are not loaded.
          </Text>
        )}
      </>
    );
  }

  return (
    <Scroll hideTrack visibility="Hover">
      <div className={css.Column}>
        {body}
        {/* Stays mounted while an album is open, so a running send keeps its progress. */}
        {canShare && (
          <div hidden={!!open}>
            <ShareSet room={room} folder={path} />
          </div>
        )}
        <button type="button" className={css.Row} onClick={onTimeline}>
          <Text size="B400">Timeline ›</Text>
        </button>
      </div>
    </Scroll>
  );
}
