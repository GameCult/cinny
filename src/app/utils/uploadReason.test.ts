import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadContent, uploadFailure } from './matrix';
import { uploadFailureText, uploadReason } from './uploadReason';

// What a person reads, from failures built the way the app builds them: through uploadFailure and
// uploadContent, not by hand-made info objects.
const abort = () => new DOMException('', 'AbortError');
const blob = new Blob(['abcd'], { type: 'image/jpeg' });
const textOf = async (e: unknown, trace = { startedAt: Date.now() } as any, file: Blob = blob) =>
  uploadFailureText(await uploadFailure(e, file, trace));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the sender is told when an upload fails', () => {
  it('a drop before any byte left says the file never started, and to send again', async () => {
    expect(await textOf(abort())).toBe(
      'Upload failed: the connection dropped before the file started. Send again.'
    );
  });

  it('a drop after progress says partway through and points at Wi-Fi', async () => {
    const text = await textOf(abort(), { startedAt: 1, firstProgressAt: 5, loaded: 2, total: 4 });
    expect(text).toContain('dropped partway through');
    expect(text).toContain('Wi-Fi');
  });

  it('a drop with the tab in the background says to keep the tab open', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    expect(await textOf(abort())).toContain('Keep this tab open');
  });

  it('offline outranks the drop it caused', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await textOf(abort())).toBe('Upload failed: you are offline. Reconnect and send again.');
  });

  it('a file the browser can no longer read says to pick it again', async () => {
    const gone = new Blob(['x']);
    (gone as any).arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    expect(await textOf(abort(), undefined, gone)).toContain('can no longer read the file');
  });

  it('a stopped upload says stopped, not that the connection failed', async () => {
    const text = await textOf(abort(), { startedAt: 1, signalAborted: true });
    expect(text).toBe('Upload failed: stopped. Send it again when you are ready.');
  });

  it('a homeserver refusal says what the server said in words, with what to do', () => {
    expect(uploadFailureText({ errcode: 'M_TOO_LARGE' })).toBe(
      'Upload failed: too large for this server. Pick a smaller file.'
    );
    expect(uploadFailureText({ errcode: 'M_FORBIDDEN' })).toContain('Ask a steward');
    expect(uploadFailureText({ errcode: 'M_LIMIT_EXCEEDED' })).toContain('Wait a moment');
  });

  it('a failure we cannot name stays generic and sends the sender to the details', async () => {
    const text = await textOf(new Error('Timeout'));
    expect(text).toBe(
      'Upload failed. Send again; if it keeps failing, show the details below to a steward.'
    );
    expect(uploadReason({ errcode: 'constructor' })).toBeUndefined();
    expect(uploadReason(null)).toBeUndefined();
  });

  it('the long diagnostic text is still on the error for the details', async () => {
    const err = await uploadFailure(abort(), blob, { startedAt: Date.now() });
    expect(err.message).toContain('4 bytes');
    expect(err.message).toContain('no progress');
  });
});

describe('through uploadContent, as the composer and the share panel call it', () => {
  it('an unreadable picked file is named before any request', async () => {
    const bad = new Blob(['x']);
    (bad as any).arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    const mx = { uploadContent: vi.fn() } as any;
    const onError = vi.fn();
    await uploadContent(mx, bad, { onSuccess: vi.fn(), onError });
    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(uploadFailureText(onError.mock.calls[0][0])).toContain('can no longer read the file');
  });

  it('a request that dies is told as a drop', async () => {
    const mx = { uploadContent: () => Promise.reject(abort()) } as any;
    const onError = vi.fn();
    await uploadContent(mx, blob, { onSuccess: vi.fn(), onError });
    expect(uploadFailureText(onError.mock.calls[0][0])).toContain('the connection dropped');
  });

  it('a server that refuses keeps its errcode and is told in words', async () => {
    const mx = {
      uploadContent: () =>
        Promise.reject(Object.assign(new Error('x'), { errcode: 'M_TOO_LARGE' })),
    } as any;
    const onError = vi.fn();
    await uploadContent(mx, blob, { onSuccess: vi.fn(), onError });
    expect(onError.mock.calls[0][0].errcode).toBe('M_TOO_LARGE');
    expect(uploadFailureText(onError.mock.calls[0][0])).toBe(
      'Upload failed: too large for this server. Pick a smaller file.'
    );
  });
});
