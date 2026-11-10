/* eslint-disable class-methods-use-this, @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars, no-unused-vars */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAbortProbe, uploadContent } from './matrix';

class FakeXhr extends EventTarget {
  upload = new EventTarget();

  readyState = 0;

  status = 0;

  open(_method: string, _url: string) {
    this.readyState = 1;
  }

  send() {
    this.readyState = 2;
  }

  abort() {}
}

const origOpen = FakeXhr.prototype.open;
const origSend = FakeXhr.prototype.send;
const uploadUrl =
  'https://matrix.example/_matrix/media/v3/upload?filename=a.jpg&access_token=SECRET';

describe('XHR probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXhr.prototype.open = origOpen;
    FakeXhr.prototype.send = origSend;
  });

  it('records which events an upload XHR fired and how it ended, without the query string', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const probe = startAbortProbe();
    const x = new FakeXhr();
    x.open('POST', uploadUrl);
    x.send();
    x.upload.dispatchEvent(new Event('loadstart'));
    x.upload.dispatchEvent(new Event('error'));
    x.dispatchEvent(new Event('error'));
    x.readyState = 4;
    x.status = 0;
    probe.stop();
    expect(probe.xhrs).toHaveLength(1);
    const text = probe.describeXhrs();
    expect(text).toContain('POST /_matrix/media/v3/upload');
    expect(text).toContain('readyState 4 status 0');
    expect(text).toContain('upload.loadstart');
    expect(text).toContain('upload.error');
    expect(text).toContain('error');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('access_token');
  });

  it('ignores XHRs that are not uploads', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const probe = startAbortProbe();
    const x = new FakeXhr();
    x.open('GET', 'https://matrix.example/_matrix/client/v3/sync');
    x.send();
    probe.stop();
    expect(probe.xhrs).toHaveLength(0);
    expect(probe.describeXhrs()).toBe('xhr: none seen');
  });

  it('still calls the real open and send and restores both afterwards', () => {
    const open = vi.fn();
    const send = vi.fn();
    FakeXhr.prototype.open = open;
    FakeXhr.prototype.send = send;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const probe = startAbortProbe();
    const x = new FakeXhr();
    x.open('POST', uploadUrl);
    x.send();
    expect(open).toHaveBeenCalledWith('POST', uploadUrl);
    expect(send).toHaveBeenCalledTimes(1);
    probe.stop();
    expect(FakeXhr.prototype.open).toBe(open);
    expect(FakeXhr.prototype.send).toBe(send);
  });

  it('records nothing for requests made after stop', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const probe = startAbortProbe();
    probe.stop();
    const x = new FakeXhr();
    x.open('POST', uploadUrl);
    x.send();
    expect(probe.xhrs).toHaveLength(0);
  });
});

describe('uploadContent in-memory copy and failure line', () => {
  const abort = () => new DOMException('', 'AbortError');

  it('uploads an in-memory copy with the same bytes, name and type, not the original', async () => {
    const file = new File(['abcdef'], 'a.jpg', { type: 'image/jpeg' });
    let sent: any;
    const mx = {
      uploadContent: vi.fn(async (f: any) => {
        sent = f;
        return { content_uri: 'mxc://a/b' };
      }),
    } as any;
    await uploadContent(mx, file, { onSuccess: vi.fn(), onError: vi.fn() });
    expect(sent).not.toBe(file);
    expect(sent.type).toBe('image/jpeg');
    expect(sent.name).toBe('a.jpg');
    expect(await sent.text()).toBe('abcdef');
  });

  it('copies again before the retry', async () => {
    const seen: any[] = [];
    const mx = {
      uploadContent: vi.fn((f: any) => {
        seen.push(f);
        return seen.length === 1
          ? Promise.reject(abort())
          : Promise.resolve({ content_uri: 'mxc://a/b' });
      }),
    } as any;
    await uploadContent(mx, new Blob(['xy']), { onSuccess: vi.fn(), onError: vi.fn() });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('reports an unreadable file and never starts the upload', async () => {
    const bad = new Blob(['x']);
    (bad as any).arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    const mx = { uploadContent: vi.fn() } as any;
    const onError = vi.fn();
    await uploadContent(mx, bad, { onSuccess: vi.fn(), onError });
    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain(
      'unreadable before upload (NotReadableError)'
    );
  });

  it('puts the XHR end state and signal.aborted in the failure line', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const mx = {
      uploadContent: () => {
        const x = new FakeXhr();
        x.open('POST', uploadUrl);
        x.send();
        x.upload.dispatchEvent(new Event('error'));
        x.readyState = 4;
        return Promise.reject(new Error('Timeout'));
      },
    } as any;
    const onError = vi.fn();
    await uploadContent(mx, new Blob(['x']), { onSuccess: vi.fn(), onError });
    const msg = onError.mock.calls[0][0].message;
    expect(msg).toContain('readyState 4 status 0');
    expect(msg).toContain('upload.error');
    expect(msg).toContain('signal.aborted false');
    vi.unstubAllGlobals();
  });
});
