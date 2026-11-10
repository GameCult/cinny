import React, { useMemo, useState } from 'react';
import { Box, Scroll, Text } from 'folds';
import { Room } from 'matrix-js-sdk';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from '../../plugins/react-custom-html-parser';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { timeDayMonYear } from '../../utils/time';
import { getMemberDisplayName } from '../../utils/room';
import { Album, AlbumFile } from './buildAlbums';
import { useAlbums } from './useAlbums';
import * as css from './AlbumView.css';

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
  return (
    <Box direction="Column" gap="100">
      <Text size="T300" truncate>
        {file.name}
      </Text>
      <RenderMessageContent
        displayName={author}
        msgType={file.content.msgtype as string}
        ts={file.ts}
        getContent={<T,>() => file.content as T}
        mediaAutoLoad={mediaAutoLoad}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    </Box>
  );
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

export function AlbumView({ room }: { room: Room }) {
  const { loading, error, albums } = useAlbums(room);
  const [dateFormat] = useSetting(settingsAtom, 'dateFormatString');
  const [openId, setOpenId] = useState<string>();
  const open: Album | undefined = albums.find((a) => a.id === openId);
  const authorOf = (a: Album) => getMemberDisplayName(room, a.author) ?? a.author;

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
  } else if (albums.length === 0) body = <Text>No albums yet.</Text>;
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
      <div className={css.Column}>{body}</div>
    </Scroll>
  );
}
