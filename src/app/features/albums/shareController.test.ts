import { describe, expect, it } from 'vitest';
import { ENCRYPTED_NOTE, Picked, ShareDeps, createShareController } from './shareController';
import { ShareResult } from './shareSet';

const file = (name: string): Picked => ({ name, type: 'audio/ogg' });
const ok = (n: number): ShareResult => ({ albumId: '$r', sent: n, failed: [], failedAt: [] });

/** A run the test settles by hand, so "in flight" is a state the test can stand in. */
const hand = () => {
  const calls: { files: Picked[]; title: string; onFile: () => void }[] = [];
  let release: (r: ShareResult) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  const run: ShareDeps<Picked>['run'] = (files, title, onFile) => {
    calls.push({ files, title, onFile });
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

const tick = () => new Promise((r) => setTimeout(r, 0));

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
    const epoch = c.getState().epoch;
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

describe('an encrypted room', () => {
  it('says so, sends nothing and keeps the pick', async () => {
    const { c, h } = make({ isEncrypted: () => true });
    c.pick([file('a')]);
    await c.send();
    await tick();
    expect(ENCRYPTED_NOTE).toBe('Not shared: this room is encrypted.');
    expect(c.getState().phase).toEqual({ kind: 'done', text: ENCRYPTED_NOTE });
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
    expect(c.getState().phase).toMatchObject({ kind: 'done', text: ENCRYPTED_NOTE });
  });
});
