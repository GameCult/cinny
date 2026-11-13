import { describe, expect, it } from 'vitest';
import { KNOWN_DATABASES, wipeLocalData } from './wipeLocalData';

type Mode = 'success' | 'blocked' | 'error' | 'throws';

const rig = (opts: { databases?: () => Promise<{ name?: string }[]>; mode?: Mode }) => {
  const deleted: string[] = [];
  let cleared = 0;
  const indexedDB = {
    databases: opts.databases,
    deleteDatabase: (name: string) => {
      deleted.push(name);
      if (opts.mode === 'throws') throw new Error('sync boom');
      const req: Record<string, (() => void) | undefined> = {};
      setTimeout(() => {
        if (opts.mode === 'blocked') req.onblocked?.();
        else if (opts.mode === 'error') req.onerror?.();
        else req.onsuccess?.();
      }, 0);
      return req as unknown as IDBOpenDBRequest;
    },
  };
  const storage = {
    clear: () => {
      cleared += 1;
    },
  };
  return { deleted, cleared: () => cleared, ports: { indexedDB, storage } };
};

describe('wipeLocalData', () => {
  it('deletes every listed database and clears storage', async () => {
    const r = rig({ databases: async () => [{ name: 'a' }, { name: 'b' }, {}] });
    await wipeLocalData(undefined, r.ports);
    expect(r.deleted).toEqual(['a', 'b']);
    expect(r.cleared()).toBe(1);
  });
  it('falls back to the known names when databases() is absent or throws', async () => {
    const absent = rig({});
    await wipeLocalData(undefined, absent.ports);
    expect(absent.deleted).toEqual(KNOWN_DATABASES);
    expect(absent.cleared()).toBe(1);
    const throws = rig({
      databases: async () => {
        throw new Error('nope');
      },
    });
    await wipeLocalData(undefined, throws.ports);
    expect(throws.deleted).toEqual(KNOWN_DATABASES);
    expect(throws.cleared()).toBe(1);
  });
  it('a synchronous deleteDatabase throw does not abort the rest or the storage clear', async () => {
    const r = rig({ databases: async () => [{ name: 'a' }, { name: 'b' }], mode: 'throws' });
    await expect(wipeLocalData(undefined, r.ports)).resolves.toBeUndefined();
    expect(r.deleted).toEqual(['a', 'b']);
    expect(r.cleared()).toBe(1);
  });
  it('blocked and errored deletions settle and still clear storage', async () => {
    await Promise.all(
      (['blocked', 'error'] as const).map(async (mode) => {
        const r = rig({ databases: async () => [{ name: 'a' }], mode });
        await wipeLocalData(undefined, r.ports);
        expect(r.cleared()).toBe(1);
      })
    );
  });
  it('a throwing clearStores does not stop the wipe', async () => {
    const r = rig({ databases: async () => [{ name: 'a' }] });
    const mx = {
      clearStores: async () => {
        throw new Error('x');
      },
    };
    await wipeLocalData(mx as never, r.ports);
    expect(r.deleted).toEqual(['a']);
    expect(r.cleared()).toBe(1);
  });
});
