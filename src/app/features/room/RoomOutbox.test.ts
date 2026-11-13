import { describe, expect, it } from 'vitest';
import { SLOW_SEND_MS, outboxView } from './RoomOutbox';

describe('outboxView', () => {
  it('walks sending -> still sending (resendable) -> failed', () => {
    expect(outboxView({ status: 'pending', ts: 100 }, 100, 0)).toMatchObject({
      label: 'Sending…',
      canResend: false,
    });
    expect(outboxView({ status: 'pending', ts: 100 }, 100 + SLOW_SEND_MS, 0)).toMatchObject({
      label: expect.stringMatching(/^Still sending/),
      canResend: true,
    });
    expect(outboxView({ status: 'failed', ts: 100, error: 'x' }, 100, 0)).toMatchObject({
      failed: true,
      canResend: true,
    });
  });

  it('offers Resend to a pending send at 30 s and not a millisecond before', () => {
    const at = (ms: number) => outboxView({ status: 'pending', ts: 100 }, 100 + ms, 0).canResend;
    expect([at(29_999), at(30_000)]).toEqual([false, true]);
  });

  it('an entry older than this page load reads as interrupted', () => {
    expect(outboxView({ status: 'pending', ts: 5 }, 6, 10).label).toMatch(/Interrupted/);
  });
});
