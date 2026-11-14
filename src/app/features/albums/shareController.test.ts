import { describe, expect, it } from 'vitest';
import { Picked, ShareDeps, createShareController } from './shareController';
import { ShareResult } from './shareSet';

const file = (name: string, size?: number): Picked => ({ name, type: 'audio/ogg', size });
const MB = 1024 * 1024;
const ok = (n: number): ShareResult => ({ albumId: '$r', sent: n, failed: [], failedAt: [] });

/** A run the test settles by hand, so "in flight" is a state the test can stand in. */
const hand = () => {
  const calls: { files: Picked[]; title: string; onFile: () => void; signal: AbortSignal }[] = [];
  let release: (r: ShareResult) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  const run: ShareDeps<Picked>['run'] = (files, title, onFile, signal) => {
    calls.push({ files, title, onFile, signal });
    return new Promise<ShareResult>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
  };
  return { calls, run, release: (r: ShareResult) => release(r), fail: (e: Error) => fail(e) };
};

const make = (over: Partial<ShareDeps<Picked>> = {}, roomId = '!zone:x') => {
  const h = hand();
  const sentTo: string[] = [];
  const c = createShareController<Picked>({
    roomId,
    isEncrypted: () => false,
    run: h.run,
    onSent: () => sentTo.push(roomId),
    ...over,
  });
  return { c, h, sentTo };
};

describe('picking', () => {
  it('starts idle with nothing picked, and a pick holds the files in order', () => {
    const { c } = make();
    expect(c.getState().files).toEqual([]);
    expect(c.getState().phase).toEqual({ kind: 'idle' });
    c.pick([file('a'), file('b')]);
    expect(c.getState().files.map((f) => f.name)).toEqual(['a', 'b']);
  });

  it('Cancel empties the pick and the title and bumps the input epoch', () => {
    const { c } = make();
    c.pick([file('a')]);
    c.setTitle('Take 4');
    const before = c.getState().epoch;
    c.cancel();
    expect(c.getState()).toMatchObject({ files: [], title: '', epoch: before + 1 });
  });

  it('subscribers hear every change and stop hearing after unsubscribe', () => {
    const { c } = make();
    let heard = 0;
    const off = c.subscribe(() => {
      heard += 1;
    });
    c.pick([file('a')]);
    off();
    c.pick([]);
    expect(heard).toBe(1);
  });
});

describe('the Send guard', () => {
  it('a double tap starts one send', async () => {
    const { c, h } = make();
    c.pick([file('a'), file('b')]);
    const first = c.send();
    const second = c.send();
    expect(h.calls).toHaveLength(1);
    h.release(ok(2));
    await Promise.all([first, second]);
    expect(h.calls).toHaveLength(1);
  });

  it('a re-mounted panel for the same room cannot start a second send while one is in flight', async () => {
    const { c, h } = make();
    c.pick([file('a')]);
    const first = c.send();
    // The page was left and returned to: a new controller, nothing picked in it but a new pick.
    const again = make({}, '!zone:x');
    again.c.pick([file('b')]);
    await again.c.send();
    expect(again.h.calls).toHaveLength(0);
    h.release(ok(1));
    await first;
    // Once the first has settled the room is free again.
    const next = again.c.send();
    expect(again.h.calls).toHaveLength(1);
    again.h.release(ok(1));
    await next;
  });

  it('another room is not blocked by a send in flight', async () => {
    const a = make({}, '!a:x');
    const b = make({}, '!b:x');
    a.c.pick([file('a')]);
    b.c.pick([file('b')]);
    const sendA = a.c.send();
    const sendB = b.c.send();
    expect(b.h.calls).toHaveLength(1);
    a.h.release(ok(1));
    b.h.release(ok(1));
    await Promise.all([sendA, sendB]);
  });

  it('sends nothing when nothing is picked', async () => {
    const { c, h } = make();
    await c.send();
    expect(h.calls).toHaveLength(0);
  });

  it('a send that throws frees the room and says so', async () => {
    const { c, h } = make();
    c.pick([file('a')]);
    const p = c.send();
    h.fail(new Error('M_FORBIDDEN'));
    await p;
    expect(c.getState().phase).toEqual({ kind: 'done', text: 'Could not share: M_FORBIDDEN' });
    expect(c.getState().files).toHaveLength(1);
    const retry = c.send();
    expect(h.calls).toHaveLength(2);
    h.release(ok(1));
    await retry;
  });
});

