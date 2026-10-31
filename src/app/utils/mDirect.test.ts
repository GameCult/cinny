import { describe, expect, it } from 'vitest';
import { addRoomIdToMDirect, removeRoomIdFromMDirect } from './matrix';

type Content = Record<string, string[]>;

/** A client whose account-data write takes a while and lands only when it completes. */
const fakeClient = (initial?: Content) => {
  let direct: Content | undefined = initial;
  const writes: Content[] = [];
  const mx = {
    getAccountData: () => (direct ? { getContent: () => direct } : undefined),
    setAccountData: async (_type: string, content: Content) => {
      await new Promise((r) => {
        setTimeout(r, 5);
      });
      writes.push(structuredClone(content));
      direct = structuredClone(content);
    },
  };
  return { mx: mx as never, writes, current: () => direct };
};

describe('m.direct edits', () => {
  it('moves a room between users and removes it, one write at a time', async () => {
    const c = fakeClient({ '@a:test': ['!r:test'] });
    await Promise.all([
      addRoomIdToMDirect(c.mx, '!r:test', '@b:test'),
      removeRoomIdFromMDirect(c.mx, '!gone:test'),
    ]);
    expect(c.current()).toEqual({ '@a:test': [], '@b:test': ['!r:test'] });
    await removeRoomIdFromMDirect(c.mx, '!r:test');
    expect(c.current()).toEqual({ '@a:test': [], '@b:test': [] });
  });

  it('serializes overlapping edits so each builds on the content the last one wrote', async () => {
    const c = fakeClient();
    await Promise.all([
      addRoomIdToMDirect(c.mx, '!dm2:test', '@friend:test'),
      addRoomIdToMDirect(c.mx, '!dm3:test', '@friend:test'),
      addRoomIdToMDirect(c.mx, '!dm4:test', '@other:test'),
    ]);
    expect(c.current()).toEqual({
      '@friend:test': ['!dm2:test', '!dm3:test'],
      '@other:test': ['!dm4:test'],
    });
    expect(c.writes).toHaveLength(3);
  });

  it('keeps going after a failed write', async () => {
    const c = fakeClient();
    const raw = c.mx as unknown as { setAccountData: (t: string, x: Content) => Promise<void> };
    const original = raw.setAccountData;
    raw.setAccountData = async () => {
      raw.setAccountData = original;
      throw new Error('offline');
    };
    await expect(addRoomIdToMDirect(c.mx, '!a:test', '@f:test')).rejects.toThrow('offline');
    await addRoomIdToMDirect(c.mx, '!a:test', '@f:test');
    expect(c.current()).toEqual({ '@f:test': ['!a:test'] });
  });
});
