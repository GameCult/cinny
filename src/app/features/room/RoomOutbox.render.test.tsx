import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOutbox, failOutbox } from '../../state/room/composerStore';
import { RoomOutbox } from './RoomOutbox';

// What the person sees under the timeline for sends the server has not confirmed.
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('RoomOutbox as rendered', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mx = { getUserId: () => '@a:x' } as never;
  const entry = (txnId: string, roomId: string, body: string) => ({
    txnId,
    roomId,
    content: { body },
  });

  it('renders nothing when the room has no unconfirmed sends', () => {
    enqueueOutbox('@a:x', entry('t1', '!other:x', 'elsewhere'));
    expect(renderToStaticMarkup(<RoomOutbox mx={mx} roomId="!r:x" />)).toBe('');
  });

  it('shows a fresh send as Sending with its text and no Resend', () => {
    enqueueOutbox('@a:x', entry('t1', '!r:x', 'on its way'), Date.now() + 1000);
    const html = renderToStaticMarkup(<RoomOutbox mx={mx} roomId="!r:x" />);
    expect(html).toContain('data-outbox-status="pending"');
    expect(text(html)).toContain('Sending…');
    expect(text(html)).toContain('on its way');
    expect(text(html)).not.toContain('Resend');
  });

  it('shows a failed send with its error, Resend and Discard', () => {
    enqueueOutbox('@a:x', entry('t2', '!r:x', 'did not go'));
    failOutbox('@a:x', 't2', 'ECONNRESET');
    const html = renderToStaticMarkup(<RoomOutbox mx={mx} roomId="!r:x" />);
    expect(html).toContain('data-outbox-status="failed"');
    expect(text(html)).toContain('Not sent: ECONNRESET');
    expect(text(html)).toContain('Resend');
    expect(text(html)).toContain('Discard');
  });

  it('shows a send left over from before this page load as interrupted, resendable', () => {
    enqueueOutbox('@a:x', entry('t3', '!r:x', 'lost to a reload'), 5);
    const html = renderToStaticMarkup(<RoomOutbox mx={mx} roomId="!r:x" />);
    expect(text(html)).toContain('Interrupted by a reload');
    expect(text(html)).toContain('Resend');
  });
});