describe('progress and results', () => {
  it('counts files as they settle, passing the title through', async () => {
    const { c, h } = make();
    c.pick([file('a'), file('b')]);
    c.setTitle('Take 4');
    const p = c.send();
    expect(c.getState().phase).toEqual({ kind: 'sending', done: 0 });
    expect(h.calls[0].title).toBe('Take 4');
    h.calls[0].onFile();
    expect(c.getState().phase).toEqual({ kind: 'sending', done: 1 });
    h.release(ok(2));
    await p;
    expect(c.getState().phase).toEqual({ kind: 'done', text: 'Shared 2 files.' });
  });

  it('full success clears the pick, tells the room list, and remounts the input', async () => {
    const { c, h, sentTo } = make();
    c.pick([file('a')]);
    const { epoch } = c.getState();
    const p = c.send();
    h.release(ok(1));
    await p;
    expect(c.getState()).toMatchObject({ files: [], title: '', epoch: epoch + 1 });
    expect(sentTo).toEqual(['!zone:x']);
  });

  it('failed files stay picked by position, so a same-named twin that went is not re-sent', async () => {
    const { c, h } = make();
    const twins = [file('a.ogg'), file('a.ogg'), file('b.ogg')];
    c.pick(twins);
    const p = c.send();
    h.release({ albumId: '$r', sent: 2, failed: ['a.ogg'], failedAt: [1] });
    await p;
    expect(c.getState().files).toEqual([twins[1]]);
    expect(c.getState().phase).toEqual({ kind: 'done', text: 'Shared 2. Not sent: a.ogg' });
  });

  it('when every upload failed everything stays picked and the note says nothing was shared', async () => {
    const { c, h } = make();
    const picked = [file('a'), file('b')];
    c.pick(picked);
    const p = c.send();
    h.release({ albumId: '$r', sent: 0, failed: ['a', 'b'], failedAt: [0, 1] });
    await p;
    expect(c.getState().files).toEqual(picked);
    expect(c.getState().phase).toEqual({
      kind: 'done',
      text: 'Nothing was shared. Not sent: a, b',
    });
  });

  it('a new pick after a result drops the result note', async () => {
    const { c, h } = make();
    c.pick([file('a')]);
    const p = c.send();
    h.release(ok(1));
    await p;
    c.pick([file('b')]);
    expect(c.getState().phase).toEqual({ kind: 'idle' });
  });
});

describe('what a send leaves behind', () => {
  it('keeps the title when some files failed, so the retry has the same name', async () => {
    const { c, h } = make();
    c.pick([file('a'), file('b')]);
    c.setTitle('Take 4');
    const p = c.send();
    h.release({ albumId: '$r', sent: 1, failed: ['b'], failedAt: [1] });
    await p;
    expect(c.getState().title).toBe('Take 4');
  });

  it('tells the room list only after the send settled, and not when it threw', async () => {
    const { c, h, sentTo } = make();
    c.pick([file('a')]);
    const p = c.send();
    expect(sentTo).toEqual([]);
    h.release(ok(1));
    await p;
    expect(sentTo).toEqual(['!zone:x']);

    const bad = make();
    bad.c.pick([file('a')]);
    const q = bad.c.send();
    bad.h.fail(new Error('boom'));
    await q;
    expect(bad.sentTo).toEqual([]);
  });

  it('a success lands in one notification: the pick is never empty while still sending', async () => {
    const { c, h } = make();
    c.pick([file('a')]);
    const p = c.send();
    const seen: string[] = [];
    c.subscribe(() => {
      const st = c.getState();
      seen.push(`${st.files.length}:${st.phase.kind}`);
    });
    h.release(ok(1));
    await p;
    expect(seen).toEqual(['0:done']);
  });
});

describe('an encrypted room', () => {
  it('says so, sends nothing and keeps the pick', async () => {
    const { c, h } = make({ isEncrypted: () => true });
    c.pick([file('a')]);
    await c.send();
    expect(c.getState().phase).toEqual({
      kind: 'done',
      text: 'Not shared: this room is encrypted.',
    });
    expect(c.getState().files).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });

  it('is checked at Send, not at mount: a room that turns encrypted after the pick is refused', async () => {
    let encrypted = false;
    const { c, h } = make({ isEncrypted: () => encrypted });
    c.pick([file('a')]);
    encrypted = true;
    await c.send();
    expect(h.calls).toHaveLength(0);
    expect(c.getState().phase).toMatchObject({
      kind: 'done',
      text: 'Not shared: this room is encrypted.',
    });
  });
});

