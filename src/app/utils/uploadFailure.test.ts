import { describe, expect, it } from 'vitest';
import { uploadFailure } from './matrix';

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
