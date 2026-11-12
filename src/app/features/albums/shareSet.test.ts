import { describe, expect, it } from 'vitest';
import config from '../../../../config.json';
import { ZoneEvent, buildAlbums } from './buildAlbums';
import {
  DEFAULT_TITLE,
  ShareFile,
  SharePort,
  remainingAfter,
  resultNote,
  sendShareSet,
  threadRelation,
} from './shareSet';

const kindOf = (f: ShareFile) => (f.mimeType.startsWith('audio') ? 'm.audio' : 'm.file');

/** A fake room: records what is sent, as the events Synapse would return from /relations. */
const room = (failOn: string[] = []) => {
  const events: ZoneEvent[] = [];
  const port: SharePort<ShareFile> = {
    send: async (content) => {
      const id = `$e${events.length + 1}`;
      events.push({
        event_id: id,
        type: 'm.room.message',
        sender: '@aqua:chat.gamecult.org',
        origin_server_ts: 1000 + events.length,
        content,
      });
      return id;
    },
    contentOf: async (f) => {
      if (failOn.includes(f.name)) throw new Error('upload failed');
      return {
        msgtype: kindOf(f),
        body: f.name,
        filename: f.name,
        url: `mxc://x/${f.name}`,
        info: { mimetype: f.mimeType },
      };
    },
  };
  const album = () => {
    const [root, ...replies] = events;
    return buildAlbums([{ root, replies }], 'chat.gamecult.org')[0];
  };
  return { events, port, album };
};

const clips: ShareFile[] = [
  { name: 'a.ogg', mimeType: 'audio/ogg' },
  { name: 'b.ogg', mimeType: 'audio/ogg' },
  { name: 'c.txt', mimeType: 'text/plain' },
];

describe('sendShareSet', () => {
  it('reads back as one album of the files in pick order', async () => {
    const r = room();
    const res = await sendShareSet(r.port, 'Take 4', clips);
    expect(res).toEqual({ albumId: '$e1', sent: 3, failed: [], failedAt: [] });
    const album = r.album();
    expect(album.title).toBe('Take 4');
    expect(album.files.map((f) => [f.name, f.kind])).toEqual([
      ['a.ogg', 'audio'],
      ['b.ogg', 'audio'],
      ['c.txt', 'file'],
    ]);
  });

  it('threads every file under the root, each falling back to the previous event', async () => {
    const r = room();
    await sendShareSet(r.port, 't', clips);
    const rels = r.events.slice(1).map((e) => e.content?.['m.relates_to']);
    expect(rels).toEqual([
      threadRelation('$e1', '$e1'),
      threadRelation('$e1', '$e2'),
      threadRelation('$e1', '$e3'),
    ]);
    expect(r.events[0].content?.['m.relates_to']).toBeUndefined();
  });

  it('titles an untitled share', async () => {
    const r = room();
    await sendShareSet(r.port, '   ', clips.slice(0, 1));
    expect(r.album().title).toBe(DEFAULT_TITLE);
  });

  it('names a failed file and still sends the rest', async () => {
    const r = room(['b.ogg']);
    const res = await sendShareSet(r.port, 't', clips);
    expect(res.failed).toEqual(['b.ogg']);
    expect(res.sent).toBe(2);
    expect(r.album().files.map((f) => f.name)).toEqual(['a.ogg', 'c.txt']);
    // the next file falls back to the last event that exists, not to the failed one
    expect(r.events[2].content?.['m.relates_to']).toEqual(threadRelation('$e1', '$e2'));
  });

  it('throws when the root cannot be sent, uploading nothing', async () => {
    let uploads = 0;
    const port: SharePort<ShareFile> = {
      send: async () => {
        throw new Error('M_FORBIDDEN');
      },
      contentOf: async () => {
        uploads += 1;
        return {};
      },
    };
    await expect(sendShareSet(port, 't', clips)).rejects.toThrow('M_FORBIDDEN');
    expect(uploads).toBe(0);
  });
});

describe('the share flag', () => {
  it('ships off', () => {
    expect(config.fileZoneShare).toEqual({ enabled: false });
  });
});

describe('after a send', () => {
  it('keeps the failed one of two same-named files, not both', async () => {
    const twins: ShareFile[] = [
      { name: 'a.ogg', mimeType: 'audio/ogg' },
      { name: 'a.ogg', mimeType: 'audio/ogg' },
    ];
    let n = 0;
    const r = room();
    const port: SharePort<ShareFile> = {
      ...r.port,
      contentOf: async (f) => {
        n += 1;
        if (n === 2) throw new Error('second upload failed');
        return r.port.contentOf(f);
      },
    };
    const res = await sendShareSet(port, 't', twins);
    expect(res.failedAt).toEqual([1]);
    expect(remainingAfter(twins, res)).toEqual([twins[1]]);
  });

  it('keeps only the failed files picked, so a retry is one tap', async () => {
    const r = room(['b.ogg']);
    const res = await sendShareSet(r.port, 't', clips);
    expect(remainingAfter(clips, res).map((f) => f.name)).toEqual(['b.ogg']);
    expect(resultNote(res)).toBe('Shared 2. Not sent: b.ogg');
  });

  it('keeps everything and says nothing was shared when every upload failed', async () => {
    const r = room(clips.map((c) => c.name));
    const res = await sendShareSet(r.port, 't', clips);
    expect(remainingAfter(clips, res)).toEqual(clips);
    expect(resultNote(res)).toBe('Nothing was shared. Not sent: a.ogg, b.ogg, c.txt');
  });

  it('clears the pick on full success', async () => {
    const r = room();
    const res = await sendShareSet(r.port, 't', clips);
    expect(remainingAfter(clips, res)).toEqual([]);
    expect(resultNote(res)).toBe('Shared 3 files.');
  });
});