describe('Stop', () => {
  it('aborts the signal of the send in flight, and only that send', async () => {
    const { c, h } = make();
    c.pick([file('a'), file('b')]);
    c.stop(); // nothing running: nothing to abort
    const sending = c.send();
    expect(h.calls[0].signal.aborted).toBe(false);
    c.stop();
    expect(h.calls[0].signal.aborted).toBe(true);
    h.release({ albumId: '$r', sent: 0, failed: ['a', 'b'], failedAt: [0, 1] });
    await sending;
    expect(c.getState().files.map((f) => f.name)).toEqual(['a', 'b']);
    // the next send gets a fresh signal
    const again = c.send();
    expect(h.calls[1].signal.aborted).toBe(false);
    h.release(ok(2));
    await again;
  });
});

describe('files over the homeserver cap', () => {
  const cap = 50 * MB;
  const capped = () => make({ maxBytes: () => cap });

  it('are named in the note and never sent; the rest go', async () => {
    const { c, h } = capped();
    c.pick([file('small.ogg', 3 * MB), file('film.mp4', 80 * MB), file('also.ogg', 1)]);
    const sent = c.send();
    expect(h.calls[0].files.map((f) => f.name)).toEqual(['small.ogg', 'also.ogg']);
    expect(c.getState().files.map((f) => f.name)).toEqual(['small.ogg', 'also.ogg']);
    h.release(ok(2));
    await sent;
    expect(c.getState().phase).toEqual({
      kind: 'done',
      text: 'Shared 2 files. Too large for this server (limit 50 MB): film.mp4',
    });
    expect(c.getState().files).toEqual([]);
  });

  it('are not kept for a retry that cannot help them, while a failed small file is', async () => {
    const { c, h } = capped();
    c.pick([file('a.ogg', 1), file('big.wav', 60 * MB)]);
    const sent = c.send();
    h.release({ albumId: '$r', sent: 0, failed: ['a.ogg'], failedAt: [0] });
    await sent;
    expect(c.getState().files.map((f) => f.name)).toEqual(['a.ogg']);
  });

  it('a pick that is all over the cap sends nothing: no run, so no album root, and the pick clears', async () => {
    const { c, h, sentTo } = capped();
    c.pick([file('a.mp4', 51 * MB), file('b.mp4', 99 * MB)]);
    const { epoch } = c.getState();
    await c.send();
    expect(h.calls).toHaveLength(0);
    expect(sentTo).toEqual([]);
    expect(c.getState()).toMatchObject({ files: [], epoch: epoch + 1 });
    expect(c.getState().phase).toEqual({
      kind: 'done',
      text: 'Nothing was shared. Too large for this server (limit 50 MB): a.mp4, b.mp4',
    });
  });

  it('a file of exactly the cap goes: the server refuses only what is larger', async () => {
    const { c, h } = capped();
    c.pick([file('edge.bin', cap)]);
    const sent = c.send();
    expect(h.calls[0].files).toHaveLength(1);
    h.release(ok(1));
    await sent;
  });

  it('the room is not held busy by an all-refused pick, so the next pick sends', async () => {
    const { c, h } = capped();
    c.pick([file('a.mp4', 99 * MB)]);
    await c.send();
    c.pick([file('b.ogg', 1)]);
    const sent = c.send();
    expect(h.calls).toHaveLength(1);
    h.release(ok(1));
    await sent;
  });

  it('a server that states no cap, or a file with no size, refuses nothing', async () => {
    const none = make();
    none.c.pick([file('a', 10 ** 12)]);
    const s1 = none.c.send();
    expect(none.h.calls[0].files).toHaveLength(1);
    none.h.release(ok(1));
    await s1;
    const unsized = make({ maxBytes: () => cap }, '!other:x');
    unsized.c.pick([file('b')]);
    const s2 = unsized.c.send();
    expect(unsized.h.calls[0].files).toHaveLength(1);
    unsized.h.release(ok(1));
    await s2;
  });

  it('a fractional cap reads with one decimal', async () => {
    const { c } = make({ maxBytes: () => 1.5 * MB });
    c.pick([file('a', 2 * MB)]);
    await c.send();
    expect(c.getState().phase).toMatchObject({ text: expect.stringContaining('limit 1.5 MB') });
  });

  it('a run that throws still names the refused files, which are not kept', async () => {
    const { c, h } = capped();
    c.pick([file('a.ogg', 1), file('big.wav', 60 * MB)]);
    const sent = c.send();
    h.fail(new Error('network down'));
    await sent;
    expect(c.getState().phase).toEqual({
      kind: 'done',
      text: 'Could not share: network down. Too large for this server (limit 50 MB): big.wav',
    });
    expect(c.getState().files.map((f) => f.name)).toEqual(['a.ogg']);
  });
});
