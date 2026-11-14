import { describe, expect, it } from 'vitest';
import config from '../../../../config.json';
import { ZoneEvent, buildAlbums } from './buildAlbums';
import {
  DEFAULT_TITLE,
  ShareFile,
  SharePort,
  CANCELLED,
  freshest,
  refusalOf,
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
    expect(res).toEqual({ albumId: '$e1', sent: 3, failed: [], failedAt: [], reasons: [] });
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

describe('adding to an existing album', () => {
  it('sends no root; each file threads under the album, the first after `lastId`', async () => {
    const r = room();
    const sent: Record<string, unknown>[] = [];
    const port = {
      ...r.port,
      send: async (c: Record<string, unknown>) => {
        sent.push(c);
        return `$n${sent.length}`;
      },
    };
    const res = await sendShareSet(
      port,
      { albumId: '$root', lastId: '$last', lastTs: 1 },
      clips.slice(0, 2)
    );
    expect(res.albumId).toBe('$root');
    expect(res.sent).toBe(2);
    expect(sent.map((c) => c.msgtype)).toEqual(['m.audio', 'm.audio']);
    expect(sent.map((c) => c['m.relates_to'])).toEqual([
      threadRelation('$root', '$last'),
      threadRelation('$root', '$n1'),
    ]);
  });
});

describe('refusals', () => {
  const refuse = (errcode: string): SharePort<ShareFile> => ({
    send: async () => '$e',
    contentOf: async () => {
      throw Object.assign(new Error('raw server text'), { errcode });
    },
  });

  it('names the three upload refusals and nothing else', () => {
    expect(refusalOf({ errcode: 'M_TOO_LARGE' })).toBe('too large for this server');
    expect(refusalOf({ errcode: 'M_FORBIDDEN' })).toBe('not allowed to upload here');
    expect(refusalOf({ errcode: 'M_LIMIT_EXCEEDED' })).toBe(
      'uploading too fast, try again shortly'
    );
    expect(refusalOf({ errcode: 'M_UNKNOWN' })).toBeUndefined();
    expect(refusalOf({ errcode: 'constructor' })).toBeUndefined();
    expect(refusalOf(new Error('x'))).toBeUndefined();
    expect(refusalOf(null)).toBeUndefined();
  });

  it('the note carries the reason beside each refused file', async () => {
    const res = await sendShareSet(refuse('M_TOO_LARGE'), 't', clips.slice(0, 2));
    expect(resultNote(res)).toBe(
      'Nothing was shared. Not sent: a.ogg (too large for this server), b.ogg (too large for this server)'
    );
  });

  it('a failure the client saw, not the server, is named too', async () => {
    const dropped: SharePort<ShareFile> = {
      send: async () => '$e',
      contentOf: async () => {
        throw Object.assign(new Error('x'), {
          errcode: 'AbortError',
          info: { aborted: true, progressed: true },
        });
      },
    };
    const res = await sendShareSet(dropped, 't', clips.slice(0, 1));
    expect(resultNote(res)).toBe(
      'Nothing was shared. Not sent: a.ogg (the connection dropped partway through)'
    );
  });

  it('an unnamed failure lists the bare name', async () => {
    const res = await sendShareSet(refuse('M_UNKNOWN'), 't', clips.slice(0, 1));
    expect(resultNote(res)).toBe('Nothing was shared. Not sent: a.ogg');
  });
});

describe('stopping a send', () => {
  /** A port whose upload of `stopAt` aborts the signal as it runs, as the Stop button does mid-upload. */
  const stopping = (stopAt: string, abortAfterUpload = false) => {
    const ac = new AbortController();
    const r = room();
    const port: SharePort<ShareFile> = {
      ...r.port,
      signal: ac.signal,
      contentOf: async (f) => {
        if (f.name !== stopAt) return r.port.contentOf(f);
        ac.abort();
        if (abortAfterUpload) return r.port.contentOf(f);
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    };
    return { port, r };
  };

  it('an upload aborted mid-file leaves that file and the rest unsent, named as stopped', async () => {
    const { port, r } = stopping('b.ogg');
    const res = await sendShareSet(port, 't', clips);
    expect(res.sent).toBe(1);
    expect(res.failed).toEqual(['b.ogg', 'c.txt']);
    expect(res.failedAt).toEqual([1, 2]);
    expect(res.reasons).toEqual([CANCELLED, CANCELLED]);
    expect(r.album().files.map((f) => f.name)).toEqual(['a.ogg']);
    expect(remainingAfter(clips, res).map((f) => f.name)).toEqual(['b.ogg', 'c.txt']);
    expect(resultNote(res)).toBe('Shared 1. Not sent: b.ogg (stopped), c.txt (stopped)');
  });

  it('a file whose upload finished after the stop is not sent', async () => {
    const { port, r } = stopping('b.ogg', true);
    const res = await sendShareSet(port, 't', clips);
    expect(res.sent).toBe(1);
    expect(res.failedAt).toEqual([1, 2]);
    expect(r.album().files.map((f) => f.name)).toEqual(['a.ogg']);
  });

  it('a signal already aborted starts nothing and sends everything back as unsent', async () => {
    const r = room();
    const ac = new AbortController();
    ac.abort();
    let uploads = 0;
    const res = await sendShareSet(
      {
        ...r.port,
        signal: ac.signal,
        contentOf: async (f) => {
          uploads += 1;
          return r.port.contentOf(f);
        },
      },
      { albumId: '$a', lastId: '$l', lastTs: 1 },
      clips
    );
    expect(uploads).toBe(0);
    expect(res.sent).toBe(0);
    expect(res.failedAt).toEqual([0, 1, 2]);
    expect(r.events).toEqual([]);
  });

  it('an abort that is not a stop is an ordinary failure', async () => {
    const r = room(['b.ogg']);
    const res = await sendShareSet({ ...r.port, signal: new AbortController().signal }, 't', clips);
    expect(res.failedAt).toEqual([1]);
    expect(res.reasons).toEqual([undefined]);
  });
});

describe('freshest', () => {
  const album = { albumId: '$alb', lastId: '$old', lastTs: 100 };
  it('moves lastId to a newer event of the same thread', () => {
    expect(
      freshest(album, [
        { id: '$mid', ts: 150, threadRoot: '$alb' },
        { id: '$new', ts: 200, threadRoot: '$alb' },
      ])
    ).toEqual({ albumId: '$alb', lastId: '$new', lastTs: 200 });
  });
  it('ignores older events and events of other threads or none', () => {
    expect(
      freshest(album, [
        { id: '$older', ts: 50, threadRoot: '$alb' },
        { id: '$other', ts: 900, threadRoot: '$else' },
        { id: '$loose', ts: 900 },
      ])
    ).toEqual(album);
  });
});
