import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import type { ClientConfig } from '../../hooks/useClientConfig';
import { ShareState } from './shareController';
import { ShareSetView, shareEnabled, useShareEnabled } from './ShareSet';

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const noop = () => undefined;
const file = (name: string) => ({ name, type: 'audio/ogg' } as File);

const view = (over: Partial<ShareState<File>> = {}, adding = false) =>
  renderToStaticMarkup(
    <ShareSetView
      state={{ files: [], title: '', phase: { kind: 'idle' }, epoch: 0, ...over }}
      onPickClick={noop}
      onPicked={noop}
      onTitle={noop}
      onSend={noop}
      onCancel={noop}
      adding={adding}
    />
  );

describe('the share panel, drawn', () => {
  it('idle: one "Share files" row and no title, names, Send or Cancel', () => {
    const html = view();
    expect(text(html)).toBe('Share files ›');
    expect(html).not.toContain('aria-label="Album title"');
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple');
    expect(html).toContain('hidden');
  });

  it('picked: the title field, the names on one line, Send N files and Cancel; no pick row', () => {
    const html = view({ files: [file('a.ogg'), file('b.ogg')] });
    expect(html).toContain('aria-label="Album title"');
    expect(html).toContain('placeholder="Shared files"');
    expect(text(html)).toBe('a.ogg · b.ogg Send 2 files Cancel');
    expect(text(html)).not.toContain('Share files');
  });

  it('one picked file reads "Send 1 file"', () => {
    expect(text(view({ files: [file('a.ogg')] }))).toContain('Send 1 file Cancel');
  });

  it('sending: progress replaces Send and Cancel, and the title is locked', () => {
    const html = view({
      files: [file('a'), file('b'), file('c')],
      phase: { kind: 'sending', done: 2 },
    });
    expect(text(html)).toContain('Sending 2 of 3…');
    expect(text(html)).not.toContain('Send 3 files');
    expect(text(html)).not.toContain('Cancel');
    expect(html).toMatch(
      /aria-label="Album title"[^>]*disabled|disabled[^>]*aria-label="Album title"/
    );
  });

  it('the encrypted note shows above the kept pick', () => {
    const html = view({
      files: [file('a.ogg')],
      phase: { kind: 'done', text: 'Not shared: this room is encrypted.' },
    });
    expect(text(html)).toBe('Not shared: this room is encrypted. a.ogg Send 1 file Cancel');
  });

  it('after a full success the idle row and the note show together', () => {
    expect(text(view({ phase: { kind: 'done', text: 'Shared 2 files.' } }))).toBe(
      'Share files › Shared 2 files.'
    );
  });
});

describe('adding to an existing album', () => {
  it('the idle row says Add files', () => {
    expect(text(view({}, true))).toBe('Add files ›');
  });

  it('picked: no title field, the names, Send and Cancel', () => {
    const html = view({ files: [file('a.ogg')] }, true);
    expect(html).not.toContain('aria-label="Album title"');
    expect(text(html)).toBe('a.ogg Send 1 file Cancel');
  });
});

describe('the flag', () => {
  it('off, missing or empty offers no share', () => {
    expect(shareEnabled({}, false)).toBe(false);
    expect(shareEnabled({ fileZoneShare: {} }, false)).toBe(false);
    expect(shareEnabled({ fileZoneShare: { enabled: false } }, false)).toBe(false);
  });

  it('on offers it, except in an encrypted room', () => {
    expect(shareEnabled({ fileZoneShare: { enabled: true } }, false)).toBe(true);
    expect(shareEnabled({ fileZoneShare: { enabled: true } }, true)).toBe(false);
  });

  it('the hook reads the client config and the room, as AlbumView mounts it', () => {
    const room = (encrypted: boolean) => ({ hasEncryptionStateEvent: () => encrypted } as never);
    function Probe({ encrypted }: { encrypted: boolean }) {
      return <span>{String(useShareEnabled(room(encrypted)))}</span>;
    }
    const probe = (config: ClientConfig, encrypted: boolean) =>
      text(
        renderToStaticMarkup(
          <ClientConfigProvider value={config}>
            <Probe encrypted={encrypted} />
          </ClientConfigProvider>
        )
      );
    expect(probe({}, false)).toBe('false');
    expect(probe({ fileZoneShare: { enabled: true } }, false)).toBe('true');
    expect(probe({ fileZoneShare: { enabled: true } }, true)).toBe('false');
  });
});
