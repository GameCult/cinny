import { describe, expect, it } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { setFallbackSession, getFallbackSession } from './sessions';
import {
  beginSoftLogout,
  classifyLogout,
  clearSoftLogout,
  createLogoutHandler,
  settleLocalData,
  decideLoginOutcome,
  getSoftLogout,
  setSoftLogout,
  withSoftLogoutDevice,
} from './softLogout';

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, String(v));
    },
  };
};

const record = { userId: '@a:hs', deviceId: 'DEV' };

describe('classifyLogout', () => {
  it('is soft only for soft_logout === true', () => {
    expect(classifyLogout(new MatrixError({ errcode: 'M_UNKNOWN_TOKEN', soft_logout: true }))).toBe(
      'soft'
    );
    expect(classifyLogout({ data: { soft_logout: true } })).toBe('soft');
  });
  it('is hard for false, absent, string-ish, and non-MatrixError values', () => {
    expect(
      classifyLogout(new MatrixError({ errcode: 'M_UNKNOWN_TOKEN', soft_logout: false }))
    ).toBe('hard');
    expect(classifyLogout(new MatrixError({ errcode: 'M_UNKNOWN_TOKEN' }))).toBe('hard');
    expect(classifyLogout({ data: { soft_logout: 'true' } })).toBe('hard');
    expect(classifyLogout(undefined)).toBe('hard');
    expect(classifyLogout(null)).toBe('hard');
    expect(classifyLogout('boom')).toBe('hard');
    expect(classifyLogout(new Error('x'))).toBe('hard');
  });
});

describe('the soft logout record', () => {
  it('round-trips and clears', () => {
    const s = memoryStorage();
    expect(getSoftLogout(s)).toBeUndefined();
    setSoftLogout(record, s);
    expect(getSoftLogout(s)).toEqual(record);
    clearSoftLogout(s);
    expect(getSoftLogout(s)).toBeUndefined();
  });
  it('treats garbage and partial records as absent', () => {
    const s = memoryStorage();
    s.setItem('ratatoskr_soft_logout', 'not json');
    expect(getSoftLogout(s)).toBeUndefined();
    s.setItem('ratatoskr_soft_logout', JSON.stringify({ userId: '@a:hs', deviceId: '' }));
    expect(getSoftLogout(s)).toBeUndefined();
  });
});

describe('beginSoftLogout', () => {
  it('keeps the device keys and the record, drops only the access token', () => {
    const s = memoryStorage();
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true });
    try {
      setFallbackSession('tok', 'DEV', '@a:hs', 'https://hs.example');
      s.setItem('other_key', 'kept');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
    expect(beginSoftLogout(s)).toBe(true);
    expect(getFallbackSession(s)).toBeUndefined();
    expect(s.getItem('cinny_access_token')).toBeNull();
    expect(s.getItem('cinny_device_id')).toBe('DEV');
    expect(s.getItem('other_key')).toBe('kept');
    expect(getSoftLogout(s)).toEqual(record);
  });
  it('does nothing without a session', () => {
    const s = memoryStorage();
    expect(beginSoftLogout(s)).toBe(false);
    expect(getSoftLogout(s)).toBeUndefined();
  });
});

describe('withSoftLogoutDevice', () => {
  const req = { type: 'm.login.password', password: 'p' } as const;
  it('asks for the recorded device on password and token requests alike', () => {
    expect(withSoftLogoutDevice(req, record)).toEqual({ ...req, device_id: 'DEV' });
    const tok = { type: 'm.login.token', token: 't' };
    expect(withSoftLogoutDevice(tok, record)).toEqual({ ...tok, device_id: 'DEV' });
  });
  it('leaves the request alone without a record', () => {
    expect(withSoftLogoutDevice(req, undefined)).toBe(req);
  });
});

describe('decideLoginOutcome', () => {
  it('is plain without a record', () => {
    expect(decideLoginOutcome(undefined, { user_id: '@a:hs', device_id: 'DEV' })).toBe('plain');
  });
  it('keeps for the same user and device', () => {
    expect(decideLoginOutcome(record, { user_id: '@a:hs', device_id: 'DEV' })).toBe('keep');
  });
  it('wipes for another user or another device', () => {
    expect(decideLoginOutcome(record, { user_id: '@b:hs', device_id: 'DEV' })).toBe('wipe');
    expect(decideLoginOutcome(record, { user_id: '@a:hs', device_id: 'NEW' })).toBe('wipe');
  });
});

describe('the logout handler', () => {
  const rig = (soft: boolean) => {
    const storage = memoryStorage();
    storage.setItem('cinny_access_token', 'tok');
    storage.setItem('cinny_device_id', 'DEV');
    storage.setItem('cinny_user_id', '@a:hs');
    storage.setItem('cinny_hs_base_url', 'https://hs.example');
    const calls = { stop: 0, wipe: 0, reload: 0, worker: 0 };
    const handler = createLogoutHandler({
      storage,
      stop: () => {
        calls.stop += 1;
      },
      wipe: async () => {
        calls.wipe += 1;
      },
      reload: () => {
        calls.reload += 1;
      },
      forgetSessionInWorker: () => {
        calls.worker += 1;
      },
    });
    const err = { data: { soft_logout: soft } };
    return { storage, calls, handler, err };
  };

  it('soft twice: one begin, no wipe, record kept', async () => {
    const { storage, calls, handler, err } = rig(true);
    await handler(err);
    await handler(err);
    expect(calls).toEqual({ stop: 1, wipe: 0, reload: 1, worker: 1 });
    expect(getSoftLogout(storage)).toEqual(record);
    expect(storage.getItem('cinny_device_id')).toBe('DEV');
  });
  it('soft then hard: the later event does not wipe', async () => {
    const { calls, handler } = rig(true);
    await handler({ data: { soft_logout: true } });
    await handler({ data: {} });
    expect(calls.wipe).toBe(0);
  });
  it('a record already standing swallows a fresh handler too', async () => {
    const { storage, calls, handler } = rig(false);
    setSoftLogout(record, storage);
    await handler({ data: {} });
    expect(calls).toEqual({ stop: 0, wipe: 0, reload: 0, worker: 0 });
  });
  it('hard twice: one wipe', async () => {
    const { calls, handler, err } = rig(false);
    await handler(err);
    await handler(err);
    expect(calls).toEqual({ stop: 1, wipe: 1, reload: 1, worker: 0 });
  });
});

describe('settleLocalData', () => {
  const run = async (
    rec: typeof record | undefined,
    res: { user_id: string; device_id: string }
  ) => {
    const s = memoryStorage();
    if (rec) setSoftLogout(rec, s);
    let wipes = 0;
    const outcome = await settleLocalData(
      res,
      async () => {
        wipes += 1;
      },
      s
    );
    return { outcome, wipes, left: getSoftLogout(s) };
  };
  it('same user and device: keep stores, retire the record', async () => {
    expect(await run(record, { user_id: '@a:hs', device_id: 'DEV' })).toEqual({
      outcome: 'keep',
      wipes: 0,
      left: undefined,
    });
  });
  it('another user or device (a new account too): wipe once, retire the record', async () => {
    expect(await run(record, { user_id: '@new:hs', device_id: 'X' })).toEqual({
      outcome: 'wipe',
      wipes: 1,
      left: undefined,
    });
    expect((await run(record, { user_id: '@a:hs', device_id: 'OTHER' })).wipes).toBe(1);
  });
  it('no record: plain, no wipe', async () => {
    expect((await run(undefined, { user_id: '@a:hs', device_id: 'D' })).wipes).toBe(0);
  });
});
