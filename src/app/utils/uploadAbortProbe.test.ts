import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeComponentLifecycle,
  formatAbortStack,
  startAbortProbe,
  uploadContent,
  uploadFailure,
} from './matrix';

const chromeStack = [
  'Error',
  '    at wrapper (https://chat.example/assets/index-abc.js:1:100)',
  '    at https://chat.example/assets/index-abc.js:1:200',
  '    at Object.cb (https://chat.example/assets/vendor-def.js:7:8)',
  '    at https://chat.example/assets/a.js:2:3',
  '    at https://chat.example/assets/b.js:4:5',
  '    at https://chat.example/assets/c.js:6:7',
  '    at https://chat.example/assets/d.js:8:9',
  '    at https://chat.example/assets/e.js:10:11',
].join('\n');

describe('formatAbortStack', () => {
  it('keeps at most six frames as file:line:col, skipping the probe wrapper and the error line', () => {
    const out = formatAbortStack(chromeStack);
    const frames = out.split(' < ');
    expect(frames).toHaveLength(6);
    expect(frames[0]).toBe('index-abc.js:1:200');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('wrapper');
  });

  it('copes with an empty stack', () => {
    expect(formatAbortStack('')).toBe('no stack');
  });
});

describe('abort probe', () => {
  const original = AbortController.prototype.abort;

  afterEach(() => {
    vi.unstubAllGlobals();
    AbortController.prototype.abort = original;
  });

  it('records an AbortController.abort made while it runs, still aborts, and restores afterwards', () => {
    const probe = startAbortProbe();
    expect(AbortController.prototype.abort).not.toBe(original);
    const c = new AbortController();
    c.abort();
    expect(c.signal.aborted).toBe(true);
    probe.stop();
    expect(AbortController.prototype.abort).toBe(original);
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0].api).toBe('AbortController.abort');
  });

  it('records XMLHttpRequest.prototype.abort and restores it', () => {
    const xhrAbort = vi.fn();
    class FakeXhr {
      // eslint-disable-next-line class-methods-use-this
      abort() {
        xhrAbort();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const probe = startAbortProbe();
    new FakeXhr().abort();
    probe.stop();
    expect(xhrAbort).toHaveBeenCalledTimes(1);
    expect(probe.calls.map((c) => c.api)).toContain('XHR.abort');
    expect(FakeXhr.prototype.abort.toString()).not.toContain('collectors');
    const after = new FakeXhr();
    after.abort();
    expect(xhrAbort).toHaveBeenCalledTimes(2);
  });

  it('records nothing after stop', () => {
    const probe = startAbortProbe();
    probe.stop();
    new AbortController().abort();
    expect(probe.calls).toHaveLength(0);
  });

  it('keeps the wrapper until the last overlapping probe stops, then restores the original', () => {
    const a = startAbortProbe();
    const b = startAbortProbe();
    a.stop();
    new AbortController().abort();
    expect(b.calls).toHaveLength(1);
    expect(a.calls).toHaveLength(0);
    b.stop();
    expect(AbortController.prototype.abort).toBe(original);
  });

  it('restores the original when the upload attempt throws', async () => {
    const mx = { uploadContent: () => Promise.reject(new Error('boom')) } as any;
    await uploadContent(mx, new Blob(['x']), { onSuccess: vi.fn(), onError: vi.fn() });
    expect(AbortController.prototype.abort).toBe(original);
  });

  it('restores the original when uploadContent itself throws synchronously', async () => {
    const mx = {
      uploadContent: () => {
        throw new Error('sync');
      },
    } as any;
    await expect(
      uploadContent(mx, new Blob(['x']), { onSuccess: vi.fn(), onError: vi.fn() })
    ).rejects.toThrow('sync');
    expect(AbortController.prototype.abort).toBe(original);
  });
});

describe('failure text', () => {
  const abort = () => new DOMException('', 'AbortError');

  it('lists abort calls seen during the attempt', async () => {
    const mx = {
      uploadContent: () => {
        new AbortController().abort();
        return Promise.reject(abort());
      },
    } as any;
    const onError = vi.fn();
    await uploadContent(mx, new Blob(['x']), { onSuccess: vi.fn(), onError });
    // retried once: the final message carries the second attempt and attempt 1's summary
    const msg = onError.mock.calls[0][0].message;
    expect(msg).toContain('abort calls: AbortController.abort');
    expect(msg).toContain('retried (attempt 1: AbortError');
  });

  it('says none when nothing in the page called abort', async () => {
    const err = await uploadFailure(abort(), new Blob(['x']), {
      startedAt: Date.now(),
      aborts: [],
    });
    expect(err.message).toContain('abort calls: none');
  });

  it('reports the component lifecycle when given', async () => {
    const mx = { uploadContent: () => Promise.reject(new Error('Timeout')) } as any;
    const onError = vi.fn();
    await uploadContent(mx, new Blob(['x']), {
      onSuccess: vi.fn(),
      onError,
      describeLifecycle: () => 'component remounted 0x, renders 3 (2 within 300ms)',
    });
    expect(onError.mock.calls[0][0].message).toContain('renders 3 (2 within 300ms)');
  });
});

describe('describeComponentLifecycle', () => {
  it('counts renders after attach and those within 300ms, and reports an unmount', () => {
    const text = describeComponentLifecycle({
      attachedAt: 1000,
      rendersAtAttach: 1,
      renders: [990, 1100, 1250, 1400],
      unmountedAt: 1500,
    });
    expect(text).toBe('component: 3 renders since attach (2 within 300ms), unmounted +500ms');
  });

  it('says not unmounted when it was not', () => {
    const text = describeComponentLifecycle({
      attachedAt: 1000,
      rendersAtAttach: 1,
      renders: [990],
    });
    expect(text).toBe('component: 0 renders since attach (0 within 300ms), not unmounted');
  });
});
