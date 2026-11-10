import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteUserActivity, uploadFailure } from './matrix';

const abort = () => new DOMException('', 'AbortError');

describe('uploadFailure', () => {
  it('keeps the error name as errcode, never the message', async () => {
    const err = await uploadFailure(abort(), new Blob(['abc'], { type: 'image/png' }));
    expect(err.errcode).toBe('AbortError');
  });

  it('never reduces an empty-message error to "Unknown message"', async () => {
    const err = await uploadFailure(abort(), new Blob(['abc']));
    expect(err.message).not.toContain('Unknown message');
    expect(err.message).toContain('AbortError');
  });

  it('reports size and type of the file', async () => {
    const err = await uploadFailure(abort(), new Blob(['abcd'], { type: 'image/png' }));
    expect(err.message).toContain('4 bytes');
    expect(err.message).toContain('image/png');
  });

  it('keeps the original error as cause', async () => {
    const e = abort();
    const err = await uploadFailure(e, new Blob(['x']));
    expect((err as any).cause).toBe(e);
  });

  it('says whether the browser could still read the file', async () => {
    const ok = await uploadFailure(abort(), new Blob(['x']));
    expect(ok.message).toContain('file readable');
    const bad = new Blob(['x']);
    (bad as any).arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    const err = await uploadFailure(abort(), bad);
    expect(err.message).toContain('file unreadable (NotReadableError)');
  });

  it('keeps a real message when the error has one', async () => {
    const err = await uploadFailure(new Error('Timeout'), new Blob(['x']));
    expect(err.message).toContain('Timeout');
    expect(err.errcode).toBe('Error');
  });
});

describe('uploadFailure client trace', () => {
  const blob = new Blob(['abcd'], { type: 'image/jpeg' });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports connectivity, visibility and idle time at the moment of failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal('navigator', {
      onLine: false,
      connection: { effectiveType: '3g', rtt: 300, downlink: 1.5, saveData: true },
    });
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    noteUserActivity();
    vi.setSystemTime(13_000);
    const err = await uploadFailure(abort(), blob, { startedAt: 12_000 });
    expect(err.message).toContain('offline');
    expect(err.message).toContain('3g rtt 300ms down 1.5Mbps saveData on');
    expect(err.message).toContain('tab hidden');
    expect(err.message).toContain('idle 3000ms');
    expect(err.message).toContain('failed after 1000ms');
  });

  it('says so when no progress event ever arrived', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const err = await uploadFailure(abort(), blob, { startedAt: 4_000 });
    expect(err.message).toContain('no progress');
  });

  it('reports time to first progress and bytes loaded when some arrived', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000);
    const err = await uploadFailure(abort(), blob, {
      startedAt: 5_000,
      firstProgressAt: 5_120,
      loaded: 65536,
      total: 700000,
    });
    expect(err.message).toContain('first progress 120ms');
    expect(err.message).toContain('65536/700000B');
    expect(err.message).toContain('failed after 4000ms');
  });

  it('copes with a browser that has no connection info or document', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('document', undefined);
    const err = await uploadFailure(abort(), blob, { startedAt: Date.now() });
    expect(err.message).toContain('online');
    expect(err.message).toContain('net n/a');
  });
});
