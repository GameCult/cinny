import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadContent } from './matrix';

const abort = () => new DOMException('', 'AbortError');
const blob = new Blob(['abcd'], { type: 'image/jpeg' });

type Step = (opts: any) => Promise<any>;
const fakeMx = (steps: Step[]) => {
  const calls: any[] = [];
  const mx = {
    uploadContent: vi.fn((_file: unknown, opts: any) => {
      calls.push(opts);
      return steps[calls.length - 1](opts);
    }),
  };
  return { mx: mx as any, calls };
};
const run = async (mx: any) => {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onPromise = vi.fn();
  await uploadContent(mx, blob, { onSuccess, onError, onPromise });
  return { onSuccess, onError, onPromise };
};

describe('uploadContent retry', () => {
  afterEach(() => vi.useRealTimers());

  it('retries once when the first attempt aborts at once with no progress', async () => {
    const { mx } = fakeMx([
      () => Promise.reject(abort()),
      async () => ({ content_uri: 'mxc://a/b' }),
    ]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(2);
    expect(r.onSuccess).toHaveBeenCalledWith('mxc://a/b');
    expect(r.onError).not.toHaveBeenCalled();
    expect(r.onPromise).toHaveBeenCalledTimes(2);
  });

  it('retries at most once and reports both attempts when the retry fails too', async () => {
    const { mx } = fakeMx([() => Promise.reject(abort()), () => Promise.reject(abort())]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(2);
    const msg = r.onError.mock.calls[0][0].message;
    expect(msg).toContain('retried');
    expect(msg).toContain('attempt 1: AbortError');
    expect(msg).toContain('no progress');
  });

  it('never retries after a progress event', async () => {
    const { mx } = fakeMx([
      (opts) => {
        opts.progressHandler({ loaded: 10, total: 100 });
        return Promise.reject(abort());
      },
      async () => ({ content_uri: 'mxc://a/b' }),
    ]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(1);
    expect(r.onError).toHaveBeenCalledTimes(1);
    expect(r.onError.mock.calls[0][0].message).not.toContain('retried');
  });

  it('never retries after the user cancelled', async () => {
    const { mx } = fakeMx([
      (opts) => {
        opts.abortController.abort();
        return Promise.reject(abort());
      },
      async () => ({ content_uri: 'mxc://a/b' }),
    ]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(1);
    expect(r.onError).toHaveBeenCalledTimes(1);
  });

  it('never retries an error that is not an abort', async () => {
    const { mx } = fakeMx([() => Promise.reject(new Error('Timeout')), async () => ({})]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(1);
    expect(r.onError).toHaveBeenCalledTimes(1);
  });

  it('never retries an abort that took three seconds or more', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { mx } = fakeMx([
      () => {
        vi.setSystemTime(3000);
        return Promise.reject(abort());
      },
      async () => ({ content_uri: 'mxc://a/b' }),
    ]);
    const r = await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(1);
    expect(r.onError).toHaveBeenCalledTimes(1);
  });

  it('retries the same abort at 2999ms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { mx } = fakeMx([
      () => {
        vi.setSystemTime(2999);
        return Promise.reject(abort());
      },
      async () => ({ content_uri: 'mxc://a/b' }),
    ]);
    await run(mx);
    expect(mx.uploadContent).toHaveBeenCalledTimes(2);
  });
});
