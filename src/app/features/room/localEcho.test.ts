import { describe, expect, it } from 'vitest';
import { EventStatus } from 'matrix-js-sdk';
import { isUnconfirmedLocalEcho } from './localEcho';

describe('isUnconfirmedLocalEcho', () => {
  it.each([
    EventStatus.ENCRYPTING,
    EventStatus.QUEUED,
    EventStatus.SENDING,
    EventStatus.NOT_SENT,
    EventStatus.CANCELLED,
  ])('hides %s', (status) => {
    expect(isUnconfirmedLocalEcho({ status })).toBe(true);
  });

  it('shows a server-confirmed event and one the server has accepted (SENT)', () => {
    expect(isUnconfirmedLocalEcho({ status: null })).toBe(false);
    expect(isUnconfirmedLocalEcho({ status: EventStatus.SENT })).toBe(false);
  });
});
